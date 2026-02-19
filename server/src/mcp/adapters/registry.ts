import type { MCPServerConfig } from '@local-agent/shared';
import { BaseStdioAdapter } from './BaseStdioAdapter.js';
import { GoogleDriveFullAdapter, type GoogleToken } from './GoogleDriveFullAdapter.js';
import { AppleDocsAdapter, type AppleToken } from './AppleDocsAdapter.js';

/**
 * Simple concrete implementation of BaseStdioAdapter for generic MCP servers
 */
class StdioAdapter extends BaseStdioAdapter {
  // No special token handling - just use base behavior
}

/**
 * Registry pattern for MCP adapters
 * Maps serverKey to adapter class and handles instantiation
 * Supports custom token types for each adapter
 */
class AdapterRegistry {
  private adapters = new Map<
    string,
    | typeof GoogleDriveFullAdapter
    | typeof AppleDocsAdapter
    | typeof StdioAdapter
  >();

  constructor() {
    // Register predefined adapters by both ID and name for flexibility
    this.register('google-drive-full', GoogleDriveFullAdapter);
    this.register('Google Drive', GoogleDriveFullAdapter); // Also register by display name
    this.register('google-docs-mcp', GoogleDriveFullAdapter); // google-docs also uses Google OAuth
    this.register('Google Docs', GoogleDriveFullAdapter); // Also register by display name
    this.register('apple-docs', AppleDocsAdapter);
    this.register('Apple Documentation', AppleDocsAdapter); // Also register by display name
    // markitdown uses StdioAdapter (no special auth required)
    this.register('markitdown', StdioAdapter);
    this.register('MarkItDown', StdioAdapter); // Also register by display name
    // Future: this.register('github', GithubAdapter);
    // Future: this.register('brave-search', BraveSearchAdapter);
  }

  /**
   * Register an adapter class for a specific server key
   */
  register(
    serverKey: string,
    adapterClass: typeof GoogleDriveFullAdapter | typeof AppleDocsAdapter | typeof StdioAdapter
  ): void {
    this.adapters.set(serverKey, adapterClass);
    console.log(`[AdapterRegistry] Registered adapter for ${serverKey}`);
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
    const AdapterClass = this.adapters.get(serverKey) || StdioAdapter;

    console.log(`[AdapterRegistry] Creating adapter for ${serverKey} using ${(AdapterClass as any).name}`);

    // Handle adapters that require token data
    if ((AdapterClass === GoogleDriveFullAdapter || AdapterClass === AppleDocsAdapter) && tokenData) {
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
