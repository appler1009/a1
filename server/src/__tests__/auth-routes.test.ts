/**
 * Integration tests for auth HTTP routes using Fastify's inject() API.
 *
 * The global `authService` singleton is mocked with vi.mock so we don't
 * touch the filesystem or a real database. Each test controls the mock's
 * return values, giving full isolation and determinism.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';

// ---------------------------------------------------------------------------
// Mock the authService singleton before importing the route module
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

// vi.mock hoists to the top of the file, so the mock is applied before imports
vi.mock('../auth/index.js', () => ({
  authService: {
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
    createSession: vi.fn(),
    getUser: vi.fn(),
    updateUser: vi.fn(),
    createGroup: vi.fn(),
    getGroupByUrl: vi.fn(),
    createGroupUser: vi.fn(),
    addMember: vi.fn(),
    createInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
    getOAuthToken: vi.fn(),
    saveOAuthToken: vi.fn(),
    revokeOAuthToken: vi.fn(),
    initialize: vi.fn(),
  },
}));

// Also mock GoogleOAuthHandler and GitHubOAuthHandler so they don't try to
// load credentials from the filesystem during route registration.
vi.mock('../auth/google-oauth.js', () => ({
  GoogleOAuthHandler: class {
    getAuthUrl() { return 'https://accounts.google.com/mock'; }
    handleCallback() { return { tokens: {}, email: 'test@gmail.com' }; }
  },
}));

vi.mock('../auth/github-oauth.js', () => ({
  GitHubOAuthHandler: class {
    getAuthUrl() { return 'https://github.com/login/oauth/authorize?mock'; }
    handleCallback() { return { token: 'gh-token', username: 'testuser' }; }
  },
}));

// Mock getMainDatabase so it doesn't touch the filesystem
vi.mock('../storage/index.js', () => ({
  getMainDatabase: vi.fn(() => ({
    saveOAuthToken: vi.fn(),
    getOAuthToken: vi.fn(),
    getAllUserOAuthTokens: vi.fn().mockReturnValue([]),
  })),
}));

// Import after mocks are registered
import { authService } from '../auth/index.js';
import { authRoutes } from '../api/auth.js';

// ---------------------------------------------------------------------------
// Test app factory — create a fresh Fastify instance per describe block
// ---------------------------------------------------------------------------

async function buildApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
  return app;
}

// ---------------------------------------------------------------------------
// POST /api/auth/check-email
// ---------------------------------------------------------------------------

describe('POST /api/auth/check-email', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    vi.mocked(authService.getUserByEmail).mockReset();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns exists: true when the user is found', async () => {
    vi.mocked(authService.getUserByEmail).mockResolvedValue(mockUser);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/check-email',
      payload: { email: 'alice@example.com' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.exists).toBe(true);
  });

  it('returns exists: false when the user is not found', async () => {
    vi.mocked(authService.getUserByEmail).mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/check-email',
      payload: { email: 'new@example.com' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
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
    vi.mocked(authService.getUserByEmail).mockReset();
    vi.mocked(authService.createSession).mockReset();
  });

  afterEach(async () => {
    await app.close();
  });

  it('returns 200 with user and session on success', async () => {
    vi.mocked(authService.getUserByEmail).mockResolvedValue(mockUser);
    vi.mocked(authService.createSession).mockResolvedValue(mockSession);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.user.email).toBe('alice@example.com');
    expect(body.data.session.id).toBe('session-test-1');
  });

  it('sets a session_id cookie on success', async () => {
    vi.mocked(authService.getUserByEmail).mockResolvedValue(mockUser);
    vi.mocked(authService.createSession).mockResolvedValue(mockSession);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'alice@example.com' },
    });

    expect(res.headers['set-cookie']).toMatch(/session_id=/);
  });

  it('returns 404 when user does not exist', async () => {
    vi.mocked(authService.getUserByEmail).mockResolvedValue(null);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'nobody@example.com' },
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
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
    vi.mocked(authService.getUserByEmail).mockReset();
    vi.mocked(authService.createUser).mockReset();
    vi.mocked(authService.createSession).mockReset();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates user and returns 200 with session', async () => {
    vi.mocked(authService.getUserByEmail).mockResolvedValue(null);
    vi.mocked(authService.createUser).mockResolvedValue(mockUser);
    vi.mocked(authService.createSession).mockResolvedValue(mockSession);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup/individual',
      payload: { email: 'new@example.com', name: 'New User' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.user).toBeDefined();
    expect(body.data.session).toBeDefined();
  });

  it('returns 400 when email is already registered', async () => {
    vi.mocked(authService.getUserByEmail).mockResolvedValue(mockUser);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup/individual',
      payload: { email: 'alice@example.com', name: 'Alice' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
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
    vi.mocked(authService.getUserByEmail).mockReset();
    vi.mocked(authService.getGroupByUrl).mockReset();
    vi.mocked(authService.createGroupUser).mockReset();
    vi.mocked(authService.createSession).mockReset();
  });

  afterEach(async () => {
    await app.close();
  });

  it('creates group user and returns 200', async () => {
    vi.mocked(authService.getUserByEmail).mockResolvedValue(null);
    vi.mocked(authService.getGroupByUrl).mockResolvedValue(null);
    vi.mocked(authService.createGroupUser).mockResolvedValue({
      user: mockUser,
      group: { id: 'g1', name: 'Acme', createdAt: new Date() },
      invitation: { id: 'inv-1', code: 'TESTCODE', groupId: 'g1', createdBy: mockUser.id, createdAt: new Date() },
    });
    vi.mocked(authService.createSession).mockResolvedValue(mockSession);

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup/group',
      payload: { email: 'admin@acme.com', name: 'Admin', groupName: 'Acme', groupUrl: 'acme' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.data.user).toBeDefined();
  });

  it('returns 400 when group URL is already taken', async () => {
    vi.mocked(authService.getUserByEmail).mockResolvedValue(null);
    vi.mocked(authService.getGroupByUrl).mockResolvedValue({ id: 'g-existing', name: 'Existing', createdAt: new Date() });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup/group',
      payload: { email: 'other@acme.com', name: 'Other', groupName: 'Other Corp', groupUrl: 'taken-url' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.message).toBe('Group URL is already taken');
  });
});
