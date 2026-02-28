import { Database } from 'bun:sqlite';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

/**
 * Migration script to convert the old SQLite database schema to the new role-based architecture
 * 
 * Old schema (single metadata.db):
 * - memory (with roleId, orgId, userId)
 * - messages (with roleId)
 * - metadata (generic key-value)
 * - settings (global)
 * 
 * New schema:
 * - main.db: users, sessions, groups, memberships, invitations, roles, oauth_tokens
 * - role_{roleId}.db: memory, messages, settings, mcp_servers, oauth_tokens, metadata
 */

interface OldMemoryEntry {
  id: string;
  roleId: string;
  orgId: string;
  userId: string;
  content: string;
  embedding: Buffer | null;
  metadata: string | null;
  createdAt: string;
}

interface OldMessageEntry {
  id: string;
  roleId: string;
  groupId: string | null;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

interface OldSettingEntry {
  key: string;
  value: string;
  updatedAt: string;
}

interface OldMetadataEntry {
  table_name: string;
  id: string;
  data: string;
}

interface MigrationResult {
  usersCreated: number;
  rolesCreated: number;
  memoriesMigrated: number;
  messagesMigrated: number;
  settingsMigrated: number;
  metadataMigrated: number;
  errors: string[];
}

/**
 * Run the migration from old database to new role-based architecture
 */
export async function migrateToRoleBasedStorage(
  dataDir: string,
  oldDbPath?: string
): Promise<MigrationResult> {
  const result: MigrationResult = {
    usersCreated: 0,
    rolesCreated: 0,
    memoriesMigrated: 0,
    messagesMigrated: 0,
    settingsMigrated: 0,
    metadataMigrated: 0,
    errors: [],
  };

  // Determine old database path
  const oldDb = oldDbPath || path.join(dataDir, 'metadata.db');
  
  // Check if old database exists
  if (!fs.existsSync(oldDb)) {
    console.log('[Migration] No old database found, nothing to migrate');
    return result;
  }

  console.log(`[Migration] Starting migration from ${oldDb}`);

  // Open old database
  const oldDbConn = new Database(oldDb, { readonly: true });

  // Check if new main.db already exists
  const mainDbPath = path.join(dataDir, 'main.db');
  const mainDbExists = fs.existsSync(mainDbPath);
  
  // Open or create main database
  const mainDb = new Database(mainDbPath);
  
  // Initialize main database schema
  mainDb.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      accountType TEXT DEFAULT 'individual',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    );
    
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
    
    CREATE TABLE IF NOT EXISTS groups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT,
      createdAt TEXT NOT NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_groups_url ON groups(url);
    
    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      groupId TEXT NOT NULL,
      userId TEXT NOT NULL,
      role TEXT DEFAULT 'member',
      createdAt TEXT NOT NULL,
      FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(groupId, userId)
    );
    
    CREATE INDEX IF NOT EXISTS idx_memberships_group ON memberships(groupId);
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(userId);
    
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      groupId TEXT NOT NULL,
      createdBy TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'member',
      expiresAt TEXT,
      usedAt TEXT,
      acceptedAt TEXT,
      createdAt TEXT NOT NULL,
      FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE CASCADE,
      FOREIGN KEY (createdBy) REFERENCES users(id)
    );
    
    CREATE INDEX IF NOT EXISTS idx_invitations_code ON invitations(code);
    CREATE INDEX IF NOT EXISTS idx_invitations_group ON invitations(groupId);
    
    CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      groupId TEXT,
      name TEXT NOT NULL,
      jobDesc TEXT,
      systemPrompt TEXT,
      model TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (groupId) REFERENCES groups(id) ON DELETE SET NULL
    );
    
    CREATE INDEX IF NOT EXISTS idx_roles_user ON roles(userId);
    CREATE INDEX IF NOT EXISTS idx_roles_group ON roles(groupId);
    
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      userId TEXT NOT NULL,
      accessToken TEXT NOT NULL,
      refreshToken TEXT,
      expiryDate INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(provider, userId)
    );
    
    CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_tokens(userId);
    CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_tokens(provider);
  `);

  // Get unique userIds from old data
  const oldUsers = new Set<string>();
  const oldRoleIds = new Set<string>();

  // Collect userIds from memory
  try {
    const memoryUsers = oldDbConn.prepare('SELECT DISTINCT userId FROM memory').all() as { userId: string }[];
    memoryUsers.forEach(u => oldUsers.add(u.userId));
  } catch (e) {
    // Table might not exist
  }

  // Collect userIds from messages
  try {
    const messageUsers = oldDbConn.prepare('SELECT DISTINCT userId FROM messages').all() as { userId: string }[];
    messageUsers.forEach(u => oldUsers.add(u.userId));
  } catch (e) {
    // Table might not exist
  }

  // Collect roleIds from memory
  try {
    const memoryRoles = oldDbConn.prepare('SELECT DISTINCT roleId FROM memory').all() as { roleId: string }[];
    memoryRoles.forEach(r => oldRoleIds.add(r.roleId));
  } catch (e) {
    // Table might not exist
  }

  // Collect roleIds from messages
  try {
    const messageRoles = oldDbConn.prepare('SELECT DISTINCT roleId FROM messages').all() as { roleId: string }[];
    messageRoles.forEach(r => oldRoleIds.add(r.roleId));
  } catch (e) {
    // Table might not exist
  }

  console.log(`[Migration] Found ${oldUsers.size} unique users and ${oldRoleIds.size} unique roles`);

  // Create users in main database
  const userMapping: Map<string, string> = new Map(); // old userId -> new userId
  
  for (const oldUserId of oldUsers) {
    // Check if user already exists
    const existingUser = mainDb.prepare('SELECT id FROM users WHERE id = ?').get(oldUserId) as { id: string } | undefined;
    
    if (existingUser) {
      userMapping.set(oldUserId, existingUser.id);
    } else {
      // Create a new user with a placeholder email
      const now = new Date().toISOString();
      const email = `migrated-${oldUserId.substring(0, 8)}@migrated.local`;
      
      try {
        mainDb.prepare(`
          INSERT INTO users (id, email, name, accountType, createdAt, updatedAt)
          VALUES (?, ?, ?, 'individual', ?, ?)
        `).run(oldUserId, email, 'Migrated User', now, now);
        
        userMapping.set(oldUserId, oldUserId);
        result.usersCreated++;
      } catch (e) {
        result.errors.push(`Failed to create user ${oldUserId}: ${e}`);
      }
    }
  }

  // Create default roles for each user
  const roleMapping: Map<string, string> = new Map(); // old roleId -> new roleId
  
  for (const oldUserId of oldUsers) {
    const newUserId = userMapping.get(oldUserId) || oldUserId;
    
    // Create a default role for this user
    const roleId = uuidv4();
    const now = new Date().toISOString();
    const roleName = 'Default';
    
    try {
      mainDb.prepare(`
        INSERT INTO roles (id, userId, name, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?)
      `).run(roleId, newUserId, roleName, now, now);
      
      // Map all old roleIds for this user to the new default role
      for (const oldRoleId of oldRoleIds) {
        roleMapping.set(oldRoleId, roleId);
      }
      
      result.rolesCreated++;
      console.log(`[Migration] Created default role ${roleId} for user ${newUserId}`);
    } catch (e) {
      result.errors.push(`Failed to create role for user ${newUserId}: ${e}`);
    }
  }

  // Migrate data for each new role
  const processedRoles = new Set<string>();
  
  for (const [oldRoleId, newRoleId] of roleMapping) {
    if (processedRoles.has(newRoleId)) continue;
    processedRoles.add(newRoleId);

    console.log(`[Migration] Migrating data for role ${newRoleId} (from old role ${oldRoleId})`);

    // Create role database
    const roleDbPath = path.join(dataDir, `role_${newRoleId}.db`);
    const roleDb = new Database(roleDbPath);
    
    // Initialize role database schema
    roleDb.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        roleId TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        metadata TEXT,
        createdAt TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_memory_created ON memory(createdAt);
      
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        roleId TEXT NOT NULL,
        groupId TEXT,
        userId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(createdAt);
      
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL,
        command TEXT,
        args TEXT,
        cwd TEXT,
        url TEXT,
        enabled INTEGER DEFAULT 1,
        autoStart INTEGER DEFAULT 0,
        restartOnExit INTEGER DEFAULT 0,
        auth TEXT,
        env TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_mcp_enabled ON mcp_servers(enabled);
      
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        provider TEXT PRIMARY KEY,
        accessToken TEXT NOT NULL,
        refreshToken TEXT,
        expiryDate INTEGER,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS metadata (
        table_name TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (table_name, id)
      );
    `);

    // Migrate memory entries
    try {
      const memories = oldDbConn.prepare('SELECT * FROM memory WHERE roleId = ?').all(oldRoleId) as OldMemoryEntry[];
      
      for (const mem of memories) {
        roleDb.prepare(`
          INSERT OR IGNORE INTO memory (id, roleId, content, embedding, metadata, createdAt)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(mem.id, newRoleId, mem.content, mem.embedding, mem.metadata, mem.createdAt);
        
        result.memoriesMigrated++;
      }
    } catch (e) {
      result.errors.push(`Failed to migrate memory for role ${newRoleId}: ${e}`);
    }

    // Migrate messages
    try {
      const messages = oldDbConn.prepare('SELECT * FROM messages WHERE roleId = ?').all(oldRoleId) as OldMessageEntry[];
      
      for (const msg of messages) {
        roleDb.prepare(`
          INSERT OR IGNORE INTO messages (id, roleId, groupId, userId, role, content, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(msg.id, newRoleId, msg.groupId, msg.userId, msg.role, msg.content, msg.createdAt);
        
        result.messagesMigrated++;
      }
    } catch (e) {
      result.errors.push(`Failed to migrate messages for role ${newRoleId}: ${e}`);
    }

    roleDb.close();
  }

  // Migrate global settings to the first role (or create a default role)
  try {
    const settings = oldDbConn.prepare('SELECT * FROM settings').all() as OldSettingEntry[];
    
    if (settings.length > 0 && processedRoles.size > 0) {
      // Get the first role
      const firstRoleId = Array.from(processedRoles)[0];
      const roleDbPath = path.join(dataDir, `role_${firstRoleId}.db`);
      const roleDb = new Database(roleDbPath);
      
      for (const setting of settings) {
        roleDb.prepare(`
          INSERT OR IGNORE INTO settings (key, value, updatedAt)
          VALUES (?, ?, ?)
        `).run(setting.key, setting.value, setting.updatedAt);
        
        result.settingsMigrated++;
      }
      
      roleDb.close();
    }
  } catch (e) {
    result.errors.push(`Failed to migrate settings: ${e}`);
  }

  // Migrate metadata (auth data, etc.)
  try {
    const metadata = oldDbConn.prepare('SELECT * FROM metadata').all() as OldMetadataEntry[];
    
    // Check for auth data in metadata
    for (const meta of metadata) {
      if (meta.table_name === 'auth_users' || 
          meta.table_name === 'auth_sessions' || 
          meta.table_name === 'auth_groups' ||
          meta.table_name === 'auth_memberships' ||
          meta.table_name === 'auth_invitations' ||
          meta.table_name === 'oauth_tokens') {
        try {
          const data = JSON.parse(meta.data);
          
          if (meta.table_name === 'auth_users') {
            // Migrate user
            const existingUser = mainDb.prepare('SELECT id FROM users WHERE id = ?').get(data.id) as { id: string } | undefined;
            if (!existingUser) {
              mainDb.prepare(`
                INSERT OR IGNORE INTO users (id, email, name, accountType, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(
                data.id,
                data.email || `migrated-${data.id.substring(0, 8)}@migrated.local`,
                data.name || 'Migrated User',
                data.accountType || 'individual',
                data.createdAt || new Date().toISOString(),
                data.updatedAt || new Date().toISOString()
              );
            }
          } else if (meta.table_name === 'auth_sessions') {
            mainDb.prepare(`
              INSERT OR IGNORE INTO sessions (id, userId, expiresAt, createdAt)
              VALUES (?, ?, ?, ?)
            `).run(data.id, data.userId, data.expiresAt, data.createdAt || new Date().toISOString());
          } else if (meta.table_name === 'auth_groups') {
            mainDb.prepare(`
              INSERT OR IGNORE INTO groups (id, name, url, createdAt)
              VALUES (?, ?, ?, ?)
            `).run(data.id, data.name, data.url, data.createdAt || new Date().toISOString());
          } else if (meta.table_name === 'auth_memberships') {
            mainDb.prepare(`
              INSERT OR IGNORE INTO memberships (id, groupId, userId, role, createdAt)
              VALUES (?, ?, ?, ?, ?)
            `).run(data.id, data.groupId, data.userId, data.role || 'member', data.createdAt || new Date().toISOString());
          } else if (meta.table_name === 'auth_invitations') {
            mainDb.prepare(`
              INSERT OR IGNORE INTO invitations (id, code, groupId, createdBy, email, role, expiresAt, usedAt, acceptedAt, createdAt)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              data.id, data.code, data.groupId, data.createdBy, data.email, 
              data.role || 'member', data.expiresAt, data.usedAt, data.acceptedAt, 
              data.createdAt || new Date().toISOString()
            );
          } else if (meta.table_name === 'oauth_tokens') {
            // OAuth tokens need a userId - check if we have it
            if (data.userId) {
              mainDb.prepare(`
                INSERT OR IGNORE INTO oauth_tokens (provider, userId, accessToken, refreshToken, expiryDate, createdAt, updatedAt)
                VALUES (?, ?, ?, ?, ?, ?, ?)
              `).run(
                data.provider, data.userId, data.accessToken, data.refreshToken, 
                data.expiryDate, data.createdAt || new Date().toISOString(), 
                data.updatedAt || new Date().toISOString()
              );
            }
          }
          
          result.metadataMigrated++;
        } catch (parseError) {
          result.errors.push(`Failed to parse metadata ${meta.table_name}/${meta.id}: ${parseError}`);
        }
      }
    }
  } catch (e) {
    result.errors.push(`Failed to migrate metadata: ${e}`);
  }

  // Close databases
  oldDbConn.close();
  mainDb.close();

  // Rename old database to backup
  const backupPath = `${oldDb}.backup`;
  if (fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
  fs.renameSync(oldDb, backupPath);
  console.log(`[Migration] Renamed old database to ${backupPath}`);

  console.log('[Migration] Migration completed:', result);
  return result;
}

/**
 * Auto-run migration on server startup if needed
 */
export async function autoMigrate(dataDir: string): Promise<{ migrated: boolean; schema: 'legacy' | 'roles' }> {
  const oldDbPath = path.join(dataDir, 'metadata.db');
  const mainDbPath = path.join(dataDir, 'main.db');
  
  console.log('\n' + '='.repeat(60));
  console.log('[Migration] Database Schema Check');
  console.log('-'.repeat(60));
  console.log(`[Migration] Data directory: ${dataDir}`);
  console.log(`[Migration] Old database (metadata.db): ${fs.existsSync(oldDbPath) ? 'EXISTS' : 'NOT FOUND'}`);
  console.log(`[Migration] New database (main.db): ${fs.existsSync(mainDbPath) ? 'EXISTS' : 'NOT FOUND'}`);
  
  // Check if migration is needed
  if (fs.existsSync(oldDbPath) && !fs.existsSync(mainDbPath)) {
    console.log('[Migration] ⚠️  LEGACY SCHEMA DETECTED - Starting migration...');
    console.log('[Migration] Converting from legacy single-database to role-based architecture');
    
    const result = await migrateToRoleBasedStorage(dataDir, oldDbPath);
    
    console.log('-'.repeat(60));
    console.log('[Migration] Migration Results:');
    console.log(`[Migration]   Users created: ${result.usersCreated}`);
    console.log(`[Migration]   Roles created: ${result.rolesCreated}`);
    console.log(`[Migration]   Memories migrated: ${result.memoriesMigrated}`);
    console.log(`[Migration]   Messages migrated: ${result.messagesMigrated}`);
    console.log(`[Migration]   Settings migrated: ${result.settingsMigrated}`);
    console.log(`[Migration]   Metadata migrated: ${result.metadataMigrated}`);
    
    if (result.errors.length > 0) {
      console.log('[Migration] ❌ Errors occurred:');
      result.errors.forEach(err => console.log(`[Migration]   - ${err}`));
    } else {
      console.log('[Migration] ✅ Migration completed successfully');
    }
    
    console.log('='.repeat(60) + '\n');
    return { migrated: true, schema: 'roles' };
  } else if (fs.existsSync(oldDbPath) && fs.existsSync(`${oldDbPath}.backup`)) {
    // Old database exists but already backed up, safe to delete
    console.log('[Migration] Cleaning up old database file (backup exists)');
    fs.unlinkSync(oldDbPath);
    console.log('[Migration] ✅ Running on ROLE-BASED schema');
    
    // List existing role databases
    const roleDbs = fs.readdirSync(dataDir)
      .filter(f => f.startsWith('role_') && f.endsWith('.db'))
      .map(f => f.replace('role_', '').replace('.db', ''));
    
    if (roleDbs.length > 0) {
      console.log(`[Migration] Found ${roleDbs.length} role database(s): ${roleDbs.join(', ')}`);
    } else {
      console.log('[Migration] No role databases found. Create a role via API: POST /api/roles');
    }
    
    console.log('='.repeat(60) + '\n');
    return { migrated: false, schema: 'roles' };
  } else if (fs.existsSync(mainDbPath)) {
    // Main database exists - check if we need to create default roles
    console.log('[Migration] ✅ Running on ROLE-BASED schema');
    
    // Check if there are any roles in the database
    const mainDb = new Database(mainDbPath);
    let rolesCount = 0;
    let usersCount = 0;
    
    try {
      const rolesResult = mainDb.prepare('SELECT COUNT(*) as count FROM roles').get() as { count: number };
      rolesCount = rolesResult?.count || 0;
      
      const usersResult = mainDb.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
      usersCount = usersResult?.count || 0;
    } catch (e) {
      // Tables might not exist yet
    }
    
    mainDb.close();
    
    console.log(`[Migration] Database status: ${usersCount} users, ${rolesCount} roles`);
    
    // Check if old database still exists and has data that wasn't migrated
    if (fs.existsSync(oldDbPath) && usersCount === 0) {
      console.log('[Migration] ⚠️  Old database exists but main.db has no users - running migration...');
      const result = await migrateToRoleBasedStorage(dataDir, oldDbPath);
      
      console.log('-'.repeat(60));
      console.log('[Migration] Migration Results:');
      console.log(`[Migration]   Users created: ${result.usersCreated}`);
      console.log(`[Migration]   Roles created: ${result.rolesCreated}`);
      console.log(`[Migration]   Memories migrated: ${result.memoriesMigrated}`);
      console.log(`[Migration]   Messages migrated: ${result.messagesMigrated}`);
      console.log(`[Migration]   Settings migrated: ${result.settingsMigrated}`);
      console.log(`[Migration]   Metadata migrated: ${result.metadataMigrated}`);
      
      if (result.errors.length > 0) {
        console.log('[Migration] ❌ Errors occurred:');
        result.errors.forEach(err => console.log(`[Migration]   - ${err}`));
      } else {
        console.log('[Migration] ✅ Migration completed successfully');
      }
      
      console.log('='.repeat(60) + '\n');
      return { migrated: true, schema: 'roles' };
    }
    
    // If we have users but no roles, create default roles
    if (usersCount > 0 && rolesCount === 0) {
      console.log('[Migration] ⚠️  Users exist but no roles found - creating default roles...');
      await createDefaultRolesForExistingUsers(dataDir);
      console.log('[Migration] ✅ Default roles created');
    }
    
    // List existing role databases
    const roleDbs = fs.readdirSync(dataDir)
      .filter(f => f.startsWith('role_') && f.endsWith('.db'))
      .map(f => f.replace('role_', '').replace('.db', ''));
    
    if (roleDbs.length > 0) {
      console.log(`[Migration] Found ${roleDbs.length} role database(s): ${roleDbs.join(', ')}`);
    } else {
      console.log('[Migration] No role databases found. Create a role via API: POST /api/roles');
    }
    
    console.log('='.repeat(60) + '\n');
    return { migrated: false, schema: 'roles' };
  } else {
    console.log('[Migration] ✅ Fresh installation - will use ROLE-BASED schema');
    console.log('='.repeat(60) + '\n');
    return { migrated: false, schema: 'roles' };
  }
}

/**
 * Create default roles for existing users who don't have any roles
 */
async function createDefaultRolesForExistingUsers(dataDir: string): Promise<void> {
  const mainDbPath = path.join(dataDir, 'main.db');
  const mainDb = new Database(mainDbPath);
  
  // Get all users without roles
  const usersWithoutRoles = mainDb.prepare(`
    SELECT u.id, u.email, u.name 
    FROM users u 
    LEFT JOIN roles r ON u.id = r.userId 
    WHERE r.id IS NULL
  `).all() as Array<{ id: string; email: string; name: string | null }>;
  
  mainDb.close();
  
  for (const user of usersWithoutRoles) {
    const roleId = uuidv4();
    const now = new Date().toISOString();
    const roleName = 'Default';
    
    // Create role in main database
    const mainDb2 = new Database(mainDbPath);
    mainDb2.prepare(`
      INSERT INTO roles (id, userId, name, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(roleId, user.id, roleName, now, now);
    mainDb2.close();
    
    // Create role database
    const roleDbPath = path.join(dataDir, `role_${roleId}.db`);
    const roleDb = new Database(roleDbPath);
    
    roleDb.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        roleId TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        metadata TEXT,
        createdAt TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        roleId TEXT NOT NULL,
        groupId TEXT,
        userId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        transport TEXT NOT NULL,
        command TEXT,
        args TEXT,
        cwd TEXT,
        url TEXT,
        enabled INTEGER DEFAULT 1,
        autoStart INTEGER DEFAULT 0,
        restartOnExit INTEGER DEFAULT 0,
        auth TEXT,
        env TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        provider TEXT PRIMARY KEY,
        accessToken TEXT NOT NULL,
        refreshToken TEXT,
        expiryDate INTEGER,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS metadata (
        table_name TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (table_name, id)
      );
    `);
    
    roleDb.close();
    
    console.log(`[Migration] Created default role ${roleId} for user ${user.email}`);
  }
}
