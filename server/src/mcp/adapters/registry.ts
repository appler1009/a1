import type { MCPServerConfig, McpAdapter } from '@local-agent/shared';
import { BaseStdioAdapter } from './BaseStdioAdapter.js';
import { InProcessAdapter, type InProcessMCPModule } from './InProcessAdapter.js';
import { SQLiteMemoryInProcess } from '../in-process/sqlite-memory.js';
import { WeatherInProcess } from '../in-process/weather.js';
import { MetaMcpSearchInProcess } from '../in-process/meta-mcp-search.js';
import { GoogleDriveInProcess } from '../in-process/google-drive.js';
import { GmailInProcess } from '../in-process/gmail.js';
import { DisplayEmailInProcess } from '../in-process/display-email.js';
import { ProcessEachInProcess } from '../in-process/process-each.js';
import { RoleManagerInProcess } from '../in-process/role-manager.js';
import { AlphaVantageInProcess } from '../in-process/alpha-vantage.js';
import { TwelveDataInProcess } from '../in-process/twelve-data.js';
import { SchedulerInProcess } from '../in-process/scheduler.js';
import { getMainDatabaseSync } from '../../storage/index.js';

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
  adapterClass: typeof StdioAdapter;
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
    // Google Drive - in-process for better performance
    // Uses google-drive-mcp-lib for direct API calls
    this.registerInProcess('google-drive-mcp-lib', (userId: string, tokenData?: any) => {
      if (!tokenData) {
        throw new Error('Token data required for Google Drive in-process adapter');
      }
      return new GoogleDriveInProcess(tokenData);
    });
    this.registerInProcess('Google Drive', (userId: string, tokenData?: any) => {
      if (!tokenData) {
        throw new Error('Token data required for Google Drive in-process adapter');
      }
      return new GoogleDriveInProcess(tokenData);
    });
    
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
    
    // Meta MCP Search - semantic search over all available MCP tools
    // This is the initial tool exposed to the LLM for tool discovery
    this.registerInProcess('meta-mcp-search', (userId: string) => new MetaMcpSearchInProcess(userId));
    this.registerInProcess('Meta MCP Search', (userId: string) => new MetaMcpSearchInProcess(userId));

    // Gmail - in-process for better performance
    // Uses gmail-mcp-lib for direct API calls
    this.registerInProcess('gmail-mcp-lib', (userId: string, tokenData?: any) => {
      if (!tokenData) {
        throw new Error('Token data required for Gmail in-process adapter');
      }
      const storageRoot = process.env.STORAGE_ROOT || './data';
      return new GmailInProcess(tokenData, storageRoot);
    });
    this.registerInProcess('Gmail', (userId: string, tokenData?: any) => {
      if (!tokenData) {
        throw new Error('Token data required for Gmail in-process adapter');
      }
      const storageRoot = process.env.STORAGE_ROOT || './data';
      return new GmailInProcess(tokenData, storageRoot);
    });

    // Display Email - allows AI to show emails in preview pane
    this.registerInProcess('display-email', () => new DisplayEmailInProcess());
    this.registerInProcess('Display Email', () => new DisplayEmailInProcess());

    // Process Each - processes a list of items one at a time using a focused LLM call per item
    // Avoids context overflow when handling many emails/files
    this.registerInProcess('process-each', () => new ProcessEachInProcess());
    this.registerInProcess('Process Each', () => new ProcessEachInProcess());

    // Role Manager - allows LLM to switch between user's roles dynamically
    // Used by Discord bot and other clients to manage active role
    this.registerInProcess('role-manager', (userId: string) => {
      const mainDb = getMainDatabaseSync();
      return new RoleManagerInProcess(userId, mainDb);
    });
    this.registerInProcess('Role Manager', (userId: string) => {
      const mainDb = getMainDatabaseSync();
      return new RoleManagerInProcess(userId, mainDb);
    });

    // Alpha Vantage - in-process financial data (requires API key)
    this.registerInProcess('alpha-vantage', (_userId: string, tokenData?: any) => {
      const apiKey = tokenData?.apiKey;
      if (!apiKey) throw new Error('Alpha Vantage API key not configured');
      return new AlphaVantageInProcess(apiKey);
    });
    this.registerInProcess('Alpha Vantage', (_userId: string, tokenData?: any) => {
      const apiKey = tokenData?.apiKey;
      if (!apiKey) throw new Error('Alpha Vantage API key not configured');
      return new AlphaVantageInProcess(apiKey);
    });

    // Twelve Data - in-process financial data (requires API key)
    this.registerInProcess('twelve-data', (_userId: string, tokenData?: any) => {
      const apiKey = tokenData?.apiKey;
      if (!apiKey) throw new Error('Twelve Data API key not configured');
      return new TwelveDataInProcess(apiKey);
    });
    this.registerInProcess('Twelve Data', (_userId: string, tokenData?: any) => {
      const apiKey = tokenData?.apiKey;
      if (!apiKey) throw new Error('Twelve Data API key not configured');
      return new TwelveDataInProcess(apiKey);
    });

    // Scheduler - role-scoped in-process task scheduler
    this.registerInProcess('scheduler', (userId: string, tokenData?: any) => {
      const mainDb = getMainDatabaseSync();
      return new SchedulerInProcess(mainDb, userId, tokenData?.roleId || '');
    });

    // Future: this.register('github', GithubAdapter);
    // Future: this.register('brave-search', BraveSearchAdapter);
  }

  /**
   * Register a stdio-based adapter class for a specific server key
   */
  registerStdio(
    serverKey: string,
    adapterClass: typeof StdioAdapter
  ): void {
    this.adapters.set(serverKey, { type: 'stdio', adapterClass });
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
  }

  /**
   * Check if a server key has an in-process adapter registered
   */
  isInProcess(serverKey: string): boolean {
    const entry = this.adapters.get(serverKey);
    return entry?.type === 'in-process';
  }

  /**
   * Create a raw in-process module (without wrapping in InProcessAdapter).
   * Used by MultiAccountAdapter to create per-account modules.
   */
  async createRawModule(
    serverKey: string,
    userId: string,
    tokenData?: any
  ): Promise<InProcessMCPModule> {
    const entry = this.adapters.get(serverKey);

    if (!entry || entry.type !== 'in-process') {
      throw new Error(`No in-process adapter registered for ${serverKey}`);
    }

    return entry.factory(userId, tokenData);
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

    if (!entry || entry.type === 'in-process') {
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

    // Default instantiation for StdioAdapter
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
