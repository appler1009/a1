import type { FastifyInstance } from 'fastify';
import { getMainDatabase } from '../storage/index.js';
import type { RoleDefinition } from '../storage/index.js';
import { config } from '../config/index.js';
import { getMcpAdapter } from '../mcp/index.js';
import { serverCurrentRoleId, setServerCurrentRoleId, llmRouter } from '../shared-state.js';
import { getByokRouter } from '../utils/byok.js';
import { countWords } from '@local-agent/shared';

const JOB_DESC_WORD_LIMIT = 102;

export async function roleRoutes(fastify: FastifyInstance): Promise<void> {
  // Get roles for user or group
  fastify.get('/roles', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    console.log(`[/api/roles] 🔍 FETCHING ROLES`);
    console.log(`[/api/roles] User ID: ${request.user.id}`);
    console.log(`[/api/roles] User email: ${request.user.email}`);

    const query = request.query as { groupId?: string };
    const mainDb = await getMainDatabase(config.storage.root);

    let roles: RoleDefinition[];
    if (query.groupId) {
      console.log(`[/api/roles] Query type: GROUP (${query.groupId})`);
      roles = await mainDb.getGroupRoles(query.groupId);
    } else {
      console.log(`[/api/roles] Query type: USER`);
      roles = await mainDb.getUserRoles(request.user.id);
    }

    // Return the per-user current role ID (persisted across devices)
    // Priority: last switched role > primary role > server-wide current role
    const userCurrentRoleId = await mainDb.getSetting<string>(`user:${request.user.id}:currentRoleId`);
    const currentRoleId = userCurrentRoleId || request.user.primaryRoleId || serverCurrentRoleId;

    console.log(`[/api/roles] ✓ Found ${roles.length} roles`);
    if (roles.length > 0) {
      console.log(`[/api/roles] Role IDs: ${roles.map(r => `${r.id}(${r.name})`).join(', ')}`);
    } else {
      console.log(`[/api/roles] ⚠️  NO ROLES FOUND FOR THIS USER!`);
    }
    console.log(`[/api/roles] Current role ID (per-user): ${currentRoleId}`);

    return reply.send({
      success: true,
      data: {
        roles,
        currentRoleId,
      }
    });
  });

  // Get the currently active role
  fastify.get('/roles/current', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const currentRoleId = serverCurrentRoleId;

    if (!currentRoleId) {
      return reply.send({
        success: true,
        data: {
          currentRole: null,
          message: 'No role is currently active'
        }
      });
    }

    const mainDb = await getMainDatabase(config.storage.root);
    const role = await mainDb.getRole(currentRoleId);

    // Verify ownership
    if (!role || role.userId !== request.user.id) {
      // Clear the invalid role
      setServerCurrentRoleId(null);
      return reply.send({
        success: true,
        data: {
          currentRole: null,
          message: 'No role is currently active'
        }
      });
    }

    return reply.send({
      success: true,
      data: {
        currentRole: role,
      }
    });
  });

  // Create role - creates a record in main.db
  fastify.post('/roles', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as { groupId?: string; name: string; jobDesc?: string; systemPrompt?: string; model?: string };

    try {
      const mainDb = await getMainDatabase(config.storage.root);
      const role = await mainDb.createRole(
        request.user.id,
        body.name,
        body.groupId,
        body.jobDesc,
        body.systemPrompt,
        body.model
      );

      console.log(`[Roles] Created role ${role.id} "${role.name}" for user ${request.user.id}`);
      return reply.send({ success: true, data: role });
    } catch (error) {
      console.error('[Roles] Failed to create role:', error);
      return reply.code(500).send({ success: false, error: { message: 'Failed to create role' } });
    }
  });

  // Get a specific role
  fastify.get('/roles/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const mainDb = await getMainDatabase(config.storage.root);
    const role = await mainDb.getRole(params.id);

    if (!role) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    // Verify ownership
    if (role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    return reply.send({ success: true, data: role });
  });

  // Update role
  fastify.patch('/roles/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const body = request.body as { name?: string; jobDesc?: string; systemPrompt?: string; model?: string };
    const mainDb = await getMainDatabase(config.storage.root);

    // Verify ownership
    const existingRole = await mainDb.getRole(params.id);
    if (!existingRole) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    if (existingRole.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    if (body.jobDesc && countWords(body.jobDesc) > JOB_DESC_WORD_LIMIT) {
      return reply.code(400).send({ success: false, error: { message: `Role description must be ${JOB_DESC_WORD_LIMIT} words or fewer` } });
    }

    const role = await mainDb.updateRole(params.id, body);
    return reply.send({ success: true, data: role });
  });

  // Delete role - removes the role from main.db and its memory DB file
  fastify.delete('/roles/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const mainDb = await getMainDatabase(config.storage.root);

    // Verify ownership
    const existingRole = await mainDb.getRole(params.id);
    if (!existingRole) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    if (existingRole.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    // If this is the current role, clear it
    if (serverCurrentRoleId === params.id) {
      setServerCurrentRoleId(null);
    }

    // Delete memory DB file if it exists
    const dataDir = config.storage.root;
    await mainDb.deleteMemoryDb(dataDir, params.id);

    // Delete role messages from main.db
    await mainDb.clearMessages(existingRole.userId, params.id);

    // Delete the role from main.db
    await mainDb.deleteRole(params.id);
    console.log(`[Roles] Deleted role ${params.id}`);

    return reply.send({ success: true });
  });

  // Switch to a role - sets the active role for the session
  fastify.post('/roles/:id/switch', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const mainDb = await getMainDatabase(config.storage.root);

    // Verify ownership
    const role = await mainDb.getRole(params.id);
    if (!role) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    if (role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    // Set the current role (global and per-user)
    setServerCurrentRoleId(params.id);
    await mainDb.setSetting(`user:${request.user.id}:currentRoleId`, params.id);

    console.log(`[Roles] User ${request.user.id} switched to role ${params.id} "${role.name}"`);

    return reply.send({
      success: true,
      data: {
        roleId: params.id,
        role,
        message: `Switched to role "${role.name}"`
      }
    });
  });

  // Get prose overview of a role's memory graph
  fastify.get('/roles/:id/memory-overview', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const mainDb = await getMainDatabase(config.storage.root);

    // Verify ownership
    const role = await mainDb.getRole(params.id);
    if (!role) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    if (role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    try {
      const adapter = await getMcpAdapter(request.user.id, 'memory', params.id);
      const result = await adapter.callTool('memory_read_graph', {});

      const graphResultText = result.text || JSON.stringify(result);

      // Check if graph is empty
      let isEmpty = false;
      try {
        const parsed = JSON.parse(graphResultText);
        if (Array.isArray(parsed?.entities) && parsed.entities.length === 0) {
          isEmpty = true;
        }
      } catch {
        // Not JSON or unexpected shape — treat as non-empty
      }

      if (isEmpty) {
        return reply.send({ success: true, data: { overview: null, empty: true } });
      }

      // Generate prose overview via LLM
      const messages = [
        {
          role: 'system' as const,
          content: 'You are a memory summarizer. Be extremely concise. Your entire response must be 200 words or fewer. No fluff, no repetition. NEVER start with a heading or title of any kind — your very first output must be regular text or a bullet point.',
        },
        {
          role: 'user' as const,
          content: `Summarize the memory graph for a role called "${role.name}" in markdown. Use bold for key terms, bullet lists where appropriate. Group related facts. Be factual and direct — do not invent anything. Do NOT include a title or heading. Stay within 200 words.\n\nMemory graph:\n${graphResultText}`,
        },
      ];

      let overview = '';
      const activeRouter = (await getByokRouter(request.user.id)) ?? llmRouter;
      const stream = activeRouter.stream({ messages, userId: request.user.id, source: 'memory_overview' });
      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          overview += chunk.content;
        }
      }

      return reply.send({ success: true, data: { overview, empty: false } });
    } catch (error) {
      console.error(`[MemoryOverview] Error for role ${params.id}:`, error);
      return reply.code(500).send({ success: false, error: { message: 'Failed to generate memory overview' } });
    }
  });

  fastify.post('/roles/:id/remove-memories', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const mainDb = await getMainDatabase(config.storage.root);

    const role = await mainDb.getRole(params.id);
    if (!role) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    if (role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    const body = request.body as { selection: string };

    try {
      const adapter = await getMcpAdapter(request.user.id, 'memory', params.id);
      const result = await adapter.callTool('memory_read_graph', {});
      const graphResultText = result.text || JSON.stringify(result);

      const messages = [
        {
          role: 'user' as const,
          content: `Given this selected text from a memory overview:\n"${body.selection}"\n\nAnd this knowledge graph:\n${graphResultText}\n\nList the entity names from the graph that are related to the selected text and should be removed.\nReturn ONLY a JSON array of entity names, e.g. ["Alice", "Project X"].\nIf nothing matches, return [].`,
        },
      ];

      let responseText = '';
      const activeRouter = (await getByokRouter(request.user.id)) ?? llmRouter;
      const stream = activeRouter.stream({ messages, userId: request.user.id, source: 'memory_removal' });
      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          responseText += chunk.content;
        }
      }

      // Strip markdown fences if present
      const stripped = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      let parsedNames: string[];
      try {
        parsedNames = JSON.parse(stripped);
        if (!Array.isArray(parsedNames)) throw new Error('Not an array');
      } catch {
        return reply.code(400).send({ success: false, error: { message: 'Could not identify entities' } });
      }

      if (parsedNames.length === 0) {
        return reply.send({ success: true, data: { removed: [], count: 0 } });
      }

      await adapter.callTool('memory_delete_entities', { entityNames: parsedNames });
      return reply.send({ success: true, data: { removed: parsedNames, count: parsedNames.length } });
    } catch (error) {
      console.error(`[RemoveMemories] Error for role ${params.id}:`, error);
      return reply.code(500).send({ success: false, error: { message: 'Failed to remove memories' } });
    }
  });

  fastify.post('/roles/:id/edit-memories', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const mainDb = await getMainDatabase(config.storage.root);

    const role = await mainDb.getRole(params.id);
    if (!role) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    if (role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    const body = request.body as { selection: string; instruction: string };

    try {
      const adapter = await getMcpAdapter(request.user.id, 'memory', params.id);
      const result = await adapter.callTool('memory_read_graph', {});
      const graphResultText = result.text || JSON.stringify(result);

      const messages = [
        {
          role: 'user' as const,
          content: `Given this selected text from a memory overview:\n"${body.selection}"\n\nUser instruction: ${body.instruction}\n\nAnd this knowledge graph:\n${graphResultText}\n\nIdentify the entities from the graph that are related to the selected text, and apply the user's instruction to update them.\nReturn ONLY a JSON array of updated entity objects. Each object must have: "name" (string), "entityType" (string), "observations" (array of strings).\nExample: [{"name":"Alice","entityType":"person","observations":["Works at Acme","Prefers email"]}]\nIf no entities match, return [].`,
        },
      ];

      let responseText = '';
      const activeRouter = (await getByokRouter(request.user.id)) ?? llmRouter;
      const stream = activeRouter.stream({ messages, userId: request.user.id, source: 'memory_update' });
      for await (const chunk of stream) {
        if (chunk.type === 'text') {
          responseText += chunk.content;
        }
      }

      const stripped = responseText.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

      let updatedEntities: Array<{ name: string; entityType: string; observations: string[] }>;
      try {
        updatedEntities = JSON.parse(stripped);
        if (!Array.isArray(updatedEntities)) throw new Error('Not an array');
      } catch {
        return reply.code(400).send({ success: false, error: { message: 'Could not identify entities to update' } });
      }

      if (updatedEntities.length === 0) {
        return reply.send({ success: true, data: { updated: [], count: 0 } });
      }

      const entityNames = updatedEntities.map((e) => e.name);
      await adapter.callTool('memory_delete_entities', { entityNames });
      await adapter.callTool('memory_create_entities', { entities: updatedEntities });

      return reply.send({ success: true, data: { updated: entityNames, count: entityNames.length } });
    } catch (error) {
      console.error(`[EditMemories] Error for role ${params.id}:`, error);
      return reply.code(500).send({ success: false, error: { message: 'Failed to edit memories' } });
    }
  });

  fastify.post('/roles/:id/save-to-memory', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const mainDb = await getMainDatabase(config.storage.root);

    const role = await mainDb.getRole(params.id);
    if (!role) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    if (role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    const body = request.body as { text: string };
    if (!body.text?.trim()) {
      return reply.code(400).send({ success: false, error: { message: 'Text is required' } });
    }

    try {
      const adapter = await getMcpAdapter(request.user.id, 'memory', params.id);
      const trimmed = body.text.trim();
      const entityName = trimmed.length > 50 ? trimmed.slice(0, 50) + '…' : trimmed;
      await adapter.callTool('memory_create_entities', {
        entities: [{ name: entityName, entityType: 'ChatNote', observations: [trimmed] }],
      });
      return reply.send({ success: true });
    } catch (error) {
      console.error(`[SaveToMemory] Error for role ${params.id}:`, error);
      return reply.code(500).send({ success: false, error: { message: 'Failed to save to memory' } });
    }
  });
}
