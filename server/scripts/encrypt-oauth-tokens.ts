/**
 * One-time migration: encrypt all plaintext OAuth tokens in the database.
 *
 * Detects which backend to use (SQLite or DynamoDB) from environment variables,
 * then encrypts any token that does not already have the `kms:v1:` prefix.
 *
 * Usage:
 *   bun server/scripts/encrypt-oauth-tokens.ts
 *
 * Environment variables:
 *   STORAGE_TYPE             — "dynamodb" selects DynamoDB; everything else uses SQLite
 *   STORAGE_ROOT             — SQLite DB directory (default: ./data)
 *   DYNAMODB_TABLE_PREFIX    — DynamoDB table prefix
 *   AWS_REGION               — AWS region (default: us-west-2)
 *   AWS_PROFILE              — AWS profile for local dev
 *   KMS_OAUTH_KEY_ID         — KMS key alias/ARN (default: alias/a1-oauth-tokens)
 *   KMS_OAUTH_DISABLED       — Set to "true" to skip encryption (dry-run mode)
 *   KMS_ENDPOINT             — Custom KMS endpoint (e.g. LocalStack)
 *
 * The script is idempotent: already-encrypted tokens are skipped.
 */

import path from 'path';
import { encryptToken, isEncrypted, ensureKmsKey } from '../src/config/kms.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isDynamoDB(): boolean {
  return process.env.STORAGE_TYPE === 'dynamodb';
}

function dbPath(): string {
  const root = process.env.STORAGE_ROOT ?? './data';
  return path.resolve(root, 'main.db');
}

function tablePrefix(): string {
  return process.env.DYNAMODB_TABLE_PREFIX ?? '';
}

function awsRegion(): string {
  return process.env.AWS_REGION ?? process.env.DYNAMODB_REGION ?? 'us-west-2';
}

// ── SQLite migration ──────────────────────────────────────────────────────────

async function migrateSQLite(): Promise<void> {
  const { Database } = await import('bun:sqlite');
  const filePath = dbPath();
  console.log(`[migrate] Opening SQLite database: ${filePath}`);
  const db = new Database(filePath);

  const rows = db.prepare(`SELECT rowid, accessToken, refreshToken FROM oauth_tokens`).all() as Array<{
    rowid: number;
    accessToken: string;
    refreshToken: string | null;
  }>;

  console.log(`[migrate] Found ${rows.length} token row(s)`);
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const needsAccessEncrypt = !isEncrypted(row.accessToken);
    const needsRefreshEncrypt = row.refreshToken !== null && !isEncrypted(row.refreshToken);

    if (!needsAccessEncrypt && !needsRefreshEncrypt) {
      skipped++;
      continue;
    }

    const newAccess = needsAccessEncrypt ? await encryptToken(row.accessToken) : row.accessToken;
    const newRefresh = needsRefreshEncrypt && row.refreshToken
      ? await encryptToken(row.refreshToken)
      : row.refreshToken;

    db.prepare(`UPDATE oauth_tokens SET accessToken = ?, refreshToken = ?, updatedAt = ? WHERE rowid = ?`)
      .run(newAccess, newRefresh, new Date().toISOString(), row.rowid);

    updated++;
    process.stdout.write('.');
  }

  db.close();

  if (updated > 0) process.stdout.write('\n');
  console.log(`[migrate] Done. Updated: ${updated}, already encrypted: ${skipped}`);
}

// ── DynamoDB migration ────────────────────────────────────────────────────────

async function migrateDynamoDB(): Promise<void> {
  const { DynamoDBClient, ScanCommand, UpdateItemCommand } = await import('@aws-sdk/client-dynamodb');
  const { fromIni } = await import('@aws-sdk/credential-providers');

  const region = awsRegion();
  const tableName = `${tablePrefix()}oauth_tokens`;

  const clientConfig: Record<string, unknown> = { region };
  if (process.env.AWS_PROFILE) {
    clientConfig.credentials = fromIni({ profile: process.env.AWS_PROFILE });
  }
  if (process.env.DYNAMODB_ENDPOINT) {
    clientConfig.endpoint = process.env.DYNAMODB_ENDPOINT;
  }

  const client = new DynamoDBClient(clientConfig);
  console.log(`[migrate] Scanning DynamoDB table: ${tableName} (region: ${region})`);

  let lastKey: Record<string, unknown> | undefined;
  let total = 0;
  let updated = 0;
  let skipped = 0;

  do {
    const resp = await client.send(new ScanCommand({
      TableName: tableName,
      ...(lastKey ? { ExclusiveStartKey: lastKey as never } : {}),
    }));

    const items = resp.Items ?? [];
    total += items.length;

    for (const item of items) {
      const accessTokenAttr = item.accessToken;
      const refreshTokenAttr = item.refreshToken;

      const rawAccess = accessTokenAttr?.S ?? '';
      const rawRefresh = refreshTokenAttr?.S ?? null;

      const needsAccessEncrypt = rawAccess !== '' && !isEncrypted(rawAccess);
      const needsRefreshEncrypt = rawRefresh !== null && !isEncrypted(rawRefresh);

      if (!needsAccessEncrypt && !needsRefreshEncrypt) {
        skipped++;
        continue;
      }

      const newAccess = needsAccessEncrypt ? await encryptToken(rawAccess) : rawAccess;
      const newRefresh = needsRefreshEncrypt && rawRefresh ? await encryptToken(rawRefresh) : rawRefresh;

      const expressionParts: string[] = ['#updatedAt = :updatedAt', 'accessToken = :access'];
      const names: Record<string, string> = { '#updatedAt': 'updatedAt' };
      const values: Record<string, unknown> = {
        ':updatedAt': { S: new Date().toISOString() },
        ':access': { S: newAccess },
      };

      if (newRefresh !== null) {
        expressionParts.push('refreshToken = :refresh');
        values[':refresh'] = { S: newRefresh };
      }

      await client.send(new UpdateItemCommand({
        TableName: tableName,
        Key: {
          userId: item.userId,
          providerKey: item.providerKey,
        },
        UpdateExpression: `SET ${expressionParts.join(', ')}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values as never,
      }));

      updated++;
      process.stdout.write('.');
    }

    lastKey = resp.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  if (updated > 0) process.stdout.write('\n');
  console.log(`[migrate] Done. Scanned: ${total}, updated: ${updated}, already encrypted: ${skipped}`);
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (process.env.KMS_OAUTH_DISABLED === 'true') {
    console.warn('[migrate] KMS_OAUTH_DISABLED=true — nothing to do.');
    process.exit(0);
  }

  console.log('[migrate] Ensuring KMS key exists...');
  const keyArn = await ensureKmsKey();
  if (keyArn) console.log(`[migrate] Using key: ${keyArn}`);

  if (isDynamoDB()) {
    await migrateDynamoDB();
  } else {
    await migrateSQLite();
  }
}

main().catch((err) => {
  console.error('[migrate] Fatal error:', err);
  process.exit(1);
});
