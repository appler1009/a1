/**
 * Integration tests for auth HTTP routes.
 *
 * Uses bun:test's mock.module() with upfront mock function references and a
 * top-level dynamic import so that mocks are registered before the route
 * module (and its dependencies) are first loaded.
 *
 * Fastify's inject() / light-my-request is incompatible with Bun's
 * http.ServerResponse, so tests use a real listener on a random port with
 * Bun's native fetch().
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import type { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockUser = {
  id: 'user-test-1',
  email: 'alice@example.com',
  name: 'Alice',
  accountType: 'individual' as const,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

const mockSession = {
  id: 'session-test-1',
  userId: 'user-test-1',
  expiresAt: new Date(Date.now() + 86400000),
  createdAt: new Date('2024-01-01'),
};

// ---------------------------------------------------------------------------
// Module mocks — registered before the route module is dynamically imported
// ---------------------------------------------------------------------------

const authServiceMock = {
  getUserByEmail: mock(),
  createUser: mock(),
  createSession: mock(),
  getUser: mock(),
  updateUser: mock(),
  createGroup: mock(),
  getGroupByUrl: mock(),
  createGroupUser: mock(),
  addMember: mock(),
  createInvitation: mock(),
  acceptInvitation: mock(),
  getOAuthToken: mock(),
  saveOAuthToken: mock(),
  revokeOAuthToken: mock(),
  initialize: mock(),
};

mock.module('../auth/index.js', () => ({ authService: authServiceMock }));

mock.module('../auth/google-oauth.js', () => ({
  GoogleOAuthHandler: class {
    getAuthUrl() { return 'https://accounts.google.com/mock'; }
    handleCallback() { return { tokens: {}, email: 'test@gmail.com' }; }
  },
}));

mock.module('../auth/github-oauth.js', () => ({
  GitHubOAuthHandler: class {
    getAuthUrl() { return 'https://github.com/login/oauth/authorize?mock'; }
    handleCallback() { return { token: 'gh-token', username: 'testuser' }; }
  },
}));

mock.module('../storage/index.js', () => ({
  getMainDatabase: mock(() => ({
    saveOAuthToken: mock(),
    getOAuthToken: mock(),
    getAllUserOAuthTokens: mock().mockReturnValue([]),
  })),
}));

// Import the route module after mocks are registered.
const { authRoutes } = await import('../api/auth.js');

// ---------------------------------------------------------------------------
// Test app factory — real listener on a random port, torn down after each test
// ---------------------------------------------------------------------------

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/api/auth`;
  return { app, baseUrl };
}

// ---------------------------------------------------------------------------
// POST /api/auth/check-email
// ---------------------------------------------------------------------------

describe('POST /api/auth/check-email', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    authServiceMock.getUserByEmail.mockReset();
  });

  afterEach(async () => {
    await app.app.close();
  });

  it('returns exists: true when the user is found', async () => {
    authServiceMock.getUserByEmail.mockResolvedValue(mockUser);

    const res = await fetch(`${app.baseUrl}/check-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.exists).toBe(true);
  });

  it('returns exists: false when the user is not found', async () => {
    authServiceMock.getUserByEmail.mockResolvedValue(null);

    const res = await fetch(`${app.baseUrl}/check-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.exists).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------

describe('POST /api/auth/login', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    authServiceMock.getUserByEmail.mockReset();
    authServiceMock.createSession.mockReset();
  });

  afterEach(async () => {
    await app.app.close();
  });

  it('returns 200 with user and session on success', async () => {
    authServiceMock.getUserByEmail.mockResolvedValue(mockUser);
    authServiceMock.createSession.mockResolvedValue(mockSession);

    const res = await fetch(`${app.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe('alice@example.com');
    expect(body.data.session.id).toBe('session-test-1');
  });

  it('sets a session_id cookie on success', async () => {
    authServiceMock.getUserByEmail.mockResolvedValue(mockUser);
    authServiceMock.createSession.mockResolvedValue(mockSession);

    const res = await fetch(`${app.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com' }),
    });

    expect(res.headers.get('set-cookie')).toMatch(/session_id=/);
  });

  it('returns 404 when user does not exist', async () => {
    authServiceMock.getUserByEmail.mockResolvedValue(null);

    const res = await fetch(`${app.baseUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody@example.com' }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.message).toBe('User not found');
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/signup/individual
// ---------------------------------------------------------------------------

describe('POST /api/auth/signup/individual', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    authServiceMock.getUserByEmail.mockReset();
    authServiceMock.createUser.mockReset();
    authServiceMock.createSession.mockReset();
  });

  afterEach(async () => {
    await app.app.close();
  });

  it('creates user and returns 200 with session', async () => {
    authServiceMock.getUserByEmail.mockResolvedValue(null);
    authServiceMock.createUser.mockResolvedValue(mockUser);
    authServiceMock.createSession.mockResolvedValue(mockSession);

    const res = await fetch(`${app.baseUrl}/signup/individual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'new@example.com', name: 'New User' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.user).toBeDefined();
    expect(body.data.session).toBeDefined();
  });

  it('returns 400 when email is already registered', async () => {
    authServiceMock.getUserByEmail.mockResolvedValue(mockUser);

    const res = await fetch(`${app.baseUrl}/signup/individual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', name: 'Alice' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe('Email already registered');
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/signup/group
// ---------------------------------------------------------------------------

describe('POST /api/auth/signup/group', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    authServiceMock.getUserByEmail.mockReset();
    authServiceMock.getGroupByUrl.mockReset();
    authServiceMock.createGroupUser.mockReset();
    authServiceMock.createSession.mockReset();
  });

  afterEach(async () => {
    await app.app.close();
  });

  it('creates group user and returns 200', async () => {
    authServiceMock.getUserByEmail.mockResolvedValue(null);
    authServiceMock.getGroupByUrl.mockResolvedValue(null);
    authServiceMock.createGroupUser.mockResolvedValue({
      user: mockUser,
      group: { id: 'g1', name: 'Acme', createdAt: new Date() },
      invitation: { id: 'inv-1', code: 'TESTCODE', groupId: 'g1', createdBy: mockUser.id, createdAt: new Date() },
    });
    authServiceMock.createSession.mockResolvedValue(mockSession);

    const res = await fetch(`${app.baseUrl}/signup/group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@acme.com', name: 'Admin', groupName: 'Acme', groupUrl: 'acme' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.user).toBeDefined();
  });

  it('returns 400 when group URL is already taken', async () => {
    authServiceMock.getUserByEmail.mockResolvedValue(null);
    authServiceMock.getGroupByUrl.mockResolvedValue({ id: 'g-existing', name: 'Existing', createdAt: new Date() });

    const res = await fetch(`${app.baseUrl}/signup/group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'other@acme.com', name: 'Other', groupName: 'Other Corp', groupUrl: 'taken-url' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toBe('Group URL is already taken');
  });
});
