import path from 'path';
import { promises as fs } from 'fs';
import type { McpAdapter, MCPServerConfig } from '@local-agent/shared';
import { adapterRegistry } from './adapters/registry.js';
import { authService } from '../auth/index.js';
import { getMainDatabase } from '../storage/main-db.js';
import { mcpManager } from './manager.js';

/**
 * Cache for adapter instances
 * Key: `${userId}:${serverKey}`
 */
const activeAdapters = new Map<string, McpAdapter>();

/**
 * Set of server keys that should use in-process adapters
 * Populated by registerInProcessAdapter()
 */
const inProcessServers = new Set<string>();

/**
 * Result of preparing MCP directory
 */
interface PrepareResult {
  cwd: string;
  credentialsPath?: string;
}

/**
 * Prepare working directory for MCP server
 * Generic credentials setup (token setup is handled by individual adapters)
 */
async function prepareUserMcpDir(
  serverKey: string,
  userId: string,
  serverConfig: MCPServerConfig
): Promise<PrepareResult> {
  const cwd = serverConfig.cwd || process.cwd();

  console.log(`[prepareUserMcpDir] Preparing directory for ${serverKey}`);
  console.log(`[prepareUserMcpDir] CWD: ${cwd}`);
  console.log(`[prepareUserMcpDir] Auth required: ${!!serverConfig.auth}`);

  if (!serverConfig.auth) {
    console.log(`[prepareUserMcpDir] No auth config, returning CWD as-is`);
    return { cwd };
  }

  console.log(`[prepareUserMcpDir] Auth provider: ${serverConfig.auth.provider}`);
  console.log(`[prepareUserMcpDir] Credentials filename: ${serverConfig.auth.credentialsFilename}`);

  // Create generic credentials file from environment variables if needed
  if (serverConfig.auth.credentialsFilename && serverConfig.auth.provider === 'google') {
    // Always use gcp-oauth.keys.json for google-drive-mcp
    const credentialsFilename = 'gcp-oauth.keys.json';
    const credentialsPath = path.join(cwd, credentialsFilename);
    console.log(`[prepareUserMcpDir] Creating credentials file at: ${credentialsPath}`);

    const credentials = {
      installed: {
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uris: [process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'],
      },
    };

    const dir = path.dirname(credentialsPath);
    console.log(`[prepareUserMcpDir] Creating directory: ${dir}`);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2));
    console.log(`[MCPAdapterFactory] Created credentials file: ${credentialsPath}`);
    console.log(`[prepareUserMcpDir] Credentials file setup complete`);
    
    return { cwd, credentialsPath };
  } else if (serverConfig.auth.credentialsFilename && serverConfig.auth.provider !== 'google') {
    console.log(`[prepareUserMcpDir] Credentials file setup skipped (non-Google provider)`);
  }

  return { cwd };
}

/**
 * Load MCP server config from MCPManager's in-memory cache or main database
 * The serverKey is the serverId from the persisted config
 *
 * Priority:
 * 1. MCPManager's in-memory cache (includes role-specific configs)
 * 2. Main database (for global/persisted configs)
 */
async function loadServerConfig(serverKey: string): Promise<MCPServerConfig> {
  // First, check MCPManager's in-memory cache
  // This includes both main DB configs AND role-specific configs loaded during role switch
  const managerConfig = mcpManager.getServerConfig(serverKey);
  if (managerConfig) {
    console.log(`[MCPAdapterFactory:loadServerConfig] Found config in MCPManager cache for: ${serverKey}`);
    return managerConfig;
  }

  // Fall back to main database for global/persisted configs
  try {
    const mainDb = getMainDatabase();
    const config = mainDb.getMCPServerConfig(serverKey);
    if (config) {
      console.log(`[MCPAdapterFactory:loadServerConfig] Found config in main database for: ${serverKey}`);
      return config as unknown as MCPServerConfig;
    }
  } catch (error) {
    console.error(`[MCPAdapterFactory] Error loading config for ${serverKey}:`, error);
  }

  throw new Error(`No MCP config found for server: ${serverKey}`);
}

/**
 * Get or create an MCP adapter for a specific user and server
 *
 * Flow:
 * 1. Return cached adapter if connected
 * 2. Load config from database
 * 3. Retrieve OAuth token if needed
 * 4. Use adapter registry to create appropriate adapter class
 * 5. Call adapter.prepare() (handled by adapter subclass)
 * 6. Connect and cache
 *
 * @param userId - The user ID requesting the adapter
 * @param serverKey - The MCP server key (e.g., 'google-drive-full')
 * @returns A connected McpAdapter instance
 */
export async function getMcpAdapter(userId: string, serverKey: string): Promise<McpAdapter> {
  const cacheKey = `${userId}:${serverKey}`;

  console.log(`[MCPAdapterFactory:getMcpAdapter] Requested: userId=${userId}, serverKey=${serverKey}`);

  // Return cached adapter if it exists and is connected
  if (activeAdapters.has(cacheKey)) {
    console.log(`[MCPAdapterFactory:getMcpAdapter] Found cached adapter for ${cacheKey}`);
    const adapter = activeAdapters.get(cacheKey)!;
    if (adapter.isConnected()) {
      console.log(`[MCPAdapterFactory:getMcpAdapter] Cached adapter is connected, returning it`);
      return adapter;
    }
    // If adapter exists but disconnected, reconnect it
    console.log(`[MCPAdapterFactory:getMcpAdapter] Cached adapter disconnected, attempting reconnect...`);
    try {
      await adapter.reconnect();
      console.log(`[MCPAdapterFactory:getMcpAdapter] Reconnect successful`);
      return adapter;
    } catch (error) {
      console.error(`[MCPAdapterFactory] Failed to reconnect adapter for ${cacheKey}:`, error);
      activeAdapters.delete(cacheKey);
    }
  }

  console.log(`[MCPAdapterFactory:getMcpAdapter] No cached adapter, creating new one...`);

  // Check if this server has an in-process adapter registered FIRST
  // In-process adapters don't need database config or OAuth tokens
  if (adapterRegistry.isInProcess(serverKey)) {
    console.log(`[MCPAdapterFactory:getMcpAdapter] Using in-process adapter for ${serverKey}`);
    const adapter = await adapterRegistry.createInProcess(
      serverKey,
      userId,
      `mcp-${serverKey}`,
      undefined // No token data needed for in-process adapters
    );
    
    // Cache the adapter (cast to McpAdapter to satisfy TypeScript)
    console.log(`[MCPAdapterFactory:getMcpAdapter] Caching in-process adapter with key: ${cacheKey}`);
    const cachedAdapter = adapter as unknown as McpAdapter;
    activeAdapters.set(cacheKey, cachedAdapter);

    // Wrap close method to handle cleanup
    const originalClose = adapter.close.bind(adapter);
    adapter.close = () => {
      console.log(`[MCPAdapterFactory] Closing in-process adapter: ${cacheKey}`);
      originalClose();
      activeAdapters.delete(cacheKey);
    };

    console.log(`[MCPAdapterFactory:getMcpAdapter] Complete - returning in-process adapter`);
    return cachedAdapter;
  }

  // Load server config from database (only for stdio adapters)
  console.log(`[MCPAdapterFactory:getMcpAdapter] Loading config for ${serverKey}...`);
  const serverConfig = await loadServerConfig(serverKey);
  console.log(`[MCPAdapterFactory:getMcpAdapter] Config loaded`, {
    command: serverConfig.command,
    has_args: !!serverConfig.args,
    auth_provider: serverConfig.auth?.provider,
  });

  // Prepare working directory (credentials files, etc.)
  console.log(`[MCPAdapterFactory:getMcpAdapter] Preparing MCP directory...`);
  const prepareResult = await prepareUserMcpDir(serverKey, userId, serverConfig);
  const { cwd, credentialsPath } = prepareResult;
  console.log(`[MCPAdapterFactory:getMcpAdapter] CWD: ${cwd}, credentialsPath: ${credentialsPath}`);

  // Retrieve OAuth token if this is a Google MCP
  let tokenData: any;
  if (serverConfig.auth?.provider === 'google') {
    console.log(`[MCPAdapterFactory:getMcpAdapter] Google auth required, retrieving OAuth token...`);
    let oauthToken = await authService.getOAuthToken(userId, 'google');
    if (oauthToken) {
      console.log(`[MCPAdapterFactory:getMcpAdapter] OAuth token found, checking expiry...`);

      // Check if token is expired or expiring within 5 minutes
      const now = Date.now();
      const expiryTime = oauthToken.expiryDate || now;
      const timeUntilExpiry = expiryTime - now;
      const REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh if expiring within 5 minutes

      if (timeUntilExpiry < REFRESH_BUFFER_MS && oauthToken.refreshToken) {
        console.log(`[MCPAdapterFactory:getMcpAdapter] Token expiring soon (${Math.round(timeUntilExpiry / 1000)}s remaining), attempting refresh...`);

        try {
          const { GoogleOAuthHandler } = await import('../auth/google-oauth.js');
          const googleOAuth = new GoogleOAuthHandler({
            clientId: process.env.GOOGLE_CLIENT_ID || '',
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
            redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
          });

          const newTokens = await googleOAuth.refreshAccessToken(oauthToken.refreshToken);

          // Store refreshed token
          oauthToken = await authService.storeOAuthToken(userId, {
            provider: 'google',
            accessToken: newTokens.access_token,
            refreshToken: newTokens.refresh_token || oauthToken.refreshToken,
            expiryDate: Date.now() + (newTokens.expires_in * 1000),
          } as any);

          console.log(`[MCPAdapterFactory:getMcpAdapter] Token refreshed successfully. New expiry: ${new Date(oauthToken.expiryDate!).toISOString()}`);
        } catch (refreshError) {
          console.error(`[MCPAdapterFactory:getMcpAdapter] Failed to refresh token:`, refreshError);
          // Continue with existing token - it might still be valid
          console.log(`[MCPAdapterFactory:getMcpAdapter] Proceeding with existing token despite refresh failure`);
        }
      } else if (timeUntilExpiry < 0) {
        console.warn(`[MCPAdapterFactory:getMcpAdapter] Token has expired, attempting to refresh...`);

        if (!oauthToken.refreshToken) {
          console.error(`[MCPAdapterFactory:getMcpAdapter] ERROR: Token expired and no refresh token available!`);
          throw new Error(`Google OAuth token has expired and cannot be refreshed. User needs to re-authenticate.`);
        }

        try {
          const { GoogleOAuthHandler } = await import('../auth/google-oauth.js');
          const googleOAuth = new GoogleOAuthHandler({
            clientId: process.env.GOOGLE_CLIENT_ID || '',
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
            redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
          });

          const newTokens = await googleOAuth.refreshAccessToken(oauthToken.refreshToken);

          // Store refreshed token
          oauthToken = await authService.storeOAuthToken(userId, {
            provider: 'google',
            accessToken: newTokens.access_token,
            refreshToken: newTokens.refresh_token || oauthToken.refreshToken,
            expiryDate: Date.now() + (newTokens.expires_in * 1000),
          } as any);

          console.log(`[MCPAdapterFactory:getMcpAdapter] Expired token refreshed successfully. New expiry: ${new Date(oauthToken.expiryDate!).toISOString()}`);
        } catch (refreshError) {
          console.error(`[MCPAdapterFactory:getMcpAdapter] Failed to refresh expired token:`, refreshError);
          throw new Error(`Google OAuth token has expired and cannot be refreshed. User needs to re-authenticate.`);
        }
      } else {
        console.log(`[MCPAdapterFactory:getMcpAdapter] Token is valid (expires in ${Math.round(timeUntilExpiry / 1000)}s)`);
      }

      // Validate OAuth token structure
      if (!oauthToken.accessToken) {
        console.error(`[MCPAdapterFactory:getMcpAdapter] ERROR: OAuth token missing accessToken!`);
        throw new Error('OAuth token is missing accessToken field');
      }

      tokenData = {
        access_token: oauthToken.accessToken,
        refresh_token: oauthToken.refreshToken,
        expiry_date: oauthToken.expiryDate,
        token_type: 'Bearer',
        credentialsPath, // Pass credentials path for env var setup
      };

      // Validate formatted token
      if (!tokenData.access_token) {
        console.error(`[MCPAdapterFactory:getMcpAdapter] ERROR: Failed to format token data!`);
        throw new Error('Token formatting failed - missing access_token');
      }

      console.log(`[MCPAdapterFactory:getMcpAdapter] Token data prepared and validated:`, {
        has_access_token: !!tokenData.access_token,
        access_token_length: tokenData.access_token?.length,
        access_token_prefix: tokenData.access_token?.substring(0, 10) + '...',
        has_refresh_token: !!tokenData.refresh_token,
        expiry_date: tokenData.expiry_date,
        token_type: tokenData.token_type,
        credentialsPath: tokenData.credentialsPath,
      });
    } else {
      console.warn(`[MCPAdapterFactory:getMcpAdapter] No OAuth token found for user ${userId}`);
      throw new Error(`Google OAuth token not found for user ${userId}. User needs to authenticate first.`);
    }
  }

  // Create adapter using registry (handles MCP-specific setup)
  console.log(`[MCPAdapterFactory:getMcpAdapter] Creating stdio adapter via registry...`);
  const adapter = adapterRegistry.create(
    serverKey,
    userId,
    `mcp-${serverKey}`,
    serverConfig,
    cwd,
    tokenData
  );
  console.log(`[MCPAdapterFactory:getMcpAdapter] Adapter created: ${adapter.id}`);

  // Connect the adapter (calls prepare() internally)
  console.log(`[MCPAdapterFactory:getMcpAdapter] Connecting adapter...`);
  try {
    await adapter.connect();
    console.log(`[MCPAdapterFactory:getMcpAdapter] Adapter connected successfully`);
  } catch (error) {
    console.error(`[MCPAdapterFactory] Failed to connect adapter for ${serverKey}:`, error);
    throw new Error(`Failed to connect to MCP server ${serverKey}: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Cache the adapter
  console.log(`[MCPAdapterFactory:getMcpAdapter] Caching adapter with key: ${cacheKey}`);
  activeAdapters.set(cacheKey, adapter);

  // Wrap close method to handle cleanup
  const originalClose = adapter.close.bind(adapter);
  adapter.close = () => {
    console.log(`[MCPAdapterFactory] Closing adapter: ${cacheKey}`);
    originalClose();
    activeAdapters.delete(cacheKey);
  };

  console.log(`[MCPAdapterFactory:getMcpAdapter] Complete - returning adapter`);
  return adapter;
}

/**
 * Close and remove an adapter from cache
 */
export function closeMcpAdapter(userId: string, serverKey: string): void {
  const key = `${userId}:${serverKey}`;
  const adapter = activeAdapters.get(key);
  if (adapter) {
    adapter.close();
  }
}

/**
 * Close all adapters for a user
 */
export function closeUserAdapters(userId: string): void {
  const keysToDelete: string[] = [];

  for (const [key, adapter] of activeAdapters.entries()) {
    if (key.startsWith(`${userId}:`)) {
      adapter.close();
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    activeAdapters.delete(key);
  }
}

/**
 * Get all active adapters for a user
 */
export function getUserAdapters(userId: string): Map<string, McpAdapter> {
  const userAdapters = new Map<string, McpAdapter>();

  for (const [key, adapter] of activeAdapters.entries()) {
    if (key.startsWith(`${userId}:`)) {
      userAdapters.set(adapter.serverKey, adapter);
    }
  }

  return userAdapters;
}
