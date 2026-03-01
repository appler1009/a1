/**
 * AWS Secrets Manager integration.
 *
 * When AWS_SECRETS_ENABLED=true, loadSecrets() fetches secrets at startup and
 * patches process.env so the rest of the app reads them transparently.
 *
 * Locally (AWS_SECRETS_ENABLED not set), this is a no-op and the app uses
 * environment variables as usual.
 *
 * Env vars always win over Secrets Manager — set an env var to override a
 * secret value without changing the Secrets Manager entry.
 *
 * Secret names default to the paths in docs/aws-deployment.md and can be
 * overridden via environment variables.
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
  type SecretsManagerClientConfig,
} from '@aws-sdk/client-secrets-manager';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SecretMapping {
  /** Secret name or full ARN in Secrets Manager */
  secretId: string;
  /** Apply the fetched string value to process.env. Only called when the secret exists. */
  apply: (value: string) => void;
  /** If true, a missing/unreadable secret aborts startup. Default: false (warn and continue). */
  required?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Only sets the env var if it isn't already defined (env var wins). */
function setIfUnset(key: string, value: string | undefined): void {
  if (value && !process.env[key]) {
    process.env[key] = value;
  }
}

function parseJson(raw: string): Record<string, string> {
  try {
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

// ── Secret mappings ───────────────────────────────────────────────────────────

function appEnv(): string {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  return nodeEnv === 'production' ? 'prod' : nodeEnv;
}

function buildMappings(): SecretMapping[] {
  const env = appEnv();
  return [
    // ── AUTH_SECRET ─────────────────────────────────────────────────────────
    {
      secretId: process.env.SECRET_AUTH_NAME ?? `a1/${env}/auth-secret`,
      required: true,
      apply(value) {
        setIfUnset('AUTH_SECRET', value.trim());
      },
    },

    // ── LLM API keys ────────────────────────────────────────────────────────
    // Secret value: JSON { "anthropic": "sk-ant-...", "openai": "...", "grok": "..." }
    {
      secretId: process.env.SECRET_LLM_KEYS_NAME ?? `a1/${env}/llm-keys`,
      apply(value) {
        const keys = parseJson(value);
        setIfUnset('ANTHROPIC_API_KEY', keys.anthropic);
        setIfUnset('OPENAI_API_KEY', keys.openai);
        setIfUnset('GROK_API_KEY', keys.grok);
      },
    },

    // ── Google OAuth ─────────────────────────────────────────────────────────
    // Secret value: JSON { "clientId": "...", "clientSecret": "..." }
    {
      secretId: process.env.SECRET_OAUTH_GOOGLE_NAME ?? `a1/${env}/oauth-google`,
      apply(value) {
        const creds = parseJson(value);
        setIfUnset('GOOGLE_CLIENT_ID', creds.clientId);
        setIfUnset('GOOGLE_CLIENT_SECRET', creds.clientSecret);
      },
    },

    // ── Gmail OAuth ──────────────────────────────────────────────────────────
    // Secret value: JSON { "clientId": "...", "clientSecret": "..." }
    {
      secretId: process.env.SECRET_OAUTH_GMAIL_NAME ?? `a1/${env}/oauth-gmail`,
      apply(value) {
        const creds = parseJson(value);
        setIfUnset('GMAIL_CLIENT_ID', creds.clientId);
        setIfUnset('GMAIL_CLIENT_SECRET', creds.clientSecret);
      },
    },

    // ── GitHub OAuth ─────────────────────────────────────────────────────────
    // Secret value: JSON { "clientId": "...", "clientSecret": "..." }
    {
      secretId: process.env.SECRET_OAUTH_GITHUB_NAME ?? `a1/${env}/oauth-github`,
      apply(value) {
        const creds = parseJson(value);
        setIfUnset('GITHUB_CLIENT_ID', creds.clientId);
        setIfUnset('GITHUB_CLIENT_SECRET', creds.clientSecret);
      },
    },

    // ── Discord ──────────────────────────────────────────────────────────────
    // Secret value: JSON { "token": "...", "clientId": "..." }
    {
      secretId: process.env.SECRET_DISCORD_NAME ?? `a1/${env}/discord`,
      apply(value) {
        const creds = parseJson(value);
        setIfUnset('DISCORD_BOT_TOKEN', creds.token);
        setIfUnset('DISCORD_CLIENT_ID', creds.clientId);
      },
    },
  ];
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Load secrets from AWS Secrets Manager and patch process.env.
 *
 * No-op when AWS_SECRETS_ENABLED is not set (local development).
 * Call this before reading any secrets from process.env (i.e. before the
 * config object is assembled in index.ts).
 */
export async function loadSecrets(): Promise<void> {
  if (!process.env.AWS_SECRETS_ENABLED) return;

  const region =
    process.env.AWS_REGION ??
    process.env.DYNAMODB_REGION ??
    'us-east-1';

  const clientConfig: SecretsManagerClientConfig = { region };

  // Allow a custom endpoint for local testing (e.g. LocalStack)
  if (process.env.SECRETS_MANAGER_ENDPOINT) {
    clientConfig.endpoint = process.env.SECRETS_MANAGER_ENDPOINT;
  }

  const client = new SecretsManagerClient(clientConfig);
  const mappings = buildMappings();
  const errors: string[] = [];

  await Promise.all(
    mappings.map(async (mapping) => {
      try {
        const { SecretString } = await client.send(
          new GetSecretValueCommand({ SecretId: mapping.secretId }),
        );
        if (SecretString) {
          mapping.apply(SecretString);
        }
      } catch (err: unknown) {
        const name = (err as { name?: string }).name ?? '';
        const isNotFound =
          name === 'ResourceNotFoundException' ||
          name === 'SecretNotFoundException';

        const msg = isNotFound
          ? `[secrets] "${mapping.secretId}" not found in Secrets Manager`
          : `[secrets] Failed to load "${mapping.secretId}": ${(err as Error).message}`;

        if (mapping.required) {
          errors.push(msg);
        } else {
          console.warn(msg);
        }
      }
    }),
  );

  if (errors.length > 0) {
    throw new Error(
      `Failed to load required secrets from AWS Secrets Manager:\n${errors.join('\n')}`,
    );
  }

  console.log(`[secrets] Loaded from AWS Secrets Manager (region: ${region})`);
}
