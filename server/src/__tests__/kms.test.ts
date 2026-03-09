/**
 * Unit tests for KMS token encryption helpers.
 *
 * Uses a local HTTP server that speaks the KMS JSON protocol so no real
 * AWS credentials or network access are needed.
 *
 * The mock uses an identity transform (ciphertext == plaintext bytes) which
 * is enough to verify the full encode / prefix / decode round-trip.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';

// ── Mock server ───────────────────────────────────────────────────────────────

/** Whether DescribeKey should return NotFoundException (for provisioning test) */
let mockDescribeKeyNotFound = false;

/** Counts how many times Decrypt has been called on the mock server */
let mockDecryptCallCount = 0;

function startMockKmsServer(): Promise<{ url: string; stop: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const target = (req.headers['x-amz-target'] as string) ?? '';
      let body = '';
      req.on('data', chunk => (body += chunk));
      req.on('end', () => {
        const data = JSON.parse(body || '{}');
        res.setHeader('Content-Type', 'application/x-amz-json-1.1');

        if (target.endsWith('Encrypt')) {
          // Identity transform: CiphertextBlob == Plaintext bytes (both base64)
          res.writeHead(200);
          res.end(JSON.stringify({
            CiphertextBlob: data.Plaintext,
            KeyId: data.KeyId,
            EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
          }));
        } else if (target.endsWith('Decrypt')) {
          // Identity reverse: Plaintext == CiphertextBlob bytes
          mockDecryptCallCount++;
          res.writeHead(200);
          res.end(JSON.stringify({
            Plaintext: data.CiphertextBlob,
            KeyId: 'alias/test-oauth-tokens',
            EncryptionAlgorithm: 'SYMMETRIC_DEFAULT',
          }));
        } else if (target.endsWith('DescribeKey')) {
          if (mockDescribeKeyNotFound) {
            res.writeHead(400);
            res.end(JSON.stringify({ __type: 'NotFoundException', message: 'Invalid keyId' }));
          } else {
            res.writeHead(200);
            res.end(JSON.stringify({
              KeyMetadata: {
                KeyId: 'mock-key-id',
                Arn: 'arn:aws:kms:us-east-1:123456789012:key/mock-key-id',
                Enabled: true,
              },
            }));
          }
        } else if (target.endsWith('CreateKey')) {
          res.writeHead(200);
          res.end(JSON.stringify({
            KeyMetadata: {
              KeyId: 'new-mock-key-id',
              Arn: 'arn:aws:kms:us-east-1:123456789012:key/new-mock-key-id',
            },
          }));
        } else if (target.endsWith('CreateAlias')) {
          res.writeHead(200);
          res.end(JSON.stringify({}));
        } else {
          res.writeHead(200);
          res.end(JSON.stringify({}));
        }
      });
    });

    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        stop: () => new Promise<void>((res, rej) => server.close(err => (err ? rej(err) : res()))),
      });
    });
  });
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('KMS token encryption', () => {
  let stopServer: () => Promise<void>;

  beforeAll(async () => {
    // Provide dummy credentials so the SDK can sign requests locally
    process.env.AWS_ACCESS_KEY_ID = 'test';
    process.env.AWS_SECRET_ACCESS_KEY = 'test';
    process.env.AWS_REGION = 'us-east-1';
    delete process.env.AWS_PROFILE; // don't try to load ~/.aws/credentials
    delete process.env.KMS_OAUTH_DISABLED;
    process.env.KMS_OAUTH_KEY_ID = 'alias/test-oauth-tokens';

    const mock = await startMockKmsServer();
    process.env.KMS_ENDPOINT = mock.url;
    stopServer = mock.stop;
  });

  afterAll(async () => {
    await stopServer?.();
  });

  // ── isEncrypted ─────────────────────────────────────────────────────────────

  describe('isEncrypted', () => {
    it('returns true for kms:v1: prefixed values', async () => {
      const { isEncrypted } = await import('../config/kms.js');
      expect(isEncrypted('kms:v1:abc123==')).toBe(true);
    });

    it('returns false for plain text', async () => {
      const { isEncrypted } = await import('../config/kms.js');
      expect(isEncrypted('plain-token')).toBe(false);
      expect(isEncrypted('')).toBe(false);
    });
  });

  // ── encryptToken ────────────────────────────────────────────────────────────

  describe('encryptToken', () => {
    it('returns a kms:v1: prefixed string', async () => {
      const { encryptToken } = await import('../config/kms.js');
      const result = await encryptToken('my-access-token');
      expect(result).toMatch(/^kms:v1:/);
    });

    it('returns plaintext as-is when KMS_OAUTH_DISABLED=true', async () => {
      process.env.KMS_OAUTH_DISABLED = 'true';
      const { encryptToken } = await import('../config/kms.js');
      expect(await encryptToken('raw')).toBe('raw');
      delete process.env.KMS_OAUTH_DISABLED;
    });
  });

  // ── decryptToken ────────────────────────────────────────────────────────────

  describe('decryptToken', () => {
    it('round-trips with encryptToken', async () => {
      const { encryptToken, decryptToken } = await import('../config/kms.js');
      const plaintext = 'super-secret-refresh-token';
      const encrypted = await encryptToken(plaintext);
      expect(await decryptToken(encrypted)).toBe(plaintext);
    });

    it('passes through non-encrypted values', async () => {
      const { decryptToken } = await import('../config/kms.js');
      expect(await decryptToken('legacy-plain-value')).toBe('legacy-plain-value');
    });

    it('returns plaintext as-is when KMS_OAUTH_DISABLED=true', async () => {
      process.env.KMS_OAUTH_DISABLED = 'true';
      const { decryptToken } = await import('../config/kms.js');
      expect(await decryptToken('kms:v1:should-not-decrypt')).toBe('kms:v1:should-not-decrypt');
      delete process.env.KMS_OAUTH_DISABLED;
    });

    it('serves repeated decrypts from in-process cache without extra KMS calls', async () => {
      const { encryptToken, decryptToken } = await import('../config/kms.js');
      const plaintext = 'cached-token-value';
      // encryptToken populates the decrypt cache as a side-effect
      const encrypted = await encryptToken(plaintext);
      const before = mockDecryptCallCount;
      // Both calls should be served from cache — no new Decrypt request to KMS
      expect(await decryptToken(encrypted)).toBe(plaintext);
      expect(await decryptToken(encrypted)).toBe(plaintext);
      expect(mockDecryptCallCount).toBe(before);
    });
  });

  // ── ensureKmsKey ────────────────────────────────────────────────────────────

  describe('ensureKmsKey', () => {
    it('returns empty string when KMS_OAUTH_DISABLED=true', async () => {
      process.env.KMS_OAUTH_DISABLED = 'true';
      const { ensureKmsKey } = await import('../config/kms.js');
      expect(await ensureKmsKey()).toBe('');
      delete process.env.KMS_OAUTH_DISABLED;
    });

    it('skips provisioning and returns the key ID when not an alias', async () => {
      const savedKeyId = process.env.KMS_OAUTH_KEY_ID;
      process.env.KMS_OAUTH_KEY_ID = 'arn:aws:kms:us-east-1:123:key/existing-key';
      const { ensureKmsKey } = await import('../config/kms.js');
      const result = await ensureKmsKey();
      expect(result).toBe('arn:aws:kms:us-east-1:123:key/existing-key');
      process.env.KMS_OAUTH_KEY_ID = savedKeyId;
    });

    it('returns existing key ARN when alias already exists', async () => {
      mockDescribeKeyNotFound = false;
      const { ensureKmsKey } = await import('../config/kms.js');
      const arn = await ensureKmsKey();
      expect(arn).toBe('arn:aws:kms:us-east-1:123456789012:key/mock-key-id');
    });

    it('creates key and alias when alias not found', async () => {
      mockDescribeKeyNotFound = true;
      const { ensureKmsKey } = await import('../config/kms.js');
      const arn = await ensureKmsKey();
      expect(arn).toBe('arn:aws:kms:us-east-1:123456789012:key/new-mock-key-id');
      mockDescribeKeyNotFound = false;
    });
  });
});
