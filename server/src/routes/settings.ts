import type { FastifyInstance } from 'fastify';
import { getMainDatabase } from '../storage/index.js';
import { config } from '../config/index.js';

export async function settingsRoutes(fastify: FastifyInstance): Promise<void> {
  // Get all settings (verify role ownership but settings are global)
  fastify.get('/settings', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { roleId?: string };
    const roleId = query.roleId;

    if (!roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    const mainDb = await getMainDatabase(config.storage.root);

    // Verify role ownership
    const role = await mainDb.getRole(roleId);
    if (!role || role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    const settings = await mainDb.getAllSettings();
    return reply.send({ success: true, data: settings });
  });

  // Get a specific setting
  fastify.get('/settings/:key', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { key: string };
    const query = request.query as { roleId?: string };
    const roleId = query.roleId;

    if (!roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    const mainDb = await getMainDatabase(config.storage.root);

    // Verify role ownership
    const role = await mainDb.getRole(roleId);
    if (!role || role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    const value = await mainDb.getSetting(params.key);

    if (value === null) {
      return reply.code(404).send({ success: false, error: { message: 'Setting not found' } });
    }

    return reply.send({ success: true, data: { key: params.key, value } });
  });

  // Update a setting
  fastify.put('/settings/:key', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { key: string };
    const body = request.body as { value: unknown; roleId?: string };
    const roleId = body.roleId;

    if (!roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    if (body.value === undefined) {
      return reply.code(400).send({ success: false, error: { message: 'Value is required' } });
    }

    const mainDb = await getMainDatabase(config.storage.root);

    // Verify role ownership
    const role = await mainDb.getRole(roleId);
    if (!role || role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    await mainDb.setSetting(params.key, body.value);
    console.log(`[Settings] Updated setting: ${params.key} = ${JSON.stringify(body.value)}`);

    return reply.send({ success: true, data: { key: params.key, value: body.value } });
  });

  // Delete a setting
  fastify.delete('/settings/:key', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { key: string };
    const query = request.query as { roleId?: string };
    const roleId = query.roleId;

    if (!roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    const mainDb = await getMainDatabase(config.storage.root);

    // Verify role ownership
    const role = await mainDb.getRole(roleId);
    if (!role || role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    await mainDb.deleteSetting(params.key);
    console.log(`[Settings] Deleted setting: ${params.key}`);

    return reply.send({ success: true });
  });
}
