import { FastifyInstance } from 'fastify';
import { v4 as uuidv4 } from 'uuid';
import type { IndividualSignup, CreateOrgSignup, JoinOrg } from '@local-agent/shared';
import { authService } from '../auth/index.js';
import { GoogleOAuthHandler } from '../auth/google-oauth.js';
import { GitHubOAuthHandler } from '../auth/github-oauth.js';
import { getMainDatabase } from '../storage/index.js';
import { config } from '../config/index.js';
import { getEmailService } from '../email-service.js';

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

    // Use secure cookies in production unless explicitly disabled
    const useSecureCookies = config.env.isProduction && process.env.COOKIE_SECURE !== 'false';
    
    reply.setCookie('session_id', session.id, {
      path: '/',
      httpOnly: true,
      secure: useSecureCookies,
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

    // Use secure cookies in production unless explicitly disabled
    const useSecureCookies = config.env.isProduction && process.env.COOKIE_SECURE !== 'false';

    reply.setCookie('session_id', session.id, {
      path: '/',
      httpOnly: true,
      secure: useSecureCookies,
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

    // Use secure cookies in production unless explicitly disabled
    const useSecureCookies = config.env.isProduction && process.env.COOKIE_SECURE !== 'false';

    reply.setCookie('session_id', session.id, {
      path: '/',
      httpOnly: true,
      secure: useSecureCookies,
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

    // Use secure cookies in production unless explicitly disabled
    const useSecureCookies = config.env.isProduction && process.env.COOKIE_SECURE !== 'false';

    reply.setCookie('session_id', session.id, {
      path: '/',
      httpOnly: true,
      secure: useSecureCookies,
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

  // Request magic link
  fastify.post('/magic-link/request', async (request, reply) => {
    const body = request.body as { email: string };
    const { email } = body;

    if (!email) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Email is required' },
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Invalid email format' },
      });
    }

    try {
      const mainDb = await getMainDatabase(config.storage.root);
      
      // Get or create user (always create user for security - don't reveal if email exists)
      let user = await mainDb.getUserByEmail(email);
      if (!user) {
        user = await mainDb.createUser(email, undefined, 'individual');
      }

      // Clean up expired tokens for this email
      await mainDb.deleteExpiredMagicLinkTokens(email);

      // Create magic link token (expires in 5 minutes)
      const magicLinkToken = await mainDb.createMagicLinkToken(email, user.id, 300);

      // Build magic link URL using the request's hostname and port
      const hostname = request.hostname;
      // Extract port from hostname if present (e.g., "localhost:3000")
      const portMatch = hostname.match(/:(\d+)$/);
      const cleanHostname = portMatch ? hostname.replace(/:\d+$/, '') : hostname;
      // In production use https (server may be behind a TLS-terminating proxy);
      // in dev fall back to the request protocol.
      const protocol = config.env.isProduction ? 'https' : (request.protocol === 'https' ? 'https' : 'http');
      // Omit port for standard ports (80/443); keep non-standard ports (e.g. localhost:3000)
      const explicitPort = portMatch ? portMatch[1] : null;
      const standardPort = (protocol === 'https' && explicitPort === '443') || (protocol === 'http' && explicitPort === '80');
      const hostWithPort = explicitPort && !standardPort ? `${cleanHostname}:${explicitPort}` : cleanHostname;
      const magicLink = `${protocol}://${hostWithPort}/login/verify?token=${magicLinkToken.token}`;

      let emailSent = false;
      try {
        const emailService = getEmailService();
        await emailService.sendMagicLinkEmail(email, magicLink);
        emailSent = true;
      } catch (emailError) {
        if (config.env.isProduction) {
          throw emailError;
        }
        console.warn('[MagicLink] Email send failed (no email service configured?):', emailError);
      }

      return reply.send({
        success: true,
        data: {
          message: emailSent ? 'Magic link sent to your email' : 'Magic link created (email not sent)',
          // Expose the raw token only in non-production environments so that
          // local dev and E2E tests can authenticate via /magic-link/verify directly.
          ...(!config.env.isProduction && !emailSent ? { testToken: magicLinkToken.token } : {}),
        },
      });
    } catch (error) {
      console.error('[MagicLink] Error:', error);
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to send magic link' },
      });
    }
  });

  // Verify magic link
  fastify.get('/magic-link/verify', async (request, reply) => {
    const { token } = request.query as { token?: string };

    if (!token) {
      return reply.code(400).send({
        success: false,
        error: { message: 'Token is required' },
      });
    }

    try {
      const mainDb = await getMainDatabase(config.storage.root);
      
      // Verify the token
      const verification = await mainDb.verifyMagicLinkToken(token);
      if (!verification) {
        return reply.code(400).send({
          success: false,
          error: { message: 'Invalid or expired token' },
        });
      }

      // Mark token as used
      await mainDb.useMagicLinkToken(token);

      // Get user
      const user = await mainDb.getUser(verification.userId);
      if (!user) {
        return reply.code(404).send({
          success: false,
          error: { message: 'User not found' },
        });
      }

      // Create session
      const session = await mainDb.createSession(user.id);

      // Use secure cookies in production unless explicitly disabled
      const useSecureCookies = config.env.isProduction && process.env.COOKIE_SECURE !== 'false';

      reply.setCookie('session_id', session.id, {
        path: '/',
        httpOnly: true,
        secure: useSecureCookies,
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
    } catch (error) {
      console.error('[MagicLink] Verify error:', error);
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to verify token' },
      });
    }
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
    const { redirectTo, service } = request.query as { redirectTo?: string; service?: string };
    const validServices = ['gmail', 'drive', 'calendar'];
    const googleService = service && validServices.includes(service) ? service : undefined;
    const authUrl = googleOAuth.getAuthorizationUrl(state, redirectTo, googleService);

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

        // Store token under service-specific provider key
        const tokenProvider = stateVerification.service ? `google-${stateVerification.service}` : 'google';
        await authService.storeOAuthToken(request.user.id, {
          provider: tokenProvider,
          accessToken: tokenResponse.access_token,
          refreshToken: tokenResponse.refresh_token,
          expiryDate,
          accountEmail,
        });

        console.log(`[GoogleOAuth] Stored token for user ${request.user.id} (provider: ${tokenProvider}, account: ${accountEmail})`);
      }

      // Redirect to the frontend callback page with provider info
      // This page will show success message and close the popup
      const frontendUrl = config.frontendUrl;
      const callbackUrl = new URL('/auth/google/callback', frontendUrl);
      callbackUrl.searchParams.set('code', code);
      callbackUrl.searchParams.set('state', state);
      callbackUrl.searchParams.set('provider', stateVerification.service ? `google-${stateVerification.service}` : 'google');
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
        if (provider === 'google' || provider.startsWith('google-')) {
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

  // Get token usage for a given calendar month (defaults to current month)
  // Query param: ?month=YYYY-MM
  fastify.get('/me/token-usage', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { month?: string };
    const now = new Date();
    let year = now.getFullYear();
    let month = now.getMonth(); // 0-indexed

    if (query.month && /^\d{4}-\d{2}$/.test(query.month)) {
      const [y, m] = query.month.split('-').map(Number);
      year = y;
      month = m - 1; // convert to 0-indexed
    }

    const mainDb = await getMainDatabase(config.storage.root);
    const from = new Date(year, month, 1);
    const to = new Date(year, month + 1, 0, 23, 59, 59, 999);

    const records = await mainDb.getTokenUsageByUser(request.user.id, { from, to });

    const zero = () => ({ promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedInputTokens: 0, cacheCreationTokens: 0 });

    const totals = records.reduce((acc, r) => ({
      promptTokens: acc.promptTokens + r.promptTokens,
      completionTokens: acc.completionTokens + r.completionTokens,
      totalTokens: acc.totalTokens + r.totalTokens,
      cachedInputTokens: acc.cachedInputTokens + r.cachedInputTokens,
      cacheCreationTokens: acc.cacheCreationTokens + r.cacheCreationTokens,
    }), zero());

    const byModel: Record<string, ReturnType<typeof zero>> = {};
    const byProvider: Record<string, ReturnType<typeof zero>> = {};
    for (const r of records) {
      if (!byModel[r.model]) byModel[r.model] = zero();
      byModel[r.model].promptTokens += r.promptTokens;
      byModel[r.model].completionTokens += r.completionTokens;
      byModel[r.model].totalTokens += r.totalTokens;
      byModel[r.model].cachedInputTokens += r.cachedInputTokens;
      byModel[r.model].cacheCreationTokens += r.cacheCreationTokens;

      if (!byProvider[r.provider]) byProvider[r.provider] = zero();
      byProvider[r.provider].promptTokens += r.promptTokens;
      byProvider[r.provider].completionTokens += r.completionTokens;
      byProvider[r.provider].totalTokens += r.totalTokens;
      byProvider[r.provider].cachedInputTokens += r.cachedInputTokens;
      byProvider[r.provider].cacheCreationTokens += r.cacheCreationTokens;
    }

    return reply.send({
      success: true,
      data: {
        month: `${year}-${String(month + 1).padStart(2, '0')}`,
        ...totals,
        byModel,
        byProvider,
        recordCount: records.length,
      },
    });
  });
}