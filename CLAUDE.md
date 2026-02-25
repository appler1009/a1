# Claude Instructions for This Project

## Important: Read AGENTS.md First

**Before working on any task, read and follow the instructions in [AGENTS.md](./AGENTS.md).**

Key points from AGENTS.md:
- **Do not create git commits** - The user will handle all git commits
- **Do not write documentation** unless explicitly requested
- **Do not start the dev server** - The user has one running all the time

## Project Context

This is a local AI agent application with:
- **Frontend**: React with TypeScript (client/)
- **Backend**: Fastify server (server/)
- **Shared**: Common types and utilities (shared/)
- **Testing**: Vitest for unit tests, Playwright for E2E tests

## Testing

Run tests with:
```bash
npm run test           # Unit tests
npm run test:e2e      # E2E tests
npm run test:coverage # Coverage report
```

## When Uncertain

Always defer to AGENTS.md for project-specific instructions about git, documentation, and server management.
