/**
 * Migration: Move MCP server configs from role-specific databases to main.db
 *
 * This migration:
 * 1. Iterates all role databases
 * 2. Reads mcp_servers from each role database
 * 3. Consolidates them into main.db (user-level, shared across roles)
 * 4. Removes mcp_servers table from role databases
 *
 * The migration is idempotent - it can be run multiple times safely.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getMainDatabase } from '../main-db.js';

interface RoleMCPServer {
  id: string;
  name: string;
  transport: string;
  command?: string;
  args?: string[];
  cwd?: string;
  url?: string;
  enabled: boolean;
  autoStart?: boolean;
  restartOnExit?: boolean;
  auth?: Record<string, unknown>;
  env?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Run the MCP server migration
 */
export async function migrateMCPServers(dataDir: string = './data'): Promise<void> {
  console.log('[MCPMigration] Starting MCP server migration...');

  const mainDb = getMainDatabase(dataDir);
  let totalMigrated = 0;
  let totalSkipped = 0;

  // Get all role database files
  const roleDbPattern = /^role_[a-f0-9\-]+\.db$/;
  const roleDbFiles = fs.readdirSync(dataDir)
    .filter(file => roleDbPattern.test(file))
    .map(file => path.join(dataDir, file));

  console.log(`[MCPMigration] Found ${roleDbFiles.length} role database(s)`);

  for (const roleDbPath of roleDbFiles) {
    const roleId = path.basename(roleDbPath, '.db').replace('role_', '');
    
    try {
      // Open role database
      const roleDb = new Database(roleDbPath);

      // Check if mcp_servers table exists
      const tableCheckResult = roleDb.prepare(`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name='mcp_servers'
      `).get();

      if (!tableCheckResult) {
        console.log(`[MCPMigration] Role ${roleId} has no mcp_servers table`);
        roleDb.close();
        continue;
      }

      // Read servers from role database
      const roleServers = roleDb.prepare('SELECT * FROM mcp_servers').all() as RoleMCPServer[];

      if (roleServers.length === 0) {
        console.log(`[MCPMigration] Role ${roleId} has no MCP servers to migrate`);
        roleDb.close();
        continue;
      }

      console.log(`[MCPMigration] Found ${roleServers.length} MCP server(s) in role ${roleId}`);

      // Migrate each server
      for (const server of roleServers) {
        try {
          // Build config object
          const config: any = {
            id: server.id,
            name: server.name,
            transport: server.transport,
          };

          if (server.command) config.command = server.command;
          if (server.args) config.args = server.args;
          if (server.cwd) config.cwd = server.cwd;
          if (server.url) config.url = server.url;
          if (server.enabled !== undefined) config.enabled = server.enabled;
          if (server.autoStart !== undefined) config.autoStart = server.autoStart;
          if (server.restartOnExit !== undefined) config.restartOnExit = server.restartOnExit;
          if (server.auth) config.auth = server.auth;
          if (server.env) config.env = server.env;

          // Store in main database
          mainDb.saveMCPServerConfig(server.id, config);
          console.log(`[MCPMigration] Migrated MCP server ${server.id} from role ${roleId}`);
          totalMigrated++;
        } catch (error: any) {
          if (error.message?.includes('UNIQUE constraint failed')) {
            console.log(`[MCPMigration] Server ${server.id} already exists in main database (skipping)`);
            totalSkipped++;
          } else {
            console.error(`[MCPMigration] Error migrating server ${server.id}:`, error);
          }
        }
      }

      // Drop mcp_servers table from role database
      roleDb.prepare('DROP TABLE IF EXISTS mcp_servers').run();
      console.log(`[MCPMigration] Dropped mcp_servers table from role ${roleId}`);

      roleDb.close();
    } catch (error) {
      console.error(`[MCPMigration] Error processing role database ${roleDbPath}:`, error);
    }
  }

  console.log(`[MCPMigration] Migration complete! Migrated: ${totalMigrated}, Skipped: ${totalSkipped}`);
}

// Run migration on module load if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateMCPServers()
    .then(() => {
      console.log('[MCPMigration] Done');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[MCPMigration] Fatal error:', error);
      process.exit(1);
    });
}
