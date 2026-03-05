/**
 * Temp Storage Abstraction
 * 
 * Provides unified temp file operations that work with both
 * local filesystem and S3 storage backends.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type { AppConfig } from '../config/index.js';
import { S3StorageAdapter } from './s3-adapter.js';

export interface TempStorageConfig {
  type: 'fs' | 's3';
  root: string;
  bucket?: string;
}

export interface TempFileInfo {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string;
  fileUri?: string;
  absolutePath?: string;
  size: number;
  cached: boolean;
}

/**
 * TempStorage - Unified temp file storage for FS and S3
 */
export class TempStorage {
  private storageType: 'fs' | 's3';
  private root: string;
  private s3Adapter: S3StorageAdapter | null = null;
  private fsTempDir: string;

  constructor(config: TempStorageConfig) {
    this.storageType = config.type;
    this.root = config.root;
    this.fsTempDir = path.join(this.root, 'temp');

    if (config.type === 's3' && config.bucket) {
      this.s3Adapter = new S3StorageAdapter({
        type: 's3',
        bucket: config.bucket,
      });
    }
  }

  /**
   * Get the appropriate temp directory path
   */
  private getTempDir(): string {
    return this.fsTempDir;
  }

  /**
   * Write a temp file
   */
  async writeTempFile(filename: string, data: Buffer | string): Promise<void> {
    if (this.storageType === 's3' && this.s3Adapter) {
      const buffer = typeof data === 'string' ? Buffer.from(data) : data;
      await this.s3Adapter.writeBinary(filename, buffer);
    } else {
      // Local filesystem
      const tempDir = this.getTempDir();
      await fs.mkdir(tempDir, { recursive: true });
      const filePath = path.join(tempDir, filename);
      await fs.writeFile(filePath, data);
    }
  }

  /**
   * Read a temp file
   */
  async readTempFile(filename: string): Promise<Buffer | null> {
    if (this.storageType === 's3' && this.s3Adapter) {
      return this.s3Adapter.readBinary(filename);
    } else {
      // Local filesystem
      try {
        const filePath = path.join(this.getTempDir(), filename);
        return await fs.readFile(filePath);
      } catch {
        return null;
      }
    }
  }

  /**
   * Read a temp file as string (for JSON/text files)
   */
  async readTempFileAsString(filename: string): Promise<string | null> {
    const buffer = await this.readTempFile(filename);
    if (buffer) {
      return buffer.toString('utf-8');
    }
    return null;
  }

  /**
   * Delete a temp file
   */
  async deleteTempFile(filename: string): Promise<void> {
    if (this.storageType === 's3' && this.s3Adapter) {
      await this.s3Adapter.deleteBinary(filename);
    } else {
      // Local filesystem
      try {
        const filePath = path.join(this.getTempDir(), filename);
        await fs.unlink(filePath);
      } catch {
        // Ignore errors during deletion
      }
    }
  }

  /**
   * List all temp files
   */
  async listTempFiles(): Promise<string[]> {
    if (this.storageType === 's3' && this.s3Adapter) {
      return this.s3Adapter.listBinary();
    } else {
      // Local filesystem
      try {
        const tempDir = this.getTempDir();
        return await fs.readdir(tempDir);
      } catch {
        return [];
      }
    }
  }

  /**
   * Check if a temp file exists
   */
  async tempFileExists(filename: string): Promise<boolean> {
    if (this.storageType === 's3' && this.s3Adapter) {
      return this.s3Adapter.existsBinary(filename);
    } else {
      // Local filesystem
      try {
        const filePath = path.join(this.getTempDir(), filename);
        await fs.access(filePath);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * Get temp file metadata
   */
  async getTempFileMetadata(filename: string): Promise<{ size: number; contentType: string } | null> {
    if (this.storageType === 's3' && this.s3Adapter) {
      return this.s3Adapter.getBinaryMetadata(filename);
    } else {
      // Local filesystem
      try {
        const filePath = path.join(this.getTempDir(), filename);
        const stats = await fs.stat(filePath);
        const ext = filename.split('.').pop()?.toLowerCase() || '';
        const contentTypes: Record<string, string> = {
          pdf: 'application/pdf',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          svg: 'image/svg+xml',
          html: 'text/html',
          txt: 'text/plain',
          json: 'application/json',
          md: 'text/markdown',
        };
        return {
          size: stats.size,
          contentType: contentTypes[ext] || 'application/octet-stream',
        };
      } catch {
        return null;
      }
    }
  }

  /**
   * Get absolute path for local files, or generate a preview URL for S3
   */
  getPreviewUrl(filename: string): string {
    return `/api/viewer/temp/${filename}`;
  }

  /**
   * Get the storage type
   */
  getStorageType(): 'fs' | 's3' {
    return this.storageType;
  }

  /**
   * Find a temp file by cache ID (matches prefix before extension)
   */
  async findTempFileByCacheId(cacheId: string): Promise<string | null> {
    const files = await this.listTempFiles();
    
    // Find a file that starts with the cache ID (format: {cacheId}.{ext})
    const matchingFile = files.find(f => {
      const dotIndex = f.lastIndexOf('.');
      const fileCacheId = dotIndex > 0 ? f.substring(0, dotIndex) : f;
      return fileCacheId === cacheId;
    });
    
    return matchingFile || null;
  }

  /**
   * Get absolute path for local filesystem files
   */
  getAbsolutePath(filename: string): string {
    return path.resolve(path.join(this.getTempDir(), filename));
  }

  /**
   * Generate file:// URI for local files
   */
  getFileUri(filename: string): string {
    if (this.storageType === 's3') {
      // For S3, return a special URI that the resolver can handle
      return `s3://temp/${filename}`;
    }
    const absolutePath = this.getAbsolutePath(filename);
    return `file://${absolutePath}`;
  }

  /**
   * Generate file:// URI for local files (async version for S3)
   */
  async getFileUriAsync(filename: string): Promise<string> {
    if (this.storageType === 's3' && this.s3Adapter) {
      // For S3, try to get a presigned URL or return S3 URI
      try {
        // Check if the file exists
        const exists = await this.s3Adapter.existsBinary(filename);
        if (exists) {
          // Return S3 URI format that can be used internally
          return `s3://${this.s3Adapter['bucket']}/temp/${filename}`;
        }
      } catch {
        // Fall through to S3 URI
      }
      return `s3://temp/${filename}`;
    }
    const absolutePath = this.getAbsolutePath(filename);
    return `file://${absolutePath}`;
  }
}

/**
 * Create a TempStorage instance from app config
 */
export function createTempStorage(config: {
  storage: AppConfig['storage'];
}): TempStorage {
  // Temp storage only supports 'fs' or 's3' - fallback to 'fs' for sqlite
  const storageType = config.storage.type === 's3' ? 's3' : 'fs';
  
  return new TempStorage({
    type: storageType,
    root: config.storage.root,
    bucket: config.storage.bucket,
  });
}
