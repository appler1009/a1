import { Database } from 'bun:sqlite';
import type { User, Session, Group, GroupMember, Invitation } from '@local-agent/shared';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs';
import type { IMainDatabase, TokenUsageRecord } from './main-db-interface.js';
import { encryptToken, decryptToken } from '../config/kms.js';

/**
 * Role definition stored in the main database
 */
export interface RoleDefinition {
  id: string;
  userId: string;
  groupId: string | null;
  name: string;
  jobDesc: string | null;
  systemPrompt: string | null;
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * OAuth token stored in main database (user-level)
 * Each user can have multiple OAuth tokens for the same provider (e.g., multiple Google accounts)
 */
export interface OAuthTokenEntry {
  provider: string;
  userId: string;
  accountEmail: string;
  accessToken: string;
  refreshToken: string | null;
  expiryDate: number | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Credit ledger entry — one row per credit or debit event.
 * amountUsd is always positive; type distinguishes credits from debits.
 */
export interface CreditLedgerEntry {
  id: string;
  userId: string;
  type: 'topup' | 'usage';
  amountUsd: number;          // absolute value — always > 0
  balanceAfter: number;       // snapshot of balance after this entry
  description: string;        // human-readable label
  stripePaymentIntentId?: string;   // set for topup entries
  model?: string;             // set for usage entries
  createdAt: Date;
}

/**
 * Stripe payment record
 */
export interface StripePayment {
  id: string;
  userId: string;
  stripePaymentIntentId: string;
  amountUsd: number;
  status: 'pending' | 'succeeded' | 'failed';
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Skill record stored in the skills table
 */
export interface SkillRecord {
  id: string;
  name: string;
  description?: string;
  content: string;
  type: string;
  config?: Record<string, unknown>;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Scheduled job stored in the main database
 */
export interface ScheduledJob {
  id: string;
  userId: string;
  roleId: string;
  description: string;
  scheduleType: 'once' | 'recurring';
  runAt: Date | null;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  lastRunAt: Date | null;
  lastError: string | null;
  holdUntil: Date | null;
  runCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Magic link token for email authentication
 */
export interface MagicLinkToken {
  id: string;
  email: string;
  userId: string;
  token: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

/**
 * Main database schema for user registration and role mapping
 * This is the central database that maps users to their roles
 * Each role has its own separate SQLite database for complete isolation
 */
export class MainDatabase implements IMainDatabase {
  private db: Database;
  private dbPath: string;

  constructor(dataDir: string) {
    // Ensure data directory exists
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.dbPath = path.join(dataDir, 'main.db');
    this.db = new Database(this.dbPath);
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      -- Users table
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        accountType TEXT DEFAULT 'individual',
        discordUserId TEXT,
        emailDisabled TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

      -- Sessions table
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        expiresAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);

      -- Groups table
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        url TEXT,
        createdAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_groups_url ON groups(url);

      -- Group memberships table
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

      -- Invitations table
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

      -- Roles table (maps users to their role databases)
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

      -- OAuth tokens table (user-level tokens, supports multiple accounts per provider)
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        userId TEXT NOT NULL,
        accountEmail TEXT NOT NULL,
        accessToken TEXT NOT NULL,
        refreshToken TEXT,
        expiryDate INTEGER,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(provider, userId, accountEmail)
      );

      CREATE INDEX IF NOT EXISTS idx_oauth_user ON oauth_tokens(userId);
      CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_tokens(provider);

      -- Generic service credentials table
      -- Stores credentials for any service (SMTP/IMAP, API keys with server config, etc.)
      -- credentialsJson is a JSON object; sensitive string fields (password, secret, token, key)
      -- are individually KMS-encrypted with the kms:v1: prefix so non-sensitive fields remain readable.
      CREATE TABLE IF NOT EXISTS service_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        userId TEXT NOT NULL,
        service TEXT NOT NULL,
        accountEmail TEXT NOT NULL,
        credentialsJson TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE(userId, service, accountEmail)
      );

      CREATE INDEX IF NOT EXISTS idx_svcred_user ON service_credentials(userId);
      CREATE INDEX IF NOT EXISTS idx_svcred_service ON service_credentials(service);

      -- MCP Servers table (persisted server configs)
      CREATE TABLE IF NOT EXISTS mcp_servers (
        id TEXT PRIMARY KEY,
        config TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      -- Chat messages table (moved from per-role SQLite DBs)
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        roleId TEXT NOT NULL,
        groupId TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(roleId, createdAt);

      -- Application settings table (global key-value)
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      -- Skills table (text documentation for AI capabilities / MCP tools)
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'mcp-in-process',
        config TEXT,
        enabled INTEGER DEFAULT 1,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );

      -- Scheduled jobs table
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        roleId TEXT NOT NULL,
        description TEXT NOT NULL,
        scheduleType TEXT NOT NULL CHECK (scheduleType IN ('once', 'recurring')),
        runAt TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
        lastRunAt TEXT,
        lastError TEXT,
        holdUntil TEXT,
        runCount INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_user ON scheduled_jobs(userId, status);
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_once ON scheduled_jobs(runAt, status);

      -- Magic link tokens table (for email magic-link authentication)
      CREATE TABLE IF NOT EXISTS magic_link_tokens (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        userId TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        expiresAt TEXT NOT NULL,
        usedAt TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_magic_link_token ON magic_link_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_magic_link_email ON magic_link_tokens(email);

      -- Token usage tracking table
      CREATE TABLE IF NOT EXISTS token_usage (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        promptTokens INTEGER NOT NULL DEFAULT 0,
        completionTokens INTEGER NOT NULL DEFAULT 0,
        totalTokens INTEGER NOT NULL DEFAULT 0,
        cachedInputTokens INTEGER NOT NULL DEFAULT 0,
        cacheCreationTokens INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL DEFAULT 'chat',
        createdAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_token_usage_user ON token_usage(userId, createdAt);

      -- Stripe payments table (one row per PaymentIntent)
      CREATE TABLE IF NOT EXISTS stripe_payments (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        stripePaymentIntentId TEXT UNIQUE NOT NULL,
        amountUsd REAL NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_stripe_payments_user ON stripe_payments(userId, createdAt);
      CREATE INDEX IF NOT EXISTS idx_stripe_payments_intent ON stripe_payments(stripePaymentIntentId);

      -- Credit ledger: one row per credit (topup) or debit (usage).
      -- Provides a full audit trail; balance on the users row is a denormalised cache.
      CREATE TABLE IF NOT EXISTS credit_ledger (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('topup', 'usage')),
        amountUsd REAL NOT NULL,
        balanceAfter REAL NOT NULL,
        description TEXT NOT NULL,
        stripePaymentIntentId TEXT,
        model TEXT,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger(userId, createdAt);
    `);

    // Migrate old MCP server IDs to new package names
    this.migrateMCPServerIds();

    // Migrate oauth_tokens table to add accountEmail column if needed
    this.migrateOAuthTokensSchema();

    // Migrate users table to add discordUserId column if needed
    this.migrateDiscordUserIdSchema();

    // Migrate users table to add telegramUserId column if needed
    this.migrateTelegramUserIdSchema();

    // Migrate users table to add whatsappUserId column if needed
    this.migrateWhatsAppUserIdSchema();

    // Migrate users table to add locale and timezone columns if needed
    this.migrateLocaleTimezoneSchema();

    // Migrate users table to add monthlySpendLimitUsd column if needed
    this.migrateMonthlySpendLimitSchema();

    // Migrate scheduled_jobs table to add holdUntil column if needed
    this.migrateScheduledJobsHoldUntil();

    // Migrate users table to add creditBalanceUsd column if needed
    this.migrateCreditBalanceSchema();

    // Migrate users table to add emailDisabled column if needed
    this.migrateEmailDisabledSchema();

    // Migrate users table to add primaryRoleId column if needed
    this.migratePrimaryRoleIdSchema();

    // Migrate users table to add sandboxUser column if needed
    this.migrateUseTestStripeSchema();
  }

  /**
   * Add accountEmail column to oauth_tokens table if it doesn't exist
   * This handles existing databases that don't have the column yet
   */
  private migrateOAuthTokensSchema(): void {
    try {
      // Check if accountEmail column exists
      const tableInfo = this.db.prepare(`PRAGMA table_info(oauth_tokens)`).all() as Array<{
        name: string;
        type: string;
      }>;

      const hasAccountEmail = tableInfo.some(col => col.name === 'accountEmail');

      if (!hasAccountEmail) {
        console.log('[MainDatabase] Adding accountEmail column to oauth_tokens table...');
        this.db.exec(`
          ALTER TABLE oauth_tokens ADD COLUMN accountEmail TEXT NOT NULL DEFAULT '';
        `);
        console.log('[MainDatabase] accountEmail column added successfully');

        // Update UNIQUE constraint by recreating the table
        this.db.exec(`
          PRAGMA foreign_keys=OFF;

          -- Create new table with correct schema
          CREATE TABLE oauth_tokens_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            userId TEXT NOT NULL,
            accountEmail TEXT NOT NULL,
            accessToken TEXT NOT NULL,
            refreshToken TEXT,
            expiryDate INTEGER,
            createdAt TEXT NOT NULL,
            updatedAt TEXT NOT NULL,
            FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE,
            UNIQUE(provider, userId, accountEmail)
          );

          -- Copy data from old table
          INSERT INTO oauth_tokens_new SELECT * FROM oauth_tokens;

          -- Drop old table
          DROP TABLE oauth_tokens;

          -- Rename new table
          ALTER TABLE oauth_tokens_new RENAME TO oauth_tokens;

          -- Recreate indices
          CREATE INDEX idx_oauth_user ON oauth_tokens(userId);
          CREATE INDEX idx_oauth_provider ON oauth_tokens(provider);

          PRAGMA foreign_keys=ON;
        `);
        console.log('[MainDatabase] oauth_tokens schema migration completed');
      }
    } catch (error) {
      console.warn('[MainDatabase] Error during oauth_tokens schema migration:', error);
      // Don't fail initialization if migration fails - the token migration will handle missing data
    }
  }

  /**
   * Add discordUserId column to users table if it doesn't exist
   * This handles existing databases that don't have the column yet
   */
  private migrateDiscordUserIdSchema(): void {
    try {
      // Check if discordUserId column exists
      const tableInfo = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{
        name: string;
        type: string;
      }>;

      const hasDiscordUserId = tableInfo.some(col => col.name === 'discordUserId');

      if (!hasDiscordUserId) {
        console.log('[MainDatabase] Adding discordUserId column to users table...');
        this.db.exec(`
          ALTER TABLE users ADD COLUMN discordUserId TEXT;
        `);
        console.log('[MainDatabase] discordUserId column added successfully');
      }
    } catch (error) {
      console.warn('[MainDatabase] Error during discordUserId schema migration:', error);
      // Don't fail initialization if migration fails
    }
  }

  /**
   * Add whatsappUserId column to users table if it doesn't exist
   */
  private migrateWhatsAppUserIdSchema(): void {
    try {
      const tableInfo = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{
        name: string;
        type: string;
      }>;
      if (!tableInfo.some(col => col.name === 'whatsappUserId')) {
        console.log('[MainDatabase] Adding whatsappUserId column to users table...');
        this.db.exec(`ALTER TABLE users ADD COLUMN whatsappUserId TEXT;`);
        console.log('[MainDatabase] whatsappUserId column added successfully');
      }
    } catch (error) {
      console.warn('[MainDatabase] Error during whatsappUserId schema migration:', error);
    }
  }

  /**
   * Add telegramUserId column to users table if it doesn't exist
   */
  private migrateTelegramUserIdSchema(): void {
    try {
      const tableInfo = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{
        name: string;
        type: string;
      }>;
      if (!tableInfo.some(col => col.name === 'telegramUserId')) {
        console.log('[MainDatabase] Adding telegramUserId column to users table...');
        this.db.exec(`ALTER TABLE users ADD COLUMN telegramUserId TEXT;`);
        console.log('[MainDatabase] telegramUserId column added successfully');
      }
    } catch (error) {
      console.warn('[MainDatabase] Error during telegramUserId schema migration:', error);
    }
  }

  /**
   * Add locale and timezone columns to users table if they don't exist
   */
  private migrateLocaleTimezoneSchema(): void {
    try {
      const tableInfo = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{
        name: string;
        type: string;
      }>;

      const hasLocale = tableInfo.some(col => col.name === 'locale');
      const hasTimezone = tableInfo.some(col => col.name === 'timezone');

      if (!hasLocale) {
        console.log('[MainDatabase] Adding locale column to users table...');
        this.db.exec(`ALTER TABLE users ADD COLUMN locale TEXT;`);
        console.log('[MainDatabase] locale column added successfully');
      }
      if (!hasTimezone) {
        console.log('[MainDatabase] Adding timezone column to users table...');
        this.db.exec(`ALTER TABLE users ADD COLUMN timezone TEXT;`);
        console.log('[MainDatabase] timezone column added successfully');
      }
    } catch (error) {
      console.warn('[MainDatabase] Error during locale/timezone schema migration:', error);
    }
  }

  private migrateMonthlySpendLimitSchema(): void {
    try {
      const tableInfo = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
      const hasCol = tableInfo.some(col => col.name === 'monthlySpendLimitUsd');
      if (!hasCol) {
        console.log('[MainDatabase] Adding monthlySpendLimitUsd column to users table...');
        this.db.exec(`ALTER TABLE users ADD COLUMN monthlySpendLimitUsd REAL;`);
        console.log('[MainDatabase] monthlySpendLimitUsd column added successfully');
      }
    } catch (error) {
      console.warn('[MainDatabase] Error during monthlySpendLimitUsd schema migration:', error);
    }
  }

  private migrateScheduledJobsHoldUntil(): void {
    try {
      const tableInfo = this.db.prepare(`PRAGMA table_info(scheduled_jobs)`).all() as Array<{ name: string }>;
      const hasHoldUntil = tableInfo.some(col => col.name === 'holdUntil');
      if (!hasHoldUntil) {
        console.log('[MainDatabase] Adding holdUntil column to scheduled_jobs table...');
        this.db.exec(`ALTER TABLE scheduled_jobs ADD COLUMN holdUntil TEXT;`);
        console.log('[MainDatabase] holdUntil column added successfully');
      }
    } catch (error) {
      console.warn('[MainDatabase] Error during scheduled_jobs holdUntil migration:', error);
    }
  }

  private migrateCreditBalanceSchema(): void {
    try {
      const tableInfo = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
      const hasCol = tableInfo.some(col => col.name === 'creditBalanceUsd');
      if (!hasCol) {
        console.log('[MainDatabase] Adding creditBalanceUsd column to users table...');
        this.db.exec(`ALTER TABLE users ADD COLUMN creditBalanceUsd REAL NOT NULL DEFAULT 0;`);
        console.log('[MainDatabase] creditBalanceUsd column added successfully');
      }
    } catch (error) {
      console.warn('[MainDatabase] Error during creditBalanceUsd schema migration:', error);
    }
  }

  private migrateEmailDisabledSchema(): void {
    try {
      const tableInfo = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
      const hasCol = tableInfo.some(col => col.name === 'emailDisabled');
      if (!hasCol) {
        console.log('[MainDatabase] Adding emailDisabled column to users table...');
        this.db.exec(`ALTER TABLE users ADD COLUMN emailDisabled TEXT;`);
        console.log('[MainDatabase] emailDisabled column added successfully');
      }
    } catch (error) {
      console.warn('[MainDatabase] Error during emailDisabled schema migration:', error);
    }
  }

  private migrateUseTestStripeSchema(): void {
    try {
      const tableInfo = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
      const hasCol = tableInfo.some(col => col.name === 'sandboxUser');
      if (!hasCol) {
        console.log('[MainDatabase] Adding sandboxUser column to users table...');
        this.db.exec(`ALTER TABLE users ADD COLUMN sandboxUser INTEGER NOT NULL DEFAULT 0;`);
        console.log('[MainDatabase] sandboxUser column added successfully');
      }
    } catch (error) {
      console.warn('[MainDatabase] Error during sandboxUser schema migration:', error);
    }
  }

  private migratePrimaryRoleIdSchema(): void {
    try {
      const tableInfo = this.db.prepare(`PRAGMA table_info(users)`).all() as Array<{ name: string }>;
      const hasCol = tableInfo.some(col => col.name === 'primaryRoleId');
      if (!hasCol) {
        console.log('[MainDatabase] Adding primaryRoleId column to users table...');
        this.db.exec(`ALTER TABLE users ADD COLUMN primaryRoleId TEXT;`);
        console.log('[MainDatabase] primaryRoleId column added successfully');
      }
    } catch (error) {
      console.warn('[MainDatabase] Error during primaryRoleId schema migration:', error);
    }
  }

  close(): void {
    this.db.close();
  }

  // ============================================
  // User Operations
  // ============================================

  async createUser(email: string, name?: string, accountType: 'individual' | 'group' = 'individual'): Promise<User> {
    const id = uuidv4();
    const now = new Date().toISOString();
    
    this.db.prepare(`
      INSERT INTO users (id, email, name, accountType, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, email, name || null, accountType, now, now);

    return {
      id,
      email,
      name,
      accountType,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  async getUser(id: string): Promise<User | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as {
      id: string;
      email: string;
      name: string | null;
      accountType: 'individual' | 'group';
      discordUserId: string | null;
      telegramUserId: string | null;
      locale: string | null;
      timezone: string | null;
      creditBalanceUsd: number;
      primaryRoleId: string | null;
      emailDisabled: string | null;
      createdAt: string;
      updatedAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name || undefined,
      accountType: row.accountType,
      discordUserId: row.discordUserId || undefined,
      telegramUserId: row.telegramUserId || undefined,
      whatsappUserId: (row as any).whatsappUserId || undefined,
      locale: row.locale || undefined,
      timezone: row.timezone || undefined,
      creditBalanceUsd: row.creditBalanceUsd ?? 0,
      primaryRoleId: row.primaryRoleId || undefined,
      emailDisabled: (row.emailDisabled as 'bounce' | 'complaint' | null) || undefined,
      sandboxUser: Boolean((row as any).sandboxUser) || undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE email = ?').get(email) as {
      id: string;
      email: string;
      name: string | null;
      accountType: 'individual' | 'group';
      discordUserId: string | null;
      telegramUserId: string | null;
      locale: string | null;
      timezone: string | null;
      creditBalanceUsd: number;
      emailDisabled: string | null;
      createdAt: string;
      updatedAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name || undefined,
      accountType: row.accountType,
      discordUserId: row.discordUserId || undefined,
      telegramUserId: row.telegramUserId || undefined,
      whatsappUserId: (row as any).whatsappUserId || undefined,
      locale: row.locale || undefined,
      timezone: row.timezone || undefined,
      creditBalanceUsd: row.creditBalanceUsd ?? 0,
      emailDisabled: (row.emailDisabled as 'bounce' | 'complaint' | null) || undefined,
      sandboxUser: Boolean((row as any).sandboxUser) || undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async getUserByDiscordId(discordUserId: string): Promise<User | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE discordUserId = ?').get(discordUserId) as {
      id: string;
      email: string;
      name: string | null;
      accountType: 'individual' | 'group';
      discordUserId: string | null;
      telegramUserId: string | null;
      locale: string | null;
      timezone: string | null;
      creditBalanceUsd: number;
      emailDisabled: string | null;
      createdAt: string;
      updatedAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name || undefined,
      accountType: row.accountType,
      discordUserId: row.discordUserId || undefined,
      telegramUserId: row.telegramUserId || undefined,
      whatsappUserId: (row as any).whatsappUserId || undefined,
      locale: row.locale || undefined,
      timezone: row.timezone || undefined,
      creditBalanceUsd: row.creditBalanceUsd ?? 0,
      emailDisabled: (row.emailDisabled as 'bounce' | 'complaint' | null) || undefined,
      sandboxUser: Boolean((row as any).sandboxUser) || undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async getUserByTelegramId(telegramUserId: string): Promise<User | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE telegramUserId = ?').get(telegramUserId) as {
      id: string;
      email: string;
      name: string | null;
      accountType: 'individual' | 'group';
      discordUserId: string | null;
      telegramUserId: string | null;
      locale: string | null;
      timezone: string | null;
      creditBalanceUsd: number;
      emailDisabled: string | null;
      createdAt: string;
      updatedAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name || undefined,
      accountType: row.accountType,
      discordUserId: row.discordUserId || undefined,
      telegramUserId: row.telegramUserId || undefined,
      whatsappUserId: (row as any).whatsappUserId || undefined,
      locale: row.locale || undefined,
      timezone: row.timezone || undefined,
      creditBalanceUsd: row.creditBalanceUsd ?? 0,
      emailDisabled: (row.emailDisabled as 'bounce' | 'complaint' | null) || undefined,
      sandboxUser: Boolean((row as any).sandboxUser) || undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async getUserByWhatsAppId(whatsappUserId: string): Promise<User | null> {
    const row = this.db.prepare('SELECT * FROM users WHERE whatsappUserId = ?').get(whatsappUserId) as {
      id: string;
      email: string;
      name: string | null;
      accountType: 'individual' | 'group';
      discordUserId: string | null;
      telegramUserId: string | null;
      locale: string | null;
      timezone: string | null;
      creditBalanceUsd: number;
      emailDisabled: string | null;
      createdAt: string;
      updatedAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name || undefined,
      accountType: row.accountType,
      discordUserId: row.discordUserId || undefined,
      telegramUserId: row.telegramUserId || undefined,
      whatsappUserId: (row as any).whatsappUserId || undefined,
      locale: row.locale || undefined,
      timezone: row.timezone || undefined,
      creditBalanceUsd: row.creditBalanceUsd ?? 0,
      emailDisabled: (row.emailDisabled as 'bounce' | 'complaint' | null) || undefined,
      sandboxUser: Boolean((row as any).sandboxUser) || undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    const user = await this.getUser(id);
    if (!user) return null;

    const now = new Date().toISOString();
    const fields: string[] = ['updatedAt = ?'];
    const values: (string | number | null)[] = [now];

    if (updates.email !== undefined) {
      fields.push('email = ?');
      values.push(updates.email);
    }
    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name || null);
    }
    if (updates.accountType !== undefined) {
      fields.push('accountType = ?');
      values.push(updates.accountType);
    }
    if (updates.discordUserId !== undefined) {
      fields.push('discordUserId = ?');
      values.push(updates.discordUserId || null);
    }
    if (updates.telegramUserId !== undefined) {
      fields.push('telegramUserId = ?');
      values.push(updates.telegramUserId || null);
    }
    if ((updates as any).whatsappUserId !== undefined) {
      fields.push('whatsappUserId = ?');
      values.push((updates as any).whatsappUserId || null);
    }
    if (updates.locale !== undefined) {
      fields.push('locale = ?');
      values.push(updates.locale || null);
    }
    if (updates.timezone !== undefined) {
      fields.push('timezone = ?');
      values.push(updates.timezone || null);
    }
    if (updates.emailDisabled !== undefined) {
      fields.push('emailDisabled = ?');
      values.push(updates.emailDisabled ?? null);
    }
    if (updates.primaryRoleId !== undefined) {
      fields.push('primaryRoleId = ?');
      values.push(updates.primaryRoleId || null);
    }
    if ((updates as any).sandboxUser !== undefined) {
      fields.push('sandboxUser = ?');
      values.push((updates as any).sandboxUser ? 1 : 0);
    }

    values.push(id);

    this.db.prepare(`
      UPDATE users SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return this.getUser(id);
  }

  async disableEmailAddress(email: string, reason: 'bounce' | 'complaint'): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE users SET emailDisabled = ?, updatedAt = ? WHERE email = ?
    `).run(reason, now, email);
    console.log(`[MainDatabase] emailDisabled=${reason} set for ${email}`);
  }

  async getAllUsers(): Promise<User[]> {
    const rows = this.db.prepare('SELECT * FROM users').all() as Array<{
      id: string;
      email: string;
      name: string | null;
      accountType: 'individual' | 'group';
      discordUserId: string | null;
      telegramUserId: string | null;
      locale: string | null;
      timezone: string | null;
      creditBalanceUsd: number;
      emailDisabled: string | null;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name || undefined,
      accountType: row.accountType,
      discordUserId: row.discordUserId || undefined,
      telegramUserId: row.telegramUserId || undefined,
      whatsappUserId: (row as any).whatsappUserId || undefined,
      locale: row.locale || undefined,
      timezone: row.timezone || undefined,
      creditBalanceUsd: row.creditBalanceUsd ?? 0,
      emailDisabled: (row.emailDisabled as 'bounce' | 'complaint' | null) || undefined,
      sandboxUser: Boolean((row as any).sandboxUser) || undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  // ============================================
  // Session Operations
  // ============================================

  async createSession(userId: string): Promise<Session> {
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO sessions (id, userId, expiresAt, createdAt)
      VALUES (?, ?, ?, ?)
    `).run(id, userId, expiresAt.toISOString(), now);

    return {
      id,
      userId,
      expiresAt,
      createdAt: new Date(now),
    };
  }

  async getSession(id: string): Promise<Session | null> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as {
      id: string;
      userId: string;
      expiresAt: string;
      createdAt: string;
    } | undefined;

    if (!row) return null;

    const expiresAt = new Date(row.expiresAt);
    if (expiresAt < new Date()) {
      this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
      return null;
    }

    return {
      id: row.id,
      userId: row.userId,
      expiresAt,
      createdAt: new Date(row.createdAt),
    };
  }

  async deleteSession(id: string): Promise<void> {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  async deleteUser(id: string): Promise<boolean> {
    // Messages don't have ON DELETE CASCADE, so delete explicitly
    this.db.prepare('DELETE FROM messages WHERE userId = ?').run(id);
    // Remaining tables (sessions, roles, oauth_tokens, memberships) cascade automatically
    const result = this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ============================================
  // Group Operations
  // ============================================

  async createGroup(name: string, url?: string): Promise<Group> {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO groups (id, name, url, createdAt)
      VALUES (?, ?, ?, ?)
    `).run(id, name, url || null, now);

    return {
      id,
      name,
      url,
      createdAt: new Date(now),
    };
  }

  async getGroup(id: string): Promise<Group | null> {
    const row = this.db.prepare('SELECT * FROM groups WHERE id = ?').get(id) as {
      id: string;
      name: string;
      url: string | null;
      createdAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      url: row.url || undefined,
      createdAt: new Date(row.createdAt),
    };
  }

  async getGroupByUrl(url: string): Promise<Group | null> {
    const row = this.db.prepare('SELECT * FROM groups WHERE url = ?').get(url) as {
      id: string;
      name: string;
      url: string | null;
      createdAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      url: row.url || undefined,
      createdAt: new Date(row.createdAt),
    };
  }

  async getUserGroups(userId: string): Promise<Group[]> {
    const rows = this.db.prepare(`
      SELECT g.* FROM groups g
      JOIN memberships m ON g.id = m.groupId
      WHERE m.userId = ?
    `).all(userId) as Array<{
      id: string;
      name: string;
      url: string | null;
      createdAt: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      url: row.url || undefined,
      createdAt: new Date(row.createdAt),
    }));
  }

  // ============================================
  // Membership Operations
  // ============================================

  async addMember(groupId: string, userId: string, role: 'owner' | 'admin' | 'member' = 'member'): Promise<GroupMember> {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT OR REPLACE INTO memberships (id, groupId, userId, role, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, groupId, userId, role, now);

    return {
      id,
      groupId,
      userId,
      role,
      createdAt: new Date(now),
    };
  }

  async getMembership(groupId: string, userId: string): Promise<GroupMember | null> {
    const row = this.db.prepare(`
      SELECT * FROM memberships WHERE groupId = ? AND userId = ?
    `).get(groupId, userId) as {
      id: string;
      groupId: string;
      userId: string;
      role: 'owner' | 'admin' | 'member';
      createdAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      groupId: row.groupId,
      userId: row.userId,
      role: row.role,
      createdAt: new Date(row.createdAt),
    };
  }

  async getGroupMembers(groupId: string): Promise<GroupMember[]> {
    const rows = this.db.prepare(`
      SELECT * FROM memberships WHERE groupId = ?
    `).all(groupId) as Array<{
      id: string;
      groupId: string;
      userId: string;
      role: 'owner' | 'admin' | 'member';
      createdAt: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      groupId: row.groupId,
      userId: row.userId,
      role: row.role,
      createdAt: new Date(row.createdAt),
    }));
  }

  async updateMemberRole(groupId: string, userId: string, role: 'owner' | 'admin' | 'member'): Promise<GroupMember | null> {
    const now = new Date().toISOString();

    const result = this.db.prepare(`
      UPDATE memberships SET role = ? WHERE groupId = ? AND userId = ?
    `).run(role, groupId, userId);

    if (result.changes === 0) return null;

    return this.getMembership(groupId, userId);
  }

  async removeMember(groupId: string, userId: string): Promise<boolean> {
    const result = this.db.prepare(`
      DELETE FROM memberships WHERE groupId = ? AND userId = ?
    `).run(groupId, userId);

    return result.changes > 0;
  }

  // ============================================
  // Invitation Operations
  // ============================================

  async createInvitation(
    groupId: string,
    createdBy: string,
    email?: string,
    role: 'owner' | 'admin' | 'member' = 'member',
    expiresInSeconds: number = 7 * 24 * 60 * 60
  ): Promise<Invitation> {
    const id = uuidv4();
    const code = this.generateInviteCode();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();

    this.db.prepare(`
      INSERT INTO invitations (id, code, groupId, createdBy, email, role, expiresAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, code, groupId, createdBy, email || null, role, expiresAt, now);

    return {
      id,
      code,
      groupId,
      createdBy,
      email,
      role,
      expiresAt: new Date(expiresAt),
      createdAt: new Date(now),
    };
  }

  async getInvitationByCode(code: string): Promise<Invitation | null> {
    const row = this.db.prepare('SELECT * FROM invitations WHERE code = ?').get(code) as {
      id: string;
      code: string;
      groupId: string;
      createdBy: string;
      email: string | null;
      role: 'owner' | 'admin' | 'member';
      expiresAt: string | null;
      usedAt: string | null;
      acceptedAt: string | null;
      createdAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      code: row.code,
      groupId: row.groupId,
      createdBy: row.createdBy,
      email: row.email || undefined,
      role: row.role,
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
      usedAt: row.usedAt ? new Date(row.usedAt) : undefined,
      acceptedAt: row.acceptedAt ? new Date(row.acceptedAt) : undefined,
      createdAt: new Date(row.createdAt),
    };
  }

  async getGroupInvitations(groupId: string): Promise<Invitation[]> {
    const rows = this.db.prepare(`
      SELECT * FROM invitations WHERE groupId = ? AND usedAt IS NULL
    `).all(groupId) as Array<{
      id: string;
      code: string;
      groupId: string;
      createdBy: string;
      email: string | null;
      role: 'owner' | 'admin' | 'member';
      expiresAt: string | null;
      usedAt: string | null;
      acceptedAt: string | null;
      createdAt: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      code: row.code,
      groupId: row.groupId,
      createdBy: row.createdBy,
      email: row.email || undefined,
      role: row.role,
      expiresAt: row.expiresAt ? new Date(row.expiresAt) : undefined,
      usedAt: row.usedAt ? new Date(row.usedAt) : undefined,
      acceptedAt: row.acceptedAt ? new Date(row.acceptedAt) : undefined,
      createdAt: new Date(row.createdAt),
    }));
  }

  async acceptInvitation(code: string, userId: string): Promise<GroupMember> {
    const invitation = await this.getInvitationByCode(code);
    if (!invitation) {
      throw new Error('Invitation not found');
    }

    if (invitation.usedAt) {
      throw new Error('Invitation already used');
    }

    if (invitation.expiresAt && invitation.expiresAt < new Date()) {
      throw new Error('Invitation expired');
    }

    const now = new Date().toISOString();
    
    this.db.prepare(`
      UPDATE invitations SET usedAt = ?, acceptedAt = ? WHERE id = ?
    `).run(now, now, invitation.id);

    const membership = await this.addMember(invitation.groupId, userId, invitation.role || 'member');
    await this.updateUser(userId, { accountType: 'group' });

    return membership;
  }

  async revokeInvitation(invitationId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM invitations WHERE id = ?').run(invitationId);
    return result.changes > 0;
  }

  private generateInviteCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // ============================================
  // Role Operations
  // ============================================

  async createRole(
    userId: string,
    name: string,
    groupId?: string,
    jobDesc?: string,
    systemPrompt?: string,
    model?: string
  ): Promise<RoleDefinition> {
    const id = uuidv4();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO roles (id, userId, groupId, name, jobDesc, systemPrompt, model, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, groupId || null, name, jobDesc || null, systemPrompt || null, model || null, now, now);

    return {
      id,
      userId,
      groupId: groupId || null,
      name,
      jobDesc: jobDesc || null,
      systemPrompt: systemPrompt || null,
      model: model || null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  async getRole(id: string): Promise<RoleDefinition | null> {
    const row = this.db.prepare('SELECT * FROM roles WHERE id = ?').get(id) as {
      id: string;
      userId: string;
      groupId: string | null;
      name: string;
      jobDesc: string | null;
      systemPrompt: string | null;
      model: string | null;
      createdAt: string;
      updatedAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      userId: row.userId,
      groupId: row.groupId,
      name: row.name,
      jobDesc: row.jobDesc,
      systemPrompt: row.systemPrompt,
      model: row.model,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async getUserRoles(userId: string): Promise<RoleDefinition[]> {
    const rows = this.db.prepare('SELECT * FROM roles WHERE userId = ?').all(userId) as Array<{
      id: string;
      userId: string;
      groupId: string | null;
      name: string;
      jobDesc: string | null;
      systemPrompt: string | null;
      model: string | null;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      userId: row.userId,
      groupId: row.groupId,
      name: row.name,
      jobDesc: row.jobDesc,
      systemPrompt: row.systemPrompt,
      model: row.model,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  async getGroupRoles(groupId: string): Promise<RoleDefinition[]> {
    const rows = this.db.prepare('SELECT * FROM roles WHERE groupId = ?').all(groupId) as Array<{
      id: string;
      userId: string;
      groupId: string | null;
      name: string;
      jobDesc: string | null;
      systemPrompt: string | null;
      model: string | null;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      userId: row.userId,
      groupId: row.groupId,
      name: row.name,
      jobDesc: row.jobDesc,
      systemPrompt: row.systemPrompt,
      model: row.model,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  async updateRole(id: string, updates: Partial<Omit<RoleDefinition, 'id' | 'userId' | 'createdAt'>>): Promise<RoleDefinition | null> {
    const role = await this.getRole(id);
    if (!role) return null;

    const now = new Date().toISOString();
    const fields: string[] = ['updatedAt = ?'];
    const values: (string | null)[] = [now];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.groupId !== undefined) {
      fields.push('groupId = ?');
      values.push(updates.groupId);
    }
    if (updates.jobDesc !== undefined) {
      fields.push('jobDesc = ?');
      values.push(updates.jobDesc || null);
    }
    if (updates.systemPrompt !== undefined) {
      fields.push('systemPrompt = ?');
      values.push(updates.systemPrompt || null);
    }
    if (updates.model !== undefined) {
      fields.push('model = ?');
      values.push(updates.model || null);
    }

    values.push(id);

    this.db.prepare(`
      UPDATE roles SET ${fields.join(', ')} WHERE id = ?
    `).run(...values);

    return this.getRole(id);
  }

  async deleteRole(id: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM roles WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ============================================
  // OAuth Token Operations
  // ============================================

  async storeOAuthToken(
    userId: string,
    provider: string,
    accessToken: string,
    refreshToken?: string,
    expiryDate?: number,
    accountEmail: string = ''
  ): Promise<OAuthTokenEntry> {
    const now = new Date().toISOString();

    const encryptedAccessToken = await encryptToken(accessToken);
    const encryptedRefreshToken = refreshToken ? await encryptToken(refreshToken) : null;

    // If email is empty and we're storing a new token, delete old empty-email tokens first
    // This ensures we don't get stuck with stale empty-email entries
    if (!accountEmail) {
      this.db.prepare(`
        DELETE FROM oauth_tokens WHERE provider = ? AND userId = ? AND accountEmail = ''
      `).run(provider, userId);
    }

    this.db.prepare(`
      INSERT OR REPLACE INTO oauth_tokens (provider, userId, accountEmail, accessToken, refreshToken, expiryDate, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, COALESCE((SELECT createdAt FROM oauth_tokens WHERE provider = ? AND userId = ? AND accountEmail = ?), ?), ?)
    `).run(provider, userId, accountEmail, encryptedAccessToken, encryptedRefreshToken, expiryDate || null, provider, userId, accountEmail, now, now);

    return {
      provider,
      userId,
      accountEmail,
      accessToken,
      refreshToken: refreshToken || null,
      expiryDate: expiryDate || null,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  async getOAuthToken(userId: string, provider: string, accountEmail?: string): Promise<OAuthTokenEntry | null> {
    let query = `SELECT * FROM oauth_tokens WHERE userId = ? AND provider = ?`;
    const params: (string | number)[] = [userId, provider];

    if (accountEmail) {
      query += ` AND accountEmail = ?`;
      params.push(accountEmail);
    }

    const row = this.db.prepare(query).get(...params) as {
      provider: string;
      userId: string;
      accountEmail: string;
      accessToken: string;
      refreshToken: string | null;
      expiryDate: number | null;
      createdAt: string;
      updatedAt: string;
    } | undefined;

    if (!row) return null;

    return {
      provider: row.provider,
      userId: row.userId,
      accountEmail: row.accountEmail,
      accessToken: await decryptToken(row.accessToken),
      refreshToken: row.refreshToken ? await decryptToken(row.refreshToken) : null,
      expiryDate: row.expiryDate,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async getAllUserOAuthTokens(userId: string, provider: string): Promise<OAuthTokenEntry[]> {
    const rows = this.db.prepare(`
      SELECT * FROM oauth_tokens WHERE userId = ? AND provider = ? ORDER BY accountEmail
    `).all(userId, provider) as Array<{
      provider: string;
      userId: string;
      accountEmail: string;
      accessToken: string;
      refreshToken: string | null;
      expiryDate: number | null;
      createdAt: string;
      updatedAt: string;
    }>;

    return Promise.all(rows.map(async row => ({
      provider: row.provider,
      userId: row.userId,
      accountEmail: row.accountEmail,
      accessToken: await decryptToken(row.accessToken),
      refreshToken: row.refreshToken ? await decryptToken(row.refreshToken) : null,
      expiryDate: row.expiryDate,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    })));
  }

  async getOAuthTokenByAccountEmail(provider: string, accountEmail: string): Promise<OAuthTokenEntry | null> {
    const row = this.db.prepare(`
      SELECT * FROM oauth_tokens WHERE provider = ? AND accountEmail = ? LIMIT 1
    `).get(provider, accountEmail) as {
      provider: string;
      userId: string;
      accountEmail: string;
      accessToken: string;
      refreshToken: string | null;
      expiryDate: number | null;
      createdAt: string;
      updatedAt: string;
    } | undefined;

    if (!row) return null;

    return {
      provider: row.provider,
      userId: row.userId,
      accountEmail: row.accountEmail,
      accessToken: await decryptToken(row.accessToken),
      refreshToken: row.refreshToken ? await decryptToken(row.refreshToken) : null,
      expiryDate: row.expiryDate,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async revokeOAuthToken(userId: string, provider: string, accountEmail?: string): Promise<boolean> {
    let query = `DELETE FROM oauth_tokens WHERE userId = ? AND provider = ?`;
    const params: (string | number)[] = [userId, provider];

    if (accountEmail) {
      query += ` AND accountEmail = ?`;
      params.push(accountEmail);
    }

    const result = this.db.prepare(query).run(...params);
    return result.changes > 0;
  }

  // ============================================
  // Generic Service Credentials Operations
  // ============================================

  /**
   * Encrypt sensitive fields within a credentials object.
   * Fields whose keys are 'password', 'secret', 'token', or 'key' have their
   * string values KMS-encrypted so they are stored safely at rest.
   */
  private async encryptCredentials(credentials: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sensitiveKeys = new Set(['password', 'secret', 'token', 'key', 'apikey', 'api_key']);
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(credentials)) {
      if (typeof v === 'string' && sensitiveKeys.has(k.toLowerCase())) {
        result[k] = await encryptToken(v);
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  /**
   * Decrypt sensitive fields within a stored credentials object.
   * Values prefixed with kms:v1: are decrypted; all others are returned as-is.
   */
  private async decryptCredentials(credentials: Record<string, unknown>): Promise<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(credentials)) {
      if (typeof v === 'string') {
        result[k] = await decryptToken(v);
      } else {
        result[k] = v;
      }
    }
    return result;
  }

  async storeServiceCredentials(
    userId: string,
    service: string,
    accountEmail: string,
    credentials: Record<string, unknown>
  ): Promise<void> {
    const now = new Date().toISOString();
    const encrypted = await this.encryptCredentials(credentials);
    const credentialsJson = JSON.stringify(encrypted);

    this.db.prepare(`
      INSERT INTO service_credentials (userId, service, accountEmail, credentialsJson, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(userId, service, accountEmail) DO UPDATE SET credentialsJson = ?, updatedAt = ?
    `).run(userId, service, accountEmail, credentialsJson, now, now, credentialsJson, now);
  }

  async getServiceCredentials(
    userId: string,
    service: string,
    accountEmail: string
  ): Promise<Record<string, unknown> | null> {
    const row = this.db.prepare(`
      SELECT credentialsJson FROM service_credentials
      WHERE userId = ? AND service = ? AND accountEmail = ?
    `).get(userId, service, accountEmail) as { credentialsJson: string } | undefined;

    if (!row) return null;
    return this.decryptCredentials(JSON.parse(row.credentialsJson) as Record<string, unknown>);
  }

  async listServiceCredentials(
    userId: string,
    service: string
  ): Promise<Array<{ accountEmail: string; credentials: Record<string, unknown> }>> {
    const rows = this.db.prepare(`
      SELECT accountEmail, credentialsJson FROM service_credentials
      WHERE userId = ? AND service = ? ORDER BY accountEmail
    `).all(userId, service) as Array<{ accountEmail: string; credentialsJson: string }>;

    return Promise.all(rows.map(async row => ({
      accountEmail: row.accountEmail,
      credentials: await this.decryptCredentials(JSON.parse(row.credentialsJson) as Record<string, unknown>),
    })));
  }

  async deleteServiceCredentials(
    userId: string,
    service: string,
    accountEmail: string
  ): Promise<boolean> {
    const result = this.db.prepare(`
      DELETE FROM service_credentials WHERE userId = ? AND service = ? AND accountEmail = ?
    `).run(userId, service, accountEmail);
    return result.changes > 0;
  }

  // ============================================
  // MCP Server Operations
  // ============================================

  /**
   * Save MCP server config
   */
  async saveMCPServerConfig(serverId: string, config: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    const configJson = JSON.stringify(config);
    
    this.db.prepare(`
      INSERT INTO mcp_servers (id, config, createdAt, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET config = ?, updatedAt = ?
    `).run(serverId, configJson, now, now, configJson, now);
  }

  /**
   * Get all MCP server configs
   */
  async getMCPServerConfigs(): Promise<Array<{ id: string; config: Record<string, unknown> }>> {
    const rows = this.db.prepare('SELECT id, config FROM mcp_servers').all() as Array<{
      id: string;
      config: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      config: JSON.parse(row.config) as Record<string, unknown>,
    }));
  }

  /**
   * Get a single MCP server config by ID
   */
  async getMCPServerConfig(serverId: string): Promise<Record<string, unknown> | null> {
    const row = this.db.prepare('SELECT config FROM mcp_servers WHERE id = ?').get(serverId) as {
      config: string;
    } | undefined;

    if (!row) return null;

    return JSON.parse(row.config) as Record<string, unknown>;
  }

  /**
   * Delete MCP server config
   */
  async deleteMCPServerConfig(serverId: string): Promise<boolean> {
    const result = this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(serverId);
    return result.changes > 0;
  }

  /**
   * Migrate old MCP server IDs to new package names
   * Handles: google-drive-full → google-drive-mcp-lib, gmail-full → gmail-mcp-lib
   */
  migrateMCPServerIds(): void {
    try {
      const migrations = [
        { old: 'google-drive-full', new: 'google-drive-mcp-lib' },
        { old: 'gmail-full', new: 'gmail-mcp-lib' },
      ];

      for (const { old, new: newId } of migrations) {
        // Update old ID to new ID if it exists and new doesn't
        const result = this.db.prepare(`
          UPDATE mcp_servers
          SET id = ?
          WHERE id = ? AND NOT EXISTS (
            SELECT 1 FROM mcp_servers WHERE id = ?
          )
        `).run(newId, old, newId);

        if (result.changes > 0) {
          console.log(`[MainDatabase] Migrated MCP server: ${old} → ${newId}`);
        }

        // Delete old ID if new ID already exists (cleanup duplicate)
        const deleteResult = this.db.prepare(`
          DELETE FROM mcp_servers WHERE id = ?
        `).run(old);

        if (deleteResult.changes > 0 && result.changes === 0) {
          console.log(`[MainDatabase] Deleted duplicate old MCP server: ${old}`);
        }
      }
    } catch (error) {
      console.error('[MainDatabase] Error migrating MCP server IDs:', error);
    }
  }

  // ============================================
  // Message Operations
  // ============================================

  async saveMessage(entry: {
    id: string;
    userId: string;
    roleId: string;
    groupId: string | null;
    from: import('./main-db-interface.js').MessageFrom;
    content: string;
    createdAt: string | Date;
  }): Promise<void> {
    const createdAt = entry.createdAt instanceof Date
      ? entry.createdAt.toISOString()
      : entry.createdAt;

    this.db.prepare(`
      INSERT OR IGNORE INTO messages (id, userId, roleId, groupId, role, content, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(entry.id, entry.userId, entry.roleId, entry.groupId ?? null, entry.from, entry.content, createdAt);
  }

  async listMessages(
    userId: string,
    roleId: string,
    options: { limit?: number; before?: string } = {}
  ): Promise<import('./main-db-interface.js').MessageRow[]> {
    const limit = options.limit ?? 50;

    let query = `SELECT * FROM messages WHERE userId = ? AND roleId = ?`;
    const params: (string | number)[] = [userId, roleId];

    if (options.before) {
      query += ` AND createdAt < ?`;
      params.push(options.before);
    }

    query += ` ORDER BY createdAt DESC LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      userId: string;
      roleId: string;
      groupId: string | null;
      role: string;
      content: string;
      createdAt: string;
    }>;

    // Return in ascending order (oldest first)
    return rows.reverse().map(row => ({
      ...row,
      from: row.role as import('./main-db-interface.js').MessageFrom,
    }));
  }

  async searchMessages(
    userId: string,
    roleId: string,
    keyword: string,
    options: { limit?: number } = {}
  ): Promise<import('./main-db-interface.js').MessageRow[]> {
    const limit = options.limit ?? 100;

    const rows = this.db.prepare(`
      SELECT * FROM messages
      WHERE userId = ? AND roleId = ? AND content LIKE ?
      ORDER BY createdAt DESC
      LIMIT ?
    `).all(userId, roleId, `%${keyword}%`, limit) as Array<{
      id: string;
      userId: string;
      roleId: string;
      groupId: string | null;
      role: string;
      content: string;
      createdAt: string;
    }>;

    return rows.map(row => ({ ...row, from: row.role as import('./main-db-interface.js').MessageFrom }));
  }

  async clearMessages(userId: string, roleId: string): Promise<void> {
    this.db.prepare(`DELETE FROM messages WHERE userId = ? AND roleId = ?`).run(userId, roleId);
  }

  // ============================================
  // Settings Operations
  // ============================================

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as { value: string } | undefined;
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return row.value as unknown as T;
    }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const now = new Date().toISOString();
    const serialized = JSON.stringify(value);
    this.db.prepare(`
      INSERT INTO settings (key, value, updatedAt) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = ?, updatedAt = ?
    `).run(key, serialized, now, serialized, now);
  }

  async deleteSetting(key: string): Promise<void> {
    this.db.prepare(`DELETE FROM settings WHERE key = ?`).run(key);
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    const rows = this.db.prepare(`SELECT key, value FROM settings`).all() as Array<{ key: string; value: string }>;
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[row.key] = JSON.parse(row.value);
      } catch {
        result[row.key] = row.value;
      }
    }
    return result;
  }

  // ============================================
  // Skills Operations
  // ============================================

  async upsertSkill(skill: {
    id: string;
    name: string;
    description?: string;
    content: string;
    type?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  }): Promise<void> {
    const now = new Date().toISOString();
    const configJson = skill.config ? JSON.stringify(skill.config) : null;
    const enabled = skill.enabled !== false ? 1 : 0;
    const type = skill.type || 'mcp-in-process';

    this.db.prepare(`
      INSERT INTO skills (id, name, description, content, type, config, enabled, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        content = excluded.content,
        type = excluded.type,
        config = excluded.config,
        enabled = excluded.enabled,
        updatedAt = excluded.updatedAt
    `).run(
      skill.id,
      skill.name,
      skill.description || null,
      skill.content,
      type,
      configJson,
      enabled,
      now,
      now
    );
  }

  async getSkill(id: string): Promise<SkillRecord | null> {
    const row = this.db.prepare('SELECT * FROM skills WHERE id = ?').get(id) as {
      id: string;
      name: string;
      description: string | null;
      content: string;
      type: string;
      config: string | null;
      enabled: number;
      createdAt: string;
      updatedAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      content: row.content,
      type: row.type,
      config: row.config ? JSON.parse(row.config) : undefined,
      enabled: row.enabled === 1,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async listSkills(enabledOnly = false): Promise<SkillRecord[]> {
    const query = enabledOnly
      ? 'SELECT * FROM skills WHERE enabled = 1 ORDER BY name'
      : 'SELECT * FROM skills ORDER BY name';

    const rows = this.db.prepare(query).all() as Array<{
      id: string;
      name: string;
      description: string | null;
      content: string;
      type: string;
      config: string | null;
      enabled: number;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      description: row.description || undefined,
      content: row.content,
      type: row.type,
      config: row.config ? JSON.parse(row.config) : undefined,
      enabled: row.enabled === 1,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  // ============================================
  // Scheduled Job Operations
  // ============================================

  private rowToScheduledJob(row: {
    id: string;
    userId: string;
    roleId: string;
    description: string;
    scheduleType: string;
    runAt: string | null;
    status: string;
    lastRunAt: string | null;
    lastError: string | null;
    holdUntil: string | null;
    runCount: number;
    createdAt: string;
    updatedAt: string;
  }): ScheduledJob {
    return {
      id: row.id,
      userId: row.userId,
      roleId: row.roleId,
      description: row.description,
      scheduleType: row.scheduleType as 'once' | 'recurring',
      runAt: row.runAt ? new Date(row.runAt) : null,
      status: row.status as ScheduledJob['status'],
      lastRunAt: row.lastRunAt ? new Date(row.lastRunAt) : null,
      lastError: row.lastError,
      holdUntil: row.holdUntil ? new Date(row.holdUntil) : null,
      runCount: row.runCount,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async createScheduledJob(params: {
    userId: string;
    roleId: string;
    description: string;
    scheduleType: 'once' | 'recurring';
    runAt?: Date | null;
  }): Promise<ScheduledJob> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const runAt = params.runAt ? params.runAt.toISOString() : null;

    this.db.prepare(`
      INSERT INTO scheduled_jobs (id, userId, roleId, description, scheduleType, runAt, status, runCount, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
    `).run(id, params.userId, params.roleId, params.description, params.scheduleType, runAt, now, now);

    return (await this.getScheduledJob(id))!;
  }

  async getScheduledJob(id: string): Promise<ScheduledJob | null> {
    const row = this.db.prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(id) as any;
    if (!row) return null;
    return this.rowToScheduledJob(row);
  }

  async listScheduledJobs(userId: string, opts?: { status?: string; roleId?: string }): Promise<ScheduledJob[]> {
    let query = 'SELECT * FROM scheduled_jobs WHERE userId = ?';
    const params: (string | number)[] = [userId];

    if (opts?.status) {
      query += ' AND status = ?';
      params.push(opts.status);
    }
    if (opts?.roleId) {
      query += ' AND roleId = ?';
      params.push(opts.roleId);
    }

    query += ' ORDER BY createdAt DESC';
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => this.rowToScheduledJob(r));
  }

  async getDueOnceJobs(): Promise<ScheduledJob[]> {
    const now = new Date().toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM scheduled_jobs
      WHERE scheduleType = 'once' AND runAt <= ? AND status = 'pending'
    `).all(now) as any[];
    return rows.map(r => this.rowToScheduledJob(r));
  }

  async getPendingRecurringJobs(userId?: string): Promise<ScheduledJob[]> {
    const now = new Date().toISOString();
    let query = `SELECT * FROM scheduled_jobs WHERE scheduleType = 'recurring' AND status = 'pending'
      AND (holdUntil IS NULL OR holdUntil <= ?)`;
    const params: string[] = [now];
    if (userId) {
      query += ' AND userId = ?';
      params.push(userId);
    }
    const rows = this.db.prepare(query).all(...params) as any[];
    return rows.map(r => this.rowToScheduledJob(r));
  }

  async updateScheduledJobStatus(id: string, update: {
    status?: ScheduledJob['status'];
    lastRunAt?: Date;
    lastError?: string;
    holdUntil?: Date | null;
    runCount?: number;
  }): Promise<void> {
    const now = new Date().toISOString();
    const fields: string[] = ['updatedAt = ?'];
    const values: (string | number | null)[] = [now];

    if (update.status !== undefined) {
      fields.push('status = ?');
      values.push(update.status);
    }
    if (update.lastRunAt !== undefined) {
      fields.push('lastRunAt = ?');
      values.push(update.lastRunAt.toISOString());
    }
    if (update.lastError !== undefined) {
      fields.push('lastError = ?');
      values.push(update.lastError);
    }
    if ('holdUntil' in update) {
      fields.push('holdUntil = ?');
      values.push(update.holdUntil ? update.holdUntil.toISOString() : null);
    }
    if (update.runCount !== undefined) {
      fields.push('runCount = ?');
      values.push(update.runCount);
    }

    values.push(id);
    this.db.prepare(`UPDATE scheduled_jobs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  async cancelScheduledJob(id: string, userId: string): Promise<boolean> {
    // First verify the job exists and belongs to the user
    const job = await this.getScheduledJob(id);
    if (!job || job.userId !== userId) {
      return false;
    }

    // Only allow cancellation of pending or failed jobs
    if (job.status !== 'pending' && job.status !== 'failed') {
      return false;
    }

    // Actually delete the job from the database
    const result = this.db.prepare(`DELETE FROM scheduled_jobs WHERE id = ?`).run(id);
    return result.changes > 0;
  }

  // ============================================
  // Magic Link Token Operations
  // ============================================

  /**
   * Create a magic link token for email authentication
   */
  async createMagicLinkToken(email: string, userId: string, expiresInSeconds: number = 300): Promise<MagicLinkToken> {
    const id = uuidv4();
    const token = this.generateSecureToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1000);

    this.db.prepare(`
      INSERT INTO magic_link_tokens (id, email, userId, token, expiresAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, email, userId, token, expiresAt.toISOString(), now.toISOString());

    return {
      id,
      email,
      userId,
      token,
      expiresAt,
      usedAt: null,
      createdAt: now,
    };
  }

  /**
   * Verify a magic link token
   * Returns the user ID if valid, null otherwise
   */
  async verifyMagicLinkToken(token: string): Promise<{ userId: string; email: string } | null> {
    const row = this.db.prepare(`
      SELECT * FROM magic_link_tokens WHERE token = ? AND usedAt IS NULL
    `).get(token) as {
      id: string;
      email: string;
      userId: string;
      token: string;
      expiresAt: string;
      usedAt: string | null;
      createdAt: string;
    } | undefined;

    if (!row) return null;

    // Check if expired
    const expiresAt = new Date(row.expiresAt);
    if (expiresAt < new Date()) {
      return null;
    }

    return {
      userId: row.userId,
      email: row.email,
    };
  }

  /**
   * Mark a magic link token as used
   */
  async useMagicLinkToken(token: string): Promise<boolean> {
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      UPDATE magic_link_tokens SET usedAt = ? WHERE token = ? AND usedAt IS NULL
    `).run(now, token);

    return result.changes > 0;
  }

  /**
   * Delete expired magic link tokens for an email
   */
  async deleteExpiredMagicLinkTokens(email: string): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(`
      DELETE FROM magic_link_tokens WHERE email = ? AND (usedAt IS NOT NULL OR expiresAt < ?)
    `).run(email, now);
  }

  /**
   * Generate a secure random token
   */
  private generateSecureToken(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let token = '';
    const randomValues = new Uint32Array(32);
    crypto.getRandomValues(randomValues);
    for (let i = 0; i < 32; i++) {
      token += chars.charAt(randomValues[i] % chars.length);
    }
    return token;
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Delete a memory database file for a role (data/memory_<roleId>.db)
   */
  deleteMemoryDb(dataDir: string, roleId: string): boolean {
    const dbPath = path.join(dataDir, `memory_${roleId}.db`);
    if (fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
      return true;
    }
    return false;
  }

  // ============================================
  // Credit Balance & Stripe Payments
  // ============================================

  async getUserCreditBalance(userId: string): Promise<number> {
    const row = this.db.prepare('SELECT creditBalanceUsd FROM users WHERE id = ?').get(userId) as
      | { creditBalanceUsd: number }
      | undefined;
    return row?.creditBalanceUsd ?? 0;
  }

  async addUserCredits(
    userId: string,
    amountUsd: number,
    opts: { stripePaymentIntentId?: string; description?: string } = {}
  ): Promise<void> {
    const now = new Date().toISOString();
    const ledgerId = uuidv4();

    // Atomic: update balance and insert ledger entry in one transaction
    const txn = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE users SET creditBalanceUsd = creditBalanceUsd + ?, updatedAt = ? WHERE id = ?
      `).run(amountUsd, now, userId);

      const row = this.db.prepare('SELECT creditBalanceUsd FROM users WHERE id = ?').get(userId) as
        | { creditBalanceUsd: number }
        | undefined;
      const balanceAfter = row?.creditBalanceUsd ?? 0;

      this.db.prepare(`
        INSERT INTO credit_ledger (id, userId, type, amountUsd, balanceAfter, description, stripePaymentIntentId, createdAt)
        VALUES (?, ?, 'topup', ?, ?, ?, ?, ?)
      `).run(
        ledgerId,
        userId,
        amountUsd,
        balanceAfter,
        opts.description ?? `Top-up $${amountUsd.toFixed(2)}`,
        opts.stripePaymentIntentId ?? null,
        now
      );
    });
    txn();
  }

  /**
   * Atomically deduct credits from a user's balance and record a ledger entry.
   * Returns true if successful, false if the balance would go below zero.
   */
  async deductUserCredits(
    userId: string,
    amountUsd: number,
    opts: { description?: string; model?: string } = {}
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const ledgerId = uuidv4();
    let succeeded = false;

    const txn = this.db.transaction(() => {
      // No balance guard — the pre-flight check in the API layer is the gate.
      // Allowing slight negative balance under races is preferable to silently
      // dropping deductions and losing ledger entries.
      this.db.prepare(`
        UPDATE users
        SET creditBalanceUsd = creditBalanceUsd - ?, updatedAt = ?
        WHERE id = ?
      `).run(amountUsd, now, userId);

      succeeded = true;

      const row = this.db.prepare('SELECT creditBalanceUsd FROM users WHERE id = ?').get(userId) as
        | { creditBalanceUsd: number }
        | undefined;
      const balanceAfter = row?.creditBalanceUsd ?? 0;

      this.db.prepare(`
        INSERT INTO credit_ledger (id, userId, type, amountUsd, balanceAfter, description, model, createdAt)
        VALUES (?, ?, 'usage', ?, ?, ?, ?, ?)
      `).run(
        ledgerId,
        userId,
        amountUsd,
        balanceAfter,
        opts.description ?? `Usage — ${opts.model ?? 'unknown model'}`,
        opts.model ?? null,
        now
      );
    });
    txn();
    return succeeded;
  }

  async createStripePayment(params: {
    userId: string;
    stripePaymentIntentId: string;
    amountUsd: number;
    status: 'pending' | 'succeeded' | 'failed';
  }): Promise<void> {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO stripe_payments (id, userId, stripePaymentIntentId, amountUsd, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, params.userId, params.stripePaymentIntentId, params.amountUsd, params.status, now, now);
  }

  async updateStripePaymentStatus(
    stripePaymentIntentId: string,
    status: 'pending' | 'succeeded' | 'failed'
  ): Promise<void> {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE stripe_payments SET status = ?, updatedAt = ? WHERE stripePaymentIntentId = ?
    `).run(status, now, stripePaymentIntentId);
  }

  async getStripePaymentByIntentId(stripePaymentIntentId: string): Promise<StripePayment | null> {
    const row = this.db.prepare(
      'SELECT * FROM stripe_payments WHERE stripePaymentIntentId = ?'
    ).get(stripePaymentIntentId) as {
      id: string;
      userId: string;
      stripePaymentIntentId: string;
      amountUsd: number;
      status: string;
      createdAt: string;
      updatedAt: string;
    } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      stripePaymentIntentId: row.stripePaymentIntentId,
      amountUsd: row.amountUsd,
      status: row.status as StripePayment['status'],
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  async getCreditLedger(userId: string, limit = 25, cursor: { before?: string; after?: string } = {}): Promise<CreditLedgerEntry[]> {
    let sql = `SELECT * FROM credit_ledger WHERE userId = ?`;
    const params: (string | number)[] = [userId];

    if (cursor.before) {
      sql += ` AND createdAt < ?`;
      params.push(cursor.before);
    } else if (cursor.after) {
      sql += ` AND createdAt > ?`;
      params.push(cursor.after);
    }

    // When paginating forward (after) we need ascending order then reverse
    const ascending = !!cursor.after;
    sql += ` ORDER BY createdAt ${ascending ? 'ASC' : 'DESC'} LIMIT ?`;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      userId: string;
      type: string;
      amountUsd: number;
      balanceAfter: number;
      description: string;
      stripePaymentIntentId: string | null;
      model: string | null;
      createdAt: string;
    }>;
    const mapped = rows.map(row => ({
      id: row.id,
      userId: row.userId,
      type: row.type as CreditLedgerEntry['type'],
      amountUsd: row.amountUsd,
      balanceAfter: row.balanceAfter,
      description: row.description,
      stripePaymentIntentId: row.stripePaymentIntentId ?? undefined,
      model: row.model ?? undefined,
      createdAt: new Date(row.createdAt),
    }));

    // After-cursor results come back oldest-first; reverse so caller always gets newest-first
    return ascending ? mapped.reverse() : mapped;
  }

  async getStripePayments(userId: string): Promise<StripePayment[]> {
    const rows = this.db.prepare(`
      SELECT * FROM stripe_payments WHERE userId = ? ORDER BY createdAt DESC LIMIT 50
    `).all(userId) as Array<{
      id: string;
      userId: string;
      stripePaymentIntentId: string;
      amountUsd: number;
      status: string;
      createdAt: string;
      updatedAt: string;
    }>;
    return rows.map(row => ({
      id: row.id,
      userId: row.userId,
      stripePaymentIntentId: row.stripePaymentIntentId,
      amountUsd: row.amountUsd,
      status: row.status as StripePayment['status'],
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  // ============================================
  // Token Usage
  // ============================================

  async recordTokenUsage(record: {
    userId: string;
    model: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedInputTokens?: number;
    cacheCreationTokens?: number;
    source?: string;
  }): Promise<void> {
    const id = uuidv4();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO token_usage (id, userId, model, provider, promptTokens, completionTokens, totalTokens, cachedInputTokens, cacheCreationTokens, source, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      record.userId,
      record.model,
      record.provider,
      record.promptTokens,
      record.completionTokens,
      record.totalTokens,
      record.cachedInputTokens ?? 0,
      record.cacheCreationTokens ?? 0,
      record.source ?? 'chat',
      now
    );
  }

  async getTokenUsageByUser(userId: string, options?: { from?: Date; to?: Date; limit?: number }): Promise<TokenUsageRecord[]> {
    let query = 'SELECT * FROM token_usage WHERE userId = ?';
    const params: (string | number)[] = [userId];

    if (options?.from) {
      query += ' AND createdAt >= ?';
      params.push(options.from.toISOString());
    }
    if (options?.to) {
      query += ' AND createdAt <= ?';
      params.push(options.to.toISOString());
    }

    query += ' ORDER BY createdAt DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      userId: string;
      model: string;
      provider: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      cachedInputTokens: number;
      cacheCreationTokens: number;
      source: string;
      createdAt: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      userId: row.userId,
      model: row.model,
      provider: row.provider,
      promptTokens: row.promptTokens,
      completionTokens: row.completionTokens,
      totalTokens: row.totalTokens,
      cachedInputTokens: row.cachedInputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      source: row.source,
      createdAt: new Date(row.createdAt),
    }));
  }
}

// Singleton instance
let mainDb: IMainDatabase | null = null;

/**
 * Returns the main database instance.
 * Chooses implementation based on MAIN_DB_TYPE env var:
 *   - 'dynamodb' → DynamoDBMainDatabase (AWS)
 *   - 'sqlite' or unset → SQLite MainDatabase (local/default)
 */
export async function getMainDatabase(dataDir: string = './data'): Promise<IMainDatabase> {
  if (mainDb) return mainDb;

  const dbType = process.env.MAIN_DB_TYPE;

  if (dbType === 'dynamodb') {
    const { getDynamoDBMainDatabase } = await import('./dynamodb-main-db.js');
    mainDb = getDynamoDBMainDatabase() as IMainDatabase;
  } else {
    mainDb = new MainDatabase(dataDir) as IMainDatabase;
  }

  return mainDb!;
}

export type { IMainDatabase };

/**
 * Synchronous accessor for the already-initialized database singleton.
 * Use this only inside factory callbacks or other synchronous contexts where
 * the database is guaranteed to have been initialized at server startup.
 * Throws if called before getMainDatabase() has resolved.
 */
export function getMainDatabaseSync(): IMainDatabase {
  if (!mainDb) {
    throw new Error(
      '[getMainDatabaseSync] Database not yet initialized. ' +
      'Ensure await getMainDatabase() is called during server startup before using sync accessor.'
    );
  }
  return mainDb;
}

export function closeMainDatabase(): void {
  if (mainDb) {
    mainDb.close();
    mainDb = null;
  }
}
