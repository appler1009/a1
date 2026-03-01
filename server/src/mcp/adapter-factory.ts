import path from 'path';
import { promises as fs } from 'fs';
import type { McpAdapter, MCPServerConfig } from '@local-agent/shared';
import { adapterRegistry } from './adapters/registry.js';
import { authService } from '../auth/index.js';
import { getMainDatabase } from '../storage/main-db.js';
import { mcpManager } from './manager.js';

/**
 * Extract the base server ID from a potentially unique instance ID.
 * Instance IDs use the format: baseId~accountEmail (e.g., gmail-mcp-lib~user@gmail.com)
 */
function getBaseServerId(id: string): string {
  const i = id.indexOf('~');
  return i >= 0 ? id.substring(0, i) : id;
}

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
 * Uses user-level tokens only (no role-specific tokens)
 *
 * @param userId - The user ID
 * @param credentialsPath - Optional credentials path for stdio adapters
 * @returns Token data for Google API calls
 * @throws Error if token not found or cannot be refreshed
 */
async function getGoogleTokenData(userId: string, credentialsPath?: string): Promise<TokenData> {
  // Always use user-level tokens (no role-specific tokens anymore)
  let oauthToken = await authService.getOAuthToken(userId, 'google');

  if (!oauthToken) {
    throw new Error(`Google OAuth token not found for user ${userId}. Please authenticate first.`);
  }

  const now = Date.now();
  const expiryTime = oauthToken.expiryDate || now;
  const timeUntilExpiry = expiryTime - now;

  // Check if token needs refresh (expiring within buffer or already expired)
  if (timeUntilExpiry < REFRESH_BUFFER_MS && oauthToken.refreshToken) {
    const isExpired = timeUntilExpiry < 0;
    console.log(`[OAuth] Token ${isExpired ? 'expired' : `expiring in ${Math.round(timeUntilExpiry / 1000)}s`}, refreshing...`);

    try {
      const { GoogleOAuthHandler } = await import('../auth/google-oauth.js');
      const googleOAuth = new GoogleOAuthHandler({
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
      });

      const newTokens = await googleOAuth.refreshAccessToken(oauthToken.refreshToken);

      // Store refreshed token at user-level
      oauthToken = await authService.storeOAuthToken(userId, {
        provider: 'google',
        accessToken: newTokens.access_token,
        refreshToken: newTokens.refresh_token || oauthToken.refreshToken,
        expiryDate: Date.now() + (newTokens.expires_in * 1000),
        accountEmail: oauthToken.accountEmail,
      } as any);
      console.log(`[OAuth] Token refreshed, new expiry: ${new Date(oauthToken.expiryDate!).toISOString()}`);
    } catch (refreshError) {
      console.error(`[OAuth] Failed to refresh token:`, refreshError);
      if (isExpired) {
        throw new Error(`Google OAuth token has expired and cannot be refreshed for user ${userId}. Please re-authenticate.`);
      }
    }
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

  if (!serverConfig.auth) return { cwd };

  if (serverConfig.auth.credentialsFilename && serverConfig.auth.provider === 'google') {
    const credentialsPath = path.join(cwd, 'gcp-oauth.keys.json');
    const credentials = {
      installed: {
        client_id: process.env.GOOGLE_CLIENT_ID || '',
        client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uris: [process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'],
      },
    };
    await fs.mkdir(path.dirname(credentialsPath), { recursive: true });
    await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2));
    return { cwd, credentialsPath };
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
  if (managerConfig) return managerConfig;

  try {
    const mainDb = await getMainDatabase();
    const config = await mainDb.getMCPServerConfig(serverKey);
    if (config) return config as unknown as MCPServerConfig;
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

  // Return cached adapter if it exists and is connected
  if (activeAdapters.has(cacheKey)) {
    const adapter = activeAdapters.get(cacheKey)!;
    if (adapter.isConnected()) return adapter;
    // Disconnected — try to reconnect
    try {
      await adapter.reconnect();
      return adapter;
    } catch (error) {
      console.error(`[MCPAdapterFactory] Failed to reconnect adapter for ${serverKey}:`, error);
      activeAdapters.delete(cacheKey);
    }
  }

  const baseServerId = getBaseServerId(serverKey);

  // In-process adapter path
  if (adapterRegistry.isInProcess(baseServerId)) {
    // memory is role-scoped (each role has its own DB); all other in-process servers
    // (gmail, google-drive, etc.) are user-scoped and should use the manager's
    // MultiAccountAdapter regardless of whether a roleId was passed.
    const isRoleScoped = baseServerId === 'memory' || baseServerId === 'Memory' || baseServerId === 'scheduler';

    if (baseServerId !== 'role-manager' && !isRoleScoped) {
      const managerAdapter = mcpManager.getInProcessAdapter(baseServerId);
      if (managerAdapter) return managerAdapter;
    }

    // Role-scoped (memory/scheduler) or no manager adapter yet — create a fresh in-process instance
    let tokenData: any;
    if (isRoleScoped && roleId) {
      if (baseServerId === 'memory' || baseServerId === 'Memory') {
        tokenData = { roleId, dbPath: path.join(process.env.STORAGE_ROOT || './data', `memory_${roleId}.db`) };
      } else {
        tokenData = { roleId };
      }
    }

    const { getPredefinedServer } = await import('./predefined-servers.js');
    const predefinedServer = getPredefinedServer(baseServerId);
    if (predefinedServer?.auth?.provider === 'google') {
      tokenData = await getGoogleTokenData(userId);
    } else if (predefinedServer?.auth?.provider === 'alphavantage' || predefinedServer?.auth?.provider === 'twelvedata') {
      const mainDb = await getMainDatabase();
      const storedConfig = await mainDb.getMCPServerConfig(`${baseServerId}:${userId}`);
      if (!storedConfig?.apiKey) {
        throw new Error(`API key not configured for ${baseServerId}. Please connect in Settings.`);
      }
      tokenData = { apiKey: storedConfig.apiKey as string };
    }

    const adapter = await adapterRegistry.createInProcess(baseServerId, userId, `mcp-${serverKey}`, tokenData);
    const cachedAdapter = adapter as unknown as McpAdapter;
    activeAdapters.set(cacheKey, cachedAdapter);

    const originalClose = adapter.close.bind(adapter);
    adapter.close = () => { originalClose(); activeAdapters.delete(cacheKey); };

    return cachedAdapter;
  }

  // Stdio adapter path
  const serverConfig = await loadServerConfig(serverKey);
  const { cwd, credentialsPath } = await prepareUserMcpDir(serverKey, userId, serverConfig);

  let tokenData: any;
  if (serverConfig.auth?.provider === 'google') {
    tokenData = await getGoogleTokenData(userId, credentialsPath);
  }

  const adapter = adapterRegistry.create(serverKey, userId, `mcp-${serverKey}`, serverConfig, cwd, tokenData);

  try {
    await adapter.connect();
  } catch (error) {
    console.error(`[MCPAdapterFactory] Failed to connect to ${serverKey}:`, error);
    throw new Error(`Failed to connect to MCP server ${serverKey}: ${error instanceof Error ? error.message : String(error)}`);
  }

  activeAdapters.set(cacheKey, adapter);
  const originalClose = adapter.close.bind(adapter);
  adapter.close = () => { originalClose(); activeAdapters.delete(cacheKey); };

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
