/**
 * Bootstrap DynamoDB tables for the a1 application.
 *
 * Usage:
 *   bun server/scripts/create-dynamodb-tables.ts
 *
 * Environment variables:
 *   AWS_REGION / DYNAMODB_REGION   — defaults to us-east-1
 *   DYNAMODB_TABLE_PREFIX          — optional prefix, e.g. "prod_"
 *   DYNAMODB_ENDPOINT              — optional local endpoint, e.g. http://localhost:8000
 *
 * The script is idempotent: existing tables are left untouched.
 */

import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
  type CreateTableCommandInput,
} from '@aws-sdk/client-dynamodb';

// ── Config ────────────────────────────────────────────────────────────────────

const REGION = process.env.DYNAMODB_REGION ?? process.env.AWS_REGION ?? 'us-east-1';
const ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const PREFIX = process.env.DYNAMODB_TABLE_PREFIX ?? '';

const client = new DynamoDBClient({
  region: REGION,
  ...(ENDPOINT ? { endpoint: ENDPOINT } : {}),
});

function t(name: string) {
  return `${PREFIX}${name}`;
}

// ── Table definitions ─────────────────────────────────────────────────────────

const tables: Array<CreateTableCommandInput & { ttlAttribute?: string }> = [
  // ── users ──────────────────────────────────────────────────────────────────
  {
    TableName: t('users'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'userId',        AttributeType: 'S' },
      { AttributeName: 'email',         AttributeType: 'S' },
      { AttributeName: 'discordUserId', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'userId', KeyType: 'HASH' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'email-index',
        KeySchema: [{ AttributeName: 'email', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'discordUserId-index',
        KeySchema: [{ AttributeName: 'discordUserId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },

  // ── sessions ───────────────────────────────────────────────────────────────
  {
    TableName: t('sessions'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'sessionId', AttributeType: 'S' },
      { AttributeName: 'userId',    AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'sessionId', KeyType: 'HASH' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'userId-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    ttlAttribute: 'ttl', // 30-day session expiry
  },

  // ── groups ─────────────────────────────────────────────────────────────────
  {
    TableName: t('groups'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'groupId', AttributeType: 'S' },
      { AttributeName: 'url',     AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'groupId', KeyType: 'HASH' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'url-index',
        KeySchema: [{ AttributeName: 'url', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },

  // ── memberships ────────────────────────────────────────────────────────────
  // PK=groupId, SK=userId — allows getGroupMembers(groupId) without a GSI
  {
    TableName: t('memberships'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'groupId', AttributeType: 'S' },
      { AttributeName: 'userId',  AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'groupId', KeyType: 'HASH' },
      { AttributeName: 'userId',  KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'userId-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },

  // ── invitations ────────────────────────────────────────────────────────────
  {
    TableName: t('invitations'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'invitationId', AttributeType: 'S' },
      { AttributeName: 'code',         AttributeType: 'S' },
      { AttributeName: 'groupId',      AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'invitationId', KeyType: 'HASH' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'code-index',
        KeySchema: [{ AttributeName: 'code', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'groupId-index',
        KeySchema: [{ AttributeName: 'groupId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
    ttlAttribute: 'ttl', // auto-expire after invitation.expiresAt
  },

  // ── roles ──────────────────────────────────────────────────────────────────
  {
    TableName: t('roles'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'roleId',  AttributeType: 'S' },
      { AttributeName: 'userId',  AttributeType: 'S' },
      { AttributeName: 'groupId', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'roleId', KeyType: 'HASH' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'userId-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'groupId-index',
        KeySchema: [{ AttributeName: 'groupId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },

  // ── oauth_tokens ───────────────────────────────────────────────────────────
  // PK=userId, SK=providerKey (e.g. "google#user@gmail.com")
  {
    TableName: t('oauth_tokens'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'userId',       AttributeType: 'S' },
      { AttributeName: 'providerKey',  AttributeType: 'S' },
      { AttributeName: 'provider',     AttributeType: 'S' },
      { AttributeName: 'accountEmail', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'userId',      KeyType: 'HASH' },
      { AttributeName: 'providerKey', KeyType: 'RANGE' },
    ],
    GlobalSecondaryIndexes: [
      {
        // getOAuthTokenByAccountEmail(provider, accountEmail)
        IndexName: 'accountEmail-index',
        KeySchema: [
          { AttributeName: 'provider',     KeyType: 'HASH' },
          { AttributeName: 'accountEmail', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },

  // ── mcp_servers ────────────────────────────────────────────────────────────
  {
    TableName: t('mcp_servers'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'serverId', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'serverId', KeyType: 'HASH' },
    ],
  },

  // ── settings ───────────────────────────────────────────────────────────────
  {
    TableName: t('settings'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'settingKey', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'settingKey', KeyType: 'HASH' },
    ],
  },

  // ── skills ─────────────────────────────────────────────────────────────────
  {
    TableName: t('skills'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'skillId', AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'skillId', KeyType: 'HASH' },
    ],
  },

  // ── messages ───────────────────────────────────────────────────────────────
  // PK=roleKey (userId#roleId), SK=sortKey (createdAt#messageId)
  {
    TableName: t('messages'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'roleKey',  AttributeType: 'S' },
      { AttributeName: 'sortKey',  AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'roleKey', KeyType: 'HASH' },
      { AttributeName: 'sortKey', KeyType: 'RANGE' },
    ],
  },

  // ── scheduled_jobs ─────────────────────────────────────────────────────────
  // GSI 1: userId-index           — listScheduledJobs(userId)
  // GSI 2: typeStatus-runAt-index — getDueOnceJobs()   PK=typeStatus SK=runAt
  // GSI 3: typeStatus-holdUntil-index — getPendingRecurringJobs()
  {
    TableName: t('scheduled_jobs'),
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'jobId',      AttributeType: 'S' },
      { AttributeName: 'userId',     AttributeType: 'S' },
      { AttributeName: 'typeStatus', AttributeType: 'S' },
      { AttributeName: 'runAt',      AttributeType: 'S' },
      { AttributeName: 'holdUntil',  AttributeType: 'S' },
    ],
    KeySchema: [
      { AttributeName: 'jobId', KeyType: 'HASH' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'userId-index',
        KeySchema: [{ AttributeName: 'userId', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'typeStatus-runAt-index',
        KeySchema: [
          { AttributeName: 'typeStatus', KeyType: 'HASH' },
          { AttributeName: 'runAt',      KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName: 'typeStatus-holdUntil-index',
        KeySchema: [
          { AttributeName: 'typeStatus', KeyType: 'HASH' },
          { AttributeName: 'holdUntil',  KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function tableExists(tableName: string): Promise<boolean> {
  try {
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (err: unknown) {
    if ((err as { name?: string }).name === 'ResourceNotFoundException') return false;
    throw err;
  }
}

async function waitForActive(tableName: string): Promise<void> {
  process.stdout.write(`  Waiting for ${tableName} to become ACTIVE...`);
  for (let i = 0; i < 60; i++) {
    const { Table } = await client.send(new DescribeTableCommand({ TableName: tableName }));
    if (Table?.TableStatus === 'ACTIVE') {
      process.stdout.write(' ACTIVE\n');
      return;
    }
    process.stdout.write('.');
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`Timed out waiting for table ${tableName} to become ACTIVE`);
}

async function enableTTL(tableName: string, attribute: string): Promise<void> {
  await client.send(new UpdateTimeToLiveCommand({
    TableName: tableName,
    TimeToLiveSpecification: { Enabled: true, AttributeName: attribute },
  }));
  console.log(`  TTL enabled on attribute "${attribute}"`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Region:  ${REGION}`);
  console.log(`Prefix:  ${PREFIX || '(none)'}`);
  if (ENDPOINT) console.log(`Endpoint: ${ENDPOINT}`);
  console.log('');

  for (const { ttlAttribute, ...tableInput } of tables) {
    const name = tableInput.TableName as string;
    const exists = await tableExists(name);

    if (exists) {
      console.log(`✓ ${name} (already exists)`);
      continue;
    }

    console.log(`+ Creating ${name}...`);
    await client.send(new CreateTableCommand(tableInput));
    await waitForActive(name);

    if (ttlAttribute) {
      await enableTTL(name, ttlAttribute);
    }

    console.log(`✓ ${name}`);
  }

  console.log('\nAll tables ready.');
}

main().catch(err => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
