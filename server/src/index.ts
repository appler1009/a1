// Load environment-specific .env file
import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeEnv = process.env.NODE_ENV || 'development';
// .env files are in the server directory (one level up from src/)
const envFile = path.join(__dirname, '..', `.env.${nodeEnv}`);
dotenvConfig({ path: envFile });

// Load secrets from AWS Secrets Manager before config is assembled.
// No-op when AWS_SECRETS_ENABLED is not set (local development).
import { loadSecrets } from './config/secrets.js';
await loadSecrets();

import { initConfig, config } from './config/index.js';
initConfig();

import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import type { User, Session } from '@local-agent/shared';
import { createStorage, autoMigrate, getMainDatabase, createTempStorage } from './storage/index.js';
import type { IMainDatabase } from './storage/index.js';
import { createLLMRouter } from './ai/router.js';
import { estimateCostUsd, DEFAULT_MONTHLY_SPEND_LIMIT_USD } from './ai/cost.js';
import { mcpManager } from './mcp/index.js';
import { authRoutes } from './api/auth.js';
import { smtpImapRoutes } from './api/smtp-imap.js';
import { byokRoutes } from './api/byok.js';
import { authService } from './auth/index.js';
import { startDiscordBot } from './discord/bot.js';
import { JobRunner } from './scheduler/job-runner.js';
import { initializeGmailInProcess } from './mcp/in-process/gmail.js';
import { initializeDisplayEmail } from './mcp/in-process/display-email.js';
import fs from 'fs';

// Shared-state setters — route files read state from shared-state.ts
import {
  setTempStorage,
  setLlmRouter,
  setJobRunner,
  setServerCurrentRoleId,
  activeStreams,
  messageSubscribers,
} from './shared-state.js';

// Route plugins
import { groupRoutes } from './routes/groups.js';
import { roleRoutes } from './routes/roles.js';
import { messageRoutes } from './routes/messages.js';
import { viewerRoutes } from './routes/viewer.js';
import { mcpServerRoutes } from './routes/mcp-servers.js';
import { settingsRoutes } from './routes/settings.js';
import { skillsRoutes } from './routes/skills.js';
import { scheduledRoutes } from './routes/scheduled.js';

// Utilities
import { executeToolWithAdapters } from './utils/tool-execution.js';

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    session: Session | null;
  }
}

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: config.logLevel,
  },
});

// Global storage instance - initialized before routes (deprecated, kept for backward compatibility)
const storage = createStorage({
  type: config.storage.type,
  root: config.storage.root,
  bucket: config.storage.bucket || '',
});

function initializeTempStorage(): void {
  const tempStorage = createTempStorage({ storage: config.storage });
  console.log(`[TempStorage] Initialized with storage type: ${tempStorage.getStorageType()}`);
  setTempStorage(tempStorage);

  // Initialize GmailInProcess with tempStorage for email caching
  initializeGmailInProcess(tempStorage);

  // Initialize DisplayEmail with tempStorage for email reading
  initializeDisplayEmail(tempStorage);
}

import { ALPHA_VANTAGE_API_REFERENCE } from './mcp/in-process/alpha-vantage.js';

/**
 * Seed skills into the database on startup
 */
async function seedSkills(mainDb: IMainDatabase): Promise<void> {
  await mainDb.upsertSkill({
    id: 'alpha-vantage',
    name: 'Alpha Vantage',
    description: 'Financial data API: stocks, forex, crypto, commodities, economic indicators, technical indicators.',
    content: ALPHA_VANTAGE_API_REFERENCE,
    type: 'mcp-in-process',
  });
}

// Default settings
const DEFAULT_SETTINGS: Record<string, unknown> = {
  MAX_TOOL_ITERATIONS: 10,
};

/**
 * Initialize default settings in the database
 * Only sets values that don't already exist
 */
async function initializeDefaultSettings(): Promise<void> {
  const mainDb = await getMainDatabase(config.storage.root);
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = await mainDb.getSetting(key);
    if (existing === null) {
      console.log(`[Settings] Initializing default setting: ${key} = ${value}`);
      await mainDb.setSetting(key, value);
    }
  }
}

// ---------------------------------------------------------------------------
// Internal scheduler endpoints — called by the Lambda evaluator.
// Protected by a shared secret; never exposed publicly.
// ---------------------------------------------------------------------------

function assertInternalApiKey(request: FastifyRequest, reply: FastifyReply): boolean {
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected) {
    reply.code(503).send({ error: 'Internal API key not configured' });
    return false;
  }
  if (request.headers['x-internal-api-key'] !== expected) {
    reply.code(401).send({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// Register plugins
fastify.register(cors, {
  origin: true,
  credentials: true,
});

fastify.register(cookie, {
  secret: config.auth.secret,
});

fastify.register(websocket);

// Register static file serving for the client build
fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', '..', 'client', 'dist'),
  prefix: '/',
});

// SPA fallback: serve index.html for any non-API routes
fastify.setNotFoundHandler(async (request, reply) => {
  if (!request.url.startsWith('/api/') && request.method === 'GET') {
    // Serve index.html for client-side routing
    return reply.sendFile('index.html');
  }
  reply.code(404).send({ message: `Route ${request.method}:${request.url} not found`, error: 'Not Found', statusCode: 404 });
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Returns jobs that the Lambda evaluator needs to assess, plus per-user spend metadata.
fastify.get('/internal/scheduler/pending', async (request, reply) => {
  if (!assertInternalApiKey(request, reply)) return;
  const mainDb = await getMainDatabase(config.storage.root);
  const [onceJobs, recurringJobs] = await Promise.all([
    mainDb.getDueOnceJobs(),
    mainDb.getPendingRecurringJobs(),
  ]);

  // Build per-user spend metadata so the lambda can skip over-limit users
  const allUserIds = [...new Set([...onceJobs, ...recurringJobs].map(j => j.userId))];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const userMeta: Record<string, { overSpendLimit: boolean }> = {};
  await Promise.all(allUserIds.map(async (userId) => {
    const [user, byokCredentials, monthlyUsage] = await Promise.all([
      mainDb.getUser(userId),
      mainDb.listServiceCredentials(userId, 'byok'),
      mainDb.getTokenUsageByUser(userId, { from: monthStart }),
    ]);
    const hasByok = byokCredentials.length > 0;
    const limitUsd = user?.monthlySpendLimitUsd ?? DEFAULT_MONTHLY_SPEND_LIMIT_USD;
    const spentUsd = estimateCostUsd(monthlyUsage);
    userMeta[userId] = { overSpendLimit: !hasByok && spentUsd >= limitUsd };
  }));

  const mapJob = (j: typeof onceJobs[number]) => ({
    id: j.id,
    userId: j.userId,
    roleId: j.roleId,
    description: j.description,
    scheduleType: j.scheduleType,
    lastRunAt: j.lastRunAt?.toISOString() ?? null,
  });

  return {
    onceJobs: onceJobs.map(mapJob),
    recurringJobs: recurringJobs.map(mapJob),
    userMeta,
  };
});

// Receives the Lambda's evaluation decisions and executes/holds accordingly.
fastify.post('/internal/scheduler/dispatch', async (request, reply) => {
  if (!assertInternalApiKey(request, reply)) return;

  // Import jobRunner from shared-state at call time (initialized in start())
  const { jobRunner } = await import('./shared-state.js');
  if (!jobRunner) return reply.code(503).send({ error: 'Job runner not initialised' });

  const body = request.body as {
    run?: string[];
    hold?: Array<{ id: string; until: string }>;
  };
  const run: string[] = Array.isArray(body.run) ? body.run : [];
  const hold: Array<{ id: string; until: string }> = Array.isArray(body.hold) ? body.hold : [];

  console.log(`[Dispatch] run: ${run.length}, hold: ${hold.length}`);

  const db = await getMainDatabase(config.storage.root);

  // Fetch all affected jobs in one pass
  const allIds = new Set([...run, ...hold.map(h => h.id)]);
  const allJobs = await Promise.all([...allIds].map(id => db.getScheduledJob(id)));
  const jobMap = new Map(allJobs.filter(Boolean).map((j) => [j!.id, j!]));

  // Execute run-jobs first, then apply hold decisions
  for (const id of run) {
    const job = jobMap.get(id);
    if (job) await jobRunner.execute(job);
  }
  for (const { id, until } of hold) {
    const holdUntil = new Date(until);
    if (!isNaN(holdUntil.getTime())) {
      await db.updateScheduledJobStatus(id, { holdUntil }).catch((err: unknown) =>
        console.error(`[Dispatch] Failed to hold job ${id}:`, err),
      );
    } else {
      console.warn(`[Dispatch] Job ${id} has invalid hold date: ${until}`);
    }
  }

  return { ok: true, run: run.length, hold: hold.length };
});

// Test-only cleanup endpoint — deletes a user and all their data by email.
// Only available outside production to prevent accidental data loss.
if (!config.env.isProduction) {
  fastify.post('/api/test/cleanup', async (request, reply) => {
    const body = request.body as { email?: string };
    if (!body.email) {
      return reply.code(400).send({ success: false, error: { message: 'email required' } });
    }
    const mainDb = await getMainDatabase(config.storage.root);
    const user = await mainDb.getUserByEmail(body.email);
    if (user) {
      await mainDb.deleteUser(user.id);
    }
    return reply.send({ success: true, deleted: !!user });
  });
}

// Environment info endpoint
fastify.get('/api/env', async () => {
  return {
    success: true,
    data: {
      env: config.env.nodeEnv,
      isDevelopment: config.env.isDevelopment,
      isTest: config.env.isTest,
      isProduction: config.env.isProduction,
      port: config.port,
      host: config.host,
    },
  };
});

// Auth middleware
fastify.addHook('onRequest', async (request) => {
  const sessionId = request.cookies.session_id;
  if (sessionId) {
    const session = await authService.getSession(sessionId);
    if (session) {
      const user = await authService.getUser(session.userId);
      request.user = user;
      request.session = session;
    } else {
      request.user = null;
      request.session = null;
    }
  } else {
    request.user = null;
    request.session = null;
  }

  // Extract role ID from request headers and set it as the current role
  // This allows the client to specify the role context for each request
  const headerRoleId = request.headers['x-role-id'] as string | undefined;
  if (headerRoleId && request.user) {
    // Verify the user owns this role before setting it
    const mainDb = await getMainDatabase(config.storage.root);
    const role = await mainDb.getRole(headerRoleId);
    if (role && role.userId === request.user.id) {
      // Set the current role for this request
      setServerCurrentRoleId(headerRoleId);
      console.log(`[Request] Setting role from header: ${headerRoleId} (${role.name})`);
    } else {
      console.log(`[Request] WARNING: Invalid role ID in header: ${headerRoleId} (role not found or not owned by user)`);
    }
  }
});

// Register API routes
fastify.register(authRoutes, { prefix: '/api/auth' });
fastify.register(smtpImapRoutes, { prefix: '/api/smtp-imap' });
fastify.register(byokRoutes, { prefix: '/api/byok' });

fastify.register(groupRoutes, { prefix: '/api' });
fastify.register(roleRoutes, { prefix: '/api' });
fastify.register(messageRoutes, { prefix: '/api' });
fastify.register(viewerRoutes, { prefix: '/api' });
fastify.register(mcpServerRoutes, { prefix: '/api' });
fastify.register(settingsRoutes, { prefix: '/api' });
fastify.register(skillsRoutes, { prefix: '/api' });
fastify.register(scheduledRoutes, { prefix: '/api' });

// Start server
const start = async () => {
  try {
    // Run auto-migration if needed (SQLite only — skip for DynamoDB which uses pre-provisioned tables)
    const migrationResult = process.env.MAIN_DB_TYPE === 'dynamodb'
      ? { migrated: false }
      : await autoMigrate(config.storage.root);
    if (migrationResult.migrated) {
      console.log('══════════════════════════════════════════════════════════════');
      console.log('  DATABASE MIGRATION COMPLETED');
      console.log('  Migrated from LEGACY schema to ROLE-BASED schema');
      console.log('══════════════════════════════════════════════════════════════\n');
    }

    // Initialize main database
    const mainDb = await getMainDatabase(config.storage.root);
    await mainDb.initialize();
    if ('schema' in migrationResult) console.log(`[Storage] Using ${migrationResult.schema.toUpperCase()} schema`);
    fastify.log.info('Main database initialized');

    // Initialize temp storage for cache files (S3 or local filesystem)
    initializeTempStorage();
    fastify.log.info('Temp storage initialized');

    // Initialize legacy storage (for backward compatibility) - only if metadata.db exists
    const legacyDbPath = path.join(config.storage.root, 'metadata.db');
    if (fs.existsSync(legacyDbPath)) {
      await storage.initialize();
    } else {
      console.log('[Storage] Skipping legacy storage initialization (no metadata.db)');
    }

    // Initialize default settings
    await initializeDefaultSettings();
    fastify.log.info('Default settings initialized');

    // Seed skills
    await seedSkills(mainDb);
    fastify.log.info('Skills seeded');

    // Initialize auth service
    await authService.initialize();
    fastify.log.info('Auth service initialized');

    // Initialize MCP manager
    await mcpManager.initialize();
    fastify.log.info('MCP manager initialized with persisted servers');

    // In-process adapters are registered in the registry constructor (registry.ts).
    // The memory adapter uses tokenData.dbPath for role-specific isolation — do not
    // re-register here with a shared path as that would overwrite the role-aware factory.

    // Initialize LLM router
    const llmRouter = createLLMRouter({
      provider: config.llm.provider,
      grokKey: config.llm.grokApiKey,
      openaiKey: config.llm.openaiApiKey,
      anthropicKey: config.llm.anthropicApiKey,
      defaultModel: config.llm.defaultModel,
      routerEnabled: config.llm.routerEnabled,
      onTokensUsed: (event) => {
        if (!event.userId) return;
        mainDb.recordTokenUsage({
          userId: event.userId,
          model: event.model,
          provider: event.provider,
          promptTokens: event.promptTokens,
          completionTokens: event.completionTokens,
          totalTokens: event.totalTokens,
          cachedInputTokens: event.cachedInputTokens,
          cacheCreationTokens: event.cacheCreationTokens,
          source: event.source,
        }).catch(err => {
          console.error('[TokenUsage] Failed to record token usage:', err);
        });
      },
    });
    setLlmRouter(llmRouter);
    fastify.log.info({ provider: config.llm.provider, hasGrokKey: !!config.llm.grokApiKey }, 'LLM router initialized');

    const jobRunner = new JobRunner(llmRouter, mainDb, executeToolWithAdapters);
    setJobRunner(jobRunner);
    fastify.log.info('Job runner initialized — awaiting Lambda dispatch');

    // Start listening
    await fastify.listen({
      port: config.port,
      host: config.host,
    });

    console.log(`Server listening on ${config.host}:${config.port}`);

    // Start Discord bot if token is configured
    await startDiscordBot(config.port);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

// Handle shutdown
function closeActiveStreams() {
  if (activeStreams.size > 0) {
    console.log(`Closing ${activeStreams.size} active SSE stream(s)...`);
    for (const stream of activeStreams) {
      stream.end();
    }
    activeStreams.clear();
  }
  if (messageSubscribers.size > 0) {
    console.log(`Closing ${messageSubscribers.size} message subscriber key(s)...`);
    for (const subs of messageSubscribers.values()) {
      for (const sub of subs) {
        sub.end();
      }
    }
    messageSubscribers.clear();
  }
}

async function gracefulShutdown(signal: string) {
  console.log(`[shutdown] ${signal} received`);

  // Close SSE connections first so ALB draining unblocks immediately
  closeActiveStreams();
  console.log('[shutdown] SSE streams closed');

  // Disconnect MCP clients with a hard timeout — a hung subprocess must not
  // block the entire shutdown and keep the container alive indefinitely.
  const MCP_DISCONNECT_TIMEOUT_MS = 5000;
  await Promise.race([
    mcpManager.disconnectAll().then(() => console.log('[shutdown] MCP clients disconnected')),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        console.log('[shutdown] MCP disconnect timed out, continuing');
        resolve();
      }, MCP_DISCONNECT_TIMEOUT_MS)
    ),
  ]);

  await fastify.close();
  console.log('[shutdown] Fastify closed — exiting');
  process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// Start the server
start();

// Export for testing
export { fastify };
