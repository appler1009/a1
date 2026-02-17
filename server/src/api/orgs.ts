import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authService } from '../auth/index.js';

const CreateOrgSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
});

const AddMemberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(['owner', 'admin', 'member']),
});

export async function registerOrgRoutes(fastify: FastifyInstance): Promise<void> {
  // Create organization
  fastify.post('/api/orgs', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    try {
      const body = CreateOrgSchema.parse(request.body);
      const org = await authService.createOrganization(body.name, body.slug, request.user.id);
      
      return { success: true, data: org };
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error },
      });
    }
  });

  // Get organization
  fastify.get('/api/orgs/:orgId', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const { orgId } = request.params as { orgId: string };
    
    // Check membership
    const membership = await authService.getMembership(orgId, request.user.id);
    if (!membership) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not a member of this organization' },
      });
    }

    const org = await authService.getOrganization(orgId);
    if (!org) {
      return reply.status(404).send({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Organization not found' },
      });
    }

    return { success: true, data: org };
  });

  // Get organization members
  fastify.get('/api/orgs/:orgId/members', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const { orgId } = request.params as { orgId: string };
    
    // Check membership
    const membership = await authService.getMembership(orgId, request.user.id);
    if (!membership) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Not a member of this organization' },
      });
    }

    const members = await authService.getGroupMembers(orgId);
    return { success: true, data: members };
  });

  // Add member
  fastify.post('/api/orgs/:orgId/members', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const { orgId } = request.params as { orgId: string };
    
    // Check if user is owner or admin
    const membership = await authService.getMembership(orgId, request.user.id);
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only owners and admins can add members' },
      });
    }

    try {
      const body = AddMemberSchema.parse(request.body);
      const newMembership = await authService.addMember(orgId, body.userId, body.role);
      
      return { success: true, data: newMembership };
    } catch (error) {
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error },
      });
    }
  });

  // Remove member
  fastify.delete('/api/orgs/:orgId/members/:userId', async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Not authenticated' },
      });
    }

    const { orgId, userId } = request.params as { orgId: string; userId: string };
    
    // Check if user is owner or admin
    const membership = await authService.getMembership(orgId, request.user.id);
    if (!membership || (membership.role !== 'owner' && membership.role !== 'admin')) {
      return reply.status(403).send({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Only owners and admins can remove members' },
      });
    }

    await authService.removeMember(orgId, userId);
    return { success: true };
  });
}