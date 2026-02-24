/**
 * Migration: Move OAuth tokens from role-specific databases to user-level database
 *
 * This migration:
 * 1. Iterates all roles in main.db
 * 2. Opens each role's database
 * 3. Reads any oauth_tokens from the role database
 * 4. Calls Google userinfo endpoint to get the account email
 * 5. Inserts into main.db oauth_tokens with accountEmail
 *
 * The migration is idempotent - it can be run multiple times safely.
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { getMainDatabase, type RoleDefinition } from '../main-db.js';

interface RoleOAuthToken {
  provider: string;
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Get account email from Google OAuth token by calling userinfo endpoint
 */
async function getGoogleAccountEmail(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      console.warn(`[TokenMigration] Failed to fetch userinfo: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as { email?: string };
    return data.email || null;
  } catch (error) {
    console.warn(`[TokenMigration] Error fetching userinfo:`, error);
    return null;
  }
}

/**
 * Run the token migration
 */
export async function migrateRoleTokens(dataDir: string = './data'): Promise<void> {
  console.log('[TokenMigration] Starting role token migration...');

  const mainDb = getMainDatabase(dataDir);

  // Get all roles
  const allUsers = mainDb.getAllUsers();
  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const user of allUsers) {
    const userRoles = mainDb.getUserRoles(user.id);

    for (const role of userRoles) {
      // Check if role database exists
      const roleDbPath = mainDb.getRoleDbPath(role.id);
      if (!fs.existsSync(roleDbPath)) {
        console.log(`[TokenMigration] Skipping role ${role.id} - database does not exist`);
        continue;
      }

      console.log(`[TokenMigration] Processing role ${role.id} (${role.name}) for user ${user.id}`);

      try {
        // Open role database
        const roleDb = new Database(roleDbPath);

        // Check if oauth_tokens table exists
        const tableCheckResult = roleDb.prepare(`
          SELECT name FROM sqlite_master
          WHERE type='table' AND name='oauth_tokens'
        `).get();

        if (!tableCheckResult) {
          console.log(`[TokenMigration] Role ${role.id} has no oauth_tokens table`);
          roleDb.close();
          continue;
        }

        // Read tokens from role database
        const roleTokens = roleDb.prepare('SELECT * FROM oauth_tokens').all() as RoleOAuthToken[];

        if (roleTokens.length === 0) {
          console.log(`[TokenMigration] Role ${role.id} has no tokens to migrate`);
          roleDb.close();
          continue;
        }

        console.log(`[TokenMigration] Found ${roleTokens.length} token(s) in role ${role.id}`);

        // Migrate each token
        for (const token of roleTokens) {
          console.log(`[TokenMigration] Migrating ${token.provider} token for role ${role.id}`);

          // Get account email
          let accountEmail: string | null = '';
          if (token.provider === 'google') {
            accountEmail = await getGoogleAccountEmail(token.accessToken);
            console.log(`[TokenMigration] Google account email: ${accountEmail || '(unknown)'}`);
          }

          // If we couldn't get email, use a placeholder (user can update later)
          if (!accountEmail) {
            accountEmail = `role-${role.id.substring(0, 8)}@unknown.local`;
            console.warn(`[TokenMigration] Using placeholder email: ${accountEmail}`);
          } else if (accountEmail === null) {
            accountEmail = '';
          }

          // Store in main database with INSERT OR IGNORE to be idempotent
          try {
            mainDb.storeOAuthToken(
              user.id,
              token.provider,
              token.accessToken,
              token.refreshToken || undefined,
              token.expiryDate || undefined,
              accountEmail
            );
            console.log(`[TokenMigration] Successfully migrated ${token.provider} token for role ${role.id}`);
            totalMigrated++;
          } catch (error: any) {
            if (error.message?.includes('UNIQUE constraint failed')) {
              console.log(`[TokenMigration] Token already exists in main database (skipping): ${token.provider} - ${accountEmail}`);
              totalSkipped++;
            } else {
              console.error(`[TokenMigration] Error migrating token:`, error);
            }
          }
        }

        roleDb.close();
      } catch (error) {
        console.error(`[TokenMigration] Error processing role ${role.id}:`, error);
      }
    }
  }

  console.log(`[TokenMigration] Migration complete! Migrated: ${totalMigrated}, Skipped: ${totalSkipped}`);
}

// Run migration on module load if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  migrateRoleTokens()
    .then(() => {
      console.log('[TokenMigration] Done');
      process.exit(0);
    })
    .catch((error) => {
      console.error('[TokenMigration] Fatal error:', error);
      process.exit(1);
    });
}
