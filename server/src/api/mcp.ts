import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authService } from '../auth/index.js';
import { mcpManager } from '../mcp/index.js';
import type { MCPServerConfig } from '@local-agent/shared';

const AddMCPServerSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'websocket', 'http', 'ws']),
  command: z.string().optional(),
  args: z.array(z.string()).optional().default([]),
  cwd: z.string().nullable().optional(),
  url: z.string().url().optional(),
  env: z.record(z.string()).optional(),
  autoStart: z.boolean().default(false),
  restartOnExit: z.boolean().default(false),
  enabled: z.boolean().default(true),
  auth: z.object({
    provider: z.string().optional(),
    tokenFilename: z.string().optional(),
    credentialsFilename: z.string().optional(),
  }).optional(),
});

const CallToolSchema = z.object({
  serverId: z.string().uuid(),
  toolName: z.string().min(1),
  arguments: z.record(z.unknown()),
});

export async function registerMCPRoutes(fastify: FastifyInstance): Promise<void> {
  // Debug endpoint to see raw database contents
  fastify.get('/api/mcp/debug/storage', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ success: false, error: 'Not authenticated' });
    }
    try {
      const rawMetadata = await mcpManager['storage'].queryMetadata('mcp_servers', {});
      return { success: true, data: { rawMetadata } };
    } catch (error) {
      return { success: true, data: { error: String(error) } };
    }
  });

  // List MCP servers
  fastify.get('/api/mcp/servers', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const servers = mcpManager.getServers();
    console.log('[MCP] getServers() type:', typeof servers);
    console.log('[MCP] getServers() is array:', Array.isArray(servers));
    console.log('[MCP] getServers() length:', servers?.length);
    if (servers && servers.length > 0) {
      console.log('[MCP] First server type:', typeof servers[0]);
      console.log('[MCP] First server:', JSON.stringify(servers[0], null, 2));
    }
    console.log('[MCP] Full getServers() returned:', JSON.stringify(servers, null, 2));
    return { success: true, data: servers };
  });

  // Add MCP server
  fastify.post('/api/mcp/servers', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    try {
      const body = request.body as any;
      const addServerBody = AddMCPServerSchema.parse(body);

      const config: MCPServerConfig = {
        id: crypto.randomUUID(),
        name: addServerBody.name,
        transport: addServerBody.transport,
        command: addServerBody.command,
        args: addServerBody.args,
        cwd: addServerBody.cwd,
        url: addServerBody.url,
        env: addServerBody.env,
        autoStart: addServerBody.autoStart,
        restartOnExit: addServerBody.restartOnExit,
        enabled: addServerBody.enabled,
        auth: body.auth, // Include auth config if provided
      };

      // If auth config includes Google OAuth, fetch the stored token
      let userToken: any;
      if (config.auth?.provider === 'google') {
        const oauthToken = await authService.getOAuthToken(request.user.id, 'google');
        if (!oauthToken) {
          return reply.status(400).send({
            success: false,
            error: { code: 'NO_AUTH_TOKEN', message: 'No Google OAuth token found. Please authenticate with Google first.' },
          });
        }

        userToken = {
          access_token: oauthToken.accessToken,
          refresh_token: oauthToken.refreshToken,
          expiry_date: oauthToken.expiryDate,
          token_type: 'Bearer',
        };

        console.log(`[MCP] Using stored Google OAuth token for server ${config.name}`);
      }

      await mcpManager.addServer(config, userToken);

      return { success: true, data: config };
    } catch (error) {
      console.error('[MCP] Failed to add server:', error);
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: String(error) },
      });
    }
  });

  // Update MCP server status
  fastify.patch('/api/mcp/servers/:serverId', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const { serverId } = request.params as { serverId: string };
    const { enabled } = request.body as { enabled?: boolean };

    if (typeof enabled !== 'boolean') {
      return reply.status(400).send({
        success: false,
        error: { code: 'INVALID_INPUT', message: 'enabled must be a boolean' },
      });
    }

    try {
      await mcpManager.updateServerStatus(serverId, enabled);
      return { success: true };
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: { code: 'UPDATE_ERROR', message: 'Failed to update server status' },
      });
    }
  });

  // Remove MCP server
  fastify.delete('/api/mcp/servers/:serverId', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const { serverId } = request.params as { serverId: string };
    await mcpManager.removeServer(serverId);

    return { success: true };
  });

  // List tools from a server
  fastify.get('/api/mcp/servers/:serverId/tools', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const { serverId } = request.params as { serverId: string };
    
    try {
      const tools = await mcpManager.listTools(serverId);
      return { success: true, data: tools };
    } catch (error) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Server not found or not connected' },
      });
    }
  });

  // List all tools from all servers
  fastify.get('/api/mcp/tools', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const tools = await mcpManager.listAllTools();
    return { success: true, data: tools };
  });

  // Call a tool
  fastify.post('/api/mcp/tools/call', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    try {
      const body = CallToolSchema.parse(request.body);
      const result = await mcpManager.callTool(body.serverId, body.toolName, body.arguments);
      
      return { success: true, data: result };
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: { code: 'TOOL_ERROR', message: 'Failed to call tool', details: String(error) },
      });
    }
  });

  // List resources from a server
  fastify.get('/api/mcp/servers/:serverId/resources', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const { serverId } = request.params as { serverId: string };
    
    try {
      const client = mcpManager.getServer(serverId);
      if (!client) {
        return reply.status(404).send({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Server not found' },
        });
      }
      
      const resources = await client.listResources();
      return { success: true, data: resources };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'RESOURCE_ERROR', message: 'Failed to list resources', details: String(error) },
      });
    }
  });

  // Read a resource
  fastify.post('/api/mcp/resources/read', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const { serverId, uri } = request.body as { serverId?: string; uri?: string };
    
    if (!serverId || !uri) {
      return reply.status(400).send({
        success: false,
        error: { code: 'MISSING_PARAMS', message: 'Server ID and URI are required' },
      });
    }

    try {
      const result = await mcpManager.readResource(serverId, uri);
      return { success: true, data: result };
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: { code: 'RESOURCE_ERROR', message: 'Failed to read resource', details: String(error) },
      });
    }
  });
}