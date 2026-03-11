import type { FastifyInstance } from 'fastify';
import { authService } from '../auth/index.js';

export async function groupRoutes(fastify: FastifyInstance): Promise<void> {
  // Get user's groups
  fastify.get('/groups', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const groups = await authService.getUserGroups(request.user.id);
    return reply.send({ success: true, data: groups });
  });

  // Create group
  fastify.post('/groups', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as { name: string; url?: string };
    const group = await authService.createGroup(body.name, body.url);
    await authService.addMember(group.id, request.user.id, 'owner');

    return reply.send({ success: true, data: group });
  });

  // Get group members
  fastify.get('/groups/:id/members', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const members = await authService.getGroupMembers(params.id);
    return reply.send({ success: true, data: members });
  });

  // Create invitation
  fastify.post('/groups/:id/invitations', async (request, reply) => {
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
}
