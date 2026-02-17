import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { v4 as uuidv4 } from 'uuid';
import type { User, Session } from '@local-agent/shared';
import { createStorage } from './storage/index.js';
import { createLLMRouter } from './ai/router.js';
import { mcpManager } from './mcp/index.js';
import { authRoutes } from './api/auth.js';
import { authService } from './auth/index.js';

// Configuration
const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  database: {
    type: 'sqlite' as const,
    path: process.env.DATABASE_PATH || './data/metadata.db',
  },
  storage: {
    type: (process.env.STORAGE_TYPE as 'fs' | 'sqlite' | 's3') || 'fs',
    root: process.env.STORAGE_ROOT || './data',
    bucket: process.env.STORAGE_BUCKET || undefined,
    endpoint: process.env.STORAGE_ENDPOINT || undefined,
    region: process.env.STORAGE_REGION || undefined,
  },
  auth: {
    secret: process.env.AUTH_SECRET || uuidv4(),
    sessionTTL: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/api/gmail/callback',
  },
  llm: {
    provider: (process.env.LLM_PROVIDER as 'grok' | 'openai') || 'grok',
    grokKey: process.env.GROK_API_KEY || '',
    openaiKey: process.env.OPENAI_API_KEY || '',
    defaultModel: process.env.DEFAULT_MODEL,
    routerEnabled: process.env.ROUTER_ENABLED === 'true',
  },
};

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
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Register plugins
fastify.register(cors, {
  origin: true,
  credentials: true,
});

fastify.register(cookie, {
  secret: config.auth.secret,
});

fastify.register(websocket);

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
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
});

// Register API routes
fastify.register(authRoutes, { prefix: '/api/auth' });

// Group routes (renamed from orgs)
fastify.register(async (instance) => {
  // Get user's groups
  instance.get('/groups', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const groups = await authService.getUserGroups(request.user.id);
    return reply.send({ success: true, data: groups });
  });

  // Create group
  instance.post('/groups', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const body = request.body as { name: string; url?: string };
    const group = await authService.createGroup(body.name, body.url);
    await authService.addMember(group.id, request.user.id, 'owner');
    
    return reply.send({ success: true, data: group });
  });

  // Get group members
  instance.get('/groups/:id/members', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const params = request.params as { id: string };
    const members = await authService.getGroupMembers(params.id);
    return reply.send({ success: true, data: members });
  });

  // Create invitation
  instance.post('/groups/:id/invitations', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const params = request.params as { id: string };
    const body = request.body as { email?: string; role?: 'owner' | 'admin' | 'member' };
    
    const invitation = await authService.createInvitation(
      params.id,
      request.user.id,
      body.email,
      body.role || 'member'
    );
    
    return reply.send({ success: true, data: invitation });
  });
}, { prefix: '/api' });

// Roles routes
fastify.register(async (instance) => {
  const roles: Map<string, { id: string; groupId: string; name: string; jobDesc?: string; systemPrompt?: string; model?: string; createdAt: Date }> = new Map();

  // Get roles for group
  instance.get('/roles', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const query = request.query as { groupId?: string };
    const groupRoles = Array.from(roles.values()).filter(r => 
      !query.groupId || r.groupId === query.groupId
    );
    
    return reply.send({ success: true, data: groupRoles });
  });

  // Create role
  instance.post('/roles', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const body = request.body as { groupId: string; name: string; jobDesc?: string; systemPrompt?: string; model?: string };
    const id = uuidv4();
    const role = {
      id,
      groupId: body.groupId,
      name: body.name,
      jobDesc: body.jobDesc,
      systemPrompt: body.systemPrompt,
      model: body.model,
      createdAt: new Date(),
    };
    
    roles.set(id, role);
    return reply.send({ success: true, data: role });
  });

  // Update role
  instance.patch('/roles/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const params = request.params as { id: string };
    const body = request.body as { name?: string; jobDesc?: string; systemPrompt?: string; model?: string };
    
    const role = roles.get(params.id);
    if (!role) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }
    
    Object.assign(role, body);
    roles.set(params.id, role);
    return reply.send({ success: true, data: role });
  });

  // Delete role
  instance.delete('/roles/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const params = request.params as { id: string };
    roles.delete(params.id);
    return reply.send({ success: true });
  });
}, { prefix: '/api' });

// Chat routes
fastify.register(async (instance) => {
  instance.post('/chat/stream', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const body = request.body as { messages: Array<{ role: string; content: string }>; roleId?: string; groupId?: string };
    
    // For now, return a simple response
    // In a real implementation, this would stream from the LLM
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    
    const response = 'This is a placeholder response. Configure your OpenAI API key to enable real chat.';
    reply.raw.write(`data: ${JSON.stringify({ content: response })}\n\n`);
    reply.raw.write('data: [DONE]\n\n');
    reply.raw.end();
  });
}, { prefix: '/api' });

// Viewer routes
fastify.register(async (instance) => {
  instance.get('/viewer/files', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    // Placeholder - return empty list
    return reply.send({ success: true, data: [] });
  });

  instance.get('/viewer/gmail', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    // Placeholder - return empty list
    return reply.send({ success: true, data: [] });
  });
}, { prefix: '/api' });

// MCP routes
fastify.register(async (instance) => {
  instance.get('/mcp/servers', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const servers = mcpManager.getConnectedServers();
    return reply.send({ success: true, data: servers });
  });

  instance.post('/mcp/servers', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const body = request.body as { name: string; transport: 'stdio' | 'websocket' | 'http'; command?: string; args?: string[]; url?: string };
    
    try {
      await mcpManager.connect({ ...body, enabled: true });
      return reply.send({ success: true, data: { name: body.name, connected: true } });
    } catch (error) {
      return reply.code(500).send({ success: false, error: { message: 'Failed to connect to MCP server' } });
    }
  });

  instance.get('/mcp/servers/:name/tools', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const params = request.params as { name: string };
    const tools = mcpManager.getTools(params.name);
    return reply.send({ success: true, data: tools });
  });
}, { prefix: '/api' });

// Start server
const start = async () => {
  try {
    // Initialize storage
    const storage = createStorage({
      type: config.storage.type,
      root: config.storage.root,
      bucket: config.storage.bucket || '',
      endpoint: config.storage.endpoint,
      region: config.storage.region,
    });
    await storage.initialize();

    // Initialize LLM router
    const llmRouter = createLLMRouter(config.llm);

    // Start listening
    await fastify.listen({
      port: config.port,
      host: config.host,
    });

    console.log(`Server listening on ${config.host}:${config.port}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

// Handle shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await mcpManager.disconnectAll();
  await fastify.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await mcpManager.disconnectAll();
  await fastify.close();
  process.exit(0);
});

// Start the server
start();

// Export for testing
export { fastify, config };