import type { MCPServerConfig, MCPToolInfo, MCPResource, MCPServerInfo, McpAdapter } from '@local-agent/shared';
import { createMCPClient, MCPClientInterface } from './client.js';
import { getMainDatabase, MainDatabase } from '../storage/main-db.js';
import { getRoleStorageService, RoleStorageService } from '../storage/role-storage-service.js';
import { promises as fs } from 'fs';
import path from 'path';
import { PREDEFINED_MCP_SERVERS, PredefinedMCPServer } from './predefined-servers.js';
import { adapterRegistry } from './adapters/registry.js';

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
  private db: MainDatabase | null = null;
  private currentRoleId: string | null = null;

  /**
   * Initialize the MCP manager and load persisted configs
   */
  async initialize(): Promise<void> {
    this.db = getMainDatabase();
    
    // Start global hidden servers first (markitdown)
    await this.startGlobalServers();
    
    // Load persisted server configs from main database
    await this.loadPersistedConfigs();
  }

  /**
   * Get the current role ID
   */
  getCurrentRoleId(): string | null {
    return this.currentRoleId;
  }

  /**
   * Initialize MCP servers for all roles across all users
   * Called during server startup to warm up per-role MCP server connections
   */
  async initializeAllRoles(): Promise<void> {
    console.log(`\n[MCPManager] ${'='.repeat(60)}`);
    console.log(`[MCPManager] INITIALIZING MCP SERVERS FOR ALL ROLES`);
    console.log(`[MCPManager] ${'='.repeat(60)}\n`);

    if (!this.db) {
      console.log('[MCPManager] Database not initialized, skipping role initialization');
      return;
    }

    try {
      // Get all users
      const users = this.db.getAllUsers();
      console.log(`[MCPManager] Found ${users.length} user(s)`);

      if (users.length === 0) {
        console.log('[MCPManager] No users found, skipping role initialization');
        return;
      }

      // For each user, get their roles and initialize MCP servers
      for (const user of users) {
        console.log(`\n[MCPManager] Initializing roles for user: ${user.email}`);

        const userRoles = this.db.getUserRoles(user.id);
        console.log(`[MCPManager]   Found ${userRoles.length} role(s) for user ${user.email}`);

        if (userRoles.length === 0) {
          console.log(`[MCPManager]   No roles found for user ${user.email}, skipping`);
          continue;
        }

        // Initialize MCP servers for each role
        for (const role of userRoles) {
          try {
            console.log(`[MCPManager]   Initializing role: ${role.name} (${role.id})`);
            await this.switchRole(role.id, user.id);
          } catch (error) {
            console.error(`[MCPManager]   Error initializing role ${role.id}:`, error);
            // Continue with next role even if one fails
          }
        }
      }

      // After all roles are initialized, switch to no role (unset current role)
      console.log(`\n[MCPManager] Resetting current role to none (servers remain initialized in cache)`);
      this.currentRoleId = null;

      console.log(`\n[MCPManager] ${'='.repeat(60)}`);
      console.log(`[MCPManager] ROLE INITIALIZATION COMPLETE`);
      console.log(`[MCPManager] ${'='.repeat(60)}\n`);
    } catch (error) {
      console.error('[MCPManager] Error during role initialization:', error);
    }
  }

  /**
   * Check if a server is global (not affected by role switches)
   */
  /**
   * Switch to a new role - load role-specific configs
   * All MCP servers are now user-level (stored in main.db, shared across roles)
   */
  async switchRole(newRoleId: string | null, userId?: string): Promise<void> {
    console.log(`\n[MCPManager] ${'='.repeat(60)}`);
    console.log(`[MCPManager] ROLE SWITCH INITIATED`);
    console.log(`[MCPManager]   Old Role: ${this.currentRoleId || 'none'}`);
    console.log(`[MCPManager]   New Role: ${newRoleId || 'none'}`);
    console.log(`[MCPManager]   User ID: ${userId || 'not provided'}`);
    console.log(`[MCPManager] ${'='.repeat(60)}\n`);
    
    const oldRoleId = this.currentRoleId;
    this.currentRoleId = newRoleId;

    // If no new role, nothing to do (all servers are user-level and stay running)
    if (!newRoleId) {
      console.log(`[MCPManager] No new role selected`);
      this.logActiveServers();
      return;
    }

    // Load role-specific MCP server configurations (all servers are user-level)
    console.log(`\n[MCPManager] [Role: ${newRoleId}] Loading role-specific MCP configurations...`);
    await this.loadRoleSpecificConfigs(newRoleId, userId);

    // Start per-role hidden servers (memory)
    await this.startPerRoleServers(newRoleId);

    this.logActiveServers();
  }

  /**
   * Log active servers with names
   */
  private logActiveServers(): void {
    const totalServers = this.clients.size + this.inProcessAdapters.size;
    console.log(`\n[MCPManager] ${'='.repeat(60)}`);
    console.log(`[MCPManager] ROLE SWITCH COMPLETE`);
    console.log(`[MCPManager]   Active servers: ${totalServers}`);
    for (const [id, config] of this.configs) {
      const inProcess = this.inProcessAdapters.has(id);
      const type = inProcess ? 'IN-PROCESS' : 'STDIO';
      console.log(`[MCPManager]     - ${config.name} (${id}) [${type}]`);
    }
    console.log(`[MCPManager] ${'='.repeat(60)}\n`);
  }

  /**
   * Start hidden servers (markitdown) - no longer per-role vs global distinction
   */
  private async startGlobalServers(): Promise<void> {
    // Exclude 'memory' — it is started per-role via startPerRoleServers with a role-specific DB path
    const hiddenServers = PREDEFINED_MCP_SERVERS.filter(s => s.hidden && s.id !== 'memory');

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
   * Start per-role hidden servers (memory uses role-specific database paths)
   */
  private async startPerRoleServers(roleId: string): Promise<void> {
    // Memory server uses role-specific database paths
    const perRoleServers = PREDEFINED_MCP_SERVERS.filter(s => s.id === 'memory' && s.hidden);

    for (const server of perRoleServers) {
      if (this.clients.has(server.id)) {
        console.log(`[MCPManager] Server ${server.id} already running for role: ${roleId}`);
        continue;
      }

      try {
        console.log(`[MCPManager] Starting role-specific server: ${server.id} for role: ${roleId}`);
        await this.startPredefinedServer(server, roleId);
        console.log(`[MCPManager] Server ${server.id} started successfully for role: ${roleId}`);
      } catch (error) {
        console.error(`[MCPManager] Failed to start role-specific server ${server.id}:`, error);
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
    
    // If server needs role database path, set it
    if (roleId) {
      const roleStorage = getRoleStorageService();
      const roleDbPath = roleStorage.getRoleDatabasePath(roleId);
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
      adapterTokenData || { roleId, dbPath: roleId ? getRoleStorageService().getRoleDatabasePath(roleId) : undefined }
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
   * Load role-specific MCP server configurations
   */
  private async loadRoleSpecificConfigs(roleId: string, userId?: string): Promise<void> {
    console.log(`[MCPManager] [Role: ${roleId}] ${'─'.repeat(50)}`);
    console.log(`[MCPManager] [Role: ${roleId}] LOADING USER-LEVEL MCP CONFIGURATIONS`);
    console.log(`[MCPManager] [Role: ${roleId}] ${'─'.repeat(50)}`);

    try {
      // Load all user-level MCP configs from main.db (migrated from role-specific databases)
      // All roles share the same MCP server set
      if (!this.db) {
        console.log(`[MCPManager] [Role: ${roleId}] Database not initialized`);
        return;
      }

      const allConfigs = this.db.getMCPServerConfigs();

      console.log(`[MCPManager] [Role: ${roleId}] Found ${allConfigs.length} MCP server configs in main database`);

      for (const { id: serverId, config: configData } of allConfigs) {
        const config = configData as any;
        console.log(`\n[MCPManager] [Role: ${roleId}] Processing server: ${config.id} (${config.name})`);
        console.log(`[MCPManager] [Role: ${roleId}]   - Enabled: ${config.enabled}`);
        console.log(`[MCPManager] [Role: ${roleId}]   - Auth Provider: ${config.auth?.provider || 'none'}`);
        
        if (!config.enabled) {
          console.log(`[MCPManager] [Role: ${roleId}]   - Skipping disabled server`);
          continue;
        }

        // Check if already running (check both stdio clients and in-process adapters)
        if (this.clients.has(config.id) || this.inProcessAdapters.has(config.id)) {
          console.log(`[MCPManager] [Role: ${roleId}]   - Server already running, skipping`);
          continue;
        }

        try {
          // Get user-level OAuth token if needed
          let userToken: any = undefined;
          if (config.auth?.provider === 'google') {
            console.log(`[MCPManager] [Role: ${roleId}]   [Token Setup] Looking for Google OAuth token...`);

            if (userId) {
              // Always use user-level tokens (role-specific tokens have been migrated)
              const { authService } = await import('../auth/index.js');
              // If config specifies accountEmail, use that specific account; otherwise get the first one
              const userOAuthToken = await authService.getOAuthToken(userId, 'google', config.accountEmail);
              if (userOAuthToken) {
                userToken = {
                  access_token: userOAuthToken.accessToken,
                  refresh_token: userOAuthToken.refreshToken,
                  expiry_date: userOAuthToken.expiryDate,
                  token_type: 'Bearer',
                };
                console.log(`[MCPManager] [Role: ${roleId}]   [Token Setup] ✓ Using user-level Google OAuth token`);
                console.log(`[MCPManager] [Role: ${roleId}]   [Token Setup]   - Account: ${userOAuthToken.accountEmail}`);
                console.log(`[MCPManager] [Role: ${roleId}]   [Token Setup]   - Access token: ${userOAuthToken.accessToken.substring(0, 20)}...`);
                console.log(`[MCPManager] [Role: ${roleId}]   [Token Setup]   - Refresh token: ${userOAuthToken.refreshToken ? 'present' : 'not present'}`);
                console.log(`[MCPManager] [Role: ${roleId}]   [Token Setup]   - Expiry: ${userOAuthToken.expiryDate ? new Date(userOAuthToken.expiryDate).toISOString() : 'not set'}`);
              } else {
                console.log(`[MCPManager] [Role: ${roleId}]   [Token Setup] ✗ No Google OAuth token found for account: ${config.accountEmail || 'any'}`);
              }
            }
          }

          // Check if this server should use in-process adapter
          // Use base server ID (stripping ~accountEmail suffix) for predefined server lookup
          const baseServerId = getBaseServerId(config.id);
          const predefinedServer = PREDEFINED_MCP_SERVERS.find(s =>
            s.id === baseServerId || s.name === config.name || s.id === config.name
          );
          if (predefinedServer?.inProcess && adapterRegistry.isInProcess(predefinedServer.id)) {
            console.log(`[MCPManager] [Role: ${roleId}]   [Restart] Starting in-process server ${config.id} (base: ${predefinedServer.id})...`);
            // Pass config.id as instanceId so multi-account adapters get unique keys
            await this.startInProcessServer(predefinedServer, roleId, userToken, userId, config.id);
            // Update configs map with accountEmail for display in getServers()
            const existingConfig = this.configs.get(config.id);
            if (existingConfig) {
              this.configs.set(config.id, { ...existingConfig, accountEmail: config.accountEmail });
            }
            console.log(`[MCPManager] [Role: ${roleId}]   [Restart] ✓ In-process server ${config.id} started successfully`);
            continue;
          }

          const mcpConfig: MCPServerConfig = {
            id: config.id,
            name: config.name,
            transport: config.transport,
            command: config.command,
            args: config.args,
            cwd: config.cwd,
            url: config.url,
            env: config.env || {},
            enabled: config.enabled,
            autoStart: config.autoStart,
            restartOnExit: config.restartOnExit,
            auth: config.auth,
            accountEmail: config.accountEmail,
          };

          console.log(`[MCPManager] [Role: ${roleId}]   [Restart] Starting server ${config.id}...`);
          await this.addServer(mcpConfig, userToken);
          console.log(`[MCPManager] [Role: ${roleId}]   [Restart] ✓ Server ${config.id} started successfully`);
        } catch (error) {
          console.error(`[MCPManager] [Role: ${roleId}]   [Restart] ✗ Failed to start server ${config.id}:`, error);
        }
      }
      
      console.log(`\n[MCPManager] [Role: ${roleId}] ${'─'.repeat(50)}`);
      console.log(`[MCPManager] [Role: ${roleId}] CONFIGURATION LOADING COMPLETE`);
      console.log(`[MCPManager] [Role: ${roleId}] ${'─'.repeat(50)}`);
    } catch (error) {
      console.error(`[MCPManager] [Role: ${roleId}] Error loading role-specific configs:`, error);
    }
  }

  /**
   * Load persisted server configs from main database
   * Only loads servers that don't require authentication (auth-required servers are loaded via loadRoleSpecificConfigs)
   * Memory server is handled separately by startPerRoleServers() during role switches
   */
  private async loadPersistedConfigs(): Promise<void> {
    if (!this.db) return;
    
    try {
      const configs = this.db.getMCPServerConfigs();
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

        // Skip memory server - it's handled by startPerRoleServers() with role-specific database path
        if (serverId === 'memory') {
          console.log(`[MCPManager] Skipping server ${serverId} (handled by startPerRoleServers with role-specific path)`);
          continue;
        }
        
        // Skip servers that require authentication - they'll be loaded via loadRoleSpecificConfigs
        if (typedConfig.auth?.provider && typedConfig.auth.provider !== 'none') {
          console.log(`[MCPManager] Skipping server ${serverId} (requires ${typedConfig.auth.provider} auth, will be loaded on role switch)`);
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
            // Include the original serverId from database
            await this.addServer({ ...typedConfig, id: serverId });
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
      this.db.saveMCPServerConfig(serverId, config as unknown as Record<string, unknown>);
      console.log(`[MCPManager] Persisted user-level config for server: ${serverId}`);
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
      this.db.deleteMCPServerConfig(serverId);
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
    const roleId = this.currentRoleId || 'no-role';
    
    if (!config.auth) {
      console.log(`[MCPManager] [Role: ${roleId}] [Token Setup] No auth config for ${serverId}, skipping token preparation`);
      return;
    }

    console.log(`[MCPManager] [Role: ${roleId}] [Token Setup] Preparing auth files for ${serverId}...`);

    // Create credentials file from environment variables if needed
    if (config.auth.credentialsFilename && config.auth.provider === 'google') {
      // Always use gcp-oauth.keys.json for google-drive-mcp
      const credentialsFilename = 'gcp-oauth.keys.json';
      const credentialsPath = path.join(process.cwd(), credentialsFilename);

      const credentials = {
        installed: {
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          redirect_uris: [process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback'],
        },
      };

      // Create parent directory if needed
      const dir = path.dirname(credentialsPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(credentialsPath, JSON.stringify(credentials, null, 2));
      console.log(`[MCPManager] [Role: ${roleId}] [Token Setup]   - Created credentials file: ${credentialsPath}`);
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

      console.log(`[MCPManager] [Role: ${roleId}] [Token Setup]   - Writing token file: ${tokenPath}`);

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
      console.log(`[MCPManager] [Role: ${roleId}] [Token Setup]   - ✓ Token file created successfully`);
    } else {
      console.log(`[MCPManager] [Role: ${roleId}] [Token Setup]   - No user token provided, skipping token file creation`);
    }
  }

  /**
   * Add and connect to an MCP server
   */
  async addServer(config: MCPServerConfig & { id?: string }, userToken?: any): Promise<void> {
    const serverId = config.id || config.name;
    if (this.clients.has(serverId) || this.inProcessAdapters.has(serverId)) {
      // Server already exists - idempotent: just return without error
      // This allows retry/re-add scenarios without failures
      console.log(`[MCPManager] Server ${serverId} already exists, skipping add`);
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
      const isInProcess = this.inProcessAdapters.has(id);
      
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
    
    // Check in-process adapters
    const adapter = this.inProcessAdapters.get(serverId);
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
