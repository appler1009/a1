import { promises as fs } from 'fs';
import path from 'path';
import Fuse from 'fuse.js';
import type { MemoryEntry } from '@local-agent/shared';
import { BaseStorage } from './interface.js';

export interface FSStorageConfig {
  type: 'fs';
  root: string;
}

/**
 * Filesystem storage adapter
 * Stores files and memory entries on the local filesystem
 */
export class FSStorageAdapter extends BaseStorage {
  private root: string;
  private memoryIndex: Map<string, MemoryEntry> = new Map();
  private memoryPath: string;

  constructor(config: FSStorageConfig) {
    super();
    this.root = path.resolve(config.root);
    this.memoryPath = path.join(this.root, 'memory');
  }

  async initialize(): Promise<void> {
    // Ensure directories exist
    await fs.mkdir(this.root, { recursive: true });
    await fs.mkdir(this.memoryPath, { recursive: true });
    await fs.mkdir(path.join(this.root, 'configs'), { recursive: true });
    await fs.mkdir(path.join(this.root, 'data'), { recursive: true });
    
    // Load existing memory entries into index
    await this.loadMemoryIndex();
  }

  private async loadMemoryIndex(): Promise<void> {
    try {
      const files = await fs.readdir(this.memoryPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(path.join(this.memoryPath, file), 'utf-8');
          const entry = JSON.parse(content) as MemoryEntry;
          this.memoryIndex.set(entry.id, entry);
        }
      }
    } catch {
      // Directory doesn't exist or is empty
    }
  }

  private getFullPath(relativePath: string): string {
    return path.join(this.root, relativePath);
  }

  // ============================================
  // File Operations
  // ============================================

  async read(path: string): Promise<string | null> {
    try {
      const fullPath = this.getFullPath(path);
      return await fs.readFile(fullPath, 'utf-8');
    } catch {
      return null;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const fullPath = this.getFullPath(path);
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir) {
      await fs.mkdir(this.getFullPath(dir), { recursive: true });
    }
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async append(path: string, content: string): Promise<void> {
    const fullPath = this.getFullPath(path);
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir) {
      await fs.mkdir(this.getFullPath(dir), { recursive: true });
    }
    await fs.appendFile(fullPath, content, 'utf-8');
  }

  async delete(path: string): Promise<void> {
    const fullPath = this.getFullPath(path);
    try {
      await fs.unlink(fullPath);
    } catch {
      // File doesn't exist
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const fullPath = this.getFullPath(path);
      await fs.access(fullPath);
      return true;
    } catch {
      return false;
    }
  }

  async list(dir: string): Promise<string[]> {
    try {
      const fullPath = this.getFullPath(dir);
      const files = await fs.readdir(fullPath);
      return files;
    } catch {
      return [];
    }
  }

  // ============================================
  // Memory Operations
  // ============================================

  async saveMemory(entry: MemoryEntry): Promise<void> {
    const filePath = path.join(this.memoryPath, `${entry.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
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
    return results.map(r => r.item);
  }

  async searchMemoryByEmbedding(_embedding: number[], _roleId: string, _limit?: number): Promise<MemoryEntry[]> {
    // FS adapter doesn't support embedding search natively
    // This would require a vector database or external service
    console.warn('FSStorageAdapter: Embedding search not implemented');
    return [];
  }

  async deleteMemory(id: string): Promise<void> {
    const filePath = path.join(this.memoryPath, `${id}.json`);
    try {
      await fs.unlink(filePath);
      this.memoryIndex.delete(id);
    } catch {
      // File doesn't exist
    }
  }

  // ============================================
  // Metadata Operations
  // ============================================

  private getMetadataPath(table: string): string {
    return path.join(this.root, 'data', `${table}.json`);
  }

  async getMetadata(table: string, id: string): Promise<Record<string, unknown> | null> {
    try {
      const filePath = this.getMetadataPath(table);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      return data[id] || null;
    } catch {
      return null;
    }
  }

  async setMetadata(table: string, id: string, data: Record<string, unknown>): Promise<void> {
    const filePath = this.getMetadataPath(table);
    let existing: Record<string, Record<string, unknown>> = {};
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      existing = JSON.parse(content);
    } catch {
      // File doesn't exist
    }

    existing[id] = data;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(existing, null, 2), 'utf-8');
  }

  async deleteMetadata(table: string, id: string): Promise<void> {
    try {
      const filePath = this.getMetadataPath(table);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      delete data[id];
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // File doesn't exist
    }
  }

  async queryMetadata(table: string, filter: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    try {
      const filePath = this.getMetadataPath(table);
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content) as Record<string, Record<string, unknown>>;
      
      return Object.values(data).filter(item => {
        for (const [key, value] of Object.entries(filter)) {
          if (item[key] !== value) {
            return false;
          }
        }
        return true;
      });
    } catch {
      return [];
    }
  }

  // ============================================
  // Settings Operations
  // ============================================

  private getSettingsPath(): string {
    return path.join(this.root, 'data', 'settings.json');
  }

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    try {
      const filePath = this.getSettingsPath();
      const content = await fs.readFile(filePath, 'utf-8');
      const settings = JSON.parse(content) as Record<string, unknown>;
      return (settings[key] as T) || null;
    } catch {
      return null;
    }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const filePath = this.getSettingsPath();
    let settings: Record<string, unknown> = {};
    
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      settings = JSON.parse(content);
    } catch {
      // File doesn't exist
    }

    settings[key] = value;
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  async deleteSetting(key: string): Promise<void> {
    try {
      const filePath = this.getSettingsPath();
      const content = await fs.readFile(filePath, 'utf-8');
      const settings = JSON.parse(content);
      delete settings[key];
      await fs.writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch {
      // File doesn't exist
    }
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    try {
      const filePath = this.getSettingsPath();
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}