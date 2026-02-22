import { RoleStorageAdapter, type RoleStorageConfig, type McpServerConfig } from './role-adapter.js';
import { getMainDatabase, type RoleDefinition } from './main-db.js';
import type { IStorage, IMessageStorage, ChatMessageEntry } from './interface.js';
import type { MemoryEntry } from '@local-agent/shared';
import path from 'path';

/**
 * Role storage manager
 * 
 * Manages role-specific storage adapters and provides a unified interface
 * for accessing role-specific data. Each role has its own isolated SQLite
 * database for complete separation of:
 * - Memory
 * - Chat messages
 * - Settings
 * - MCP server configurations
 * - OAuth tokens (role-specific)
 */
export class RoleStorageService implements IStorage, IMessageStorage {
  private dataDir: string;
  private roleAdapters: Map<string, RoleStorageAdapter> = new Map();
  private currentRoleId: string | null = null;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
  }

  async initialize(): Promise<void> {
    // Initialize main database
    const mainDb = getMainDatabase(this.dataDir);
    await mainDb.initialize();
    console.log('[RoleStorageService] Main database initialized');
  }

  // ============================================
  // Role Management
  // ============================================

  /**
   * Create a new role with its own isolated database
   */
  async createRole(
    userId: string,
    name: string,
    groupId?: string,
    jobDesc?: string,
    systemPrompt?: string,
    model?: string
  ): Promise<RoleDefinition> {
    const mainDb = getMainDatabase(this.dataDir);
    
    // Create role in main database
    const role = mainDb.createRole(userId, name, groupId, jobDesc, systemPrompt, model);
    
    // Create and initialize the role-specific database
    const adapter = await this.getRoleAdapter(role.id);
    console.log(`[RoleStorageService] Created role ${role.id} with name "${name}"`);
    
    return role;
  }

  /**
   * Get a role by ID
   */
  getRole(roleId: string): RoleDefinition | null {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getRole(roleId);
  }

  /**
   * Get all roles for a user
   */
  getUserRoles(userId: string): RoleDefinition[] {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getUserRoles(userId);
  }

  /**
   * Get all roles for a group
   */
  getGroupRoles(groupId: string): RoleDefinition[] {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getGroupRoles(groupId);
  }

  /**
   * Update a role
   */
  updateRole(roleId: string, updates: Partial<Omit<RoleDefinition, 'id' | 'userId' | 'createdAt'>>): RoleDefinition | null {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.updateRole(roleId, updates);
  }

  /**
   * Delete a role and its database
   */
  async deleteRole(roleId: string): Promise<boolean> {
    const mainDb = getMainDatabase(this.dataDir);
    
    // Close and remove the adapter from cache
    const adapter = this.roleAdapters.get(roleId);
    if (adapter) {
      adapter.close();
      this.roleAdapters.delete(roleId);
    }
    
    // Delete the role database file
    mainDb.deleteRoleDb(roleId);
    
    // Delete from main database
    const result = mainDb.deleteRole(roleId);
    console.log(`[RoleStorageService] Deleted role ${roleId}`);
    
    return result;
  }

  /**
   * Set the current active role
   */
  setCurrentRole(roleId: string): void {
    this.currentRoleId = roleId;
  }

  /**
   * Get the current active role ID
   */
  getCurrentRoleId(): string | null {
    return this.currentRoleId;
  }

  // ============================================
  // Role Adapter Management
  // ============================================

  /**
   * Get or create a role storage adapter
   */
  async getRoleAdapter(roleId: string): Promise<RoleStorageAdapter> {
    let adapter = this.roleAdapters.get(roleId);
    
    if (!adapter) {
      adapter = new RoleStorageAdapter({
        roleId,
        dataDir: this.dataDir,
      });
      await adapter.initialize();
      this.roleAdapters.set(roleId, adapter);
    }
    
    return adapter;
  }

  /**
   * Close a specific role adapter
   */
  closeRoleAdapter(roleId: string): void {
    const adapter = this.roleAdapters.get(roleId);
    if (adapter) {
      adapter.close();
      this.roleAdapters.delete(roleId);
    }
  }

  /**
   * Close all role adapters
   */
  closeAllAdapters(): void {
    for (const adapter of this.roleAdapters.values()) {
      adapter.close();
    }
    this.roleAdapters.clear();
  }

  /**
   * Get the database path for a specific role
   */
  getRoleDatabasePath(roleId: string): string {
    return path.join(this.dataDir, `role_${roleId}.db`);
  }

  /**
   * Get the current role adapter (throws if no role is set)
   */
  private async getCurrentAdapter(): Promise<RoleStorageAdapter> {
    if (!this.currentRoleId) {
      throw new Error('No role is currently active. Call setCurrentRole() first.');
    }
    return this.getRoleAdapter(this.currentRoleId);
  }

  // ============================================
  // IStorage Interface - Delegates to current role
  // ============================================

  async read(path: string): Promise<string | null> {
    const adapter = await this.getCurrentAdapter();
    return adapter.read(path);
  }

  async write(path: string, content: string): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.write(path, content);
  }

  async append(path: string, content: string): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.append(path, content);
  }

  async delete(path: string): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.delete(path);
  }

  async exists(path: string): Promise<boolean> {
    const adapter = await this.getCurrentAdapter();
    return adapter.exists(path);
  }

  async list(dir: string): Promise<string[]> {
    const adapter = await this.getCurrentAdapter();
    return adapter.list(dir);
  }

  // ============================================
  // Memory Operations
  // ============================================

  async saveMemory(entry: MemoryEntry): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.saveMemory(entry);
  }

  async getMemory(id: string): Promise<MemoryEntry | null> {
    const adapter = await this.getCurrentAdapter();
    return adapter.getMemory(id);
  }

  async listMemory(roleId: string): Promise<MemoryEntry[]> {
    const adapter = await this.getCurrentAdapter();
    return adapter.listMemory(roleId);
  }

  async searchMemory(query: string, roleId: string, limit?: number): Promise<MemoryEntry[]> {
    const adapter = await this.getCurrentAdapter();
    return adapter.searchMemory(query, roleId, limit);
  }

  async searchMemoryByEmbedding(embedding: number[], roleId: string, limit?: number): Promise<MemoryEntry[]> {
    const adapter = await this.getCurrentAdapter();
    return adapter.searchMemoryByEmbedding(embedding, roleId, limit);
  }

  async deleteMemory(id: string): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.deleteMemory(id);
  }

  // ============================================
  // Message Operations (IMessageStorage)
  // ============================================

  async saveMessage(entry: ChatMessageEntry): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.saveMessage(entry);
  }

  async getMessage(id: string): Promise<ChatMessageEntry | null> {
    const adapter = await this.getCurrentAdapter();
    return adapter.getMessage(id);
  }

  async listMessages(roleId: string, options?: { limit?: number; before?: string }): Promise<ChatMessageEntry[]> {
    const adapter = await this.getCurrentAdapter();
    return adapter.listMessages(roleId, options);
  }

  async searchMessages(keyword: string, roleId: string, options?: { limit?: number }): Promise<ChatMessageEntry[]> {
    const adapter = await this.getCurrentAdapter();
    return adapter.searchMessages(keyword, roleId, options);
  }

  async deleteMessage(id: string): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.deleteMessage(id);
  }

  async clearMessages(roleId: string): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.clearMessages(roleId);
  }

  // ============================================
  // Metadata Operations
  // ============================================

  async getMetadata(table: string, id: string): Promise<Record<string, unknown> | null> {
    const adapter = await this.getCurrentAdapter();
    return adapter.getMetadata(table, id);
  }

  async setMetadata(table: string, id: string, data: Record<string, unknown>): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.setMetadata(table, id, data);
  }

  async deleteMetadata(table: string, id: string): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.deleteMetadata(table, id);
  }

  async queryMetadata(table: string, filter: Record<string, unknown>): Promise<Record<string, unknown>[]> {
    const adapter = await this.getCurrentAdapter();
    return adapter.queryMetadata(table, filter);
  }

  // ============================================
  // Settings Operations
  // ============================================

  async getSetting<T = unknown>(key: string): Promise<T | null> {
    const adapter = await this.getCurrentAdapter();
    return adapter.getSetting<T>(key);
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.setSetting(key, value);
  }

  async deleteSetting(key: string): Promise<void> {
    const adapter = await this.getCurrentAdapter();
    return adapter.deleteSetting(key);
  }

  async getAllSettings(): Promise<Record<string, unknown>> {
    const adapter = await this.getCurrentAdapter();
    return adapter.getAllSettings();
  }

  // ============================================
  // Role-specific Operations (MCP, OAuth)
  // ============================================

  /**
   * Save MCP server configuration for a role
   */
  async saveMcpServer(roleId: string, config: Omit<McpServerConfig, 'createdAt' | 'updatedAt'>): Promise<McpServerConfig> {
    const adapter = await this.getRoleAdapter(roleId);
    return adapter.saveMcpServer(config);
  }

  /**
   * Get MCP server configuration for a role
   */
  async getMcpServer(roleId: string, serverId: string): Promise<McpServerConfig | null> {
    const adapter = await this.getRoleAdapter(roleId);
    return adapter.getMcpServer(serverId);
  }

  /**
   * List all MCP servers for a role
   */
  async listMcpServers(roleId: string): Promise<McpServerConfig[]> {
    const adapter = await this.getRoleAdapter(roleId);
    return adapter.listMcpServers();
  }

  /**
   * Delete MCP server for a role
   */
  async deleteMcpServer(roleId: string, serverId: string): Promise<boolean> {
    const adapter = await this.getRoleAdapter(roleId);
    return adapter.deleteMcpServer(serverId);
  }

  /**
   * Store role-specific OAuth token
   */
  async storeRoleOAuthToken(
    roleId: string,
    provider: string,
    accessToken: string,
    refreshToken?: string,
    expiryDate?: number
  ): Promise<void> {
    const adapter = await this.getRoleAdapter(roleId);
    await adapter.storeRoleOAuthToken(provider, accessToken, refreshToken, expiryDate);
  }

  /**
   * Get role-specific OAuth token
   */
  async getRoleOAuthToken(roleId: string, provider: string): Promise<{ accessToken: string; refreshToken?: string; expiryDate?: number } | null> {
    const adapter = await this.getRoleAdapter(roleId);
    const token = adapter.getRoleOAuthToken(provider);
    if (!token) return null;
    return {
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiryDate: token.expiryDate,
    };
  }

  /**
   * Delete role-specific OAuth token
   */
  async deleteRoleOAuthToken(roleId: string, provider: string): Promise<boolean> {
    const adapter = await this.getRoleAdapter(roleId);
    return adapter.deleteRoleOAuthToken(provider);
  }

  // ============================================
  // IMessageStorage interface compatibility
  // ============================================

  /**
   * Get message storage for the current role
   */
  getMessageStorage(): IMessageStorage | null {
    if (!this.currentRoleId) {
      return null;
    }
    // Return self as we implement IMessageStorage
    return this;
  }
}

// Singleton instance
let roleStorageService: RoleStorageService | null = null;

export function getRoleStorageService(dataDir: string = './data'): RoleStorageService {
  if (!roleStorageService) {
    roleStorageService = new RoleStorageService(dataDir);
  }
  return roleStorageService;
}

export function closeRoleStorageService(): void {
  if (roleStorageService) {
    roleStorageService.closeAllAdapters();
    roleStorageService = null;
  }
}
