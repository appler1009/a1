import { Database } from 'bun:sqlite';
import Fuse from 'fuse.js';
import type { MemoryEntry } from '@local-agent/shared';
import { BaseStorage, type ChatMessageEntry, type IMessageStorage } from './interface.js';

export interface SQLiteStorageConfig {
  type: 'sqlite';
  root: string;
  database?: string;
}

/**
 * SQLite storage adapter
 * Stores metadata in SQLite and files on the filesystem
 * Also implements IMessageStorage for chat messages
 */
export class SQLiteStorageAdapter extends BaseStorage implements IMessageStorage {
  private db: Database;
  private root: string;
  private memoryIndex: Map<string, MemoryEntry> = new Map();

  constructor(config: SQLiteStorageConfig) {
    super();
    this.root = config.root;
    const dbPath = config.database || `${config.root}/metadata.db`;
    this.db = new Database(dbPath);
  }

  async initialize(): Promise<void> {
    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory (
        id TEXT PRIMARY KEY,
        roleId TEXT NOT NULL,
        orgId TEXT NOT NULL,
        userId TEXT NOT NULL,
        content TEXT NOT NULL,
        embedding BLOB,
        metadata TEXT,
        createdAt TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_memory_role ON memory(roleId);
      CREATE INDEX IF NOT EXISTS idx_memory_org ON memory(orgId);
      CREATE INDEX IF NOT EXISTS idx_memory_user ON memory(userId);
      
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        roleId TEXT NOT NULL,
        groupId TEXT,
        userId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      
      CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(roleId);
      CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(createdAt);
      
      CREATE TABLE IF NOT EXISTS metadata (
        table_name TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (table_name, id)
      );
      
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
    `);

    // Load memory into index
    await this.loadMemoryIndex();
  }

  private async loadMemoryIndex(): Promise<void> {
    const rows = this.db.prepare('SELECT * FROM memory').all() as Array<{
      id: string;
      roleId: string;
      orgId: string;
      userId: string;
      content: string;
      embedding: Buffer | null;
      metadata: string | null;
      createdAt: string;
    }>;

    for (const row of rows) {
      const entry: MemoryEntry = {
        id: row.id,
        roleId: row.roleId,
        orgId: row.orgId,
        userId: row.userId,
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

  // ============================================
  // File Operations (stored in metadata table as JSON)
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
      (id, roleId, orgId, userId, content, embedding, metadata, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      entry.id,
      entry.roleId,
      entry.userId,
      entry.orgId,
      entry.content,
      entry.embedding ? JSON.stringify(entry.embedding) : null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      typeof entry.createdAt === 'string' ? entry.createdAt : entry.createdAt.toISOString()
    );

    this.memoryIndex.set(entry.id, entry);
  }

  async getMemory(id: string): Promise<MemoryEntry | null> {
    return this.memoryIndex.get(id) || null;
  }

  async listMemory(roleId: string): Promise<MemoryEntry[]> {
    const entries: MemoryEntry[] = [];
    for (const entry of this.memoryIndex.values()) {
      if (entry.roleId === roleId) {
        entries.push(entry);
      }
    }
    return entries.sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async searchMemory(query: string, roleId: string, limit = 10): Promise<MemoryEntry[]> {
    const roleEntries = await this.listMemory(roleId);
    
    if (roleEntries.length === 0) {
      return [];
    }

    const fuse = new Fuse(roleEntries, {
      keys: ['content'],
      includeScore: true,
      threshold: 0.4,
    });

    const results = fuse.search(query, { limit });
    return results.map((r: { item: MemoryEntry }) => r.item);
  }

  async searchMemoryByEmbedding(_embedding: number[], _roleId: string, _limit?: number): Promise<MemoryEntry[]> {
    // SQLite doesn't support vector search natively
    // This would require sqlite-vss or an external vector DB
    console.warn('SQLiteStorageAdapter: Embedding search not implemented');
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
      entry.roleId,
      entry.groupId,
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

  async listMessages(roleId: string, options?: { limit?: number; before?: string }): Promise<ChatMessageEntry[]> {
    let query = 'SELECT * FROM messages WHERE roleId = ?';
    const params: (string | number)[] = [roleId];

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

  async searchMessages(keyword: string, roleId: string, options?: { limit?: number }): Promise<ChatMessageEntry[]> {
    const limit = options?.limit || 100;
    const searchPattern = `%${keyword}%`;
    
    const rows = this.db.prepare(`
      SELECT * FROM messages 
      WHERE roleId = ? AND content LIKE ?
      ORDER BY createdAt DESC
      LIMIT ?
    `).all(roleId, searchPattern, limit) as Array<{
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

  async clearMessages(roleId: string): Promise<void> {
    this.db.prepare('DELETE FROM messages WHERE roleId = ?').run(roleId);
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
}