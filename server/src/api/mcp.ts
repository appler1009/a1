import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authService } from '../auth/index.js';
import { mcpManager } from '../mcp/index.js';
import type { MCPServerConfig } from '@local-agent/shared';

const AddMCPServerSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'websocket', 'http']),
  command: z.string().optional(),
  url: z.string().url().optional(),
  env: z.record(z.string()).optional(),
  enabled: z.boolean().default(true),
});

const CallToolSchema = z.object({
  serverId: z.string().uuid(),
  toolName: z.string().min(1),
  arguments: z.record(z.unknown()),
});

export async function registerMCPRoutes(fastify: FastifyInstance): Promise<void> {
  // List MCP servers
  fastify.get('/api/mcp/servers', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const servers = mcpManager.getServers();
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
      const body = AddMCPServerSchema.parse(request.body);
      
      const config: MCPServerConfig = {
        id: crypto.randomUUID(),
        name: body.name,
        transport: body.transport,
        command: body.command,
        url: body.url,
        env: body.env,
        enabled: body.enabled,
      };

      await mcpManager.addServer(config);

      return { success: true, data: config };
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error },
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