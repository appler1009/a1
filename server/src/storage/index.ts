import type { StorageAdapterConfig, MemoryEntry } from '@local-agent/shared';
import { FSStorageAdapter, FSStorageConfig } from './fs-adapter.js';
import { SQLiteStorageAdapter, SQLiteStorageConfig } from './sqlite-adapter.js';
import { S3StorageAdapter, S3StorageConfig } from './s3-adapter.js';
import type { IStorage } from './interface.js';

export type { IStorage };
export { BaseStorage } from './interface.js';
export { FSStorageAdapter } from './fs-adapter.js';
export { SQLiteStorageAdapter } from './sqlite-adapter.js';
export { S3StorageAdapter } from './s3-adapter.js';

/**
 * Storage service factory
 * Creates the appropriate storage adapter based on configuration
 */
export class StorageService implements IStorage {
  private adapter: IStorage;

  constructor(config: StorageAdapterConfig) {
    switch (config.type) {
      case 'fs':
        this.adapter = new FSStorageAdapter(config);
        break;
      case 'sqlite':
        this.adapter = new SQLiteStorageAdapter(config);
        break;
      case 's3':
        this.adapter = new S3StorageAdapter(config);
        break;
      default:
        throw new Error(`Unknown storage type: ${(config as { type: string }).type}`);
    }
  }

  async initialize(): Promise<void> {
    if ('initialize' in this.adapter && typeof this.adapter.initialize === 'function') {
      await (this.adapter as FSStorageAdapter | SQLiteStorageAdapter | S3StorageAdapter).initialize();
    }
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
}

/**
 * Create a storage service from configuration
 */
export function createStorage(config: StorageAdapterConfig): StorageService {
  return new StorageService(config);
}