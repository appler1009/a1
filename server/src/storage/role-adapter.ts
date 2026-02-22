import Database from 'better-sqlite3';
import Fuse from 'fuse.js';
import type { MemoryEntry } from '@local-agent/shared';
import { BaseStorage, type ChatMessageEntry, type IMessageStorage } from './interface.js';
import fs from 'fs';
import path from 'path';

/**
 * Configuration for a role-specific SQLite database
 */
export interface RoleStorageConfig {
  roleId: string;
  dataDir: string;
}

/**
 * MCP Server configuration stored in role database
 */
export interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'websocket' | 'http' | 'ws';
  command?: string;
  args?: string[];
  cwd?: string | null;
  url?: string;
  enabled: boolean;
  autoStart: boolean;
  restartOnExit: boolean;
  auth?: {
    provider?: string;
    type?: string;
    credentialsFilename?: string;
    tokenFilename?: string;
  };
  env?: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Role-specific OAuth token (e.g., Google Drive for this role)
 */
export interface RoleOAuthToken {
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Role-specific SQLite storage adapter
 * 
 * Each role has its own completely isolated SQLite database containing:
 * - Memory entries
 * - Chat messages
 * - Settings (role-specific preferences)
 * - MCP server configurations
 * - OAuth tokens (role-specific, like separate Google Drive accounts)
 * 
 * This provides complete isolation between roles - when a user switches roles,
 * they get a completely separate environment.
 */
export class RoleStorageAdapter extends BaseStorage implements IMessageStorage {
  private db: Database.Database;
  private roleId: string;
  private dbPath: string;
  private memoryIndex: Map<string, MemoryEntry> = new Map();

  constructor(config: RoleStorageConfig) {
    super();
    this.roleId = config.roleId;
    this.dbPath = path.join(config.dataDir, `role_${config.roleId}.db`);
    
    console.log(`[RoleAdapter] Creating adapter for role ${this.roleId}`);
    console.log(`[RoleAdapter] Database path: ${this.dbPath}`);
    
    // Ensure data directory exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    
    this.db = new Database(this.dbPath);
    console.log(`[RoleAdapter] Database opened successfully`);
  }

  async initialize(): Promise<void> {
    this.db.exec(`
      -- Memory entries for this role
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        roleId TEXT NOT NULL DEFAULT '${this.roleId}',
        content TEXT NOT NULL,
        embedding BLOB,
        metadata TEXT,
        createdAt TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_memory_created ON memory(createdAt);
      
      -- Chat messages for this role
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        roleId TEXT NOT NULL DEFAULT '${this.roleId}',
        groupId TEXT,
        userId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(createdAt);
      
      -- Settings for this role
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      
      -- MCP server configurations for this role
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
      
      -- OAuth tokens for this role (separate from user-level tokens)
      CREATE TABLE IF NOT EXISTS oauth_tokens (
        provider TEXT PRIMARY KEY,
        accessToken TEXT NOT NULL,
        refreshToken TEXT,
        expiryDate INTEGER,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      
      -- Metadata table for generic key-value storage
      CREATE TABLE IF NOT EXISTS metadata (
        table_name TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (table_name, id)
      );
    `);

    // Load memory into index
    await this.loadMemoryIndex();
  }

  private async loadMemoryIndex(): Promise<void> {
    const rows = this.db.prepare('SELECT * FROM memory').all() as Array<{
      id: string;
      roleId: string;
      content: string;
      embedding: Buffer | null;
      metadata: string | null;
      createdAt: string;
    }>;

    for (const row of rows) {
      const entry: MemoryEntry = {
        id: row.id,
        roleId: row.roleId,
        orgId: this.roleId, // For backward compatibility
        userId: this.roleId, // Role-specific, so userId is the roleId
        content: row.content,
        embedding: row.embedding ? JSON.parse(row.embedding.toString()) : undefined,
        metadata: row.metadata ? JSON.parse(row.metadata) : undefined,
        createdAt: new Date(row.createdAt),
      };
      this.memoryIndex.set(entry.id, entry);
    }
  }

  close(): void {
    this.db.close();
  }

  getRoleId(): string {
    return this.roleId;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  // ============================================
  // File Operations (stored in metadata table)
  // ============================================

  async read(path: string): Promise<string | null> {
    const row = this.db.prepare(
      'SELECT data FROM metadata WHERE table_name = ? AND id = ?'
    ).get('files', path) as { data: string } | undefined;
    
    return row?.data || null;
  }

  async write(path: string, content: string): Promise<void> {
    this.db.prepare(
      'INSERT OR REPLACE INTO metadata (table_name, id, data) VALUES (?, ?, ?)'
    ).run('files', path, content);
  }

  async append(path: string, content: string): Promise<void> {
    const existing = await this.read(path);
    const newContent = existing ? existing + content : content;
    await this.write(path, newContent);
  }

  async delete(path: string): Promise<void> {
    this.db.prepare(
      'DELETE FROM metadata WHERE table_name = ? AND id = ?'
    ).run('files', path);
  }

  async exists(path: string): Promise<boolean> {
    const row = this.db.prepare(
      'SELECT 1 FROM metadata WHERE table_name = ? AND id = ?'
    ).get('files', path);
    return !!row;
  }

  async list(dir: string): Promise<string[]> {
    const rows = this.db.prepare(
      'SELECT id FROM metadata WHERE table_name = ? AND id LIKE ?'
    ).all('files', `${dir}%`) as Array<{ id: string }>;
    
    return rows.map(r => r.id);
  }

  // ============================================
  // Memory Operations
  // ============================================

  async saveMemory(entry: MemoryEntry): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO memory 
      (id, roleId, content, embedding, metadata, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      this.roleId,
      entry.content,
      entry.embedding ? JSON.stringify(entry.embedding) : null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      typeof entry.createdAt === 'string' ? entry.createdAt : entry.createdAt.toISOString()
    );

    this.memoryIndex.set(entry.id, {
      ...entry,
      roleId: this.roleId,
      orgId: this.roleId,
      userId: this.roleId,
    });
  }

  async getMemory(id: string): Promise<MemoryEntry | null> {
    return this.memoryIndex.get(id) || null;
  }

  async listMemory(_roleId: string): Promise<MemoryEntry[]> {
    // Role is already isolated, so we ignore the roleId parameter
    const entries = Array.from(this.memoryIndex.values());
    return entries.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async searchMemory(query: string, _roleId?: string, limit = 10): Promise<MemoryEntry[]> {
    const entries = await this.listMemory(this.roleId);
    
    if (entries.length === 0) {
      return [];
    }

    const fuse = new Fuse(entries, {
      keys: ['content'],
      includeScore: true,
      threshold: 0.4,
    });

    const results = fuse.search(query, { limit });
    return results.map((r: { item: MemoryEntry }) => r.item);
  }

  async searchMemoryByEmbedding(_embedding: number[], _roleId?: string, _limit?: number): Promise<MemoryEntry[]> {
    // SQLite doesn't support vector search natively
    console.warn('RoleStorageAdapter: Embedding search not implemented');
    return [];
  }

  async deleteMemory(id: string): Promise<void> {
    this.db.prepare('DELETE FROM memory WHERE id = ?').run(id);
    this.memoryIndex.delete(id);
  }

  // ============================================
  // Chat Message Operations
  // ============================================

  async saveMessage(entry: ChatMessageEntry): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO messages 
      (id, roleId, groupId, userId, role, content, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      this.roleId,
      entry.groupId || null,
      entry.userId,
      entry.role,
      entry.content,
      typeof entry.createdAt === 'string' ? entry.createdAt : entry.createdAt.toISOString()
    );
  }

  async getMessage(id: string): Promise<ChatMessageEntry | null> {
    const row = this.db.prepare(
      'SELECT * FROM messages WHERE id = ?'
    ).get(id) as {
      id: string;
      roleId: string;
      groupId: string | null;
      userId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      roleId: row.roleId,
      groupId: row.groupId,
      userId: row.userId,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
    };
  }

  async listMessages(_roleId?: string, options?: { limit?: number; before?: string }): Promise<ChatMessageEntry[]> {
    console.log(`[RoleAdapter] listMessages called for role ${this.roleId}`);
    console.log(`[RoleAdapter] Database path: ${this.dbPath}`);
    
    let query = 'SELECT * FROM messages WHERE roleId = ?';
    const params: (string | number)[] = [this.roleId];

    if (options?.before) {
      query += ' AND createdAt < (SELECT createdAt FROM messages WHERE id = ?)';
      params.push(options.before);
    }

    query += ' ORDER BY createdAt DESC';

    if (options?.limit) {
      query += ' LIMIT ?';
      params.push(options.limit);
    }

    const rows = this.db.prepare(query).all(...params) as Array<{
      id: string;
      roleId: string;
      groupId: string | null;
      userId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt: string;
    }>;

    console.log(`[RoleAdapter] Found ${rows.length} messages in database`);

    // Return in chronological order (oldest first)
    return rows.reverse().map(row => ({
      id: row.id,
      roleId: row.roleId,
      groupId: row.groupId,
      userId: row.userId,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
    }));
  }

  async searchMessages(keyword: string, _roleId?: string, options?: { limit?: number }): Promise<ChatMessageEntry[]> {
    const limit = options?.limit || 100;
    const searchPattern = `%${keyword}%`;
    
    const rows = this.db.prepare(`
      SELECT * FROM messages 
      WHERE roleId = ? AND content LIKE ?
      ORDER BY createdAt DESC
      LIMIT ?
    `).all(this.roleId, searchPattern, limit) as Array<{
      id: string;
      roleId: string;
      groupId: string | null;
      userId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      createdAt: string;
    }>;

    // Return in chronological order (oldest first)
    return rows.reverse().map(row => ({
      id: row.id,
      roleId: row.roleId,
      groupId: row.groupId,
      userId: row.userId,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
    }));
  }

  async deleteMessage(id: string): Promise<void> {
    this.db.prepare('DELETE FROM messages WHERE id = ?').run(id);
  }

  async clearMessages(_roleId?: string): Promise<void> {
    this.db.prepare('DELETE FROM messages WHERE roleId = ?').run(this.roleId);
  }

  // ============================================
  // Metadata Operations
  // ============================================

  async getMetadata(table: string, id: string): Promise<Record<string, unknown> | null> {
    const row = this.db.prepare(
      'SELECT data FROM metadata WHERE table_name = ? AND id = ?'
    ).get(table, id) as { data: string } | undefined;
    
    return row ? JSON.parse(row.data) : null;
  }

  async setMetadata(table: string, id: string, data: Record<string, unknown>): Promise<void> {
    this.db.prepare(
      'INSERT OR REPLACE INTO metadata (table_name, id, data) VALUES (?, ?, ?)'
    ).run(table, id, JSON.stringify(data));
  }

  async deleteMetadata(table: string, id: string): Promise<void> {
    this.db.prepare(
      'DELETE FROM metadata WHERE table_name = ? AND id = ?'
    ).run(table, id);
  }

  async queryMetadata(table: string, filter: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const rows = this.db.prepare(
      'SELECT id, data FROM metadata WHERE table_name = ?'
    ).all(table) as Array<{ id: string; data: string }>;

    const results: Record<string, unknown>[] = [];
    for (const row of rows) {
      const data = JSON.parse(row.data) as Record<string, unknown>;
      let matches = true;
      
      for (const [key, value] of Object.entries(filter)) {
        if (data[key] !== value) {
          matches = false;
          break;
        }
      }
      
      if (matches) {
        results.push(data);
      }
    }

    return results;
  }

  // ============================================
  // Settings Operations
  // ============================================

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    const row = this.db.prepare(
      'SELECT value FROM settings WHERE key = ?'
    ).get(key) as { value: string } | undefined;
    
    if (!row) return null;
    
    try {
      return JSON.parse(row.value) as T;
    } catch {
      // If it's not valid JSON, return the raw value
      return row.value as T;
    }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const valueStr = JSON.stringify(value);
    const now = new Date().toISOString();
    
    this.db.prepare(
      'INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES (?, ?, ?)'
    ).run(key, valueStr, now);
  }

  async deleteSetting(key: string): Promise<void> {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    const rows = this.db.prepare(
      'SELECT key, value FROM settings'
    ).all() as Array<{ key: string; value: string }>;

    const settings: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        settings[row.key] = JSON.parse(row.value);
      } catch {
        settings[row.key] = row.value;
      }
    }

    return settings;
  }

  // ============================================
  // MCP Server Operations (Role-specific)
  // ============================================

  async saveMcpServer(config: Omit<McpServerConfig, 'createdAt' | 'updatedAt'>): Promise<McpServerConfig> {
    const now = new Date().toISOString();
    
    // Check if this is an update
    const existing = this.getMcpServer(config.id);
    const createdAt = existing ? existing.createdAt.toISOString() : now;

    this.db.prepare(`
      INSERT OR REPLACE INTO mcp_servers 
      (id, name, transport, command, args, cwd, url, enabled, autoStart, restartOnExit, auth, env, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      config.id,
      config.name,
      config.transport,
      config.command || null,
      config.args ? JSON.stringify(config.args) : null,
      config.cwd || null,
      config.url || null,
      config.enabled ? 1 : 0,
      config.autoStart ? 1 : 0,
      config.restartOnExit ? 1 : 0,
      config.auth ? JSON.stringify(config.auth) : null,
      config.env ? JSON.stringify(config.env) : null,
      createdAt,
      now
    );

    return {
      ...config,
      createdAt: new Date(createdAt),
      updatedAt: new Date(now),
    };
  }

  getMcpServer(id: string): McpServerConfig | null {
    const row = this.db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as {
      id: string;
      name: string;
      transport: string;
      command: string | null;
      args: string | null;
      cwd: string | null;
      url: string | null;
      enabled: number;
      autoStart: number;
      restartOnExit: number;
      auth: string | null;
      env: string | null;
      createdAt: string;
      updatedAt: string;
    } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      name: row.name,
      transport: row.transport as 'stdio' | 'websocket' | 'http',
      command: row.command || undefined,
      args: row.args ? JSON.parse(row.args) : undefined,
      cwd: row.cwd || undefined,
      url: row.url || undefined,
      enabled: row.enabled === 1,
      autoStart: row.autoStart === 1,
      restartOnExit: row.restartOnExit === 1,
      auth: row.auth ? JSON.parse(row.auth) : undefined,
      env: row.env ? JSON.parse(row.env) : undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  listMcpServers(): McpServerConfig[] {
    const rows = this.db.prepare('SELECT * FROM mcp_servers').all() as Array<{
      id: string;
      name: string;
      transport: string;
      command: string | null;
      args: string | null;
      cwd: string | null;
      url: string | null;
      enabled: number;
      autoStart: number;
      restartOnExit: number;
      auth: string | null;
      env: string | null;
      createdAt: string;
      updatedAt: string;
    }>;

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      transport: row.transport as 'stdio' | 'websocket' | 'http',
      command: row.command || undefined,
      args: row.args ? JSON.parse(row.args) : undefined,
      cwd: row.cwd || undefined,
      url: row.url || undefined,
      enabled: row.enabled === 1,
      autoStart: row.autoStart === 1,
      restartOnExit: row.restartOnExit === 1,
      auth: row.auth ? JSON.parse(row.auth) : undefined,
      env: row.env ? JSON.parse(row.env) : undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    }));
  }

  deleteMcpServer(id: string): boolean {
    const result = this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // ============================================
  // Role-specific OAuth Token Operations
  // ============================================

  async storeRoleOAuthToken(
    provider: string,
    accessToken: string,
    refreshToken?: string,
    expiryDate?: number
  ): Promise<RoleOAuthToken> {
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT OR REPLACE INTO oauth_tokens (provider, accessToken, refreshToken, expiryDate, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, COALESCE((SELECT createdAt FROM oauth_tokens WHERE provider = ?), ?), ?)
    `).run(provider, accessToken, refreshToken || null, expiryDate || null, provider, now, now);

    return {
      provider,
      accessToken,
      refreshToken,
      expiryDate,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  getRoleOAuthToken(provider: string): RoleOAuthToken | null {
    const row = this.db.prepare(`
      SELECT * FROM oauth_tokens WHERE provider = ?
    `).get(provider) as {
      provider: string;
      accessToken: string;
      refreshToken: string | null;
      expiryDate: number | null;
      createdAt: string;
      updatedAt: string;
    } | undefined;

    if (!row) return null;

    return {
      provider: row.provider,
      accessToken: row.accessToken,
      refreshToken: row.refreshToken || undefined,
      expiryDate: row.expiryDate || undefined,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  deleteRoleOAuthToken(provider: string): boolean {
    const result = this.db.prepare('DELETE FROM oauth_tokens WHERE provider = ?').run(provider);
    return result.changes > 0;
  }
}
