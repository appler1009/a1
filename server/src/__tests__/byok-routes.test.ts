/**
 * Unit tests for BYOK (Bring-Your-Own-Key) API routes.
 *
 * Uses bun:test with mock.module() for the database.
 * Fastify runs on a random port with a real HTTP listener.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import Fastify from 'fastify';
import type { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockUser = { id: 'user-1', email: 'alice@example.com' };

// ---------------------------------------------------------------------------
// Database mock
// ---------------------------------------------------------------------------

const dbMock = {
  storeServiceCredentials: mock(async () => {}),
  listServiceCredentials: mock(async () => [] as Array<{ accountEmail: string; credentials: Record<string, unknown> }>),
  deleteServiceCredentials: mock(async () => true),
};

// Mock storage/index.js (not main-db.js directly) so that main-db.test.ts,
// which imports MainDatabase directly from storage/main-db.js, is unaffected.
mock.module('../storage/index.js', () => ({
  getMainDatabase: mock(() => Promise.resolve(dbMock)),
}));

// Dynamic import after mocks are registered
const { byokRoutes } = await import('../api/byok.js');

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp(authenticated = true) {
  const app = Fastify({ logger: false });
  app.decorateRequest('user', null);
  if (authenticated) {
    app.addHook('preHandler', async (request) => {
      (request as any).user = mockUser;
    });
  }
  await app.register(byokRoutes, { prefix: '/api/byok' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${port}/api/byok` };
}

async function post(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// GET / — list configured providers
// ---------------------------------------------------------------------------

describe('GET /api/byok', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    dbMock.listServiceCredentials.mockReset();
  });

  afterEach(async () => { await app.app.close(); });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = await buildApp(false);
    try {
      const res = await fetch(`${unauthApp.baseUrl}`);
      expect(res.status).toBe(401);
    } finally {
      await unauthApp.app.close();
    }
  });

  it('returns an empty array when no keys are configured', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([]);

    const res = await fetch(app.baseUrl);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('masks the API key, showing only the last 4 characters', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([
      {
        accountEmail: 'anthropic',
        credentials: { apiKey: 'sk-ant-abcdefghijklmnop', model: 'claude-opus-4-5', enabled: true },
      },
    ]);

    const res = await fetch(app.baseUrl);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    const entry = body.data[0];
    expect(entry.provider).toBe('anthropic');
    expect(entry.model).toBe('claude-opus-4-5');
    expect(entry.enabled).toBe(true);
    expect(entry.apiKeyHint).toBe('...mnop');
    expect(entry.apiKeyHint).not.toContain('sk-ant');
  });

  it('returns multiple providers correctly', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([
      { accountEmail: 'xai', credentials: { apiKey: 'xai-key-1234', model: 'grok-4', enabled: true } },
      { accountEmail: 'openai', credentials: { apiKey: 'sk-openai-5678', model: 'gpt-4o', enabled: false } },
    ]);

    const res = await fetch(app.baseUrl);
    const body = await res.json();
    expect(body.data).toHaveLength(2);
    expect(body.data[0].provider).toBe('xai');
    expect(body.data[0].enabled).toBe(true);
    expect(body.data[1].provider).toBe('openai');
    expect(body.data[1].enabled).toBe(false);
  });

  it('queries the database with the correct userId and service', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([]);
    await fetch(app.baseUrl);
    expect(dbMock.listServiceCredentials).toHaveBeenCalledWith('user-1', 'byok');
  });
});

// ---------------------------------------------------------------------------
// POST / — save or update a provider key
// ---------------------------------------------------------------------------

describe('POST /api/byok', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    dbMock.storeServiceCredentials.mockReset();
    dbMock.listServiceCredentials.mockReset();
    dbMock.storeServiceCredentials.mockResolvedValue(undefined);
    dbMock.listServiceCredentials.mockResolvedValue([]);
  });

  afterEach(async () => { await app.app.close(); });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = await buildApp(false);
    try {
      const res = await post(`${unauthApp.baseUrl}`, { provider: 'anthropic', apiKey: 'sk-abc', model: 'claude-opus-4-5' });
      expect(res.status).toBe(401);
    } finally {
      await unauthApp.app.close();
    }
  });

  it('returns 400 for an invalid provider', async () => {
    const res = await post(app.baseUrl, { provider: 'cohere', apiKey: 'key', model: 'command-r' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when apiKey is missing', async () => {
    const res = await post(app.baseUrl, { provider: 'anthropic', model: 'claude-opus-4-5' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when model is missing', async () => {
    const res = await post(app.baseUrl, { provider: 'anthropic', apiKey: 'sk-abc' });
    expect(res.status).toBe(400);
  });

  it('stores credentials with enabled=false when activate is not set', async () => {
    const res = await post(app.baseUrl, { provider: 'openai', apiKey: 'sk-openai-abc', model: 'gpt-4o' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.provider).toBe('openai');
    expect(dbMock.storeServiceCredentials).toHaveBeenCalledWith(
      'user-1', 'byok', 'openai',
      { apiKey: 'sk-openai-abc', model: 'gpt-4o', enabled: false }
    );
  });

  it('stores credentials with enabled=true when activate=true', async () => {
    const res = await post(app.baseUrl, { provider: 'xai', apiKey: 'xai-key', model: 'grok-4', activate: true });
    expect(res.status).toBe(200);
    expect(dbMock.storeServiceCredentials).toHaveBeenCalledWith(
      'user-1', 'byok', 'xai',
      { apiKey: 'xai-key', model: 'grok-4', enabled: true }
    );
  });

  it('disables other providers when activate=true', async () => {
    // Simulate an existing active Anthropic key
    dbMock.listServiceCredentials.mockResolvedValue([
      { accountEmail: 'anthropic', credentials: { apiKey: 'old-key', model: 'claude-opus-4-5', enabled: true } },
    ]);

    await post(app.baseUrl, { provider: 'openai', apiKey: 'sk-openai', model: 'gpt-4o', activate: true });

    // Should disable the anthropic entry
    expect(dbMock.storeServiceCredentials).toHaveBeenCalledWith(
      'user-1', 'byok', 'anthropic',
      { apiKey: 'old-key', model: 'claude-opus-4-5', enabled: false }
    );
    // And then store the new openai entry as active
    expect(dbMock.storeServiceCredentials).toHaveBeenCalledWith(
      'user-1', 'byok', 'openai',
      { apiKey: 'sk-openai', model: 'gpt-4o', enabled: true }
    );
  });

  it('does not disable the same provider when re-saving with activate=true', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([
      { accountEmail: 'anthropic', credentials: { apiKey: 'old-key', model: 'claude-opus-4-5', enabled: true } },
    ]);

    await post(app.baseUrl, { provider: 'anthropic', apiKey: 'new-key', model: 'claude-opus-4-5', activate: true });

    // storeServiceCredentials should only be called once (for the save), not to disable itself
    const disableCalls = (dbMock.storeServiceCredentials.mock.calls as any[]).filter(
      ([, , acct, creds]: any) => acct === 'anthropic' && creds.enabled === false
    );
    expect(disableCalls).toHaveLength(0);
  });

  it('accepts all three valid providers', async () => {
    for (const provider of ['xai', 'openai', 'anthropic'] as const) {
      dbMock.storeServiceCredentials.mockReset();
      dbMock.storeServiceCredentials.mockResolvedValue(undefined);
      const res = await post(app.baseUrl, { provider, apiKey: 'test-key', model: 'test-model' });
      expect(res.status).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// DELETE /:provider — remove a provider key
// ---------------------------------------------------------------------------

describe('DELETE /api/byok/:provider', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    dbMock.deleteServiceCredentials.mockReset();
  });

  afterEach(async () => { await app.app.close(); });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = await buildApp(false);
    try {
      const res = await fetch(`${unauthApp.baseUrl}/anthropic`, { method: 'DELETE' });
      expect(res.status).toBe(401);
    } finally {
      await unauthApp.app.close();
    }
  });

  it('returns 400 for an invalid provider name', async () => {
    const res = await fetch(`${app.baseUrl}/cohere`, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the config does not exist', async () => {
    dbMock.deleteServiceCredentials.mockResolvedValue(false);
    const res = await fetch(`${app.baseUrl}/anthropic`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns 200 when deleted successfully', async () => {
    dbMock.deleteServiceCredentials.mockResolvedValue(true);
    const res = await fetch(`${app.baseUrl}/openai`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('calls deleteServiceCredentials with the correct arguments', async () => {
    dbMock.deleteServiceCredentials.mockResolvedValue(true);
    await fetch(`${app.baseUrl}/xai`, { method: 'DELETE' });
    expect(dbMock.deleteServiceCredentials).toHaveBeenCalledWith('user-1', 'byok', 'xai');
  });
});

// ---------------------------------------------------------------------------
// POST /deactivate — disable BYOK
// ---------------------------------------------------------------------------

describe('POST /api/byok/deactivate', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    dbMock.listServiceCredentials.mockReset();
    dbMock.storeServiceCredentials.mockReset();
    dbMock.storeServiceCredentials.mockResolvedValue(undefined);
  });

  afterEach(async () => { await app.app.close(); });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = await buildApp(false);
    try {
      const res = await post(`${unauthApp.baseUrl}/deactivate`, {});
      expect(res.status).toBe(401);
    } finally {
      await unauthApp.app.close();
    }
  });

  it('returns 200 when no providers are active (no-op)', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([
      { accountEmail: 'anthropic', credentials: { apiKey: 'key', model: 'claude-opus-4-5', enabled: false } },
    ]);

    const res = await post(`${app.baseUrl}/deactivate`, {});
    expect(res.status).toBe(200);
    expect(dbMock.storeServiceCredentials).not.toHaveBeenCalled();
  });

  it('disables the active provider', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([
      { accountEmail: 'anthropic', credentials: { apiKey: 'key', model: 'claude-opus-4-5', enabled: true } },
      { accountEmail: 'openai', credentials: { apiKey: 'key2', model: 'gpt-4o', enabled: false } },
    ]);

    const res = await post(`${app.baseUrl}/deactivate`, {});
    expect(res.status).toBe(200);
    expect(dbMock.storeServiceCredentials).toHaveBeenCalledTimes(1);
    expect(dbMock.storeServiceCredentials).toHaveBeenCalledWith(
      'user-1', 'byok', 'anthropic',
      { apiKey: 'key', model: 'claude-opus-4-5', enabled: false }
    );
  });
});

// ---------------------------------------------------------------------------
// POST /:provider/activate — set active provider
// ---------------------------------------------------------------------------

describe('POST /api/byok/:provider/activate', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    dbMock.listServiceCredentials.mockReset();
    dbMock.storeServiceCredentials.mockReset();
    dbMock.storeServiceCredentials.mockResolvedValue(undefined);
  });

  afterEach(async () => { await app.app.close(); });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = await buildApp(false);
    try {
      const res = await post(`${unauthApp.baseUrl}/anthropic/activate`, {});
      expect(res.status).toBe(401);
    } finally {
      await unauthApp.app.close();
    }
  });

  it('returns 400 for an invalid provider', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([]);
    const res = await post(`${app.baseUrl}/cohere/activate`, {});
    expect(res.status).toBe(400);
  });

  it('returns 404 when the provider is not configured', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([]);
    const res = await post(`${app.baseUrl}/anthropic/activate`, {});
    expect(res.status).toBe(404);
  });

  it('enables the target provider and disables others', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([
      { accountEmail: 'anthropic', credentials: { apiKey: 'ant-key', model: 'claude-opus-4-5', enabled: false } },
      { accountEmail: 'openai', credentials: { apiKey: 'oai-key', model: 'gpt-4o', enabled: true } },
    ]);

    const res = await post(`${app.baseUrl}/anthropic/activate`, {});
    expect(res.status).toBe(200);

    expect(dbMock.storeServiceCredentials).toHaveBeenCalledWith(
      'user-1', 'byok', 'anthropic',
      { apiKey: 'ant-key', model: 'claude-opus-4-5', enabled: true }
    );
    expect(dbMock.storeServiceCredentials).toHaveBeenCalledWith(
      'user-1', 'byok', 'openai',
      { apiKey: 'oai-key', model: 'gpt-4o', enabled: false }
    );
  });

  it('is idempotent when activating an already active provider', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([
      { accountEmail: 'xai', credentials: { apiKey: 'xai-key', model: 'grok-4', enabled: true } },
    ]);

    const res = await post(`${app.baseUrl}/xai/activate`, {});
    expect(res.status).toBe(200);
    expect(dbMock.storeServiceCredentials).toHaveBeenCalledWith(
      'user-1', 'byok', 'xai',
      { apiKey: 'xai-key', model: 'grok-4', enabled: true }
    );
  });
});
