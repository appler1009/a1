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
 * Result of token refresh operation
 */
interface TokenData {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type: string;
  credentialsPath?: string;
}

/**
 * Refresh buffer in milliseconds - refresh if expiring within 5 minutes
 */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Get and refresh Google OAuth token if needed
 * Shared helper for both in-process and stdio adapters
 *
 * @param userId - The user ID
 * @param roleId - Optional role ID for role-specific tokens
 * @param credentialsPath - Optional credentials path for stdio adapters
 * @returns Token data for Google API calls
 * @throws Error if token not found or cannot be refreshed
 */
async function getGoogleTokenData(userId: string, roleId?: string, credentialsPath?: string): Promise<TokenData> {
  let oauthToken: any;

  // If roleId is provided, get role-specific token; otherwise get global user token
  if (roleId) {
    const { getRoleStorageService } = await import('../storage/role-storage-service.js');
    const roleStorage = getRoleStorageService();
    oauthToken = await roleStorage.getRoleOAuthToken(roleId, 'google');
    console.log(`[getGoogleTokenData] Attempting to retrieve role-specific token for role ${roleId}`);
  } else {
    oauthToken = await authService.getOAuthToken(userId, 'google');
    console.log(`[getGoogleTokenData] Attempting to retrieve global user token for user ${userId}`);
  }

  if (!oauthToken) {
    const context = roleId ? `role ${roleId}` : `user ${userId}`;
    console.warn(`[getGoogleTokenData] No OAuth token found for ${context}`);
    throw new Error(`Google OAuth token not found for ${context}. Please authenticate first.`);
  }

  const now = Date.now();
  const expiryTime = oauthToken.expiryDate || now;
  const timeUntilExpiry = expiryTime - now;

  // Check if token needs refresh (expiring within buffer or already expired)
  if (timeUntilExpiry < REFRESH_BUFFER_MS && oauthToken.refreshToken) {
    const isExpired = timeUntilExpiry < 0;
    console.log(`[getGoogleTokenData] Token ${isExpired ? 'expired' : `expiring in ${Math.round(timeUntilExpiry / 1000)}s`}, attempting refresh...`);

    try {
      const { GoogleOAuthHandler } = await import('../auth/google-oauth.js');
      const googleOAuth = new GoogleOAuthHandler({
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
      });

      const newTokens = await googleOAuth.refreshAccessToken(oauthToken.refreshToken);

      // Store refreshed token
      if (roleId) {
        const { getRoleStorageService } = await import('../storage/role-storage-service.js');
        const roleStorage = getRoleStorageService();
        await roleStorage.storeRoleOAuthToken(roleId, 'google', newTokens.access_token, newTokens.refresh_token || oauthToken.refreshToken, Date.now() + (newTokens.expires_in * 1000));
        console.log(`[getGoogleTokenData] Token refreshed and stored in role ${roleId}. New expiry: ${new Date(Date.now() + (newTokens.expires_in * 1000)).toISOString()}`);
      } else {
        oauthToken = await authService.storeOAuthToken(userId, {
          provider: 'google',
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token || oauthToken.refreshToken,
          expiryDate: Date.now() + (newTokens.expires_in * 1000),
        } as any);
        console.log(`[getGoogleTokenData] Token refreshed successfully. New expiry: ${new Date(oauthToken.expiryDate!).toISOString()}`);
      }
    } catch (refreshError) {
      console.error(`[getGoogleTokenData] Failed to refresh token:`, refreshError);

      // If token is expired and refresh failed, throw error
      if (isExpired) {
        const context = roleId ? `role ${roleId}` : `user ${userId}`;
        throw new Error(`Google OAuth token has expired and cannot be refreshed for ${context}. Please re-authenticate.`);
      }
      // If token is still valid, continue with existing token
      console.log(`[getGoogleTokenData] Proceeding with existing token despite refresh failure`);
    }
  } else {
    console.log(`[getGoogleTokenData] Token is valid (expires in ${Math.round(timeUntilExpiry / 1000)}s)`);
  }

  // Validate OAuth token structure
  if (!oauthToken.accessToken) {
    console.error(`[getGoogleTokenData] ERROR: OAuth token missing accessToken!`);
    throw new Error('OAuth token is missing accessToken field');
  }

  return {
    access_token: oauthToken.accessToken,
    refresh_token: oauthToken.refreshToken,
    expiry_date: oauthToken.expiryDate,
    token_type: 'Bearer',
    credentialsPath,
  };
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
 * 3. Retrieve OAuth token if needed (role-specific or global)
 * 4. Use adapter registry to create appropriate adapter class
 * 5. Call adapter.prepare() (handled by adapter subclass)
 * 6. Connect and cache
 *
 * @param userId - The user ID requesting the adapter
 * @param serverKey - The MCP server key (e.g., 'google-drive-mcp-lib', 'gmail-mcp-lib')
 * @param roleId - Optional role ID for role-specific tokens (if provided, uses role's token instead of global user token)
 * @returns A connected McpAdapter instance
 */
export async function getMcpAdapter(userId: string, serverKey: string, roleId?: string): Promise<McpAdapter> {
  const cacheKey = `${userId}:${serverKey}${roleId ? `:${roleId}` : ''}`;

  console.log(`[MCPAdapterFactory:getMcpAdapter] Requested: userId=${userId}, serverKey=${serverKey}, roleId=${roleId || 'none'}`);

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
  if (adapterRegistry.isInProcess(serverKey)) {
    console.log(`[MCPAdapterFactory:getMcpAdapter] Using in-process adapter for ${serverKey}`);

    // For in-process adapters that need OAuth tokens (like Google Drive),
    // we need to retrieve the token data before creating the adapter
    let tokenData: any = undefined;

    // Check if this server requires Google OAuth by looking at predefined servers
    const { getPredefinedServer } = await import('./predefined-servers.js');
    const predefinedServer = getPredefinedServer(serverKey);

    if (predefinedServer?.auth?.provider === 'google') {
      console.log(`[MCPAdapterFactory:getMcpAdapter] In-process adapter requires Google OAuth, retrieving token...`);
      tokenData = await getGoogleTokenData(userId, roleId);
      console.log(`[MCPAdapterFactory:getMcpAdapter] Token data prepared for in-process adapter`);
    }
    
    const adapter = await adapterRegistry.createInProcess(
      serverKey,
      userId,
      `mcp-${serverKey}`,
      tokenData
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
    tokenData = await getGoogleTokenData(userId, roleId, credentialsPath);
    console.log(`[MCPAdapterFactory:getMcpAdapter] Token data prepared and validated:`, {
      has_access_token: !!tokenData.access_token,
      access_token_length: tokenData.access_token?.length,
      access_token_prefix: tokenData.access_token?.substring(0, 10) + '...',
      has_refresh_token: !!tokenData.refresh_token,
      expiry_date: tokenData.expiry_date,
      token_type: tokenData.token_type,
      credentialsPath: tokenData.credentialsPath,
    });
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
