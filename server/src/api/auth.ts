import { FastifyInstance } from 'fastify';
import type { IndividualSignup, CreateOrgSignup, JoinOrg } from '@local-agent/shared';
import { authService } from '../auth/index.js';

export async function authRoutes(fastify: FastifyInstance) {
  // Check if email exists
  fastify.post('/check-email', async (request, reply) => {
    const body = request.body as { email: string };
    
    const user = await authService.getUserByEmail(body.email);
    
    return reply.send({
      success: true,
      data: {
        exists: !!user,
      },
    });
  });

  // Login (email-only)
  fastify.post('/login', async (request, reply) => {
    const body = request.body as { email: string };
    
    const user = await authService.getUserByEmail(body.email);
    
    if (!user) {
      return reply.code(404).send({
        success: false,
        error: { message: 'User not found' },
      });
    }

    const session = await authService.createSession(user.id);
    
    return reply.send({
      success: true,
      data: {
        user,
        session,
      },
    });
  });

  // Individual signup
  fastify.post('/signup/individual', async (request, reply) => {
    const body = request.body as IndividualSignup;
    
    const existing = await authService.getUserByEmail(body.email);
    if (existing) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Email already registered' },
      });
    }

    const user = await authService.createUser(body.email, body.name, 'individual');
    const session = await authService.createSession(user.id);
    
    return reply.send({
      success: true,
      data: {
        user,
        session,
      },
    });
  });

  // Group signup (create new group)
  fastify.post('/signup/group', async (request, reply) => {
    const body = request.body as CreateOrgSignup;
    
    const existing = await authService.getUserByEmail(body.email);
    if (existing) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Email already registered' },
      });
    }

    // Check if group URL is taken
    if (body.groupUrl) {
      const existingGroup = await authService.getGroupByUrl(body.groupUrl);
      if (existingGroup) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Group URL is already taken' },
        });
      }
    }

    const result = await authService.createGroupUser(
      body.email,
      body.name,
      body.groupName,
      body.groupUrl
    );
    
    const session = await authService.createSession(result.user.id);
    
    return reply.send({
      success: true,
      data: {
        user: result.user,
        session,
        group: result.group,
        inviteCode: result.invitation.code,
      },
    });
  });

  // Join group with invitation code
  fastify.post('/join', async (request, reply) => {
    const body = request.body as JoinOrg;
    
    // Find invitation by code
    const invitation = await authService.getInvitationByCode(body.inviteCode);
    
    if (!invitation) {
      return reply.code(404).send({
        success: false,
        error: { message: 'Invalid invitation code' },
      });
    }

    if (invitation.usedAt) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Invitation already used' },
      });
    }

    if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Invitation expired' },
      });
    }

    // Check if email matches invitation (if invitation has email)
    if (invitation.email && invitation.email !== body.email) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Email does not match invitation' },
      });
    }

    // Check if user already exists
    let user = await authService.getUserByEmail(body.email);
    
    if (!user) {
      // Create new user
      user = await authService.createOrgUser(
        body.email, 
        body.name, 
        invitation.groupId, 
        invitation.role || 'member'
      );
    } else {
      // Add existing user to group
      await authService.addMember(invitation.groupId, user.id, invitation.role || 'member');
    }

    // Accept invitation
    await authService.acceptInvitation(body.inviteCode, user.id);
    
    const group = await authService.getGroup(invitation.groupId);
    const session = await authService.createSession(user.id);
    
    return reply.send({
      success: true,
      data: {
        user,
        session,
        group,
      },
    });
  });

  // Get invitation details
  fastify.get('/invitation/:code', async (request, reply) => {
    const params = request.params as { code: string };
    
    const invitation = await authService.getInvitationByCode(params.code);
    
    if (!invitation) {
      return reply.code(404).send({
        success: false,
        error: { message: 'Invitation not found' },
      });
    }

    const group = await authService.getGroup(invitation.groupId);
    
    return reply.send({
      success: true,
      data: {
        group,
        role: invitation.role,
        email: invitation.email,
      },
    });
  });

  // Logout
  fastify.post('/logout', async (request, reply) => {
    const body = request.body as { sessionId?: string };
    
    if (body.sessionId) {
      await authService.deleteSession(body.sessionId);
    }
    
    return reply.send({
      success: true,
    });
  });

  // Get current user
  fastify.get('/me', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({
        success: false,
        error: { message: 'Not authenticated' },
      });
    }

    const user = await authService.getUser(request.user.id);
    const groups = await authService.getUserGroups(request.user.id);
    
    return reply.send({
      success: true,
      data: {
        user,
        groups,
      },
    });
  });
}