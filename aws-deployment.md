# AWS Deployment: Storage & Security

## Current State

| Component | Current (local) | AWS target |
|---|---|---|
| Relational data (users, sessions, roles, etc.) | SQLite `main.db` | DynamoDB (`MAIN_DB_TYPE=dynamodb`) |
| Chat messages | SQLite `main.db` | DynamoDB (same tables) |
| File/blob storage | Filesystem | S3 — already implemented (`STORAGE_TYPE=s3`) |
| Secrets | `.env` file | Secrets Manager |

**Blocking issue for ECS Fargate**: ECS Fargate has ephemeral local disk. `main.db` (SQLite) must be replaced before deploying. Set `MAIN_DB_TYPE=dynamodb` to use the DynamoDB implementation. Alternatively, mount EFS at `/app/data` for a zero-code-change SQLite path.

---

## Environment Variables

### Core (required)

```bash
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
AUTH_SECRET=<64-char-random-string>      # Never use the default
FRONTEND_URL=https://<your-domain>       # Used for OAuth callback URLs
```

### Database (required for AWS)

```bash
# Option A — DynamoDB (recommended)
MAIN_DB_TYPE=dynamodb
DYNAMODB_REGION=us-east-1
# DYNAMODB_TABLE_PREFIX=prod_   # Optional: prefix all table names (e.g. prod_users)
# Credentials come from the ECS task IAM role — no keys needed

# Option B — SQLite on EFS (no code changes, mount EFS at /app/data)
# No extra env vars needed; ECS task definition provides the EFS volume mount.
```

### Blob storage (required for AWS)

```bash
STORAGE_TYPE=s3
STORAGE_BUCKET=<your-bucket-name>
STORAGE_REGION=us-east-1
# Credentials come from the ECS task IAM role — no keys needed
```

### LLM provider (required — pick one)

```bash
LLM_PROVIDER=anthropic          # or openai, grok
DEFAULT_MODEL=claude-sonnet-4-6
ANTHROPIC_API_KEY=<key>
# OPENAI_API_KEY=<key>
# GROK_API_KEY=<key>
```

### OAuth (optional — enable per provider)

```bash
GOOGLE_CLIENT_ID=<id>
GOOGLE_CLIENT_SECRET=<secret>
GOOGLE_REDIRECT_URI=https://<domain>/api/auth/google/callback

GMAIL_CLIENT_ID=<id>
GMAIL_CLIENT_SECRET=<secret>
GMAIL_REDIRECT_URI=https://<domain>/api/gmail/callback

GITHUB_CLIENT_ID=<id>
GITHUB_CLIENT_SECRET=<secret>
GITHUB_REDIRECT_URI=https://<domain>/api/auth/github/callback
```

### Discord bot (optional)

```bash
DISCORD_BOT_TOKEN=<token>
DISCORD_CLIENT_ID=<id>
DISCORD_CHANNEL_IDS=<comma-separated-channel-ids>
```

### Feature flags

```bash
ROUTER_ENABLED=false             # Enable multi-model routing
ENABLE_META_MCP_SEARCH=false     # Semantic search over MCP tools
LOG_LEVEL=info                   # debug | info | warn | error
```

---

## ECS Fargate Deployment

### Architecture

```
Internet
    │
    ▼
ALB (public subnets, port 443/80)
    │
    ▼
ECS Fargate task (private subnets, port 3000)
    ├── DynamoDB (via VPC Gateway Endpoint)
    ├── S3 (via VPC Gateway Endpoint)
    ├── KMS (via VPC Interface Endpoint)
    └── Secrets Manager (via VPC Interface Endpoint)
```

### Container image

```bash
# Build
docker build -t a1-app .

# Push to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker tag a1-app:latest <account>.dkr.ecr.us-east-1.amazonaws.com/a1-app:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/a1-app:latest
```

### Healthcheck

The container exposes `GET /health` on port 3000. Configure the ALB target group:
- Protocol: HTTP
- Path: `/health`
- Healthy threshold: 2
- Unhealthy threshold: 3
- Interval: 30s
- Timeout: 10s

### Task definition (key sections)

Secrets are loaded by the app at startup (not via ECS `secrets` injection). Set `AWS_SECRETS_ENABLED=true` in `environment` and the app calls `loadSecrets()` before building the config.

```json
{
  "cpu": "512",
  "memory": "1024",
  "portMappings": [{ "containerPort": 3000 }],
  "environment": [
    { "name": "NODE_ENV",              "value": "production" },
    { "name": "PORT",                  "value": "3000" },
    { "name": "FRONTEND_URL",          "value": "https://<your-domain>" },
    { "name": "AWS_SECRETS_ENABLED",   "value": "true" },
    { "name": "AWS_REGION",            "value": "us-east-1" },
    { "name": "MAIN_DB_TYPE",          "value": "dynamodb" },
    { "name": "DYNAMODB_REGION",       "value": "us-east-1" },
    { "name": "STORAGE_TYPE",          "value": "s3" },
    { "name": "STORAGE_BUCKET",        "value": "<bucket>" },
    { "name": "STORAGE_REGION",        "value": "us-east-1" },
    { "name": "LLM_PROVIDER",          "value": "anthropic" },
    { "name": "DEFAULT_MODEL",         "value": "claude-sonnet-4-6" },
    { "name": "GOOGLE_REDIRECT_URI",   "value": "https://<your-domain>/api/auth/google/callback" },
    { "name": "GMAIL_REDIRECT_URI",    "value": "https://<your-domain>/api/gmail/callback" },
    { "name": "GITHUB_REDIRECT_URI",   "value": "https://<your-domain>/api/auth/github/callback" }
  ]
}
```

All secrets (`AUTH_SECRET`, API keys, OAuth credentials, Discord token) are fetched from Secrets Manager by the app — no `secrets` array is needed in the task definition.

### OAuth redirect URIs

Update each OAuth app's console with production URIs before deploying:

| Provider | Console URL | Redirect URI |
|---|---|---|
| Google | console.cloud.google.com → APIs & Services → Credentials | `https://<domain>/api/auth/google/callback` |
| Gmail | Same Google project, Gmail API OAuth client | `https://<domain>/api/gmail/callback` |
| GitHub | github.com → Settings → Developer settings → OAuth Apps | `https://<domain>/api/auth/github/callback` |

---

## Storage Architecture

### DynamoDB (primary — all relational data)

Everything in `main.db` maps to DynamoDB. Set `MAIN_DB_TYPE=dynamodb` at runtime.

**Why DynamoDB first:**
- Serverless, pay-per-request, no cluster to manage
- TTL on sessions and invitations — auto-deleted without a cron job
- Transact writes used for atomic operations (e.g. `acceptInvitation`)
- All existing access patterns (get by ID, query by userId/groupId/email) map cleanly to PK + GSI

**Aurora Serverless v2 is not needed** for this application's current access patterns. All message pagination and search can be handled by DynamoDB (cursor pagination via sort key ranges, keyword search via `contains` filter expression).

#### Table design

All table names accept an optional prefix via `DYNAMODB_TABLE_PREFIX` (e.g. `prod_` → `prod_users`).

| Table | PK | SK | GSIs | Notes |
|---|---|---|---|---|
| `users` | `userId` | — | `email-index` (PK: email), `discordUserId-index` (sparse) | |
| `sessions` | `sessionId` | — | `userId-index` | TTL attribute: `ttl` (Unix seconds) |
| `groups` | `groupId` | — | `url-index` (sparse) | |
| `memberships` | `groupId` | `userId` | `userId-index` | Composite PK for O(1) lookup |
| `invitations` | `invitationId` | — | `code-index`, `groupId-index` | TTL attribute: `ttl` |
| `roles` | `roleId` | — | `userId-index`, `groupId-index` (sparse) | |
| `oauth_tokens` | `userId` | `providerKey` (`provider#email`) | `accountEmail-index` (PK: provider, SK: accountEmail) | |
| `mcp_servers` | `serverId` | — | — | Small table, Scan acceptable |
| `settings` | `settingKey` | — | — | Tiny table, Scan acceptable |
| `skills` | `skillId` | — | — | Small table, Scan acceptable |
| `messages` | `roleKey` (`userId#roleId`) | `sortKey` (`createdAt#messageId`) | — | Cursor pagination: `sortKey < before DESC LIMIT N` |
| `scheduled_jobs` | `jobId` | — | `userId-index`, `typeStatus-runAt-index`, `typeStatus-holdUntil-index` | `typeStatus` = `once#pending` for GSI |

#### Provisioning checklist

Each table needs:
- **Billing mode**: `PAY_PER_REQUEST`
- **Encryption**: KMS (`aws:owned` or customer-managed)
- **TTL**: enable on `sessions` and `invitations` tables (attribute: `ttl`)
- **GSIs**: as shown in the table above (on-demand billing, same as base table)

#### `scheduled_jobs` GSI design

| GSI name | PK | SK | Purpose |
|---|---|---|---|
| `userId-index` | `userId` | — | `listScheduledJobs(userId)` |
| `typeStatus-runAt-index` | `typeStatus` | `runAt` | `getDueOnceJobs()` — query `once#pending`, SK ≤ now |
| `typeStatus-holdUntil-index` | `typeStatus` | `holdUntil` | `getPendingRecurringJobs()` — query `recurring#pending`, SK ≤ now |

The `typeStatus` attribute is a composite string (`scheduleType#status`, e.g. `once#pending`). It is kept in sync whenever `updateScheduledJobStatus` changes the status.

---

### S3 (file/blob storage)

Already implemented in `server/src/storage/s3-adapter.ts`. Set:

```bash
STORAGE_TYPE=s3
STORAGE_BUCKET=<bucket-name>
STORAGE_REGION=<region>
```

Enable **SSE-KMS** on the bucket and block all public access.

---

## Security

### Secrets Management

The app fetches secrets from Secrets Manager at startup when `AWS_SECRETS_ENABLED=true` is set (via `loadSecrets()` in `server/src/config/secrets.ts`). Each secret is read and written to `process.env`, then `initConfig()` snapshots those values into the typed `AppConfig` singleton. Existing env vars always win over Secrets Manager, so individual values can be overridden in the task definition without editing the secret.

| Secret path | Format | Env vars populated |
|---|---|---|
| `app/auth-secret` | Plain string | `AUTH_SECRET` |
| `app/llm-keys` | JSON `{ anthropic, openai, grok }` | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GROK_API_KEY` |
| `app/oauth-google` | JSON `{ clientId, clientSecret }` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` |
| `app/oauth-gmail` | JSON `{ clientId, clientSecret }` | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` |
| `app/oauth-github` | JSON `{ clientId, clientSecret }` | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` |
| `app/discord` | JSON `{ token, clientId }` | `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID` |

`app/auth-secret` is **required** — startup fails if it cannot be loaded. All other secrets are optional and produce a warning if missing.

**Not stored in Secrets Manager** — set these in the task definition `environment` array:
- OAuth redirect URIs (`GOOGLE_REDIRECT_URI`, `GMAIL_REDIRECT_URI`, `GITHUB_REDIRECT_URI`) — must point to your production domain
- `DISCORD_CHANNEL_IDS` — comma-separated list of channel IDs the bot listens in
- All infrastructure variables (`MAIN_DB_TYPE`, `DYNAMODB_REGION`, `STORAGE_TYPE`, etc.)

### Why not AWS Secrets Manager for OAuth tokens

Secrets Manager is designed for static, long-lived service credentials. OAuth tokens are per-user, per-provider, and rotate frequently (access tokens expire hourly; refresh tokens rotate on use). Using Secrets Manager for OAuth tokens would cost ~$0.40/token/month and hit API rate limits under moderate traffic. Store them in the DynamoDB `oauth_tokens` table instead, with application-level KMS encryption (see below).

---

### Encryption

#### At rest (enable at provisioning — no code changes)

| Service | Setting |
|---|---|
| DynamoDB | Enable encryption at rest (SSE with AWS-owned or KMS key) |
| S3 | Enable SSE-KMS on the bucket |

#### Application-level encryption for OAuth tokens

KMS at-rest encryption protects storage media. It does not protect against compromised AWS credentials with direct DynamoDB read access. Because OAuth tokens represent delegated access to users' Gmail, Google Drive, and GitHub accounts, encrypt the `accessToken` and `refreshToken` values at the application level before writing to DynamoDB.

Use **AWS KMS envelope encryption**:

1. **Write**: call `GenerateDataKey` to get a plaintext + encrypted data key pair. Encrypt the token with the plaintext key. Store the ciphertext and the encrypted data key together.
2. **Read**: call `Decrypt` to recover the data key. Decrypt the token value.

Cost: ~$0.03 per 10,000 KMS API calls — negligible.

#### Messages (at-rest only)

Application-level encryption on message content would break keyword search. KMS at-rest encryption on DynamoDB is sufficient.

---

### Network isolation

**VPC layout:**
- ECS tasks run in **private subnets**
- S3 accessed via **VPC Gateway Endpoint** (free)
- DynamoDB accessed via **VPC Gateway Endpoint** (free)
- ALB in **public subnets**, forwards to ECS on port 3000

**Security groups:**
- ECS task SG: allow inbound from ALB SG only
- No `0.0.0.0/0` inbound to the app tier (DynamoDB is accessed via endpoint, not a security group)

---

### IAM (ECS task role — least privilege)

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem",
        "dynamodb:DeleteItem", "dynamodb:Query", "dynamodb:Scan",
        "dynamodb:BatchWriteItem", "dynamodb:TransactWriteItems"
      ],
      "Resource": [
        "arn:aws:dynamodb:<region>:<account>:table/<prefix>*",
        "arn:aws:dynamodb:<region>:<account>:table/<prefix>*/index/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::<bucket-name>",
        "arn:aws:s3:::<bucket-name>/*"
      ]
    },
    {
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:GenerateDataKey"],
      "Resource": "arn:aws:kms:<region>:<account>:key/<oauth-token-key-id>"
    },
    {
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": [
        "arn:aws:secretsmanager:<region>:<account>:secret:app/auth-secret-*",
        "arn:aws:secretsmanager:<region>:<account>:secret:app/llm-keys-*",
        "arn:aws:secretsmanager:<region>:<account>:secret:app/oauth-*"
      ]
    }
  ]
}
```

---

### In-memory cache

`server/src/mcp/tool-cache.ts` uses a process-local `Map` with a 5-minute TTL. Sufficient for a single ECS task. If scaling to multiple tasks, replace with **ElastiCache for Redis**.

---

## Minimal AWS Stack Checklist

- [ ] VPC with public + private subnets (at least 2 AZs)
- [ ] Internet Gateway + NAT Gateway (for outbound from private subnets)
- [ ] S3 bucket (block public access, enable SSE-KMS)
- [ ] S3 VPC Gateway Endpoint
- [ ] DynamoDB VPC Gateway Endpoint
- [ ] DynamoDB tables (see Storage Architecture above) with on-demand billing
- [ ] Secrets Manager secrets (see table above)
- [ ] Secrets Manager VPC Interface Endpoint
- [ ] KMS key for OAuth token encryption (optional, add later)
- [ ] ECR repository for container image
- [ ] ECS cluster + Fargate task definition
- [ ] ECS task IAM role (see policy above)
- [ ] ALB + target group (healthcheck: `GET /health`)
- [ ] ACM certificate for your domain
- [ ] Route 53 record (or CNAME) pointing to ALB DNS name
- [ ] OAuth redirect URIs updated in each provider's console
