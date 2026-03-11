# A1 — Self-Hosted AI Agent Platform

A self-hosted, multi-user AI agent platform with first-class MCP (Model Context Protocol) support. Run agents backed by Grok, OpenAI, or Anthropic, connect them to tools like Gmail, Google Drive, Calendar, and custom MCP servers, and schedule autonomous jobs.

## Features

- **Multi-user**: Magic link login via email (AWS SES); invite-code-based registration
- **Agent Roles**: Per-role system prompts, model selection, and MCP server sets; switch roles mid-conversation
- **Multi-LLM**: Grok (default), OpenAI, and Anthropic/Claude; optional keyword-based model router
- **Built-in MCP Servers**: Weather, Gmail, Google Drive, Google Calendar, Memory, Scheduler, Fetch URL, MarkItDown, SMTP/IMAP, Alpha Vantage, Twelve Data, and more — all running in-process for low latency
- **External MCP Servers**: Add any stdio-compatible MCP server (GitHub, Brave Search, custom tools)
- **Connected Accounts**: Link Google (Gmail, Drive, Calendar) and GitHub accounts after login; multiple Google accounts supported with automatic fan-out across Gmail and Drive
- **Memory System**: Per-role knowledge graph (entities + relations) backed by SQLite locally or DynamoDB in production
- **Scheduled Jobs**: Lambda-based job runner for autonomous background tasks with two-phase tool discovery
- **Discord Bot**: Expose any agent role to Discord; responds to @mentions or auto-replies in configured channels
- **Split-pane UI**: Chat on the left, file/email/document viewer on the right; responsive mobile layout with cross-device message sync
- **Token Usage Tracking**: Per-user cost accounting across all LLM providers
- **OAuth Token Security**: AES-256 encryption via AWS KMS; can be disabled for local dev without AWS

## Tech Stack

**Backend:** Bun, TypeScript, Fastify, SQLite (dev) / DynamoDB (prod)

**Frontend:** React 18, Vite, Tailwind CSS, shadcn/ui, TanStack Query, Zustand

**LLM Providers:** xAI Grok (`grok-4-1-fast-reasoning` default), OpenAI, Anthropic Claude

**AWS (optional/production):** S3, DynamoDB, KMS, SES, Lambda

## Quick Start

### Docker

```bash
cp .env.example server/.env.production
# Edit server/.env.production — set AUTH_SECRET and at least one LLM API key

docker compose up -d
```

The app is available at `http://localhost:3000`.

> **Note:** The default `docker-compose.yml` is tuned for production (S3 + DynamoDB + KMS). For a purely local setup, set `STORAGE_TYPE=fs`, `MAIN_DB_TYPE=sqlite`, and `KMS_OAUTH_DISABLED=true` in your env file.

### Development

```bash
bun install

cp .env.example server/.env.development
# Edit server/.env.development

bun run dev
```

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:3000`

## Configuration

All config is loaded from `.env.<NODE_ENV>` in the `server/` directory.

### Core

| Variable | Description | Default |
|---|---|---|
| `PORT` | Server port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `LOG_LEVEL` | Pino log level | `info` |
| `FRONTEND_URL` | Public frontend URL (used in OAuth redirects) | `http://localhost:5173` |
| `AUTH_SECRET` | Session signing secret | random UUID — always set in production |

### LLM

| Variable | Description | Default |
|---|---|---|
| `LLM_PROVIDER` | `grok` \| `openai` \| `anthropic` | `grok` |
| `GROK_API_KEY` | xAI API key | |
| `OPENAI_API_KEY` | OpenAI API key | |
| `ANTHROPIC_API_KEY` | Anthropic API key | |
| `DEFAULT_MODEL` | Override the provider's default model | |
| `ROUTER_ENABLED` | Enable keyword-based model routing | `false` |

### Storage

| Variable | Description | Default |
|---|---|---|
| `STORAGE_TYPE` | `fs` \| `sqlite` \| `s3` | `fs` |
| `STORAGE_ROOT` | Local data directory | `./data` |
| `STORAGE_BUCKET` | S3 bucket (when `STORAGE_TYPE=s3`) | |
| `DATABASE_PATH` | SQLite main DB path | `./data/metadata.db` |
| `MAIN_DB_TYPE` | `sqlite` \| `dynamodb` | `sqlite` |
| `DYNAMODB_TABLE_PREFIX` | Prefix for DynamoDB table names | |
| `DYNAMODB_REGION` | DynamoDB region | `us-west-2` |

### Connected Accounts (OAuth)

These enable users to link external services after logging in — they are not login providers.

| Variable | Description |
|---|---|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth app (enables Gmail, Drive, Calendar MCP tools) |
| `GOOGLE_REDIRECT_URI` | Google OAuth callback URL |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth app (enables GitHub MCP server) |
| `GITHUB_REDIRECT_URI` | GitHub OAuth callback URL |

### AWS

| Variable | Description | Default |
|---|---|---|
| `AWS_REGION` | AWS region | `us-west-2` |
| `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Credentials (or use instance role / `~/.aws`) | |
| `KMS_OAUTH_KEY_ID` | KMS key alias or ARN for OAuth token encryption | `alias/a1-oauth-tokens` |
| `KMS_OAUTH_DISABLED` | Set `true` to skip KMS (local dev) | |
| `KMS_ENDPOINT` | Custom KMS endpoint (e.g. LocalStack) | |
| `SES_SENDER_EMAIL` | From address for magic link emails | |

### Discord Bot

| Variable | Description |
|---|---|
| `DISCORD_BOT_TOKEN` | Bot token — bot is disabled when unset |
| `DISCORD_CLIENT_ID` | Discord application client ID |
| `DISCORD_CHANNEL_IDS` | Comma-separated channel IDs for auto-respond (optional) |

### MCP

| Variable | Description | Default |
|---|---|---|
| `ENABLE_META_MCP_SEARCH` | Enable semantic tool discovery | `true` |

## Built-in MCP Servers

These run in-process (no subprocess overhead):

| Server | Auth | Notes |
|---|---|---|
| Weather | None | NOAA + Open-Meteo; forecasts, alerts, air quality, marine |
| Memory | None | Per-role knowledge graph; SQLite locally, DynamoDB in production |
| Fetch URL | None | Fetches pages/APIs, converts HTML to markdown |
| MarkItDown | None | Converts PDF, DOCX, XLSX, PPTX, images to markdown |
| Process Each | None | Runs a focused AI call per item to avoid context overflow |
| Role Manager | None | Lets the AI switch the active role |
| Scheduler | None | Schedule autonomous background jobs |
| Gmail | Google OAuth | Read, search, send email; supports multiple Google accounts |
| Google Drive | Google OAuth | Browse and read Drive files; supports multiple accounts |
| Google Calendar | Google OAuth | List events, create meetings |
| SMTP / IMAP Email | Credentials | Any mail provider via standard protocols |
| Alpha Vantage | API key | Stocks, forex, crypto, economic indicators |
| Twelve Data | API key | Real-time and historical market data |
| Meta MCP Search | None | Semantic tool discovery — the AI's entry point to all tools |

External servers (stdio subprocess) can be added per-role through the MCP settings panel: GitHub, Brave Search, or any custom server.

## Project Structure

```
├── client/                   # React frontend
│   └── src/
│       ├── components/       # UI components (chat pane, viewer pane, dialogs)
│       ├── hooks/            # Custom React hooks
│       ├── lib/              # API client, preview adapters (PDF, image, email)
│       └── pages/            # Login, OAuth callback, Join
├── server/                   # Fastify backend
│   └── src/
│       ├── ai/               # LLM providers (Grok, OpenAI, Anthropic) + router
│       ├── api/              # REST route handlers
│       ├── auth/             # Session auth, magic link, Google/GitHub OAuth (connected accounts)
│       ├── config/           # App config
│       ├── discord/          # Discord bot
│       ├── mcp/
│       │   ├── adapters/     # BaseStdioAdapter, InProcessAdapter, MultiAccountAdapter, registry
│       │   └── in-process/   # Built-in MCP server implementations
│       ├── scheduler/        # Lambda-based autonomous job runner
│       ├── storage/          # FS, SQLite, S3, DynamoDB adapters
│       └── utils/            # Shared utilities
└── shared/                   # TypeScript types and Zod schemas shared by client + server
```

## License

MIT
