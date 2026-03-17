/**
 * Unit tests for billing API routes.
 *
 * Uses bun:test with mock.module() for the database, config, and Stripe service.
 * Fastify runs on a random port with a real HTTP listener.
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import Fastify from 'fastify';
import type { AddressInfo } from 'net';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const regularUser = { id: 'user-regular', email: 'alice@example.com' };
const sandboxUser = { id: 'user-sandbox', email: 'sandbox@example.com' };

const dbUsers: Record<string, { id: string; email: string; creditBalanceUsd: number; sandboxUser?: boolean }> = {
  [regularUser.id]: { ...regularUser, creditBalanceUsd: 5.00 },
  [sandboxUser.id]: { ...sandboxUser, creditBalanceUsd: 2.50, sandboxUser: true },
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const dbMock = {
  getUser: mock(async (id: string) => dbUsers[id] ?? null),
  getUserCreditBalance: mock(async (id: string) => dbUsers[id]?.creditBalanceUsd ?? 0),
  createStripePayment: mock(async () => {}),
  getStripePayments: mock(async () => []),
  getCreditLedger: mock(async () => []),
  getStripePaymentByIntentId: mock(async () => null as null | { status: string }),
  addUserCredits: mock(async () => {}),
  updateStripePaymentStatus: mock(async () => {}),
};

mock.module('../storage/index.js', () => ({
  getMainDatabase: mock(() => Promise.resolve(dbMock)),
}));

mock.module('../config/index.js', () => ({
  config: {
    storage: { root: './data' },
    stripe:     { secretKey: 'sk_live_xxx', publishableKey: 'pk_live_xxx', webhookSecret: 'whsec_live' },
    stripeTest: { secretKey: 'sk_test_xxx', publishableKey: 'pk_test_xxx', webhookSecret: 'whsec_test' },
  },
}));

const mockPaymentIntent = { id: 'pi_123', client_secret: 'pi_123_secret_abc' };
const constructWebhookEventMock = mock(async () => ({
  type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_456', metadata: { userId: regularUser.id, amountCents: '1000' } } },
}));

mock.module('../stripe/service.js', () => ({
  TOPUP_AMOUNTS_CENTS: [500, 1000, 2000, 5000],
  centsToUsd: (cents: number) => cents / 100,
  getStripeConfig: (mode: string) =>
    mode === 'test'
      ? { secretKey: 'sk_test_xxx', publishableKey: 'pk_test_xxx', webhookSecret: 'whsec_test' }
      : { secretKey: 'sk_live_xxx', publishableKey: 'pk_live_xxx', webhookSecret: 'whsec_live' },
  createTopUpPaymentIntent: mock(async () => mockPaymentIntent),
  constructWebhookEvent: constructWebhookEventMock,
}));

// Dynamic import after mocks
const { billingRoutes, billingWebhookRoute } = await import('../api/billing.js');

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

async function buildApp(authenticatedAs: typeof regularUser | null = regularUser) {
  const app = Fastify({ logger: false });
  app.decorateRequest('user', null);
  if (authenticatedAs) {
    app.addHook('preHandler', async (request) => {
      (request as any).user = authenticatedAs;
    });
  }
  await app.register(billingRoutes, { prefix: '/api' });
  await app.register(billingWebhookRoute, { prefix: '/api' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${port}/api` };
}

function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// GET /api/billing/balance
// ---------------------------------------------------------------------------

describe('GET /api/billing/balance', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => { app = await buildApp(); });
  afterEach(async () => { await app.app.close(); });

  it('returns 401 when not authenticated', async () => {
    const { app: a, base } = await buildApp(null);
    try {
      const res = await fetch(`${base}/billing/balance`);
      expect(res.status).toBe(401);
    } finally {
      await a.close();
    }
  });

  it('returns credit balance and live publishable key for regular user', async () => {
    dbMock.getUser.mockResolvedValue(dbUsers[regularUser.id] as any);
    const res = await fetch(`${app.base}/billing/balance`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.creditBalanceUsd).toBe(5.00);
    expect(body.data.publishableKey).toBe('pk_live_xxx');
    expect(body.data.stripeMode).toBe('live');
  });

  it('returns test publishable key for sandbox user', async () => {
    const { app: a, base } = await buildApp(sandboxUser);
    try {
      dbMock.getUser.mockResolvedValue(dbUsers[sandboxUser.id] as any);
      const res = await fetch(`${base}/billing/balance`);
      const body = await res.json();
      expect(body.data.publishableKey).toBe('pk_test_xxx');
      expect(body.data.stripeMode).toBe('test');
    } finally {
      await a.close();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/billing/create-payment-intent
// ---------------------------------------------------------------------------

describe('POST /api/billing/create-payment-intent', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeEach(async () => {
    app = await buildApp();
    dbMock.getUser.mockResolvedValue(dbUsers[regularUser.id] as any);
    dbMock.createStripePayment.mockReset();
  });
  afterEach(async () => { await app.app.close(); });

  it('returns 401 when not authenticated', async () => {
    const { app: a, base } = await buildApp(null);
    try {
      const res = await post(`${base}/billing/create-payment-intent`, { amountCents: 1000 });
      expect(res.status).toBe(401);
    } finally {
      await a.close();
    }
  });

  it('returns 400 for an invalid amount', async () => {
    const res = await post(`${app.base}/billing/create-payment-intent`, { amountCents: 999 });
    expect(res.status).toBe(400);
  });

  it('returns 400 when amountCents is missing', async () => {
    const res = await post(`${app.base}/billing/create-payment-intent`, {});
    expect(res.status).toBe(400);
  });

  it('creates a payment intent and records it for a regular (live) user', async () => {
    const res = await post(`${app.base}/billing/create-payment-intent`, { amountCents: 1000 });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.clientSecret).toBe('pi_123_secret_abc');
    expect(dbMock.createStripePayment).toHaveBeenCalledWith(
      expect.objectContaining({ userId: regularUser.id, amountUsd: 10, status: 'pending' })
    );
  });

  it('creates a payment intent using test mode for sandbox user', async () => {
    const { createTopUpPaymentIntent } = await import('../stripe/service.js');
    (createTopUpPaymentIntent as ReturnType<typeof mock>).mockReset();
    (createTopUpPaymentIntent as ReturnType<typeof mock>).mockResolvedValue(mockPaymentIntent);

    dbMock.getUser.mockResolvedValue(dbUsers[sandboxUser.id] as any);
    const { app: a, base } = await buildApp(sandboxUser);
    try {
      const res = await post(`${base}/billing/create-payment-intent`, { amountCents: 500 });
      expect(res.status).toBe(200);
      expect(createTopUpPaymentIntent).toHaveBeenCalledWith(sandboxUser.id, 500, 'test');
    } finally {
      await a.close();
    }
  });

  it('accepts all valid top-up amounts', async () => {
    for (const amountCents of [500, 1000, 2000, 5000]) {
      dbMock.createStripePayment.mockReset();
      const res = await post(`${app.base}/billing/create-payment-intent`, { amountCents });
      expect(res.status).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/billing/webhook  (live)
// POST /api/billing/webhook/test
// ---------------------------------------------------------------------------

async function buildWebhookApp() {
  const app = Fastify({ logger: false });
  app.decorateRequest('user', null);
  await app.register(billingWebhookRoute, { prefix: '/api' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, base: `http://127.0.0.1:${port}/api` };
}

function rawPost(url: string, body: string, extraHeaders: Record<string, string> = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body,
  });
}

describe('POST /api/billing/webhook', () => {
  let app: Awaited<ReturnType<typeof buildWebhookApp>>;

  beforeEach(async () => {
    app = await buildWebhookApp();
    constructWebhookEventMock.mockReset();
    dbMock.getStripePaymentByIntentId.mockReset();
    dbMock.addUserCredits.mockReset();
    dbMock.updateStripePaymentStatus.mockReset();
  });
  afterEach(async () => { await app.app.close(); });

  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await rawPost(`${app.base}/billing/webhook`, '{}');
    expect(res.status).toBe(400);
  });

  it('returns 400 when signature verification fails', async () => {
    constructWebhookEventMock.mockRejectedValue(new Error('Bad signature'));
    const res = await rawPost(`${app.base}/billing/webhook`, '{}', { 'stripe-signature': 'bad' });
    expect(res.status).toBe(400);
  });

  it('credits user on payment_intent.succeeded', async () => {
    constructWebhookEventMock.mockResolvedValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_ok', metadata: { userId: regularUser.id, amountCents: '1000' } } },
    } as any);
    dbMock.getStripePaymentByIntentId.mockResolvedValue(null);

    const res = await rawPost(`${app.base}/billing/webhook`, '{}', { 'stripe-signature': 'sig' });
    expect(res.status).toBe(200);
    expect(dbMock.addUserCredits).toHaveBeenCalledWith(
      regularUser.id, 10,
      expect.objectContaining({ stripePaymentIntentId: 'pi_ok' })
    );
    expect(dbMock.updateStripePaymentStatus).toHaveBeenCalledWith('pi_ok', 'succeeded');
  });

  it('skips double-credit when payment already succeeded', async () => {
    constructWebhookEventMock.mockResolvedValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_dup', metadata: { userId: regularUser.id, amountCents: '500' } } },
    } as any);
    dbMock.getStripePaymentByIntentId.mockResolvedValue({ status: 'succeeded' });

    const res = await rawPost(`${app.base}/billing/webhook`, '{}', { 'stripe-signature': 'sig' });
    expect(res.status).toBe(200);
    expect(dbMock.addUserCredits).not.toHaveBeenCalled();
  });

  it('marks payment failed on payment_intent.payment_failed', async () => {
    constructWebhookEventMock.mockResolvedValue({
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_fail' } },
    } as any);

    const res = await rawPost(`${app.base}/billing/webhook`, '{}', { 'stripe-signature': 'sig' });
    expect(res.status).toBe(200);
    expect(dbMock.updateStripePaymentStatus).toHaveBeenCalledWith('pi_fail', 'failed');
  });

  it('ignores events with missing metadata gracefully', async () => {
    constructWebhookEventMock.mockResolvedValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_nometadata', metadata: {} } },
    } as any);

    const res = await rawPost(`${app.base}/billing/webhook`, '{}', { 'stripe-signature': 'sig' });
    expect(res.status).toBe(200);
    expect(dbMock.addUserCredits).not.toHaveBeenCalled();
  });

  it('returns 500 and does not mark succeeded when credit fails', async () => {
    constructWebhookEventMock.mockResolvedValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_err', metadata: { userId: regularUser.id, amountCents: '1000' } } },
    } as any);
    dbMock.getStripePaymentByIntentId.mockResolvedValue(null);
    dbMock.addUserCredits.mockRejectedValue(new Error('DB error'));

    const res = await rawPost(`${app.base}/billing/webhook`, '{}', { 'stripe-signature': 'sig' });
    expect(res.status).toBe(500);
    expect(dbMock.updateStripePaymentStatus).not.toHaveBeenCalledWith('pi_err', 'succeeded');
  });
});

describe('POST /api/billing/webhook/test', () => {
  let app: Awaited<ReturnType<typeof buildWebhookApp>>;

  beforeEach(async () => {
    app = await buildWebhookApp();
    constructWebhookEventMock.mockReset();
    dbMock.getStripePaymentByIntentId.mockReset();
    dbMock.addUserCredits.mockReset();
    dbMock.updateStripePaymentStatus.mockReset();
  });
  afterEach(async () => { await app.app.close(); });

  it('returns 400 when stripe-signature header is missing', async () => {
    const res = await rawPost(`${app.base}/billing/webhook/test`, '{}');
    expect(res.status).toBe(400);
  });

  it('returns 400 when signature verification fails', async () => {
    constructWebhookEventMock.mockRejectedValue(new Error('Bad test signature'));
    const res = await rawPost(`${app.base}/billing/webhook/test`, '{}', { 'stripe-signature': 'bad' });
    expect(res.status).toBe(400);
  });

  it('credits user on payment_intent.succeeded via test webhook', async () => {
    constructWebhookEventMock.mockResolvedValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_ok', metadata: { userId: sandboxUser.id, amountCents: '500' } } },
    } as any);
    dbMock.getStripePaymentByIntentId.mockResolvedValue(null);

    const res = await rawPost(`${app.base}/billing/webhook/test`, '{}', { 'stripe-signature': 'sig' });
    expect(res.status).toBe(200);
    expect(dbMock.addUserCredits).toHaveBeenCalledWith(
      sandboxUser.id, 5,
      expect.objectContaining({ stripePaymentIntentId: 'pi_test_ok' })
    );
  });

  it('verifies webhook using test mode', async () => {
    constructWebhookEventMock.mockResolvedValue({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_test_mode', metadata: { userId: sandboxUser.id, amountCents: '500' } } },
    } as any);
    dbMock.getStripePaymentByIntentId.mockResolvedValue(null);

    await rawPost(`${app.base}/billing/webhook/test`, '{}', { 'stripe-signature': 'sig' });
    expect(constructWebhookEventMock).toHaveBeenCalledWith(
      expect.anything(), 'sig', 'test'
    );
  });
});
