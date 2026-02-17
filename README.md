# Local Agent UI with MCP Support

Self-hosted Docker solution for local AI agents with MCP (Model Context Protocol) support. Multi-user, multi-organization platform with role-based agent configurations.

## Features

- **Multi-user & Multi-organization**: Create organizations, invite users, manage roles
- **Agent Roles**: Per-user agent configurations with custom system prompts and models
- **Streaming Chat**: Real-time streaming responses with auto model routing
- **MCP Integration**: Connect to MCP servers for tool calling capabilities
- **Split Pane UI**: Left side for chat, right side for viewer (Gmail, Docs, Files, MCP)
- **Memory System**: Per-role markdown memory with search capabilities
- **Storage Abstraction**: FS (default), SQLite, or S3/MinIO storage backends
- **Dark Theme**: Modern dark UI with resizable panels

## Tech Stack

### Backend
- Node.js 20, TypeScript
- Fastify (web framework)
- Lucia (authentication)
- OpenAI SDK
- Zod (validation)

### Frontend
- React 18, Vite
- Tailwind CSS, shadcn/ui components
- TanStack Query, Zustand
- react-resizable-panels

### Storage
- Abstracted storage interface
- FS (filesystem) adapter - default
- SQLite adapter - for metadata
- S3/MinIO adapter - for scalable storage

## Quick Start

### Using Docker

```bash
# Build and run
docker-compose up -d

# Or with MinIO for S3 storage
docker-compose --profile s3 up -d
```

### Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Edit .env with your configuration
# Required: OPENAI_API_KEY

# Start development servers
npm run dev
```

The application will be available at:
- Frontend: http://localhost:5173
- Backend API: http://localhost:3000

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | 3000 |
| `HOST` | Server host | 0.0.0.0 |
| `AUTH_SECRET` | Session secret | (random UUID) |
| `STORAGE_TYPE` | Storage backend | fs |
| `STORAGE_ROOT` | Storage root path | /app/data |
| `OPENAI_API_KEY` | OpenAI API key | (required) |
| `DEFAULT_MODEL` | Default LLM model | gpt-4 |
| `ROUTER_ENABLED` | Enable model routing | false |

### Storage Configuration

#### Filesystem (default)
```env
STORAGE_TYPE=fs
STORAGE_ROOT=/app/data
```

#### SQLite
```env
STORAGE_TYPE=sqlite
STORAGE_ROOT=/app/data
DATABASE_PATH=/app/data/metadata.db
```

#### S3/MinIO
```env
STORAGE_TYPE=s3
STORAGE_BUCKET=agent
STORAGE_ENDPOINT=http://minio:9000
STORAGE_REGION=us-east-1
STORAGE_ACCESS_KEY=minioadmin
STORAGE_SECRET_KEY=minioadmin
```

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Organizations
- `POST /api/orgs` - Create organization
- `GET /api/orgs/:orgId` - Get organization
- `GET /api/orgs/:orgId/members` - List members
- `POST /api/orgs/:orgId/members` - Add member
- `DELETE /api/orgs/:orgId/members/:userId` - Remove member

### Roles
- `GET /api/orgs/:orgId/roles` - List roles
- `GET /api/orgs/:orgId/roles/:roleId` - Get role
- `POST /api/orgs/:orgId/roles` - Create role
- `PATCH /api/orgs/:orgId/roles/:roleId` - Update role
- `DELETE /api/orgs/:orgId/roles/:roleId` - Delete role

### Chat
- `POST /api/chat/stream` - Stream chat (SSE)
- `GET /api/chat/:conversationId` - Get conversation

### Memory
- `GET /api/memory/:roleId` - Get role memory
- `GET /api/memory/:roleId/search` - Search memory

### MCP
- `GET /api/mcp/servers` - List MCP servers
- `POST /api/mcp/servers` - Add MCP server
- `DELETE /api/mcp/servers/:serverId` - Remove server
- `GET /api/mcp/servers/:serverId/tools` - List tools
- `GET /api/mcp/tools` - List all tools
- `POST /api/mcp/tools/call` - Call a tool

### Viewer
- `GET /api/viewer/files` - List files
- `GET /api/viewer/files/:filename` - Read file
- `POST /api/viewer/files/:filename` - Write file
- `GET /api/viewer/gmail` - List Gmail messages
- `POST /api/viewer/docs/render` - Render markdown

## Project Structure

```
app/
├── shared/              # Shared types and schemas
│   └── src/
│       ├── schemas/     # Zod schemas
│       └── types/       # TypeScript types
├── server/              # Backend server
│   └── src/
│       ├── api/         # API routes
│       ├── ai/          # LLM router
│       ├── auth/        # Authentication
│       ├── mcp/         # MCP client
│       ├── storage/     # Storage adapters
│       └── index.ts     # Entry point
├── client/              # Frontend client
│   └── src/
│       ├── components/  # React components
│       ├── store/       # Zustand stores
│       └── lib/         # Utilities
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## MCP Integration

Connect to MCP servers for tool calling:

```typescript
// Add MCP server
await fetch('/api/mcp/servers', {
  method: 'POST',
  body: JSON.stringify({
    name: 'filesystem',
    transport: 'stdio',
    command: 'mcp-filesystem',
    enabled: true,
  }),
});

// Call tool
await fetch('/api/mcp/tools/call', {
  method: 'POST',
  body: JSON.stringify({
    serverId: 'server-uuid',
    toolName: 'read_file',
    arguments: { path: '/path/to/file' },
  }),
});
```

## License

MIT