import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import Fuse from 'fuse.js';
import type { MemoryEntry } from '@local-agent/shared';
import { BaseStorage } from './interface.js';

export interface S3StorageConfig {
  type: 's3';
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

/**
 * S3/MinIO storage adapter
 * Stores files and memory entries in S3-compatible storage
 */
export class S3StorageAdapter extends BaseStorage {
  private client: S3Client;
  private bucket: string;
  private memoryIndex: Map<string, MemoryEntry> = new Map();
  private prefix: string;

  constructor(config: S3StorageConfig) {
    super();
    this.bucket = config.bucket;
    this.prefix = '';
    
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region || 'us-east-1',
      forcePathStyle: config.forcePathStyle ?? !!config.endpoint,
      credentials: config.accessKeyId && config.secretAccessKey ? {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      } : undefined,
    });
  }

  async initialize(): Promise<void> {
    // Load existing memory entries into index
    await this.loadMemoryIndex();
  }

  private async loadMemoryIndex(): Promise<void> {
    try {
      const objects = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${this.prefix}memory/`,
        })
      );

      if (objects.Contents) {
        for (const obj of objects.Contents) {
          if (obj.Key?.endsWith('.json')) {
            const content = await this.getObject(obj.Key);
            if (content) {
              const entry = JSON.parse(content) as MemoryEntry;
              this.memoryIndex.set(entry.id, entry);
            }
          }
        }
      }
    } catch {
      // Bucket doesn't exist or is empty
    }
  }

  private async getObject(key: string): Promise<string | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      
      if (response.Body) {
        return await response.Body.transformToString('utf-8');
      }
      return null;
    } catch {
      return null;
    }
  }

  private async putObject(key: string, content: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: 'application/json',
      })
    );
  }

  private async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      })
    );
  }

  private async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // File Operations
  // ============================================

  async read(path: string): Promise<string | null> {
    return this.getObject(`${this.prefix}${path}`);
  }

  async write(path: string, content: string): Promise<void> {
    await this.putObject(`${this.prefix}${path}`, content);
  }

  async append(path: string, content: string): Promise<void> {
    const existing = await this.read(path);
    const newContent = existing ? existing + content : content;
    await this.write(path, newContent);
  }

  async delete(path: string): Promise<void> {
    await this.deleteObject(`${this.prefix}${path}`);
  }

  async exists(path: string): Promise<boolean> {
    return this.objectExists(`${this.prefix}${path}`);
  }

  async list(dir: string): Promise<string[]> {
    try {
      const objects = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${this.prefix}${dir}`,
        })
      );

      if (objects.Contents) {
        return objects.Contents
          .map(obj => obj.Key?.replace(`${this.prefix}`, '') || '')
          .filter(key => key.length > 0);
      }
      return [];
    } catch {
      return [];
    }
  }

  // ============================================
  // Memory Operations
  // ============================================

  async saveMemory(entry: MemoryEntry): Promise<void> {
    const key = `${this.prefix}memory/${entry.id}.json`;
    await this.putObject(key, JSON.stringify(entry, null, 2));
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
    // S3 doesn't support vector search natively
    // This would require a vector database like Pinecone, Weaviate, or pgvector
    console.warn('S3StorageAdapter: Embedding search not implemented');
    return [];
  }

  async deleteMemory(id: string): Promise<void> {
    const key = `${this.prefix}memory/${id}.json`;
    await this.deleteObject(key);
    this.memoryIndex.delete(id);
  }

  // ============================================
  // Metadata Operations
  // ============================================

  async getMetadata(table: string, id: string): Promise<Record<string, unknown> | null> {
    const content = await this.getObject(`${this.prefix}metadata/${table}/${id}.json`);
    return content ? JSON.parse(content) : null;
  }

  async setMetadata(table: string, id: string, data: Record<string, unknown>): Promise<void> {
    await this.putObject(`${this.prefix}metadata/${table}/${id}.json`, JSON.stringify(data, null, 2));
  }

  async deleteMetadata(table: string, id: string): Promise<void> {
    await this.deleteObject(`${this.prefix}metadata/${table}/${id}.json`);
  }

  async queryMetadata(table: string, filter: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    try {
      const objects = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: `${this.prefix}metadata/${table}/`,
        })
      );

      const results: Record<string, unknown>[] = [];
      
      if (objects.Contents) {
        for (const obj of objects.Contents) {
          if (obj.Key?.endsWith('.json')) {
            const content = await this.getObject(obj.Key);
            if (content) {
              const data = JSON.parse(content) as Record<string, unknown>;
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
          }
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  // ============================================
  // Settings Operations
  // ============================================

  private getSettingsKey(): string {
    return `${this.prefix}settings.json`;
  }

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    try {
      const content = await this.getObject(this.getSettingsKey());
      if (!content) return null;
      
      const settings = JSON.parse(content) as Record<string, unknown>;
      return (settings[key] as T) || null;
    } catch {
      return null;
    }
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    let settings: Record<string, unknown> = {};
    
    try {
      const content = await this.getObject(this.getSettingsKey());
      if (content) {
        settings = JSON.parse(content);
      }
    } catch {
      // File doesn't exist
    }

    settings[key] = value;
    await this.putObject(this.getSettingsKey(), JSON.stringify(settings, null, 2));
  }

  async deleteSetting(key: string): Promise<void> {
    try {
      const content = await this.getObject(this.getSettingsKey());
      if (content) {
        const settings = JSON.parse(content) as Record<string, unknown>;
        delete settings[key];
        await this.putObject(this.getSettingsKey(), JSON.stringify(settings, null, 2));
      }
    } catch {
      // File doesn't exist
    }
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    try {
      const content = await this.getObject(this.getSettingsKey());
      if (!content) return {};
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
}