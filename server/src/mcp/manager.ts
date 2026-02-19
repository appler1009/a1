import type { MCPServerConfig, MCPToolInfo, MCPResource, MCPServerInfo } from '@local-agent/shared';
import { createMCPClient, MCPClientInterface } from './client.js';
import { createStorage } from '../storage/index.js';
import { promises as fs } from 'fs';
import path from 'path';
import { PREDEFINED_MCP_SERVERS } from './predefined-servers.js';

/**
 * MCP Manager
 * Manages multiple MCP server connections
 */
export class MCPManager {
  private clients: Map<string, MCPClientInterface> = new Map();
  private configs: Map<string, MCPServerConfig> = new Map();
  private storage = createStorage({
    type: 'sqlite',
    root: './data',
  });

  /**
   * Initialize the MCP manager and load persisted configs
   */
  async initialize(): Promise<void> {
    await this.storage.initialize();
    await this.loadPersistedConfigs();
    await this.startHiddenServers();
  }

  /**
   * Start hidden MCP servers that should be automatically available
   * These servers don't show in the UI but provide background functionality
   */
  private async startHiddenServers(): Promise<void> {
    const hiddenServers = PREDEFINED_MCP_SERVERS.filter(s => s.hidden);
    
    for (const server of hiddenServers) {
      // Check if already running
      if (this.clients.has(server.id)) {
        console.log(`[MCPManager] Hidden server ${server.id} already running`);
        continue;
      }

      try {
        console.log(`[MCPManager] Starting hidden server: ${server.id}`);
        
        const config: MCPServerConfig = {
          id: server.id,
          name: server.name,
          transport: 'stdio',
          command: server.command,
          args: server.args,
          env: server.env || {},
          enabled: true,
          autoStart: true,
          restartOnExit: false,
          auth: server.auth,
        };

        await this.addServer(config);
        console.log(`[MCPManager] Hidden server ${server.id} started successfully`);
      } catch (error) {
        console.error(`[MCPManager] Failed to start hidden server ${server.id}:`, error);
      }
    }
  }

  /**
   * Load persisted server configs from database
   */
  private async loadPersistedConfigs(): Promise<void> {
    try {
      const configs = await this.storage.queryMetadata('mcp_servers', {});
      console.log(`[MCPManager] Loaded ${configs.length} persisted MCP server configs`);

      for (const config of configs) {
        const serverId = config.id as string;
        const serverConfig = config.config as MCPServerConfig;

        if (serverConfig.enabled) {
          try {
            console.log(`[MCPManager] Connecting to persisted server: ${serverId}`);
            // Include the original serverId from database
            await this.addServer({ ...serverConfig, id: serverId });
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
   * Save server config to database
   */
  private async persistConfig(serverId: string, config: MCPServerConfig): Promise<void> {
    try {
      await this.storage.setMetadata('mcp_servers', serverId, {
        id: serverId,
        config,
        createdAt: new Date().toISOString(),
      });
      console.log(`[MCPManager] Persisted config for server: ${serverId}`);
    } catch (error) {
      console.error(`[MCPManager] Failed to persist config for ${serverId}:`, error);
    }
  }

  /**
   * Remove server config from database
   */
  private async deletePersistedConfig(serverId: string): Promise<void> {
    try {
      await this.storage.deleteMetadata('mcp_servers', serverId);
      console.log(`[MCPManager] Deleted persisted config for server: ${serverId}`);
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
    if (!config.auth) return;

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
      console.log(`[MCPManager] Created credentials file: ${credentialsPath}`);
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
      console.log(`[MCPManager] Created token file: ${tokenPath}`);
    }
  }

  /**
   * Add and connect to an MCP server
   */
  async addServer(config: MCPServerConfig & { id?: string }, userToken?: any): Promise<void> {
    const serverId = config.id || config.name;
    if (this.clients.has(serverId)) {
      throw new Error(`Server ${serverId} already exists`);
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
      this.configs.delete(serverId);

      // Delete from database
      await this.deletePersistedConfig(serverId);
    }
  }

  /**
   * Get all connected servers
   */
  getServers(): Array<{ id: string; config: MCPServerConfig; info: MCPServerInfo | null }> {
    const result: Array<{ id: string; config: MCPServerConfig; info: MCPServerInfo | null }> = [];

    console.log(`[MCPManager] this.configs has ${this.configs.size} servers`);
    console.log(`[MCPManager] Config keys:`, Array.from(this.configs.keys()));

    for (const [id, config] of this.configs) {
      const client = this.clients.get(id);
      result.push({
        id,
        config,
        info: client?.getInfo() || null,
      });
    }

    console.log(`[MCPManager] getServers() returning ${result.length} servers`);
    return result;
  }

  /**
   * Get list of connected server names
   */
  getConnectedServers(): string[] {
    return Array.from(this.clients.keys());
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
   * List all tools from all connected servers
   */
  async listAllTools(): Promise<Array<{ serverId: string; tools: MCPToolInfo[] }>> {
    const results: Array<{ serverId: string; tools: MCPToolInfo[] }> = [];
    
    for (const [serverId, client] of this.clients) {
      try {
        const tools = await client.listTools();
        results.push({ serverId, tools });
      } catch (error) {
        console.error(`Failed to list tools for server ${serverId}:`, error);
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
   * Call a tool on a specific server
   */
  async callTool(serverId: string, toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const client = this.clients.get(serverId);
    if (!client) {
      throw new Error(`Server ${serverId} not found`);
    }
    return client.callTool(toolName, args);
  }

  /**
   * Find which server has a specific tool
   */
  async findTool(toolName: string): Promise<{ serverId: string; tool: MCPToolInfo } | null> {
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