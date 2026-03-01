import type { StorageAdapterConfig, MemoryEntry } from '@local-agent/shared';
import { FSStorageAdapter } from './fs-adapter.js';
import { SQLiteStorageAdapter } from './sqlite-adapter.js';
import { S3StorageAdapter } from './s3-adapter.js';
import type { IStorage, IMessageStorage, ChatMessageEntry } from './interface.js';

// Export main storage
export { MainDatabase, getMainDatabase, getMainDatabaseSync, closeMainDatabase, type RoleDefinition, type OAuthTokenEntry, type SkillRecord, type IMainDatabase } from './main-db.js';
export { DynamoDBMainDatabase, getDynamoDBMainDatabase } from './dynamodb-main-db.js';
export type { ScheduledJob } from './main-db-interface.js';
export { migrateToRoleBasedStorage, autoMigrate } from './migrate.js';

export type { IStorage, IMessageStorage, ChatMessageEntry };
export { BaseStorage } from './interface.js';
export { FSStorageAdapter } from './fs-adapter.js';
export { SQLiteStorageAdapter } from './sqlite-adapter.js';
export { S3StorageAdapter } from './s3-adapter.js';

/**
 * Storage service factory
 * Creates the appropriate storage adapter based on configuration
 * Always uses SQLite for message storage regardless of main storage type
 * 
 * @deprecated Use RoleStorageService for new code
 */
export class StorageService implements IStorage {
  private adapter: IStorage;
  private messageStorage: IMessageStorage;
  private messageStorageAdapter: SQLiteStorageAdapter;

  constructor(config: StorageAdapterConfig) {
    // Always create SQLite adapter for message storage
    // Use a default path for the messages database
    const messageDbRoot = 'root' in config ? config.root : './data';
    const sqliteAdapter = new SQLiteStorageAdapter({
      type: 'sqlite',
      root: messageDbRoot,
    });
    this.messageStorage = sqliteAdapter;
    this.messageStorageAdapter = sqliteAdapter;

    switch (config.type) {
      case 'fs':
        this.adapter = new FSStorageAdapter(config);
        break;
      case 'sqlite':
        // Reuse the same SQLite adapter for both storage and messages
        this.adapter = sqliteAdapter;
        break;
      case 's3':
        this.adapter = new S3StorageAdapter(config);
        break;
      default:
        throw new Error(`Unknown storage type: ${(config as { type: string }).type}`);
    }
  }

  async initialize(): Promise<void> {
    // Always initialize SQLite for message storage
    // Only initialize separately if not using SQLite as main adapter
    const adapterIsSqlite = this.adapter === this.messageStorageAdapter;
    
    if (!adapterIsSqlite) {
      // Initialize the message storage SQLite adapter separately
      await this.messageStorageAdapter.initialize();
    }
    
    if ('initialize' in this.adapter && typeof this.adapter.initialize === 'function') {
      await (this.adapter as FSStorageAdapter | SQLiteStorageAdapter | S3StorageAdapter).initialize();
    }
  }

  /**
   * Get message storage (always SQLite)
   */
  getMessageStorage(): IMessageStorage | null {
    return this.messageStorage;
  }

  // ============================================
  // File Operations
  // ============================================

  read(path: string): Promise<string | null> {
    return this.adapter.read(path);
  }

  write(path: string, content: string): Promise<void> {
    return this.adapter.write(path, content);
  }

  append(path: string, content: string): Promise<void> {
    return this.adapter.append(path, content);
  }

  delete(path: string): Promise<void> {
    return this.adapter.delete(path);
  }

  exists(path: string): Promise<boolean> {
    return this.adapter.exists(path);
  }

  list(dir: string): Promise<string[]> {
    return this.adapter.list(dir);
  }

  // ============================================
  // Memory Operations
  // ============================================

  saveMemory(entry: MemoryEntry): Promise<void> {
    return this.adapter.saveMemory(entry);
  }

  getMemory(id: string): Promise<MemoryEntry | null> {
    return this.adapter.getMemory(id);
  }

  listMemory(roleId: string): Promise<MemoryEntry[]> {
    return this.adapter.listMemory(roleId);
  }

  searchMemory(query: string, roleId: string, limit?: number): Promise<MemoryEntry[]> {
    return this.adapter.searchMemory(query, roleId, limit);
  }

  searchMemoryByEmbedding(embedding: number[], roleId: string, limit?: number): Promise<MemoryEntry[]> {
    return this.adapter.searchMemoryByEmbedding(embedding, roleId, limit);
  }

  deleteMemory(id: string): Promise<void> {
    return this.adapter.deleteMemory(id);
  }

  // ============================================
  // Metadata Operations
  // ============================================

  getMetadata(table: string, id: string): Promise<Record<string, unknown> | null> {
    return this.adapter.getMetadata(table, id);
  }

  setMetadata(table: string, id: string, data: Record<string, unknown>): Promise<void> {
    return this.adapter.setMetadata(table, id, data);
  }

  deleteMetadata(table: string, id: string): Promise<void> {
    return this.adapter.deleteMetadata(table, id);
  }

  queryMetadata(table: string, filter: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    return this.adapter.queryMetadata(table, filter);
  }

  // ============================================
  // Settings Operations
  // ============================================

  getSetting<T = unknown>(key: string): Promise<T | null> {
    return this.adapter.getSetting<T>(key);
  }

  setSetting(key: string, value: unknown): Promise<void> {
    return this.adapter.setSetting(key, value);
  }

  deleteSetting(key: string): Promise<void> {
    return this.adapter.deleteSetting(key);
  }

  getAllSettings(): Promise<Record<string, unknown>> {
    return this.adapter.getAllSettings();
  }
}

/**
 * Create a storage service from configuration
 * @deprecated Use getRoleStorageService for new code
 */
export function createStorage(config: StorageAdapterConfig): StorageService {
  return new StorageService(config);
}