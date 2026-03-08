import type { MCPServerConfig, MCPToolInfo, MCPResource, MCPServerInfo, McpAdapter } from '@local-agent/shared';
import { createMCPClient, MCPClientInterface } from './client.js';
import { getMainDatabase, MainDatabase, type IMainDatabase } from '../storage/main-db.js';
import { promises as fs } from 'fs';
import path from 'path';
import { PREDEFINED_MCP_SERVERS, PredefinedMCPServer } from './predefined-servers.js';
import { adapterRegistry } from './adapters/registry.js';
import { MultiAccountAdapter } from './adapters/MultiAccountAdapter.js';
import { config as appConfig } from '../config/index.js';

/** Server IDs that support multiple authenticated accounts simultaneously */
const MULTI_ACCOUNT_SERVER_IDS = new Set(['gmail-mcp-lib', 'google-drive-mcp-lib']);

function isMultiAccountCapable(baseId: string): boolean {
  return MULTI_ACCOUNT_SERVER_IDS.has(baseId);
}

/**
 * Extract the base server ID from a potentially unique instance ID.
 * Instance IDs use the format: baseId~accountEmail (e.g., gmail-mcp-lib~user@gmail.com)
 */
function getBaseServerId(id: string): string {
  const i = id.indexOf('~');
  return i >= 0 ? id.substring(0, i) : id;
}

/**
 * MCP Manager
 * Manages multiple MCP server connections
 * Supports role-specific MCP server configurations
 * 
 * Server types:
 * - Global servers (global: true): Not affected by role switches, always running
 * - Per-role servers (global: false): Restarted on role switch with role-specific config
 */
export class MCPManager {
  private clients: Map<string, MCPClientInterface> = new Map();
  private configs: Map<string, MCPServerConfig> = new Map();
  private inProcessAdapters: Map<string, McpAdapter> = new Map();
  private db: IMainDatabase | null = null;
  private get dataDir(): string { return appConfig.storage.root; }

  /**
   * Initialize the MCP manager and load persisted configs
   */
  async initialize(): Promise<void> {
    this.db = await getMainDatabase();

    // Start global hidden servers first (markitdown, weather, etc.)
    await this.startGlobalServers();

    // Load persisted server configs from main database
    await this.loadPersistedConfigs();

    // Start all non-auth-required predefined servers (not already started as hidden)
    await this.startDefaultServers();
  }

  /**
   * Start hidden servers (markitdown) - no longer per-role vs global distinction
   */
  private async startGlobalServers(): Promise<void> {
    // Exclude 'memory' — it is created lazily per-role via getMcpAdapter() in adapter-factory.ts
    // Allow disabling meta-mcp-search via ENABLE_META_MCP_SEARCH env var
    const enableMetaMcpSearch = process.env.ENABLE_META_MCP_SEARCH !== 'false';
    const hiddenServers = PREDEFINED_MCP_SERVERS.filter(s =>
      s.hidden &&
      s.id !== 'memory' &&
      (s.id !== 'meta-mcp-search' || enableMetaMcpSearch)
    );

    for (const server of hiddenServers) {
      if (this.clients.has(server.id) || this.inProcessAdapters.has(server.id)) {
        console.log(`[MCPManager] Server ${server.id} already running`);
        continue;
      }

      try {
        console.log(`[MCPManager] Starting hidden server: ${server.id}`);
        await this.startPredefinedServer(server);
        console.log(`[MCPManager] Server ${server.id} started successfully`);
      } catch (error) {
        console.error(`[MCPManager] Failed to start hidden server ${server.id}:`, error);
      }
    }
  }

  /**
   * Start default non-hidden, non-auth servers
   * These are predefined servers that don't require authentication and aren't hidden (e.g., brave-search)
   * Auth-required servers (google-drive, gmail, github) are loaded via loadPersistedConfigs() if the user has previously authenticated
   */
  private async startDefaultServers(): Promise<void> {
    // Get all non-hidden, non-auth-required predefined servers
    const defaultServers = PREDEFINED_MCP_SERVERS.filter(s =>
      !s.hidden &&
      (!s.auth || s.auth.provider === 'none')
    );

    if (defaultServers.length === 0) {
      console.log('[MCPManager] No default servers to start');
      return;
    }

    console.log(`[MCPManager] Starting ${defaultServers.length} default server(s)`);

    for (const server of defaultServers) {
      // Skip servers with required but unset env vars (empty string = required placeholder)
      if (server.env) {
        const missingVars = Object.entries(server.env)
          .filter(([, v]) => v === '')
          .map(([k]) => k);
        if (missingVars.length > 0) {
          console.log(`[MCPManager] Skipping ${server.id}: missing required env vars: ${missingVars.join(', ')}`);
          continue;
        }
      }

      // Check if already running (from startGlobalServers or persisted configs)
      if (this.clients.has(server.id) || this.inProcessAdapters.has(server.id)) {
        console.log(`[MCPManager] Server ${server.id} already running`);
        continue;
      }

      try {
        console.log(`[MCPManager] Starting default server: ${server.id}`);
        await this.startPredefinedServer(server);
        console.log(`[MCPManager] Server ${server.id} started successfully`);
      } catch (error) {
        console.error(`[MCPManager] Failed to start default server ${server.id}:`, error);
      }
    }
  }

  /**
   * Start a predefined server
   */
  private async startPredefinedServer(server: PredefinedMCPServer, roleId?: string): Promise<void> {
    // Check if this is an in-process server
    if (server.inProcess) {
      await this.startInProcessServer(server, roleId);
      return;
    }

    // Prepare environment variables
    const env: Record<string, string> = server.env ? { ...server.env } : {};
    
    // If server needs role database path, set it (memory DB is role-specific)
    if (roleId) {
      const roleDbPath = path.join(this.dataDir, `memory_${roleId}.db`);
      env.SQLITE_DB_PATH = roleDbPath;
      console.log(`[MCPManager] Setting SQLITE_DB_PATH for ${server.id}: ${roleDbPath}`);
    }

    const config: MCPServerConfig = {
      id: server.id,
      name: server.name,
      transport: 'stdio',
      command: server.command,
      args: server.args,
      env,
      enabled: true,
      autoStart: true,
      restartOnExit: false,
      hidden: true,
      auth: server.auth,
    };

    await this.addServer(config);
  }

  /**
   * Start an in-process server
   */
  private async startInProcessServer(
    server: PredefinedMCPServer,
    roleId?: string,
    tokenData?: any,
    userId?: string,
    instanceId?: string  // Unique ID for multi-account (e.g., gmail-mcp-lib~user@gmail.com)
  ): Promise<void> {
    const effectiveId = instanceId || server.id;
    console.log(`[MCPManager] Starting in-process server: ${effectiveId} (base: ${server.id})`);

    // Check if in-process adapter is registered (use base server ID for registry lookup)
    if (!adapterRegistry.isInProcess(server.id)) {
      throw new Error(`No in-process adapter registered for ${server.id}`);
    }

    // For Google Drive in-process, we need to pass token data
    let adapterTokenData = tokenData;

    // If server requires Google OAuth but no token provided, get it from auth
    if (server.auth?.provider === 'google' && !adapterTokenData && userId) {
      const { authService } = await import('../auth/index.js');
      const oauthToken = await authService.getOAuthToken(userId, 'google');
      if (oauthToken) {
        adapterTokenData = {
          access_token: oauthToken.accessToken,
          refresh_token: oauthToken.refreshToken,
          expiry_date: oauthToken.expiryDate,
          token_type: 'Bearer',
        };
        console.log(`[MCPManager] Retrieved Google OAuth token for in-process ${effectiveId}`);
      }
    }

    // Create the in-process adapter (use effectiveId as instance ID, server.id as registry key)
    const adapter = await adapterRegistry.createInProcess(
      server.id,
      roleId || 'system',
      effectiveId,
      adapterTokenData || { roleId, dbPath: roleId ? path.join(this.dataDir, `memory_${roleId}.db`) : undefined }
    );

    // Store the adapter under the unique instance ID
    this.inProcessAdapters.set(effectiveId, adapter as unknown as McpAdapter);

    // Store a minimal config for tracking under the unique instance ID
    const config: MCPServerConfig = {
      id: effectiveId,
      name: server.name,
      transport: 'stdio', // Placeholder
      enabled: true,
      autoStart: true,
      restartOnExit: false,
      hidden: server.hidden,
      auth: server.auth,
    };
    this.configs.set(effectiveId, config);

    console.log(`[MCPManager] In-process server ${effectiveId} started successfully`);
  }

  /**
   * Disconnect a server and delete its token files
   */
  private async disconnectServerAndDeleteTokens(serverId: string, provider: string): Promise<void> {
    const config = this.configs.get(serverId);
    
    // Step 1: Disconnect the client (stdio)
    const client = this.clients.get(serverId);
    if (client) {
      console.log(`[MCPManager]   [Shutdown] Disconnecting MCP client...`);
      try {
        await client.disconnect();
        console.log(`[MCPManager]   [Shutdown] ✓ Client disconnected`);
      } catch (error) {
        console.error(`[MCPManager]   [Shutdown] ✗ Error disconnecting: ${error}`);
      }
      this.clients.delete(serverId);
    }

    // Step 1b: Disconnect in-process adapter
    const inProcessAdapter = this.inProcessAdapters.get(serverId);
    if (inProcessAdapter) {
      console.log(`[MCPManager]   [Shutdown] Closing in-process adapter...`);
      try {
        inProcessAdapter.close();
        console.log(`[MCPManager]   [Shutdown] ✓ In-process adapter closed`);
      } catch (error) {
        console.error(`[MCPManager]   [Shutdown] ✗ Error closing in-process adapter: ${error}`);
      }
      this.inProcessAdapters.delete(serverId);
    }

    // Step 2: Delete token file
    if (config?.auth?.tokenFilename) {
      let tokenPath: string;
      
      if (serverId.includes('google-drive') && config.auth.tokenFilename === 'tokens.json') {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const tokenDir = process.env.GOOGLE_DRIVE_MCP_TOKEN_PATH
          ? path.dirname(process.env.GOOGLE_DRIVE_MCP_TOKEN_PATH)
          : path.join(homeDir, '.config', 'google-drive-mcp');
        tokenPath = path.join(tokenDir, config.auth.tokenFilename);
      } else {
        tokenPath = path.join(process.cwd(), config.auth.tokenFilename);
      }

      console.log(`[MCPManager]   [Token Cleanup] Deleting token file: ${tokenPath}`);
      try {
        await fs.unlink(tokenPath);
        console.log(`[MCPManager]   [Token Cleanup] ✓ Token file deleted`);
      } catch (error: any) {
        if (error.code === 'ENOENT') {
          console.log(`[MCPManager]   [Token Cleanup] Token file not found (already deleted)`);
        } else {
          console.error(`[MCPManager]   [Token Cleanup] ✗ Error deleting token: ${error}`);
        }
      }
    }

    // Step 3: Remove config from memory
    this.configs.delete(serverId);
    console.log(`[MCPManager]   [Shutdown] ✓ Server ${serverId} fully shut down`);
  }

  /**
   * Disconnect all non-hidden servers
   */
  private async disconnectAllNonHidden(): Promise<void> {
    const nonHiddenServers = Array.from(this.configs.entries())
      .filter(([_, config]) => !config.hidden)
      .map(([serverId, config]) => ({ serverId, provider: config.auth?.provider || 'none' }));

    for (const { serverId, provider } of nonHiddenServers) {
      console.log(`[MCPManager] [Shutdown] Disconnecting non-hidden server: ${serverId}`);
      await this.disconnectServerAndDeleteTokens(serverId, provider);
    }
  }

  /**
   * Load persisted server configs from main database at startup.
   * Loads all enabled servers, including auth-required ones (using the userId stored in each config).
   * Role-scoped servers (memory, scheduler) are NOT loaded here — they are created lazily
   * via getMcpAdapter() in adapter-factory.ts with the appropriate roleId.
   */
  private async loadPersistedConfigs(): Promise<void> {
    if (!this.db) return;
    
    try {
      const configs = await this.db.getMCPServerConfigs();
      console.log(`[MCPManager] Loaded ${configs.length} persisted MCP server configs from main database`);

      for (const { id: serverId, config: serverConfig } of configs) {
        let typedConfig = serverConfig as MCPServerConfig;

        // Normalize config: ensure args is an array, not a string (can happen during serialization)
        if (typeof (typedConfig as any).args === 'string') {
          try {
            (typedConfig as any).args = JSON.parse((typedConfig as any).args);
            console.log(`[MCPManager] Normalized args for ${serverId} from string to array`);
          } catch {
            console.warn(`[MCPManager] Failed to parse args string for ${serverId}, using empty array`);
            (typedConfig as any).args = [];
          }
        }

        // Extract accountEmail from serverId if not in config (format: baseId~email)
        if (!((typedConfig as any).accountEmail) && serverId.includes('~')) {
          const [, email] = serverId.split('~');
          if (email) {
            (typedConfig as any).accountEmail = email;
            console.log(`[MCPManager] Extracted accountEmail from serverId ${serverId}: ${email}`);
          }
        }

        // Skip memory server - it's created lazily per-role via getMcpAdapter() in adapter-factory.ts
        if (serverId === 'memory') {
          console.log(`[MCPManager] Skipping server ${serverId} (created lazily per role via adapter-factory)`);
          continue;
        }

        // Skip hidden predefined servers — startGlobalServers() always starts them fresh
        // using the canonical command from predefined-servers.ts (e.g. 'uvx', not an
        // absolute host path that may have been persisted from a previous run).
        const baseServerId = getBaseServerId(serverId);
        const predefined = PREDEFINED_MCP_SERVERS.find(s => s.id === baseServerId);
        if (predefined?.hidden) {
          console.log(`[MCPManager] Skipping hidden predefined server ${serverId} (handled by startGlobalServers)`);
          continue;
        }
        
        if (typedConfig.enabled) {
          // Check if already running (from startHiddenServers)
          if (this.clients.has(serverId)) {
            console.log(`[MCPManager] Server ${serverId} already running, skipping`);
            continue;
          }

          try {
            console.log(`[MCPManager] Connecting to persisted server: ${serverId}`);
            console.log(`[MCPManager] Config for ${serverId}:`, {
              accountEmail: (typedConfig as any).accountEmail,
              hasAuth: !!typedConfig.auth?.provider,
              authProvider: typedConfig.auth?.provider
            });

            // For auth-required servers, retrieve the user's token
            let userToken: any = undefined;
            if (typedConfig.auth?.provider && typedConfig.auth.provider !== 'none') {
              const provider = typedConfig.auth.provider;
              const accountEmail = (typedConfig as any).accountEmail as string | undefined;
              const userId = (typedConfig as any).userId as string | undefined;

              if (provider === 'alphavantage' || provider === 'twelvedata') {
                // API key servers: read the key from mcp_servers table
                if (userId) {
                  const baseServerId = getBaseServerId(serverId);
                  const storedConfig = await this.db!.getMCPServerConfig(`${baseServerId}:${userId}`);
                  if (storedConfig?.apiKey) {
                    userToken = { apiKey: storedConfig.apiKey as string };
                    console.log(`[MCPManager] Retrieved API key for ${serverId} (userId=${userId})`);
                  } else {
                    console.log(`[MCPManager] No API key found for ${serverId} (userId=${userId}), skipping`);
                    continue;
                  }
                } else {
                  console.log(`[MCPManager] No userId in config for ${provider} server ${serverId}, skipping`);
                  continue;
                }
              } else {
                try {
                  let oauthToken: any = null;

                  if (userId) {
                    // Preferred: look up by userId + provider
                    console.log(`[MCPManager] Retrieving ${provider} token for user ${userId} for server ${serverId}`);
                    const { authService } = await import('../auth/index.js');
                    oauthToken = await authService.getOAuthToken(userId, provider, accountEmail);
                  } else if (accountEmail) {
                    // Fallback: look up by accountEmail directly (no userId in legacy configs)
                    console.log(`[MCPManager] Retrieving ${provider} token by accountEmail ${accountEmail} for server ${serverId}`);
                    oauthToken = await this.db!.getOAuthTokenByAccountEmail(provider, accountEmail);
                  }

                  if (oauthToken) {
                    userToken = {
                      access_token: oauthToken.accessToken,
                      refresh_token: oauthToken.refreshToken,
                      expiry_date: oauthToken.expiryDate,
                      token_type: 'Bearer',
                    };
                    console.log(`[MCPManager] Successfully retrieved ${provider} token for server ${serverId}`);
                  } else {
                    console.log(`[MCPManager] No ${provider} token found for server ${serverId} (userId=${userId}, accountEmail=${accountEmail}), skipping`);
                    continue;
                  }
                } catch (error) {
                  console.error(`[MCPManager] Failed to retrieve ${provider} token for server ${serverId}:`, error);
                  continue;
                }
              }
            }

            // Include the original serverId from database
            const configToAdd = { ...typedConfig, id: serverId } as any;
            console.log(`[MCPManager] Adding persisted server with config:`, {
              id: configToAdd.id,
              accountEmail: configToAdd.accountEmail,
              hasToken: !!userToken
            });
            await this.addServer(configToAdd, userToken);
          } catch (error) {
            console.error(`[MCPManager] Failed to connect to persisted server ${serverId}:`, error);
          }
        }
      }
    } catch (error) {
      console.log('[MCPManager] No persisted MCP configs found or error loading:', error);
    }
  }

  /**
   * Save server config to main database (user-level, shared across all roles)
   */
  private async persistConfig(serverId: string, config: MCPServerConfig): Promise<void> {
    if (!this.db) {
      console.error(`[MCPManager] Database not initialized, cannot persist config for ${serverId}`);
      return;
    }

    try {
      const configToSave = config as unknown as Record<string, unknown>;
      console.log(`[MCPManager] Persisting user-level config for server: ${serverId}`, {
        hasAccountEmail: !!(configToSave as any).accountEmail,
        accountEmail: (configToSave as any).accountEmail,
        configKeys: Object.keys(configToSave)
      });
      await this.db.saveMCPServerConfig(serverId, configToSave);
      console.log(`[MCPManager] ✓ Persisted user-level config for server: ${serverId}`);
    } catch (error) {
      console.error(`[MCPManager] Failed to persist config for ${serverId}:`, error);
    }
  }

  /**
   * Remove server config from role-specific database
   */
  private async deletePersistedConfig(serverId: string): Promise<void> {
    if (!this.db) {
      console.error(`[MCPManager] Database not initialized, cannot delete config for ${serverId}`);
      return;
    }

    // All servers are stored in main database (user-level, shared across roles)
    try {
      await this.db.deleteMCPServerConfig(serverId);
      console.log(`[MCPManager] Deleted persisted config for user-level server: ${serverId}`);
    } catch (error) {
      console.error(`[MCPManager] Failed to delete persisted config for ${serverId}:`, error);
    }
  }

  /**
   * Update server enabled status
   */
  async updateServerStatus(serverId: string, enabled: boolean): Promise<void> {
    const config = this.configs.get(serverId);
    if (!config) {
      throw new Error(`Server ${serverId} not found`);
    }

    config.enabled = enabled;
    await this.persistConfig(serverId, config);
    console.log(`[MCPManager] Updated server ${serverId} enabled status to: ${enabled}`);
  }

  /**
   * Prepare MCP server directory with auth files
   */
  private async prepareMCPDirectory(
    serverId: string,
    config: MCPServerConfig,
    userToken?: { access_token: string; refresh_token?: string; expiry_date?: number; scope?: string; token_type?: string }
  ): Promise<void> {
    if (!config.auth) {
      console.log(`[MCPManager] [Token Setup] No auth config for ${serverId}, skipping token preparation`);
      return;
    }

    console.log(`[MCPManager] [Token Setup] Preparing auth files for ${serverId}...`);

    // Create credentials file from environment variables if needed
    if (config.auth.credentialsFilename && config.auth.provider === 'google') {
      // Always use gcp-oauth.keys.json for google-drive-mcp
      const credentialsFilename = 'gcp-oauth.keys.json';
      const credentialsPath = path.join(process.cwd(), credentialsFilename);

      const credentials = {
        installed: {
          client_id: appConfig.google.clientId,
          client_secret: appConfig.google.clientSecret,
          redirect_uris: [appConfig.google.redirectUri],
        },
      };

      // Create parent directory if needed
      const dir = path.dirname(credentialsPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2));
      console.log(`[MCPManager] [Token Setup]   - Created credentials file: ${credentialsPath}`);
    }

    // Create token file if token is provided
    if (userToken) {
      const tokenFilename = config.auth.tokenFilename || 'token.json';
      let tokenPath: string;

      // Handle different token file locations for different MCP servers
      if (serverId.includes('google-drive') && tokenFilename === 'tokens.json') {
        // google-drive-mcp uses ~/.config/google-drive-mcp/tokens.json by default
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const defaultTokenDir = path.join(homeDir, '.config', 'google-drive-mcp');

        // Allow override via GOOGLE_DRIVE_MCP_TOKEN_PATH environment variable
        const tokenDir = process.env.GOOGLE_DRIVE_MCP_TOKEN_PATH
          ? path.dirname(process.env.GOOGLE_DRIVE_MCP_TOKEN_PATH)
          : defaultTokenDir;

        tokenPath = path.join(tokenDir, tokenFilename);
      } else {
        tokenPath = path.join(process.cwd(), tokenFilename);
      }

      console.log(`[MCPManager] [Token Setup]   - Writing token file: ${tokenPath}`);

      // Create parent directory if needed
      const dir = path.dirname(tokenPath);
      await fs.mkdir(dir, { recursive: true });

      // Format token appropriately for the MCP server
      const tokenData = serverId.includes('google-drive') && tokenFilename === 'tokens.json'
        ? {
            access_token: userToken.access_token,
            refresh_token: userToken.refresh_token,
            scope: userToken.scope || 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets',
            token_type: userToken.token_type || 'Bearer',
            expiry_date: userToken.expiry_date,
          }
        : userToken;

      await fs.writeFile(tokenPath, JSON.stringify(tokenData, null, 2));
      console.log(`[MCPManager] [Token Setup]   - ✓ Token file created successfully`);
    } else {
      console.log(`[MCPManager] [Token Setup]   - No user token provided, skipping token file creation`);
    }
  }

  /**
   * Add and connect to an MCP server.
   * For multi-account capable in-process servers, adds the account to the
   * shared MultiAccountAdapter instead of spawning a subprocess.
   */
  async addServer(config: MCPServerConfig & { id?: string }, userToken?: any): Promise<void> {
    const serverId = config.id || config.name;
    const baseId = getBaseServerId(serverId);

    // For multi-account capable in-process servers, use MultiAccountAdapter
    const predefinedServer = PREDEFINED_MCP_SERVERS.find(s => s.id === baseId);
    if (predefinedServer?.inProcess && isMultiAccountCapable(baseId)) {
      // Get or create MultiAccountAdapter
      let multiAdapter = this.inProcessAdapters.get(baseId);
      if (!(multiAdapter instanceof MultiAccountAdapter)) {
        const fresh = new MultiAccountAdapter(baseId, baseId);
        this.inProcessAdapters.set(baseId, fresh as unknown as McpAdapter);
        multiAdapter = fresh as unknown as McpAdapter;
      }
      const adapter = multiAdapter as unknown as MultiAccountAdapter;

      const accountEmail = (config as any).accountEmail as string | undefined;
      console.log(`[MCPManager:addServer] Multi-account ${baseId}: serverId=${serverId}, accountEmail=${accountEmail}, hasToken=${!!userToken}, currentAccounts=${adapter.getAccountEmails().join(',')}`);

      if (accountEmail && userToken && !adapter.getAccountEmails().includes(accountEmail)) {
        try {
          console.log(`[MCPManager:addServer] Creating raw module for ${baseId} with account ${accountEmail}`);
          const module = await adapterRegistry.createRawModule(predefinedServer.id, 'system', userToken);
          adapter.addAccount(accountEmail, module);
          console.log(`[MCPManager:addServer] Added account ${accountEmail} to MultiAccountAdapter for ${baseId}`);
        } catch (err) {
          console.error(`[MCPManager:addServer] Failed to add account ${accountEmail} to ${baseId}:`, err);
        }
      } else if (!accountEmail) {
        console.warn(`[MCPManager:addServer] No accountEmail found for multi-account server ${baseId}. Config: ${JSON.stringify(config)}`);
      } else if (!userToken) {
        console.warn(`[MCPManager:addServer] No userToken provided for multi-account server ${baseId} account ${accountEmail}`);
      }

      // Store config for display in getServers()
      this.configs.set(serverId, config);

      // Persist config to database
      await this.persistConfig(serverId, config);
      return;
    }

    if (this.clients.has(serverId) || this.inProcessAdapters.has(serverId)) {
      // Server already exists - idempotent: just return without error
      console.log(`[MCPManager] Server ${serverId} already exists, skipping add`);
      return;
    }

    // For non-multi-account in-process servers (e.g. alpha-vantage), start the in-process adapter
    if (predefinedServer?.inProcess && adapterRegistry.isInProcess(baseId)) {
      await this.startInProcessServer(predefinedServer, undefined, userToken, (config as any).userId, serverId);
      this.configs.set(serverId, config);
      await this.persistConfig(serverId, config);
      return;
    }

    // Prepare auth files if needed
    if (config.auth) {
      await this.prepareMCPDirectory(serverId, config, userToken);
    }

    const client = createMCPClient(config);
    await client.connect();

    this.clients.set(serverId, client);
    this.configs.set(serverId, config);

    // Persist to database
    await this.persistConfig(serverId, config);
  }

  /**
   * Connect to an MCP server (alias for addServer)
   */
  async connect(config: MCPServerConfig & { id?: string }): Promise<void> {
    return this.addServer(config);
  }

  /**
   * Remove and disconnect from an MCP server
   */
  async removeServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId);
    if (client) {
      await client.disconnect();
      this.clients.delete(serverId);
    }

    // Always delete from cache and database, regardless of whether client exists
    this.configs.delete(serverId);
    this.inProcessAdapters.delete(serverId);

    // Delete from database
    await this.deletePersistedConfig(serverId);
  }

  /**
   * Get all connected servers (both stdio and in-process)
   */
  getServers(): Array<{ id: string; config: MCPServerConfig; info: MCPServerInfo | null }> {
    const result: Array<{ id: string; config: MCPServerConfig; info: MCPServerInfo | null }> = [];

    console.log(`[MCPManager] this.configs has ${this.configs.size} servers`);
    console.log(`[MCPManager] this.inProcessAdapters has ${this.inProcessAdapters.size} adapters`);
    console.log(`[MCPManager] Config keys:`, Array.from(this.configs.keys()));

    for (const [id, config] of this.configs) {
      const client = this.clients.get(id);
      // Multi-account adapters are keyed by base ID, not instance ID
      const baseId = getBaseServerId(id);
      const isInProcess = this.inProcessAdapters.has(id) || this.inProcessAdapters.has(baseId);

      // For in-process adapters, create a minimal info object
      const info: MCPServerInfo | null = client?.getInfo() || (isInProcess ? {
        name: config.name,
        tools: [], // Tools are loaded on demand
        resources: [],
        connected: true,
      } : null);

      result.push({
        id,
        config,
        info,
      });
    }

    console.log(`[MCPManager] getServers() returning ${result.length} servers`);
    return result;
  }

  /**
   * Collect system prompt contributions from all active in-process adapters.
   * Each adapter may optionally implement getSystemPrompt() to inject instructions
   * relevant to that server into the AI system prompt.
   */
  getSystemPrompts(): string[] {
    const prompts: string[] = [];
    const seen = new Set<string>();

    for (const adapter of this.inProcessAdapters.values()) {
      const getPrompt = (adapter as any).getSystemPrompt;
      if (typeof getPrompt === 'function') {
        const prompt: string | undefined = getPrompt.call(adapter);
        if (prompt && !seen.has(prompt)) {
          seen.add(prompt);
          prompts.push(prompt);
        }
      }
    }

    return prompts;
  }

  /**
   * Get list of connected server names (both stdio and in-process)
   */
  getConnectedServers(): string[] {
    const stdioServers = Array.from(this.clients.keys());
    const inProcessServers = Array.from(this.inProcessAdapters.keys());
    return [...stdioServers, ...inProcessServers];
  }

  /**
   * Get tools for a specific server
   */
  getTools(serverId: string): MCPToolInfo[] {
    const client = this.clients.get(serverId);
    if (!client) {
      return [];
    }
    const info = client.getInfo();
    return info?.tools || [];
  }

  /**
   * Get a specific server
   */
  getServer(serverId: string): MCPClientInterface | undefined {
    return this.clients.get(serverId);
  }

  /**
   * Get an in-process adapter by base server ID (e.g., 'gmail-mcp-lib').
   * Returns the adapter if one exists — may be a MultiAccountAdapter.
   * Used by adapter-factory to delegate execution to the manager's live adapters.
   */
  getInProcessAdapter(baseId: string): McpAdapter | undefined {
    return this.inProcessAdapters.get(baseId);
  }

  /**
   * Get a server's config from in-memory cache
   * This includes both main DB and role-specific DB configs that have been loaded
   */
  getServerConfig(serverId: string): MCPServerConfig | undefined {
    return this.configs.get(serverId);
  }

  /**
   * List all tools from all connected servers (both stdio and in-process)
   */
  async listAllTools(): Promise<Array<{ serverId: string; tools: MCPToolInfo[] }>> {
    const results: Array<{ serverId: string; tools: MCPToolInfo[] }> = [];
    
    // Get tools from stdio clients
    for (const [serverId, client] of this.clients) {
      try {
        const tools = await client.listTools();
        results.push({ serverId, tools });
      } catch (error) {
        console.error(`Failed to list tools for server ${serverId}:`, error);
      }
    }
    
    // Get tools from in-process adapters
    for (const [serverId, adapter] of this.inProcessAdapters) {
      try {
        const tools = await adapter.listTools();
        results.push({ serverId, tools });
      } catch (error) {
        console.error(`Failed to list tools for in-process server ${serverId}:`, error);
      }
    }
    
    return results;
  }

  /**
   * List tools from a specific server
   */
  async listTools(serverId: string): Promise<MCPToolInfo[]> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} not found`);
    }
    return client.listTools();
  }

  /**
   * Call a tool on a specific server (stdio or in-process)
   */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    // Check stdio clients first
    const client = this.clients.get(serverId);
    if (client) {
      return client.callTool(toolName, args);
    }

    // Check in-process adapters (direct key first, then base ID for multi-account)
    const adapter = this.inProcessAdapters.get(serverId)
      ?? this.inProcessAdapters.get(getBaseServerId(serverId));
    if (adapter) {
      return adapter.callTool(toolName, args);
    }

    throw new Error(`Server ${serverId} not found`);
  }

  /**
   * Find which server has a specific tool (checks both stdio and in-process)
   */
  async findTool(toolName: string): Promise<{ serverId: string; tool: MCPToolInfo } | null> {
    // Check stdio clients
    for (const [serverId, client] of this.clients) {
      try {
        const tools = await client.listTools();
        const tool = tools.find(t => t.name === toolName);
        if (tool) {
          return { serverId, tool };
        }
      } catch (error) {
        console.error(`Failed to search tools for server ${serverId}:`, error);
      }
    }
    
    // Check in-process adapters
    for (const [serverId, adapter] of this.inProcessAdapters) {
      try {
        const tools = await adapter.listTools();
        const tool = tools.find(t => t.name === toolName);
        if (tool) {
          return { serverId, tool };
        }
      } catch (error) {
        console.error(`Failed to search tools for in-process server ${serverId}:`, error);
      }
    }
    
    return null;
  }

  /**
   * Call a tool by name, automatically finding the right server
   */
  async callToolByName(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const found = await this.findTool(toolName);
    if (!found) {
      throw new Error(`Tool ${toolName} not found on any server`);
    }
    return this.callTool(found.serverId, toolName, args);
  }

  /**
   * Execute a tool call and return the result as a string
   */
  async executeToolCall(toolName: string, args: Record<string, unknown>): Promise<string> {
    try {
      console.log(`[MCPManager] Executing tool: ${toolName}`, { args });
      const result = await this.callToolByName(toolName, args);
      const resultString = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      console.log(`[MCPManager] Tool execution result (${toolName}): ${resultString.substring(0, 200)}...`);
      return resultString;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[MCPManager] Tool execution failed (${toolName}):`, error);
      return `Error executing tool ${toolName}: ${errorMsg}`;
    }
  }

  /**
   * List all resources from all connected servers
   */
  async listAllResources(): Promise<Array<{ serverId: string; resources: MCPResource[] }>> {
    const results: Array<{ serverId: string; resources: MCPResource[] }> = [];
    
    for (const [serverId, client] of this.clients) {
      try {
        const resources = await client.listResources();
        results.push({ serverId, resources });
      } catch (error) {
        console.error(`Failed to list resources for server ${serverId}:`, error);
      }
    }
    
    return results;
  }

  /**
   * Read a resource from a specific server
   */
  async readResource(serverId: string, uri: string): Promise<unknown> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} not found`);
    }
    return client.readResource(uri);
  }

  /**
   * Disconnect from all servers
   */
  async disconnectAll(): Promise<void> {
    for (const [serverId, client] of this.clients) {
      try {
        await client.disconnect();
      } catch (error) {
        console.error(`Failed to disconnect from server ${serverId}:`, error);
      }
    }
    this.clients.clear();
    this.configs.clear();
  }
}

// Singleton instance
export const mcpManager = new MCPManager();
