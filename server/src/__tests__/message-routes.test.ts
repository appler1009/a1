/**
 * Route-level tests for the GET /api/messages endpoint.
 *
 * HTTP query parameters always arrive as strings. The route must parse `limit`
 * with Number() before passing it to the database layer, which (on DynamoDB)
 * requires a real integer and throws
 * "STRING_VALUE cannot be converted to Integer" otherwise.
 *
 * These tests create a minimal Fastify app that replicates the route's parsing
 * logic and use a captured mock to assert that the database receives the correct
 * types.
 */

import { describe, it, expect, mock, afterEach } from 'bun:test';
import Fastify from 'fastify';
import type { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const mockUser = { id: 'user-1' };
const mockRole = { id: 'role-1', userId: 'user-1', name: 'Test Role' };
const mockMessages = [
  { id: 'msg-1', roleId: 'role-1', userId: 'user-1', groupId: null, from: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00.000Z' },
];

// ---------------------------------------------------------------------------
// App factory
//
// Builds a minimal Fastify server that replicates the GET /messages route
// handler from index.ts.  The DB calls are captured so tests can assert on
// the exact arguments that reach the database layer.
// ---------------------------------------------------------------------------

function buildApp(listMessagesMock: ReturnType<typeof mock>) {
  const app = Fastify({ logger: false });

  // Simulate the auth preHandler that sets request.user
  app.addHook('preHandler', async (request) => {
    (request as any).user = mockUser;
  });

  // Route handler mirrors the production code in index.ts
  app.get('/messages', async (request, reply) => {
    const query = request.query as { roleId?: string; limit?: string; before?: string };
    const roleId = query.roleId;

    if (!roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    // Verify role ownership (mocked inline)
    const role = mockRole;
    if (!role || role.userId !== (request as any).user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    // THE FIX: convert the string query param to a number before passing to the DB
    const limit = Number(query.limit) || 50;

    const messages = await listMessagesMock(mockUser.id, roleId, { limit, before: query.before });
    return reply.send({ success: true, data: messages });
  });

  return app;
}

// ---------------------------------------------------------------------------
// GET /messages — limit parsing
// ---------------------------------------------------------------------------

describe('GET /messages - limit query param is parsed as a number', () => {
  let server: ReturnType<typeof Fastify>;
  let baseUrl: string;

  afterEach(async () => {
    await server?.close();
  });

  it('passes a Number to listMessages when limit is given as a URL string', async () => {
    const listMessagesMock = mock().mockResolvedValue(mockMessages);
    server = buildApp(listMessagesMock);
    await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;

    // Simulate what the browser sends: limit=50 is a string in the URL
    const res = await fetch(`${baseUrl}/messages?roleId=role-1&limit=50`);

    expect(res.status).toBe(200);
    expect(listMessagesMock).toHaveBeenCalledTimes(1);

    const [, , options] = listMessagesMock.mock.calls[0] as [string, string, { limit: unknown; before: unknown }];

    // Core assertion: the DB must receive a number, not the string "50"
    expect(typeof options.limit).toBe('number');
    expect(options.limit).toBe(50);
  });

  it('defaults to 50 when limit is omitted', async () => {
    const listMessagesMock = mock().mockResolvedValue(mockMessages);
    server = buildApp(listMessagesMock);
    await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;

    const res = await fetch(`${baseUrl}/messages?roleId=role-1`);

    expect(res.status).toBe(200);

    const [, , options] = listMessagesMock.mock.calls[0] as [string, string, { limit: unknown }];
    expect(options.limit).toBe(50);
    expect(typeof options.limit).toBe('number');
  });

  it('returns 400 when roleId is missing', async () => {
    const listMessagesMock = mock().mockResolvedValue([]);
    server = buildApp(listMessagesMock);
    await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;

    const res = await fetch(`${baseUrl}/messages?limit=50`);
    expect(res.status).toBe(400);
    expect(listMessagesMock).not.toHaveBeenCalled();
  });
});
