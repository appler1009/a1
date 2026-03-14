import { v4 as uuidv4 } from 'uuid';
import type { FastifyInstance } from 'fastify';
import { getMainDatabase } from '../storage/index.js';
import { config } from '../config/index.js';
import { mcpManager, getMcpAdapter, listPredefinedServers, getPredefinedServer, requiresAuth, PREDEFINED_MCP_SERVERS } from '../mcp/index.js';
import { authService } from '../auth/index.js';
import { serverCurrentRoleId } from '../shared-state.js';

export async function mcpServerRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/mcp/servers', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    // Get IDs of hidden predefined servers
    const hiddenServerIds = new Set(
      PREDEFINED_MCP_SERVERS.filter(s => s.hidden).map(s => s.id)
    );

    // Return full server objects with { id, config, info }, filtering out hidden servers
    // Check both the config.hidden flag AND if the server ID matches a hidden predefined server
    let servers = mcpManager.getServers().filter(s =>
      !s.config.hidden && !hiddenServerIds.has(s.id)
    );

    // Note: accountEmail is already in server.config for multi-account support
    // No need to fetch it separately - the config contains it
    const enhancedServers = servers;

    return reply.send({ success: true, data: { servers: enhancedServers, currentRoleId: serverCurrentRoleId } });
  });

  fastify.post('/mcp/servers', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as any;

    // Get the current role ID
    const currentRoleId = serverCurrentRoleId;

    if (!currentRoleId) {
      return reply.code(400).send({
        success: false,
        error: { message: 'No role is currently active. Please switch to a role first.' },
      });
    }

    const serverConfig = {
      id: body.id || undefined,
      name: body.name,
      transport: body.transport,
      command: body.command,
      args: body.args,
      cwd: body.cwd,
      url: body.url,
      enabled: true,
      autoStart: false,
      restartOnExit: false,
      auth: body.auth,
      env: body.env,
    };

    try {
      // If auth config includes Google OAuth, fetch the user-level token
      let userToken: any;
      if (serverConfig.auth?.provider && serverConfig.auth.provider.startsWith('google')) {
        // Always use user-level OAuth token (role-specific tokens have been migrated)
        const oauthToken = await authService.getOAuthToken(request.user.id, serverConfig.auth.provider);
        if (oauthToken) {
          userToken = {
            access_token: oauthToken.accessToken,
            refresh_token: oauthToken.refreshToken,
            expiry_date: oauthToken.expiryDate,
            token_type: 'Bearer',
          };
          console.log(`[MCP] Using user-level Google OAuth token for server ${serverConfig.name} (account: ${oauthToken.accountEmail})`);
        }
      }

      // Add server (MCP servers are user-level, not role-specific)
      await mcpManager.addServer(serverConfig, userToken);
      return reply.send({ success: true, data: { name: body.name, connected: true, roleId: currentRoleId } });
    } catch (error) {
      return reply.code(500).send({ success: false, error: { message: 'Failed to connect to MCP server', details: String(error) } });
    }
  });

  fastify.get('/mcp/servers/:id/tools', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const tools = mcpManager.getTools(params.id);
    return reply.send({ success: true, data: tools });
  });

  // Update MCP server status
  fastify.patch('/mcp/servers/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const { enabled } = request.body as { enabled?: boolean };

    if (typeof enabled !== 'boolean') {
      return reply.code(400).send({ success: false, error: { message: 'enabled must be a boolean' } });
    }

    try {
      await mcpManager.updateServerStatus(params.id, enabled);
      return reply.send({ success: true });
    } catch (error) {
      return reply.code(400).send({ success: false, error: { message: 'Failed to update server status' } });
    }
  });

  // Delete MCP server
  fastify.delete('/mcp/servers/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    try {
      await mcpManager.removeServer(params.id);
      return reply.send({ success: true });
    } catch (error) {
      return reply.code(400).send({ success: false, error: { message: 'Failed to remove server' } });
    }
  });

  // List available predefined MCP servers
  fastify.get('/mcp/available-servers', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as Record<string, string>;
    const includeHidden = query.includeHidden === 'true';
    const servers = listPredefinedServers(includeHidden);
    return reply.send({ success: true, data: servers });
  });

  // Add a predefined MCP server
  fastify.post('/mcp/servers/add-predefined', async (request, reply) => {
    const requestId = uuidv4().substring(0, 8);
    console.log(`[AddPredefinedServer:${requestId}] Request started`);

    if (!request.user) {
      console.log(`[AddPredefinedServer:${requestId}] Not authenticated`);
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const { serverId, accountEmail, apiKey } = request.body as { serverId: string; accountEmail?: string; apiKey?: string };
    console.log(`[AddPredefinedServer:${requestId}] serverId: ${serverId}, accountEmail: ${accountEmail || 'auto'}`);

    if (!serverId) {
      console.log(`[AddPredefinedServer:${requestId}] serverId is missing`);
      return reply.code(400).send({
        success: false,
        error: { message: 'serverId is required' },
      });
    }

    // Get the current role ID
    const currentRoleId = serverCurrentRoleId;
    if (!currentRoleId) {
      return reply.code(400).send({
        success: false,
        error: { message: 'No role is currently active. Please switch to a role first.' },
      });
    }

    console.log(`[AddPredefinedServer:${requestId}] Looking up predefined server...`);
    const predefinedServer = getPredefinedServer(serverId);
    if (!predefinedServer) {
      console.log(`[AddPredefinedServer:${requestId}] Predefined server not found`);
      return reply.code(404).send({
        success: false,
        error: { message: `Unknown server: ${serverId}` },
      });
    }

    try {
      console.log(`[AddPredefinedServer:${requestId}] Checking auth requirements...`);
      // Check if auth is required and available
      if (requiresAuth(serverId)) {
        if (predefinedServer.auth?.provider && predefinedServer.auth.provider.startsWith('google')) {
          const googleProvider = predefinedServer.auth.provider;
          console.log(`[AddPredefinedServer:${requestId}] Google auth required (${googleProvider}), checking token for account: ${accountEmail || 'any'}...`);

          // Always use user-level OAuth token (role-specific tokens have been migrated)
          // If accountEmail is specified, use that specific account; otherwise get the first one
          const oauthToken = await authService.getOAuthToken(request.user.id, googleProvider, accountEmail);
          if (!oauthToken) {
            console.log(`[AddPredefinedServer:${requestId}] No OAuth token found for account: ${accountEmail || 'any'}`);
            return reply.code(403).send({
              success: false,
              error: {
                code: 'NO_AUTH',
                message: `${predefinedServer.name} requires Google authentication. Please authenticate first.`,
                authRequired: true,
                authProvider: googleProvider,
              },
            });
          }
          console.log(`[AddPredefinedServer:${requestId}] OAuth token found (account: ${oauthToken.accountEmail})`);
        }
        // Add other auth providers as needed
        if (predefinedServer.auth?.provider === 'alphavantage' || predefinedServer.auth?.provider === 'twelvedata') {
          if (!apiKey) {
            return reply.code(400).send({
              success: false,
              error: {
                code: 'NO_API_KEY',
                message: `${predefinedServer.name} requires an API key. Please provide apiKey in the request.`,
                authRequired: true,
                authProvider: predefinedServer.auth.provider,
              },
            });
          }
          // Store the API key in mcp_servers under serverId:userId
          const mainDb = await getMainDatabase(config.storage.root);
          await mainDb.saveMCPServerConfig(`${serverId}:${request.user.id}`, { apiKey });
          console.log(`[AddPredefinedServer:${requestId}] Stored API key for ${serverId}:${request.user.id}`);
        }
        if (predefinedServer.auth?.provider === 'smtp-imap') {
          const mainDb = await getMainDatabase(config.storage.root);
          const accounts = await mainDb.listServiceCredentials(request.user.id, 'smtp-imap');
          if (!accounts.length) {
            return reply.code(400).send({
              success: false,
              error: {
                code: 'NO_CREDENTIALS',
                message: 'SMTP/IMAP credentials not configured. Please save your account details first.',
                authRequired: true,
                authProvider: 'smtp-imap',
              },
            });
          }
          console.log(`[AddPredefinedServer:${requestId}] SMTP/IMAP credentials found (${accounts.length} account(s))`);
        }
      }

      // Create config from predefined server
      console.log(`[AddPredefinedServer:${requestId}] Creating server config...`);
      // Generate unique instance ID for multi-account support (e.g., gmail-mcp-lib~user@gmail.com)
      const instanceId = accountEmail ? `${predefinedServer.id}~${accountEmail}` : predefinedServer.id;
      const serverConfig = {
        id: instanceId,
        name: predefinedServer.name,
        transport: 'stdio' as const,
        command: predefinedServer.command,
        args: predefinedServer.args,
        cwd: undefined,
        url: undefined,
        enabled: true,
        autoStart: false,
        restartOnExit: false,
        auth: predefinedServer.auth,
        userId: request.user.id, // Store the user who owns this server (needed for auth-required servers at startup)
        accountEmail, // Store the selected account email for multi-account support
        env: predefinedServer.env || {},
      };

      // Prepare token if needed
      let userToken: any;
      if (serverConfig.auth?.provider && serverConfig.auth.provider.startsWith('google')) {
        console.log(`[AddPredefinedServer:${requestId}] Preparing Google token (${serverConfig.auth.provider}) for account: ${accountEmail || 'auto'}...`);

        // Always use user-level OAuth token (role-specific tokens have been migrated)
        // If accountEmail is specified, use that specific account; otherwise get the first one
        const oauthToken = await authService.getOAuthToken(request.user.id, serverConfig.auth.provider, accountEmail);
        if (oauthToken) {
          userToken = {
            access_token: oauthToken.accessToken,
            refresh_token: oauthToken.refreshToken,
            expiry_date: oauthToken.expiryDate,
            token_type: 'Bearer',
          };
          console.log(`[AddPredefinedServer:${requestId}] Using user-level token (account: ${oauthToken.accountEmail})`);
        }
      } else if ((serverConfig.auth?.provider === 'alphavantage' || serverConfig.auth?.provider === 'twelvedata') && apiKey) {
        userToken = { apiKey };
        console.log(`[AddPredefinedServer:${requestId}] Using API key for ${serverId}`);
      }

      console.log(`[AddPredefinedServer:${requestId}] Calling mcpManager.addServer...`);
      await mcpManager.addServer(serverConfig, userToken);
      console.log(`[AddPredefinedServer:${requestId}] Server added successfully`);

      console.log(`[AddPredefinedServer:${requestId}] Sending success response`);
      return reply.send({
        success: true,
        data: {
          id: predefinedServer.id,
          name: predefinedServer.name,
          connected: true,
          roleId: currentRoleId,
        },
      });
    } catch (error) {
      console.error(`[AddPredefinedServer:${requestId}] Error occurred:`, error);
      return reply.code(500).send({
        success: false,
        error: {
          message: `Failed to connect to ${predefinedServer.name}`,
          details: String(error),
        },
      });
    } finally {
      console.log(`[AddPredefinedServer:${requestId}] Request completed`);
    }
  });

  // Store user-level OAuth token for MCP servers
  // Note: OAuth tokens are now stored at the user level, not per-role
  fastify.post('/mcp/oauth/token', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as {
      roleId?: string; // Kept for backward compatibility but not used
      provider: string;
      accessToken: string;
      refreshToken?: string;
      expiryDate?: number;
      accountEmail?: string;
    };

    if (!body.provider || !body.accessToken) {
      return reply.code(400).send({
        success: false,
        error: { message: 'provider and accessToken are required' },
      });
    }

    try {
      // Store at user-level (tokens are now shared across all roles)
      await authService.storeOAuthToken(request.user.id, {
        provider: body.provider,
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        expiryDate: body.expiryDate,
        accountEmail: body.accountEmail || '',
      });

      console.log(`[MCP] Stored ${body.provider} OAuth token for user ${request.user.id}`);

      return reply.send({
        success: true,
        data: {
          provider: body.provider,
          message: `OAuth token stored for user`,
        },
      });
    } catch (error) {
      console.error('[MCP] Failed to store OAuth token:', error);
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to store OAuth token' },
      });
    }
  });

  // Get user-level OAuth token status
  // Note: OAuth tokens are now stored at the user level, not per-role
  fastify.get('/mcp/oauth/token', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { roleId?: string; provider?: string };

    if (!query.provider) {
      return reply.code(400).send({
        success: false,
        error: { message: 'provider is required' },
      });
    }

    try {
      // Get user-level token (no longer role-specific)
      const token = await authService.getOAuthToken(request.user.id, query.provider);

      return reply.send({
        success: true,
        data: {
          provider: query.provider,
          hasToken: !!token,
          accountEmail: token?.accountEmail,
          expiryDate: token?.expiryDate,
        },
      });
    } catch (error) {
      console.error('[MCP] Failed to get OAuth token:', error);
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to get OAuth token status' },
      });
    }
  });

  // Get all user-level OAuth connections (shared across all roles)
  fastify.get('/mcp/oauth/connections', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    try {
      const mainDb = await getMainDatabase();

      // Get all OAuth tokens for this user
      const [gmailTokens, driveTokens, calendarTokens, githubTokens] = await Promise.all([
        mainDb.getAllUserOAuthTokens(request.user.id, 'google-gmail'),
        mainDb.getAllUserOAuthTokens(request.user.id, 'google-drive'),
        mainDb.getAllUserOAuthTokens(request.user.id, 'google-calendar'),
        mainDb.getAllUserOAuthTokens(request.user.id, 'github'),
      ]);

      const toAccountList = (tokens: typeof githubTokens) => tokens.map(token => ({
        accountEmail: token.accountEmail,
        expiryDate: token.expiryDate,
        createdAt: token.createdAt,
        updatedAt: token.updatedAt,
      }));

      return reply.send({
        success: true,
        data: {
          'google-gmail': toAccountList(gmailTokens),
          'google-drive': toAccountList(driveTokens),
          'google-calendar': toAccountList(calendarTokens),
          github: toAccountList(githubTokens),
        },
      });
    } catch (error) {
      console.error('[MCP] Failed to get OAuth connections:', error);
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to get OAuth connections' },
      });
    }
  });
}
