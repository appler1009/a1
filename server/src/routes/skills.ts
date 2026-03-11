import type { FastifyInstance } from 'fastify';
import { getMainDatabase } from '../storage/index.js';
import { config } from '../config/index.js';

export async function skillsRoutes(fastify: FastifyInstance): Promise<void> {
  // List all skills (content omitted for brevity in list)
  fastify.get('/skills', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const mainDb = await getMainDatabase(config.storage.root);
    const skills = await mainDb.listSkills();
    // Omit content from list for bandwidth reasons
    const summary = skills.map(({ content: _content, ...rest }) => rest);
    return reply.send({ success: true, data: summary });
  });

  // Get a single skill with full content
  fastify.get('/skills/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const { id } = request.params as { id: string };
    const mainDb = await getMainDatabase(config.storage.root);
    const skill = await mainDb.getSkill(id);
    if (!skill) {
      return reply.code(404).send({ success: false, error: { message: 'Skill not found' } });
    }
    return reply.send({ success: true, data: skill });
  });
}
