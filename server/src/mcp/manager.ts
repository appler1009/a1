import type { MCPServerConfig, MCPToolInfo, MCPResource, MCPServerInfo } from '@local-agent/shared';
import { createMCPClient, MCPClientInterface } from './client.js';

/**
 * MCP Manager
 * Manages multiple MCP server connections
 */
export class MCPManager {
  private clients: Map<string, MCPClientInterface> = new Map();
  private configs: Map<string, MCPServerConfig> = new Map();

  /**
   * Add and connect to an MCP server
   */
  async addServer(config: MCPServerConfig & { id?: string }): Promise<void> {
    const serverId = config.id || config.name;
    if (this.clients.has(serverId)) {
      throw new Error(`Server ${serverId} already exists`);
    }

    const client = createMCPClient(config);
    await client.connect();
    
    this.clients.set(serverId, client);
    this.configs.set(serverId, config);
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
    }
  }

  /**
   * Get all connected servers
   */
  getServers(): Array<{ id: string; config: MCPServerConfig; info: MCPServerInfo | null }> {
    const result: Array<{ id: string; config: MCPServerConfig; info: MCPServerInfo | null }> = [];
    
    for (const [id, config] of this.configs) {
      const client = this.clients.get(id);
      result.push({
        id,
        config,
        info: client?.getInfo() || null,
      });
    }
    
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