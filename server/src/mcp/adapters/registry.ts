import type { MCPServerConfig, McpAdapter } from '@local-agent/shared';
import { BaseStdioAdapter } from './BaseStdioAdapter.js';
import { GoogleDriveFullAdapter, type GoogleToken } from './GoogleDriveFullAdapter.js';
import { InProcessAdapter, type InProcessMCPModule } from './InProcessAdapter.js';
import { SQLiteMemoryInProcess } from '../in-process/sqlite-memory.js';
import { WeatherInProcess } from '../in-process/weather.js';

/**
 * Simple concrete implementation of BaseStdioAdapter for generic MCP servers
 */
class StdioAdapter extends BaseStdioAdapter {
  // No special token handling - just use base behavior
}

/**
 * Factory function type for creating in-process modules
 */
export type InProcessModuleFactory = (userId: string, tokenData?: any) => InProcessMCPModule | Promise<InProcessMCPModule>;

/**
 * Registry entry for in-process adapters
 */
interface InProcessRegistryEntry {
  type: 'in-process';
  factory: InProcessModuleFactory;
}

/**
 * Registry entry for stdio adapters
 */
interface StdioRegistryEntry {
  type: 'stdio';
  adapterClass: typeof GoogleDriveFullAdapter | typeof StdioAdapter;
}

type RegistryEntry = InProcessRegistryEntry | StdioRegistryEntry;

/**
 * Registry pattern for MCP adapters
 * Maps serverKey to adapter class and handles instantiation
 * Supports both stdio-based and in-process adapters
 */
class AdapterRegistry {
  private adapters = new Map<string, RegistryEntry>();

  constructor() {
    // Register predefined adapters by both ID and name for flexibility
    this.registerStdio('google-drive-full', GoogleDriveFullAdapter);
    this.registerStdio('Google Drive', GoogleDriveFullAdapter); // Also register by display name
    this.registerStdio('google-docs-mcp', GoogleDriveFullAdapter); // google-docs also uses Google OAuth
    this.registerStdio('Google Docs', GoogleDriveFullAdapter); // Also register by display name
    // markitdown uses StdioAdapter (no special auth required)
    this.registerStdio('markitdown', StdioAdapter);
    this.registerStdio('MarkItDown', StdioAdapter); // Also register by display name
    
    // Memory server uses in-process adapter for direct SQLite access
    this.registerInProcess('memory', (userId: string, tokenData?: any) => {
      const dbPath = tokenData?.dbPath || `data/memory-${userId}.db`;
      return new SQLiteMemoryInProcess(dbPath);
    });
    this.registerInProcess('Memory', (userId: string, tokenData?: any) => {
      const dbPath = tokenData?.dbPath || `data/memory-${userId}.db`;
      return new SQLiteMemoryInProcess(dbPath);
    });
    
    // Weather server uses in-process adapter for direct API calls
    this.registerInProcess('weather', () => new WeatherInProcess());
    this.registerInProcess('Weather', () => new WeatherInProcess());
    
    // Future: this.register('github', GithubAdapter);
    // Future: this.register('brave-search', BraveSearchAdapter);
  }

  /**
   * Register a stdio-based adapter class for a specific server key
   */
  registerStdio(
    serverKey: string,
    adapterClass: typeof GoogleDriveFullAdapter | typeof StdioAdapter
  ): void {
    this.adapters.set(serverKey, { type: 'stdio', adapterClass });
    console.log(`[AdapterRegistry] Registered stdio adapter for ${serverKey}`);
  }

  /**
   * Register an in-process adapter factory for a specific server key
   * The factory receives userId and optional tokenData and returns an InProcessMCPModule
   */
  registerInProcess(
    serverKey: string,
    factory: InProcessModuleFactory
  ): void {
    this.adapters.set(serverKey, { type: 'in-process', factory });
    console.log(`[AdapterRegistry] Registered in-process adapter for ${serverKey}`);
  }

  /**
   * Check if a server key has an in-process adapter registered
   */
  isInProcess(serverKey: string): boolean {
    const entry = this.adapters.get(serverKey);
    return entry?.type === 'in-process';
  }

  /**
   * Create an in-process adapter instance
   */
  async createInProcess(
    serverKey: string,
    userId: string,
    id: string,
    tokenData?: any
  ): Promise<InProcessAdapter> {
    const entry = this.adapters.get(serverKey);
    
    if (!entry || entry.type !== 'in-process') {
      throw new Error(`No in-process adapter registered for ${serverKey}`);
    }

    console.log(`[AdapterRegistry] Creating in-process adapter for ${serverKey}`);
    
    const module = await entry.factory(userId, tokenData);
    return new InProcessAdapter(id, userId, serverKey, module);
  }

  /**
   * Create an adapter instance based on server key
   * Uses registered adapter if available, otherwise defaults to StdioAdapter
   */
  create(
    serverKey: string,
    userId: string,
    id: string,
    config: MCPServerConfig,
    cwd: string,
    tokenData?: any
  ): BaseStdioAdapter {
    const entry = this.adapters.get(serverKey);

    // If no entry or in-process, use default StdioAdapter
    if (!entry || entry.type === 'in-process') {
      console.log(`[AdapterRegistry] Creating default stdio adapter for ${serverKey}`);
      return new StdioAdapter(
        id,
        userId,
        serverKey,
        config.command || '',
        config.args || [],
        cwd,
        config.env || {}
      );
    }

    const AdapterClass = entry.adapterClass;
    console.log(`[AdapterRegistry] Creating adapter for ${serverKey} using ${(AdapterClass as any).name}`);

    // Handle adapters that require token data
    if (AdapterClass === GoogleDriveFullAdapter && tokenData) {
      return new (AdapterClass as any)(
        id,
        userId,
        serverKey,
        config.command || '',
        config.args || [],
        cwd,
        config.env || {},
        tokenData
      );
    }

    // Default instantiation for StdioAdapter and others without token data
    return new (AdapterClass as any)(
      id,
      userId,
      serverKey,
      config.command || '',
      config.args || [],
      cwd,
      config.env || {}
    );
  }
}

// Global registry instance
export const adapterRegistry = new AdapterRegistry();
