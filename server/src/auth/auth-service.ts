import type { User, Session, Group, GroupMember, Invitation } from '@local-agent/shared';
import { getMainDatabase, type OAuthTokenEntry } from '../storage/main-db.js';

/**
 * Authentication service using the main database
 * 
 * Handles user registration, sessions, groups, and OAuth tokens.
 * All data is stored in the main SQLite database (main.db).
 */
export class AuthService {
  private dataDir: string;

  constructor(dataDir: string = './data') {
    this.dataDir = dataDir;
  }

  async initialize(): Promise<void> {
    const mainDb = getMainDatabase(this.dataDir);
    await mainDb.initialize();
    console.log('[AuthService] Initialized with main database');
  }

  // ============================================
  // User Operations
  // ============================================

  async createUser(email: string, name?: string, accountType: 'individual' | 'group' = 'individual'): Promise<User> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.createUser(email, name, accountType);
  }

  async getUser(id: string): Promise<User | null> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getUser(id);
  }

  async getUserByEmail(email: string): Promise<User | null> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getUserByEmail(email);
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.updateUser(id, updates);
  }

  // ============================================
  // Session Operations
  // ============================================

  async createSession(userId: string): Promise<Session> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.createSession(userId);
  }

  async getSession(id: string): Promise<Session | null> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getSession(id);
  }

  async deleteSession(id: string): Promise<void> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.deleteSession(id);
  }

  // ============================================
  // Group Operations
  // ============================================

  async createGroup(name: string, url?: string): Promise<Group> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.createGroup(name, url);
  }

  async getGroup(id: string): Promise<Group | null> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getGroup(id);
  }

  async getGroupByUrl(url: string): Promise<Group | null> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getGroupByUrl(url);
  }

  async getUserGroups(userId: string): Promise<Group[]> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getUserGroups(userId);
  }

  // ============================================
  // Membership Operations
  // ============================================

  async addMember(groupId: string, userId: string, role: 'owner' | 'admin' | 'member' = 'member'): Promise<GroupMember> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.addMember(groupId, userId, role);
  }

  async getMembership(groupId: string, userId: string): Promise<GroupMember | null> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getMembership(groupId, userId);
  }

  async getGroupMembers(groupId: string): Promise<GroupMember[]> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getGroupMembers(groupId);
  }

  async updateMemberRole(groupId: string, userId: string, role: 'owner' | 'admin' | 'member'): Promise<GroupMember | null> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.updateMemberRole(groupId, userId, role);
  }

  async removeMember(groupId: string, userId: string): Promise<boolean> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.removeMember(groupId, userId);
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
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.createInvitation(groupId, createdBy, email, role, expiresInSeconds);
  }

  async getInvitationByCode(code: string): Promise<Invitation | null> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getInvitationByCode(code);
  }

  async getGroupInvitations(groupId: string): Promise<Invitation[]> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getGroupInvitations(groupId);
  }

  async acceptInvitation(code: string, userId: string): Promise<GroupMember> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.acceptInvitation(code, userId);
  }

  async revokeInvitation(invitationId: string): Promise<boolean> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.revokeInvitation(invitationId);
  }

  // ============================================
  // OAuth Token Operations (User-level)
  // ============================================

  async storeOAuthToken(
    userId: string,
    token: { provider: string; accessToken: string; refreshToken?: string; expiryDate?: number; accountEmail?: string }
  ): Promise<OAuthTokenEntry> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.storeOAuthToken(userId, token.provider, token.accessToken, token.refreshToken, token.expiryDate, token.accountEmail);
  }

  async getOAuthToken(userId: string, provider: string, accountEmail?: string): Promise<OAuthTokenEntry | null> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.getOAuthToken(userId, provider, accountEmail);
  }

  async revokeOAuthToken(userId: string, provider: string): Promise<boolean> {
    const mainDb = getMainDatabase(this.dataDir);
    return mainDb.revokeOAuthToken(userId, provider);
  }

  // ============================================
  // Helper Methods
  // ============================================

  /**
   * Create user with group (for group account creation)
   */
  async createGroupUser(
    email: string,
    name: string | undefined,
    groupName: string,
    groupUrl: string | undefined
  ): Promise<{ user: User; group: Group; invitation: Invitation }> {
    // Create user
    const user = await this.createUser(email, name, 'group');
    
    // Create group
    const group = await this.createGroup(groupName, groupUrl);
    
    // Add user as owner
    await this.addMember(group.id, user.id, 'owner');
    
    // Create invitation code for inviting others
    const invitation = await this.createInvitation(group.id, user.id, undefined, 'member');
    
    return { user, group, invitation };
  }

  // Legacy aliases for backward compatibility
  async createOrganization(name: string, url?: string, _ownerId?: string): Promise<Group> {
    return this.createGroup(name, url);
  }

  async getOrganization(id: string): Promise<Group | null> {
    return this.getGroup(id);
  }

  async getUserOrganizations(userId: string): Promise<Group[]> {
    return this.getUserGroups(userId);
  }

  async createOrgUser(
    email: string,
    name: string | undefined,
    groupId: string,
    role: 'owner' | 'admin' | 'member' = 'member'
  ): Promise<User> {
    const user = await this.createUser(email, name, 'group');
    await this.addMember(groupId, user.id, role);
    return user;
  }
}

// Singleton instance
let authService: AuthService | null = null;

export function getAuthService(dataDir: string = './data'): AuthService {
  if (!authService) {
    authService = new AuthService(dataDir);
  }
  return authService;
}

// Export for backward compatibility
export { authService as default } from './index.js';
