# Claude Instructions for This Project

## Git Commits
- **Do not create git commits.** The user will handle git commits themselves.
- All code changes should be written and tested, but final commit decisions remain with the user.

## Documentation
- **Do not write documentation** unless explicitly requested by the user.
- Focus on implementation only.

## Dev Server
- **Do not start the dev server** on your own.
- The user has a dev server running all the time for testing.
- Let the user handle server restarts and reloading.

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
