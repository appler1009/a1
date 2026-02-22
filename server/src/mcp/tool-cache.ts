import type { MCPToolInfo } from '@local-agent/shared';

/**
 * Cached tool entry with server mapping
 */
interface CachedTool {
  toolName: string;
  serverId: string;
  tool: MCPToolInfo;
  cachedAt: number;
}

/**
 * Tool cache for quick tool lookups without connecting to servers
 * 
 * This cache stores tool listings per server and provides fast lookups
 * to avoid connecting to every server when searching for a tool.
 */
class ToolCache {
  private toolIndex = new Map<string, CachedTool>(); // toolName -> CachedTool
  private serverTools = new Map<string, Set<string>>(); // serverId -> Set of toolNames
  private cacheTimestamps = new Map<string, number>(); // serverId -> last cache time
  private readonly CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

  /**
   * Update the cache with tools from a server
   */
  updateServerTools(serverId: string, tools: MCPToolInfo[]): void {
    // Remove old tools for this server
    this.clearServerTools(serverId);

    // Add new tools
    const toolNames = new Set<string>();
    const now = Date.now();

    for (const tool of tools) {
      const cachedTool: CachedTool = {
        toolName: tool.name,
        serverId,
        tool,
        cachedAt: now,
      };

      this.toolIndex.set(tool.name, cachedTool);
      toolNames.add(tool.name);
    }

    this.serverTools.set(serverId, toolNames);
    this.cacheTimestamps.set(serverId, now);

    console.log(`[ToolCache] Updated cache for server ${serverId}: ${tools.length} tools`);
  }

  /**
   * Find which server has a specific tool
   * Returns null if tool not found or cache is stale
   */
  findToolServer(toolName: string): { serverId: string; tool: MCPToolInfo } | null {
    const cached = this.toolIndex.get(toolName);
    
    if (!cached) {
      return null;
    }

    // Check if cache is still valid
    const serverCacheTime = this.cacheTimestamps.get(cached.serverId) || 0;
    const now = Date.now();
    
    if (now - serverCacheTime > this.CACHE_TTL_MS) {
      // Cache is stale, remove it
      this.toolIndex.delete(toolName);
      return null;
    }

    return {
      serverId: cached.serverId,
      tool: cached.tool,
    };
  }

  /**
   * Check if a tool exists in the cache
   */
  hasTool(toolName: string): boolean {
    return this.findToolServer(toolName) !== null;
  }

  /**
   * Get all cached tools for a server
   */
  getServerTools(serverId: string): MCPToolInfo[] {
    const toolNames = this.serverTools.get(serverId);
    if (!toolNames) {
      return [];
    }

    const tools: MCPToolInfo[] = [];
    for (const toolName of toolNames) {
      const cached = this.toolIndex.get(toolName);
      if (cached) {
        tools.push(cached.tool);
      }
    }

    return tools;
  }

  /**
   * Get all cached tools across all servers
   */
  getAllTools(): Array<{ serverId: string; tools: MCPToolInfo[] }> {
    const results: Array<{ serverId: string; tools: MCPToolInfo[] }> = [];

    for (const serverId of this.serverTools.keys()) {
      const tools = this.getServerTools(serverId);
      if (tools.length > 0) {
        results.push({ serverId, tools });
      }
    }

    return results;
  }

  /**
   * Clear all cached tools for a specific server
   */
  clearServerTools(serverId: string): void {
    const toolNames = this.serverTools.get(serverId);
    if (toolNames) {
      for (const toolName of toolNames) {
        this.toolIndex.delete(toolName);
      }
      this.serverTools.delete(serverId);
    }
    this.cacheTimestamps.delete(serverId);
    console.log(`[ToolCache] Cleared cache for server ${serverId}`);
  }

  /**
   * Clear all cached tools
   */
  clearAll(): void {
    this.toolIndex.clear();
    this.serverTools.clear();
    this.cacheTimestamps.clear();
    console.log(`[ToolCache] Cleared all cached tools`);
  }

  /**
   * Check if cache needs refresh for a server
   */
  needsRefresh(serverId: string): boolean {
    const cacheTime = this.cacheTimestamps.get(serverId);
    if (!cacheTime) {
      return true;
    }
    return Date.now() - cacheTime > this.CACHE_TTL_MS;
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    totalTools: number;
    serverCount: number;
    servers: Array<{ serverId: string; toolCount: number; cachedAt: number }>;
  } {
    const servers = Array.from(this.serverTools.entries()).map(([serverId, tools]) => ({
      serverId,
      toolCount: tools.size,
      cachedAt: this.cacheTimestamps.get(serverId) || 0,
    }));

    return {
      totalTools: this.toolIndex.size,
      serverCount: this.serverTools.size,
      servers,
    };
  }

  /**
   * Get total number of cached tools
   */
  getToolCount(): number {
    return this.toolIndex.size;
  }

  /**
   * Get list of tools that need fresh cache (for pre-warming)
   */
  getServersNeedingRefresh(): string[] {
    const needing: string[] = [];
    const now = Date.now();

    for (const [serverId, cachedAt] of this.cacheTimestamps) {
      if (now - cachedAt > this.CACHE_TTL_MS) {
        needing.push(serverId);
      }
    }

    return needing;
  }
}

// Global singleton instance
export const toolCache = new ToolCache();
