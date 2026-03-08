/**
 * AWS KMS token encryption.
 *
 * OAuth tokens are encrypted at rest using a customer-managed KMS key
 * (AWS-managed key material). Encrypted values are stored with a `kms:v1:`
 * prefix so plaintext values can be detected (e.g. during migration).
 *
 * Decrypted values are cached in a process-level Map so each unique
 * ciphertext is only decrypted once per process lifetime.
 *
 * Required environment variable:
 *   KMS_OAUTH_KEY_ID  — Key ID, ARN, or alias (e.g. alias/a1-oauth-tokens).
 *                       Defaults to "alias/a1-oauth-tokens".
 *
 * Set KMS_OAUTH_DISABLED=true to disable encryption (local dev without AWS).
 */

import {
  KMSClient,
  EncryptCommand,
  DecryptCommand,
  CreateKeyCommand,
  CreateAliasCommand,
  DescribeKeyCommand,
  type KMSClientConfig,
} from '@aws-sdk/client-kms';
import { getAwsCredentials } from './aws.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const ENCRYPTED_PREFIX = 'kms:v1:';

// ── Singletons ────────────────────────────────────────────────────────────────

let _client: KMSClient | null = null;

function getClient(): KMSClient {
  if (!_client) {
    const region = process.env.AWS_REGION ?? process.env.DYNAMODB_REGION ?? 'us-west-2';
    const config: KMSClientConfig = { region, credentials: getAwsCredentials() };
    if (process.env.KMS_ENDPOINT) {
      config.endpoint = process.env.KMS_ENDPOINT;
    }
    _client = new KMSClient(config);
  }
  return _client;
}

function getKeyId(): string {
  return process.env.KMS_OAUTH_KEY_ID ?? 'alias/a1-oauth-tokens';
}

// ── In-memory decrypt cache ───────────────────────────────────────────────────

// Key: encrypted base64 string (with prefix); value: plaintext
const _decryptCache = new Map<string, string>();

// ── Public API ────────────────────────────────────────────────────────────────

/** Returns true if the value was encrypted by this module. */
export function isEncrypted(value: string): boolean {
  return value.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Encrypt a plaintext token value.
 *
 * Returns a `kms:v1:<base64>` string safe for storage.
 * No-op (returns value as-is) when KMS_OAUTH_DISABLED=true.
 */
export async function encryptToken(plaintext: string): Promise<string> {
  if (process.env.KMS_OAUTH_DISABLED === 'true') return plaintext;

  const { CiphertextBlob } = await getClient().send(
    new EncryptCommand({ KeyId: getKeyId(), Plaintext: Buffer.from(plaintext, 'utf-8') }),
  );
  if (!CiphertextBlob) throw new Error('[kms] encrypt returned no ciphertext');

  const encrypted = ENCRYPTED_PREFIX + Buffer.from(CiphertextBlob).toString('base64');
  _decryptCache.set(encrypted, plaintext);
  return encrypted;
}

/**
 * Decrypt a token value produced by `encryptToken`.
 *
 * - Values without the `kms:v1:` prefix are returned as-is (plaintext passthrough
 *   for backward compatibility during and after migration).
 * - Decrypted values are cached in memory for the lifetime of the process.
 * - No-op (returns value as-is) when KMS_OAUTH_DISABLED=true.
 */
export async function decryptToken(value: string): Promise<string> {
  if (process.env.KMS_OAUTH_DISABLED === 'true') return value;
  if (!isEncrypted(value)) return value; // plaintext passthrough

  const cached = _decryptCache.get(value);
  if (cached !== undefined) return cached;

  const ciphertextBlob = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
  const { Plaintext } = await getClient().send(new DecryptCommand({ CiphertextBlob: ciphertextBlob }));
  if (!Plaintext) throw new Error('[kms] decrypt returned no plaintext');

  const plaintext = Buffer.from(Plaintext).toString('utf-8');
  _decryptCache.set(value, plaintext);
  return plaintext;
}

// ── Key provisioning ──────────────────────────────────────────────────────────

/**
 * Ensure the KMS key and alias used for OAuth token encryption exist.
 *
 * Called once at server startup when KMS_OAUTH_KEY_ID is not set to a
 * full ARN/key-id (i.e. the default alias path).  Safe to call multiple
 * times — existing keys/aliases are left untouched.
 *
 * Returns the key ARN.
 */
export async function ensureKmsKey(): Promise<string> {
  if (process.env.KMS_OAUTH_DISABLED === 'true') return '';

  const client = getClient();
  const alias = getKeyId();

  // If already pointing at a non-alias key/ARN, skip provisioning.
  if (!alias.startsWith('alias/')) return alias;

  try {
    const { KeyMetadata } = await client.send(new DescribeKeyCommand({ KeyId: alias }));
    const arn = KeyMetadata?.Arn ?? '';
    console.log(`[kms] OAuth token key exists: ${arn}`);
    return arn;
  } catch (err: unknown) {
    if ((err as { name?: string }).name !== 'NotFoundException') throw err;
  }

  // Create the key
  const { KeyMetadata } = await client.send(
    new CreateKeyCommand({
      Description: 'A1 app — OAuth token encryption',
      KeyUsage: 'ENCRYPT_DECRYPT',
      Origin: 'AWS_KMS',
    }),
  );
  const keyId = KeyMetadata?.KeyId;
  const keyArn = KeyMetadata?.Arn ?? '';
  if (!keyId) throw new Error('[kms] CreateKey returned no KeyId');

  // Attach alias
  await client.send(new CreateAliasCommand({ AliasName: alias, TargetKeyId: keyId }));
  console.log(`[kms] Created OAuth token key: ${keyArn} (${alias})`);
  return keyArn;
}
