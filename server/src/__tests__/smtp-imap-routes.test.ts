/**
 * Unit tests for SMTP/IMAP API routes.
 *
 * Uses bun:test with mock.module() for nodemailer, imapflow, and the database.
 * Fastify runs on a random port with a real HTTP listener (Bun's fetch).
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import Fastify from 'fastify';
import type { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const mockUser = { id: 'user-1', email: 'alice@example.com' };

const validCredentials = {
  smtpHost: 'smtp.example.com',
  smtpPort: 587,
  smtpSecure: true,
  imapHost: 'imap.example.com',
  imapPort: 993,
  imapSecure: true,
  username: 'alice@example.com',
  password: 'secret',
};

// ---------------------------------------------------------------------------
// Module mocks — registered before route module is dynamically imported
// ---------------------------------------------------------------------------

const mockTransporter = {
  verify: mock(async () => {}),
  close: mock(() => {}),
};

const mockImapConnect = mock(async () => {});
const mockImapLogout = mock(async () => {});

mock.module('nodemailer', () => ({
  default: {
    createTransport: mock(() => mockTransporter),
  },
}));

mock.module('imapflow', () => ({
  ImapFlow: class {
    constructor(_opts: unknown) {}
    connect() { return mockImapConnect(); }
    logout() { return mockImapLogout(); }
  },
}));

const dbMock = {
  storeServiceCredentials: mock(async () => {}),
  listServiceCredentials: mock(async () => []),
  deleteServiceCredentials: mock(async () => true),
};

mock.module('../storage/main-db.js', () => ({
  getMainDatabase: mock(() => Promise.resolve(dbMock)),
}));

// Dynamic import after mocks are registered
const { smtpImapRoutes } = await import('../api/smtp-imap.js');

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
  await app.register(smtpImapRoutes, { prefix: '/api/smtp-imap' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, baseUrl: `http://127.0.0.1:${port}/api/smtp-imap` };
}

async function post(url: string, body: unknown) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// POST /test — connection testing
// ---------------------------------------------------------------------------

describe('POST /api/smtp-imap/test', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    mockTransporter.verify.mockReset();
    mockTransporter.close.mockReset();
    mockImapConnect.mockReset();
    mockImapLogout.mockReset();
    mockTransporter.verify.mockResolvedValue(undefined);
    mockImapConnect.mockResolvedValue(undefined);
    mockImapLogout.mockResolvedValue(undefined);
  });

  afterEach(async () => { await app.app.close(); });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = await buildApp(false);
    try {
      const res = await post(`${unauthApp.baseUrl}/test`, validCredentials);
      expect(res.status).toBe(401);
    } finally {
      await unauthApp.app.close();
    }
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await post(`${app.baseUrl}/test`, { smtpHost: 'smtp.example.com' });
    expect(res.status).toBe(400);
  });

  it('returns smtp and imap ok when both connections succeed', async () => {
    const res = await post(`${app.baseUrl}/test`, validCredentials);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.smtp.ok).toBe(true);
    expect(body.data.imap.ok).toBe(true);
  });

  it('reports smtp failure and imap success independently', async () => {
    mockTransporter.verify.mockRejectedValue(new Error('Authentication failed'));

    const res = await post(`${app.baseUrl}/test`, validCredentials);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.smtp.ok).toBe(false);
    expect(body.data.smtp.message).toContain('Authentication failed');
    expect(body.data.imap.ok).toBe(true);
  });

  it('reports imap failure and smtp success independently', async () => {
    mockImapConnect.mockRejectedValue(new Error('Connection refused'));

    const res = await post(`${app.baseUrl}/test`, validCredentials);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.smtp.ok).toBe(true);
    expect(body.data.imap.ok).toBe(false);
    expect(body.data.imap.message).toContain('Connection refused');
  });

  it('reports both failures when both connections fail', async () => {
    mockTransporter.verify.mockRejectedValue(new Error('SMTP error'));
    mockImapConnect.mockRejectedValue(new Error('IMAP error'));

    const res = await post(`${app.baseUrl}/test`, validCredentials);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.smtp.ok).toBe(false);
    expect(body.data.imap.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// GET /accounts — list accounts
// ---------------------------------------------------------------------------

describe('GET /api/smtp-imap/accounts', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    dbMock.listServiceCredentials.mockReset();
  });

  afterEach(async () => { await app.app.close(); });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = await buildApp(false);
    try {
      const res = await fetch(`${unauthApp.baseUrl}/accounts`);
      expect(res.status).toBe(401);
    } finally {
      await unauthApp.app.close();
    }
  });

  it('returns an empty array when no accounts exist', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([]);

    const res = await fetch(`${app.baseUrl}/accounts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data).toEqual([]);
  });

  it('returns accounts with passwords stripped', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([
      {
        accountEmail: 'alice@example.com',
        credentials: {
          smtpHost: 'smtp.example.com',
          smtpPort: 587,
          smtpSecure: true,
          imapHost: 'imap.example.com',
          imapPort: 993,
          imapSecure: true,
          username: 'alice@example.com',
          password: 'should-be-stripped',
        },
      },
    ]);

    const res = await fetch(`${app.baseUrl}/accounts`);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    const account = body.data[0];
    expect(account.accountEmail).toBe('alice@example.com');
    expect(account.smtpHost).toBe('smtp.example.com');
    expect(account.username).toBe('alice@example.com');
    expect(account.password).toBeUndefined();
  });

  it('queries the database with the correct userId and service', async () => {
    dbMock.listServiceCredentials.mockResolvedValue([]);
    await fetch(`${app.baseUrl}/accounts`);
    expect(dbMock.listServiceCredentials).toHaveBeenCalledWith('user-1', 'smtp-imap');
  });
});

// ---------------------------------------------------------------------------
// POST /accounts — save account
// ---------------------------------------------------------------------------

describe('POST /api/smtp-imap/accounts', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    dbMock.storeServiceCredentials.mockReset();
    dbMock.storeServiceCredentials.mockResolvedValue(undefined);
  });

  afterEach(async () => { await app.app.close(); });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = await buildApp(false);
    try {
      const res = await post(`${unauthApp.baseUrl}/accounts`, {
        accountEmail: 'alice@example.com',
        ...validCredentials,
      });
      expect(res.status).toBe(401);
    } finally {
      await unauthApp.app.close();
    }
  });

  it('returns 400 when accountEmail is not a valid email', async () => {
    const res = await post(`${app.baseUrl}/accounts`, {
      ...validCredentials,
      accountEmail: 'not-an-email',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when required credential fields are missing', async () => {
    const res = await post(`${app.baseUrl}/accounts`, {
      accountEmail: 'alice@example.com',
    });
    expect(res.status).toBe(400);
  });

  it('stores credentials and returns accountEmail on success', async () => {
    const res = await post(`${app.baseUrl}/accounts`, {
      accountEmail: 'alice@example.com',
      ...validCredentials,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.accountEmail).toBe('alice@example.com');
  });

  it('calls storeServiceCredentials with correct arguments', async () => {
    await post(`${app.baseUrl}/accounts`, {
      accountEmail: 'alice@example.com',
      ...validCredentials,
    });
    expect(dbMock.storeServiceCredentials).toHaveBeenCalledWith(
      'user-1',
      'smtp-imap',
      'alice@example.com',
      validCredentials,
    );
  });
});

// ---------------------------------------------------------------------------
// DELETE /accounts/:accountEmail — remove account
// ---------------------------------------------------------------------------

describe('DELETE /api/smtp-imap/accounts/:accountEmail', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    dbMock.deleteServiceCredentials.mockReset();
  });

  afterEach(async () => { await app.app.close(); });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = await buildApp(false);
    try {
      const res = await fetch(`${unauthApp.baseUrl}/accounts/alice@example.com`, { method: 'DELETE' });
      expect(res.status).toBe(401);
    } finally {
      await unauthApp.app.close();
    }
  });

  it('returns 404 when the account does not exist', async () => {
    dbMock.deleteServiceCredentials.mockResolvedValue(false);

    const res = await fetch(`${app.baseUrl}/accounts/nobody@example.com`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('returns success when the account is deleted', async () => {
    dbMock.deleteServiceCredentials.mockResolvedValue(true);

    const res = await fetch(`${app.baseUrl}/accounts/alice@example.com`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('calls deleteServiceCredentials with the correct arguments', async () => {
    dbMock.deleteServiceCredentials.mockResolvedValue(true);

    await fetch(`${app.baseUrl}/accounts/alice@example.com`, { method: 'DELETE' });
    expect(dbMock.deleteServiceCredentials).toHaveBeenCalledWith('user-1', 'smtp-imap', 'alice@example.com');
  });
});
