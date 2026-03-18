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
  { id: 'msg-1', roleId: 'role-1', userId: 'user-1', groupId: null, from: 'user', content: 'Hello', createdAt: '2024-01-01T00:00:00.000Z', isRead: true },
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

// ---------------------------------------------------------------------------
// POST /messages/mark-read
// ---------------------------------------------------------------------------

function buildMarkReadApp(opts: {
  authenticated?: boolean;
  markMessagesReadMock?: ReturnType<typeof mock>;
  getRoleMock?: ReturnType<typeof mock>;
} = {}) {
  const { authenticated = true, markMessagesReadMock = mock().mockResolvedValue(undefined), getRoleMock } = opts;
  const app = Fastify({ logger: false });

  app.addHook('preHandler', async (request) => {
    if (authenticated) (request as any).user = mockUser;
  });

  app.post('/messages/mark-read', async (request, reply) => {
    if (!(request as any).user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    const body = request.body as { roleId?: string };
    if (!body.roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }
    const role = getRoleMock ? await getRoleMock(body.roleId) : mockRole;
    if (!role || role.userId !== (request as any).user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }
    await markMessagesReadMock((request as any).user.id, body.roleId);
    return reply.send({ success: true });
  });

  return app;
}

describe('POST /messages/mark-read', () => {
  let server: ReturnType<typeof Fastify>;
  let baseUrl: string;

  afterEach(async () => {
    await server?.close();
  });

  it('calls markMessagesRead and returns 200 for a valid role', async () => {
    const markMock = mock().mockResolvedValue(undefined);
    server = buildMarkReadApp({ markMessagesReadMock: markMock });
    await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;

    const res = await fetch(`${baseUrl}/messages/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId: 'role-1' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(markMock).toHaveBeenCalledTimes(1);
    const [userId, roleId] = markMock.mock.calls[0] as [string, string];
    expect(userId).toBe('user-1');
    expect(roleId).toBe('role-1');
  });

  it('returns 400 when roleId is missing', async () => {
    server = buildMarkReadApp();
    await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;

    const res = await fetch(`${baseUrl}/messages/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('returns 401 when not authenticated', async () => {
    server = buildMarkReadApp({ authenticated: false });
    await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;

    const res = await fetch(`${baseUrl}/messages/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId: 'role-1' }),
    });

    expect(res.status).toBe(401);
  });

  it('returns 403 when role belongs to a different user', async () => {
    const otherRole = { id: 'role-1', userId: 'other-user', name: 'Other Role' };
    const getRoleMock = mock().mockResolvedValue(otherRole);
    server = buildMarkReadApp({ getRoleMock });
    await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;

    const res = await fetch(`${baseUrl}/messages/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roleId: 'role-1' }),
    });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /messages/unread-counts
// ---------------------------------------------------------------------------

function buildUnreadCountsApp(opts: {
  authenticated?: boolean;
  getUnreadCountsMock?: ReturnType<typeof mock>;
} = {}) {
  const { authenticated = true, getUnreadCountsMock = mock().mockResolvedValue({}) } = opts;
  const app = Fastify({ logger: false });

  app.addHook('preHandler', async (request) => {
    if (authenticated) (request as any).user = mockUser;
  });

  app.get('/messages/unread-counts', async (request, reply) => {
    if (!(request as any).user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    const counts = await getUnreadCountsMock((request as any).user.id);
    return reply.send({ success: true, data: counts });
  });

  return app;
}

describe('GET /messages/unread-counts', () => {
  let server: ReturnType<typeof Fastify>;
  let baseUrl: string;

  afterEach(async () => {
    await server?.close();
  });

  it('returns unread counts for the authenticated user', async () => {
    const countsMock = mock().mockResolvedValue({ 'role-1': 3, 'role-2': 1 });
    server = buildUnreadCountsApp({ getUnreadCountsMock: countsMock });
    await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;

    const res = await fetch(`${baseUrl}/messages/unread-counts`);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual({ 'role-1': 3, 'role-2': 1 });

    expect(countsMock).toHaveBeenCalledTimes(1);
    const [userId] = countsMock.mock.calls[0] as [string];
    expect(userId).toBe('user-1');
  });

  it('returns empty object when no unread messages', async () => {
    const countsMock = mock().mockResolvedValue({});
    server = buildUnreadCountsApp({ getUnreadCountsMock: countsMock });
    await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;

    const res = await fetch(`${baseUrl}/messages/unread-counts`);
    const body = await res.json();
    expect(body.data).toEqual({});
  });

  it('returns 401 when not authenticated', async () => {
    server = buildUnreadCountsApp({ authenticated: false });
    await server.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = `http://127.0.0.1:${(server.server.address() as AddressInfo).port}`;

    const res = await fetch(`${baseUrl}/messages/unread-counts`);
    expect(res.status).toBe(401);
  });
});
