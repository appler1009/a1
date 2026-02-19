# Deployment Environments Guide

This project now supports multiple deployment environments: **development**, **test**, and **production**.

## Environment Setup

### Environment-Specific Configuration Files

Each environment has its own `.env` file located in the `server/` directory:

- **`server/.env.development`** - Local development environment (default)
- **`server/.env.test`** - Testing/staging environment
- **`server/.env.production`** - Production environment
- **`server/.env.example`** - Template with all available variables

## Running Different Environments

### Development (Default)
```bash
# Development mode with hot reload
npm run dev

# Or build and run development server
npm run build:dev
npm run start:dev
```

### Test Environment
```bash
# Build for test
npm run build
NODE_ENV=test npm run start:test

# Or using the provided script
npm run start:test
```

### Production
```bash
# Build for production
npm run build:prod

# Start production server
npm start
```

## Environment Detection in Client

The client automatically detects and displays the current environment in the header:

- **DEVELOPMENT** (blue badge) - Local development
- **TEST** (yellow badge) - Testing/staging
- **PRODUCTION** (red badge) - Production environment

The environment info is fetched from the `/api/env` endpoint on app startup.

## Configuration Variables

### Server Configuration
- `NODE_ENV` - Environment name (development, test, production)
- `PORT` - Server port (default: 3000)
- `HOST` - Server host (default: 0.0.0.0)
- `LOG_LEVEL` - Logging level (debug, info, warn, error)

### Database & Storage
- `DATABASE_PATH` - SQLite database path
- `STORAGE_TYPE` - Storage backend (fs, sqlite, s3)
- `STORAGE_ROOT` - Local storage root directory
- `STORAGE_BUCKET` - S3 bucket name (if using S3)

### Authentication
- `AUTH_SECRET` - Secret key for session management (generate for production!)
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `GOOGLE_REDIRECT_URI` - OAuth redirect URI

### LLM Configuration
- `LLM_PROVIDER` - LLM provider (grok, openai)
- `DEFAULT_MODEL` - Default model to use
- `GROK_API_KEY` - Grok API key
- `OPENAI_API_KEY` - OpenAI API key

## Environment-Specific Defaults

### Development
- Port: 3000
- Log Level: debug
- Storage: Filesystem (`./data`)
- Router Enabled: false

### Test
- Port: 3001 (avoid conflicts)
- Log Level: warn
- Storage: Filesystem (`./data/test`)
- Database: `./data/test-metadata.db`

### Production
- Port: 3000
- Log Level: info
- Storage: Filesystem (recommended: use S3 or other persistent storage)
- Database: `./data/metadata.db`

## API Endpoints

### Get Current Environment
```
GET /api/env
```

Returns:
```json
{
  "success": true,
  "data": {
    "env": "development|test|production",
    "isDevelopment": boolean,
    "isTest": boolean,
    "isProduction": boolean,
    "port": number,
    "host": string
  }
}
```

## Docker Deployment

When using Docker, pass the environment variable:

```bash
# Development
docker run -e NODE_ENV=development -p 3000:3000 local-agent-ui

# Production
docker run -e NODE_ENV=production -p 3000:3000 local-agent-ui
```

## Important Notes for Production

1. **Generate a strong AUTH_SECRET**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

2. **Use environment variables** - Never commit sensitive values to `.env.production`

3. **Consider using S3** - For persistent storage across deployments

4. **Review all environment variables** - Ensure all required OAuth credentials and API keys are set

5. **Enable HTTPS** - In production, ensure your redirect URIs use `https://`

## Switching Environments

The environment is determined by the `NODE_ENV` environment variable:

```bash
# Check current environment
echo $NODE_ENV

# Switch environment (for the current shell session)
export NODE_ENV=production
npm run start

# Or inline
NODE_ENV=production npm run start
```
