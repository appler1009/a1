import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getMainDatabase } from '../storage/index.js';
import { config } from '../config/index.js';
import {
  createTopUpPaymentIntent,
  constructWebhookEvent,
  centsToUsd,
  TOPUP_AMOUNTS_CENTS,
  getStripeConfig,
  type TopUpAmountCents,
  type StripeMode,
} from '../stripe/service.js';

/**
 * Billing routes — two separate plugin functions so each can have its own
 * content-type parser.  The webhook route needs the raw body for signature
 * verification; all other billing routes use normal JSON.
 *
 * Register in index.ts:
 *   fastify.register(billingRoutes, { prefix: '/api' });
 *   fastify.register(billingWebhookRoute, { prefix: '/api' });
 */
export async function billingRoutes(fastify: FastifyInstance): Promise<void> {
  // ----------------------------------------------------------------
  // GET /api/billing/balance
  // Returns the user's current credit balance and the Stripe publishable key.
  // ----------------------------------------------------------------
  fastify.get('/billing/balance', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const mainDb = await getMainDatabase(config.storage.root);
    const user = await mainDb.getUser(request.user.id);
    const creditBalanceUsd = user?.creditBalanceUsd ?? 0;
    const mode: StripeMode = user?.sandboxUser ? 'test' : 'live';

    return reply.send({
      success: true,
      data: {
        creditBalanceUsd,
        publishableKey: getStripeConfig(mode).publishableKey,
        stripeMode: mode,
      },
    });
  });

  // ----------------------------------------------------------------
  // POST /api/billing/create-payment-intent
  // Body: { amountCents: 500 | 1000 | 2000 | 5000 }
  // Creates a Stripe PaymentIntent and records it as pending.
  // ----------------------------------------------------------------
  fastify.post('/billing/create-payment-intent', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as { amountCents?: number };
    const amountCents = body?.amountCents;

    if (!amountCents || !(TOPUP_AMOUNTS_CENTS as readonly number[]).includes(amountCents)) {
      return reply.code(400).send({
        success: false,
        error: {
          message: `amountCents must be one of: ${TOPUP_AMOUNTS_CENTS.join(', ')}`,
        },
      });
    }

    const mainDb = await getMainDatabase(config.storage.root);
    const user = await mainDb.getUser(request.user.id);
    const mode: StripeMode = user?.sandboxUser ? 'test' : 'live';
    const stripeConfig = getStripeConfig(mode);

    if (!stripeConfig.secretKey) {
      return reply.code(503).send({
        success: false,
        error: { message: 'Billing is not configured on this server' },
      });
    }

    try {
      const intent = await createTopUpPaymentIntent(
        request.user.id,
        amountCents as TopUpAmountCents,
        mode
      );

      await mainDb.createStripePayment({
        userId: request.user.id,
        stripePaymentIntentId: intent.id,
        amountUsd: centsToUsd(amountCents),
        status: 'pending',
      });

      return reply.send({
        success: true,
        data: { clientSecret: intent.client_secret },
      });
    } catch (err) {
      fastify.log.error(err, '[Billing] Failed to create payment intent');
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to create payment intent' },
      });
    }
  });

  // ----------------------------------------------------------------
  // GET /api/billing/payments
  // Returns recent payment history for the authenticated user.
  // ----------------------------------------------------------------
  fastify.get('/billing/payments', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const mainDb = await getMainDatabase(config.storage.root);
    const payments = await mainDb.getStripePayments(request.user.id);

    return reply.send({
      success: true,
      data: payments.map(p => ({
        id: p.id,
        amountUsd: p.amountUsd,
        status: p.status,
        createdAt: p.createdAt.toISOString(),
      })),
    });
  });

  // ----------------------------------------------------------------
  // GET /api/billing/ledger
  // Returns a full credit/debit ledger for the authenticated user.
  // ----------------------------------------------------------------
  fastify.get('/billing/ledger', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { limit?: string; before?: string; after?: string };
    const limit = Math.min(parseInt(query.limit ?? '25', 10), 100);

    const mainDb = await getMainDatabase(config.storage.root);
    const entries = await mainDb.getCreditLedger(request.user.id, limit, {
      before: query.before,
      after: query.after,
    });

    return reply.send({
      success: true,
      data: entries.map(e => ({
        id: e.id,
        type: e.type,
        amountUsd: e.amountUsd,
        balanceAfter: e.balanceAfter,
        description: e.description,
        stripePaymentIntentId: e.stripePaymentIntentId,
        model: e.model,
        createdAt: e.createdAt.toISOString(),
      })),
    });
  });

}

/**
 * Shared webhook handler logic — verifies and processes a Stripe event.
 */
async function handleWebhookEvent(
  fastify: FastifyInstance,
  rawBody: Buffer,
  signature: string,
  mode: StripeMode
) {
  let event;
  try {
    event = await constructWebhookEvent(rawBody, signature, mode);
  } catch (err) {
    fastify.log.warn(err, `[Billing] Webhook signature verification failed (mode=${mode})`);
    return { status: 400, body: { error: 'Webhook signature verification failed' } };
  }

  if (event.type === 'payment_intent.succeeded') {
    const intent = event.data.object as {
      id: string;
      metadata: { userId?: string; amountCents?: string };
    };

    const userId = intent.metadata?.userId;
    const amountCents = parseInt(intent.metadata?.amountCents ?? '0', 10);

    if (!userId || !amountCents) {
      fastify.log.warn({ intentId: intent.id }, '[Billing] Webhook: missing userId or amountCents in metadata');
      return { status: 200, body: { received: true } };
    }

    const amountUsd = centsToUsd(amountCents);

    try {
      const mainDb = await getMainDatabase(config.storage.root);

      // Guard against double-crediting (idempotency)
      const existing = await mainDb.getStripePaymentByIntentId(intent.id);
      if (existing?.status === 'succeeded') {
        fastify.log.info({ intentId: intent.id }, '[Billing] Webhook: already processed, skipping');
        return { status: 200, body: { received: true } };
      }

      await mainDb.addUserCredits(userId, amountUsd, {
        stripePaymentIntentId: intent.id,
        description: `Top-up $${amountUsd.toFixed(2)} via Stripe`,
      });
      await mainDb.updateStripePaymentStatus(intent.id, 'succeeded');

      fastify.log.info(
        { intentId: intent.id, userId, amountUsd, mode },
        '[Billing] Credits added to user account'
      );
    } catch (err) {
      fastify.log.error(err, '[Billing] Failed to credit user account');
      return { status: 500, body: { error: 'Failed to process payment' } };
    }
  }

  if (event.type === 'payment_intent.payment_failed') {
    const intent = event.data.object as { id: string };
    try {
      const mainDb = await getMainDatabase(config.storage.root);
      await mainDb.updateStripePaymentStatus(intent.id, 'failed');
    } catch (err) {
      fastify.log.warn(err, '[Billing] Failed to mark payment as failed');
    }
  }

  return { status: 200, body: { received: true } };
}

/**
 * Webhook route registered in its own plugin scope so it can use a raw-body
 * content-type parser (required for Stripe signature verification).
 */
export async function billingWebhookRoute(fastify: FastifyInstance): Promise<void> {
  // Override the JSON parser for this plugin scope to also capture the raw buffer.
  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    function (_req: FastifyRequest, body: Buffer, done: (err: Error | null, body?: unknown) => void) {
      (_req as unknown as { rawBody: Buffer }).rawBody = body;
      try {
        done(null, JSON.parse(body.toString()));
      } catch (err) {
        done(err as Error);
      }
    }
  );

  // ----------------------------------------------------------------
  // POST /api/billing/webhook
  // Live Stripe webhook endpoint.
  // ----------------------------------------------------------------
  fastify.post('/billing/webhook', async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      return reply.code(400).send({ error: 'Missing stripe-signature header' });
    }

    const rawBody = (request as unknown as { rawBody: Buffer }).rawBody;
    if (!rawBody) {
      return reply.code(400).send({ error: 'Missing raw body' });
    }

    const result = await handleWebhookEvent(fastify, rawBody, signature, 'live');
    return reply.code(result.status).send(result.body);
  });

  // ----------------------------------------------------------------
  // POST /api/billing/webhook/test
  // Test/sandbox Stripe webhook endpoint (for users with sandboxUser=true).
  // ----------------------------------------------------------------
  fastify.post('/billing/webhook/test', async (request, reply) => {
    const signature = request.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      return reply.code(400).send({ error: 'Missing stripe-signature header' });
    }

    const rawBody = (request as unknown as { rawBody: Buffer }).rawBody;
    if (!rawBody) {
      return reply.code(400).send({ error: 'Missing raw body' });
    }

    const result = await handleWebhookEvent(fastify, rawBody, signature, 'test');
    return reply.code(result.status).send(result.body);
  });
}
