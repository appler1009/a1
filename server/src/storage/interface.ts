import type { MemoryEntry } from '@local-agent/shared';

/**
 * Chat message entry for storage
 */
export interface ChatMessageEntry {
  id: string;
  roleId: string;
  groupId: string | null;
  userId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date | string;
}

/**
 * Message storage interface
 * Only SQLite adapter implements this - storing messages to filesystem/S3 doesn't make sense
 */
export interface IMessageStorage {
  saveMessage(entry: ChatMessageEntry): Promise<void>;
  getMessage(id: string): Promise<ChatMessageEntry | null>;
  listMessages(roleId: string, options?: { limit?: number; before?: string }): Promise<ChatMessageEntry[]>;
  searchMessages(keyword: string, roleId: string, options?: { limit?: number }): Promise<ChatMessageEntry[]>;
  deleteMessage(id: string): Promise<void>;
  clearMessages(roleId: string): Promise<void>;
}

/**
 * Storage interface
 * All storage adapters must implement this interface
 */
export interface IStorage {
  // File operations
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  append(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;

  // Memory operations
  saveMemory(entry: MemoryEntry): Promise<void>;
  getMemory(id: string): Promise<MemoryEntry | null>;
  listMemory(roleId: string): Promise<MemoryEntry[]>;
  searchMemory(query: string, roleId: string, limit?: number): Promise<MemoryEntry[]>;
  searchMemoryByEmbedding(embedding: number[], roleId: string, limit?: number): Promise<MemoryEntry[]>;
  deleteMemory(id: string): Promise<void>;

  // Metadata operations (for SQLite)
  getMetadata(table: string, id: string): Promise<Record<string, unknown> | null>;
  setMetadata(table: string, id: string, data: Record<string, unknown>): Promise<void>;
  deleteMetadata(table: string, id: string): Promise<void>;
  queryMetadata(table: string, filter: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

/**
 * Abstract storage base class
 * Provides a base implementation for storage adapters
 */
export abstract class BaseStorage implements IStorage {
  abstract read(path: string): Promise<string | null>;
  abstract write(path: string, content: string): Promise<void>;
  abstract append(path: string, content: string): Promise<void>;
  abstract delete(path: string): Promise<void>;
  abstract exists(path: string): Promise<boolean>;
  abstract list(dir: string): Promise<string[]>;

  abstract saveMemory(entry: MemoryEntry): Promise<void>;
  abstract getMemory(id: string): Promise<MemoryEntry | null>;
  abstract listMemory(roleId: string): Promise<MemoryEntry[]>;
  abstract searchMemory(query: string, roleId: string, limit?: number): Promise<MemoryEntry[]>;
  abstract searchMemoryByEmbedding(embedding: number[], roleId: string, limit?: number): Promise<MemoryEntry[]>;
  abstract deleteMemory(id: string): Promise<void>;

  abstract getMetadata(table: string, id: string): Promise<Record<string, unknown> | null>;
  abstract setMetadata(table: string, id: string, data: Record<string, unknown>): Promise<void>;
  abstract deleteMetadata(table: string, id: string): Promise<void>;
  abstract queryMetadata(table: string, filter: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}