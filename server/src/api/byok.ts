/**
 * Bring-Your-Own-Key (BYOK) API routes
 *
 * Allows users to configure their own LLM provider API keys,
 * stored encrypted via the existing service_credentials table.
 *
 * Endpoints (all require authentication):
 *   GET    /api/byok              — list configured providers (keys masked)
 *   POST   /api/byok              — save or update a provider key
 *   DELETE /api/byok/:provider    — remove a provider key
 *   POST   /api/byok/:provider/activate — set as the active provider
 *   POST   /api/byok/deactivate   — disable BYOK (revert to app default)
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getMainDatabase } from '../storage/index.js';

export const BYOK_SERVICE = 'byok';
export const VALID_BYOK_PROVIDERS = ['xai', 'openai', 'anthropic'] as const;
export type ByokProvider = (typeof VALID_BYOK_PROVIDERS)[number];

const UpsertSchema = z.object({
  provider: z.enum(VALID_BYOK_PROVIDERS),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  activate: z.boolean().optional(),
});

export async function byokRoutes(fastify: FastifyInstance): Promise<void> {
  // List all configured BYOK providers (keys masked)
  fastify.get('/', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const mainDb = await getMainDatabase();
    const entries = await mainDb.listServiceCredentials(request.user.id, BYOK_SERVICE);

    const masked = entries.map(({ accountEmail, credentials }) => ({
      provider: accountEmail,
      model: credentials.model as string,
      enabled: (credentials.enabled as boolean) ?? false,
      apiKeyHint: typeof credentials.apiKey === 'string'
        ? `...${(credentials.apiKey as string).slice(-4)}`
        : '****',
    }));

    return reply.send({ success: true, data: masked });
  });

  // Save or update a provider key
  fastify.post('/', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const parsed = UpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: parsed.error.message } });
    }

    const { provider, apiKey, model, activate } = parsed.data;
    const mainDb = await getMainDatabase();

    if (activate) {
      const existing = await mainDb.listServiceCredentials(request.user.id, BYOK_SERVICE);
      for (const { accountEmail, credentials } of existing) {
        if (accountEmail !== provider && credentials.enabled) {
          await mainDb.storeServiceCredentials(request.user.id, BYOK_SERVICE, accountEmail, {
            ...credentials,
            enabled: false,
          });
        }
      }
    }

    await mainDb.storeServiceCredentials(request.user.id, BYOK_SERVICE, provider, {
      apiKey,
      model,
      enabled: activate ?? false,
    });

    return reply.send({ success: true, data: { provider } });
  });

  // Delete a provider key
  fastify.delete('/:provider', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const { provider } = request.params as { provider: string };
    if (!VALID_BYOK_PROVIDERS.includes(provider as ByokProvider)) {
      return reply.code(400).send({ success: false, error: { message: 'Invalid provider' } });
    }

    const mainDb = await getMainDatabase();
    const deleted = await mainDb.deleteServiceCredentials(request.user.id, BYOK_SERVICE, provider);
    if (!deleted) {
      return reply.code(404).send({ success: false, error: { message: 'Config not found' } });
    }

    return reply.send({ success: true });
  });

  // Disable BYOK (revert to app default) — must be registered before /:provider/activate
  fastify.post('/deactivate', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const mainDb = await getMainDatabase();
    const all = await mainDb.listServiceCredentials(request.user.id, BYOK_SERVICE);

    for (const { accountEmail, credentials } of all) {
      if (credentials.enabled) {
        await mainDb.storeServiceCredentials(request.user.id, BYOK_SERVICE, accountEmail, {
          ...credentials,
          enabled: false,
        });
      }
    }

    return reply.send({ success: true });
  });

  // Activate a specific provider
  fastify.post('/:provider/activate', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const { provider } = request.params as { provider: string };
    if (!VALID_BYOK_PROVIDERS.includes(provider as ByokProvider)) {
      return reply.code(400).send({ success: false, error: { message: 'Invalid provider' } });
    }

    const mainDb = await getMainDatabase();
    const all = await mainDb.listServiceCredentials(request.user.id, BYOK_SERVICE);

    const target = all.find(e => e.accountEmail === provider);
    if (!target) {
      return reply.code(404).send({ success: false, error: { message: 'Provider not configured' } });
    }

    for (const { accountEmail, credentials } of all) {
      await mainDb.storeServiceCredentials(request.user.id, BYOK_SERVICE, accountEmail, {
        ...credentials,
        enabled: accountEmail === provider,
      });
    }

    return reply.send({ success: true });
  });
}
