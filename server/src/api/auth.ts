import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import type { IndividualSignup, CreateOrgSignup, JoinOrg } from '@local-agent/shared';
import { authService } from '../auth/index.js';
import { GoogleOAuthHandler } from '../auth/google-oauth.js';
import { GitHubOAuthHandler } from '../auth/github-oauth.js';
import { getMainDatabase } from '../storage/index.js';
import { config } from '../config/index.js';

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

    reply.setCookie('session_id', session.id, {
      path: '/',
      httpOnly: true,
      secure: config.env.isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

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

    reply.setCookie('session_id', session.id, {
      path: '/',
      httpOnly: true,
      secure: config.env.isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

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

    reply.setCookie('session_id', session.id, {
      path: '/',
      httpOnly: true,
      secure: config.env.isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

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

    reply.setCookie('session_id', session.id, {
      path: '/',
      httpOnly: true,
      secure: config.env.isProduction,
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

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

  // Update current user profile
  fastify.patch('/me', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({
        success: false,
        error: { message: 'Not authenticated' },
      });
    }

    const body = request.body as { name?: string; discordUserId?: string; locale?: string; timezone?: string };
    const mainDb = await getMainDatabase(config.storage.root);

    const updates: Partial<{ name?: string; discordUserId?: string; locale?: string; timezone?: string }> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.discordUserId !== undefined) updates.discordUserId = body.discordUserId;
    if (body.locale !== undefined) updates.locale = body.locale;
    if (body.timezone !== undefined) updates.timezone = body.timezone;

    const updatedUser = await mainDb.updateUser(request.user.id, updates);

    if (!updatedUser) {
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to update user' },
      });
    }

    const groups = await authService.getUserGroups(request.user.id);

    return reply.send({
      success: true,
      data: {
        user: updatedUser,
        groups,
      },
    });
  });

  // Google OAuth flow
  const googleOAuth = new GoogleOAuthHandler({
    clientId: config.google.clientId,
    clientSecret: config.google.clientSecret,
    redirectUri: config.google.redirectUri,
  });

  // Start Google OAuth flow
  fastify.get('/google/start', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({
        success: false,
        error: { message: 'Not authenticated' },
      });
    }

    const state = uuidv4();
    const redirectTo = (request.query as any).redirectTo as string | undefined;
    const authUrl = googleOAuth.getAuthorizationUrl(state, redirectTo);

    return reply.send({
      success: true,
      data: {
        authUrl,
      },
    });
  });

  // Google OAuth callback
  fastify.get('/google/callback', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };

    if (!code || !state) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Missing authorization code or state' },
      });
    }

    // Verify state
    const stateVerification = googleOAuth.verifyState(state);
    if (!stateVerification.valid) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Invalid or expired state parameter' },
      });
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await googleOAuth.exchangeCodeForTokens(code);

      // Hoist accountEmail so it's available for the redirect URL below
      let accountEmail = '';

      // Store the token if user is authenticated
      if (request.user) {
        const expiryDate = tokenResponse.expires_in ? Date.now() + tokenResponse.expires_in * 1000 : undefined;

        // Get the Google account email from userinfo endpoint
        try {
          const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: {
              'Authorization': `Bearer ${tokenResponse.access_token}`,
            },
          });

          if (userinfoResponse.ok) {
            const userinfo = (await userinfoResponse.json()) as { email?: string };
            accountEmail = userinfo.email || '';
            console.log(`[GoogleOAuth] Got account email from userinfo: ${accountEmail}`);
          } else {
            console.warn(`[GoogleOAuth] Failed to fetch userinfo: ${userinfoResponse.status}`);
          }
        } catch (error) {
          console.warn(`[GoogleOAuth] Error fetching userinfo:`, error);
        }

        // Store global token with account email
        await authService.storeOAuthToken(request.user.id, {
          provider: 'google',
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiryDate,
          accountEmail,
        });

        console.log(`[GoogleOAuth] Stored global token for user ${request.user.id} (account: ${accountEmail})`);
      }

      // Redirect to the frontend callback page with provider info
      // This page will show success message and close the popup
      const frontendUrl = config.frontendUrl;
      const callbackUrl = new URL('/auth/google/callback', frontendUrl);
      callbackUrl.searchParams.set('code', code);
      callbackUrl.searchParams.set('state', state);
      callbackUrl.searchParams.set('provider', 'google');
      if (accountEmail) {
        callbackUrl.searchParams.set('accountEmail', accountEmail);
      }

      return reply.redirect(callbackUrl.toString());
    } catch (error) {
      console.error('[GoogleOAuth] Token exchange failed:', error);
      // Redirect to error page instead of sending JSON
      const frontendUrl = config.frontendUrl;
      const errorUrl = new URL('/auth/google/callback', frontendUrl);
      errorUrl.searchParams.set('error', 'token_exchange_failed');
      errorUrl.searchParams.set('state', state);

      return reply.redirect(errorUrl.toString());
    }
  });

  // Get stored OAuth token
  fastify.get('/oauth/token/:provider', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({
        success: false,
        error: { message: 'Not authenticated' },
      });
    }

    const { provider } = request.params as { provider: string };
    const token = await authService.getOAuthToken(request.user.id, provider);

    if (!token) {
      return reply.code(404).send({
        success: false,
        error: { message: `No ${provider} token found` },
      });
    }

    return reply.send({
      success: true,
      data: {
        provider: token.provider,
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiryDate: token.expiryDate,
      },
    });
  });

  // Revoke OAuth token
  fastify.post('/oauth/revoke/:provider', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({
        success: false,
        error: { message: 'Not authenticated' },
      });
    }

    const { provider } = request.params as { provider: string };
    const token = await authService.getOAuthToken(request.user.id, provider);

    if (token) {
      try {
        // Attempt to revoke with Google
        if (provider === 'google') {
          await googleOAuth.revokeToken(token.accessToken);
        } else if (provider === 'github') {
          await githubOAuth.revokeToken(token.accessToken);
        }
      } catch (error) {
        console.error(`[OAuth] Failed to revoke token:`, error);
      }
    }

    // Remove from storage regardless
    await authService.revokeOAuthToken(request.user.id, provider);

    return reply.send({
      success: true,
    });
  });

  // GitHub OAuth flow
  const githubOAuth = new GitHubOAuthHandler({
    clientId: config.github.clientId,
    clientSecret: config.github.clientSecret,
    redirectUri: config.github.redirectUri,
  });

  // Start GitHub OAuth flow
  fastify.get('/github/start', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({
        success: false,
        error: { message: 'Not authenticated' },
      });
    }

    const state = uuidv4();
    const redirectTo = (request.query as any).redirectTo as string | undefined;
    const authUrl = githubOAuth.getAuthorizationUrl(state, redirectTo);

    return reply.send({
      success: true,
      data: {
        authUrl,
      },
    });
  });

  // GitHub OAuth callback
  fastify.get('/github/callback', async (request, reply) => {
    const { code, state } = request.query as { code?: string; state?: string };

    if (!code || !state) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Missing authorization code or state' },
      });
    }

    // Verify state
    const stateVerification = githubOAuth.verifyState(state);
    if (!stateVerification.valid) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Invalid or expired state parameter' },
      });
    }

    try {
      // Exchange code for tokens
      const tokenResponse = await githubOAuth.exchangeCodeForTokens(code);

      // Store the token if user is authenticated
      if (request.user) {
        // GitHub tokens don't have expiry by default
        await authService.storeOAuthToken(request.user.id, {
          provider: 'github',
          accessToken: tokenResponse.access_token,
          refreshToken: undefined,
          expiryDate: undefined,
          accountEmail: '', // GitHub doesn't require email for token storage
        });

        console.log(`[GitHubOAuth] Stored global token for user ${request.user.id}`);
      }

      // Redirect to the frontend callback page with provider info
      const frontendUrl = config.frontendUrl;
      const callbackUrl = new URL('/auth/github/callback', frontendUrl);
      callbackUrl.searchParams.set('code', code);
      callbackUrl.searchParams.set('state', state);
      callbackUrl.searchParams.set('provider', 'github');

      return reply.redirect(callbackUrl.toString());
    } catch (error) {
      console.error('[GitHubOAuth] Token exchange failed:', error);
      // Redirect to error page
      const frontendUrl = config.frontendUrl;
      const errorUrl = new URL('/auth/github/callback', frontendUrl);
      errorUrl.searchParams.set('error', 'token_exchange_failed');
      errorUrl.searchParams.set('state', state);

      return reply.redirect(errorUrl.toString());
    }
  });
}