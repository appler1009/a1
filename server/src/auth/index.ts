import type { User, Session, Group, GroupMember, Invitation } from '@local-agent/shared';
import { v4 as uuidv4 } from 'uuid';
import { createStorage } from '../storage/index.js';

export interface AuthConfig {
  storage: 'fs' | 'sqlite' | 's3';
}

export class AuthService {
  private storage: ReturnType<typeof createStorage>;
  private users: Map<string, User> = new Map();
  private sessions: Map<string, Session> = new Map();
  private groups: Map<string, Group> = new Map();
  private memberships: GroupMember[] = [];
  private invitations: Invitation[] = [];

  constructor(config: AuthConfig) {
    this.storage = createStorage({
      type: config.storage,
      root: './data',
      bucket: '',
    });
  }

  async initialize() {
    await this.storage.initialize();
    await this.loadFromStorage();
  }

  private async loadFromStorage() {
    // Load users
    try {
      const usersData = await this.storage.read('auth_users.json');
      if (usersData) {
        const users = JSON.parse(usersData);
        this.users = new Map(Object.entries(users));
      }
    } catch (e) {
      // File doesn't exist yet, start empty
    }

    // Load sessions
    try {
      const sessionsData = await this.storage.read('auth_sessions.json');
      if (sessionsData) {
        const sessions = JSON.parse(sessionsData);
        this.sessions = new Map(Object.entries(sessions));
      }
    } catch (e) {
      // File doesn't exist yet, start empty
    }

    // Load groups
    try {
      const groupsData = await this.storage.read('auth_groups.json');
      if (groupsData) {
        const groups = JSON.parse(groupsData);
        this.groups = new Map(Object.entries(groups));
      }
    } catch (e) {
      // File doesn't exist yet, start empty
    }

    // Load memberships
    try {
      const membershipsData = await this.storage.read('auth_memberships.json');
      if (membershipsData) {
        this.memberships = JSON.parse(membershipsData);
      }
    } catch (e) {
      // File doesn't exist yet, start empty
    }

    // Load invitations
    try {
      const invitationsData = await this.storage.read('auth_invitations.json');
      if (invitationsData) {
        this.invitations = JSON.parse(invitationsData);
      }
    } catch (e) {
      // File doesn't exist yet, start empty
    }
  }

  private async saveToStorage() {
    // Save users
    await this.storage.write('auth_users.json', JSON.stringify(Object.fromEntries(this.users)));

    // Save sessions
    await this.storage.write('auth_sessions.json', JSON.stringify(Object.fromEntries(this.sessions)));

    // Save groups
    await this.storage.write('auth_groups.json', JSON.stringify(Object.fromEntries(this.groups)));

    // Save memberships
    await this.storage.write('auth_memberships.json', JSON.stringify(this.memberships));

    // Save invitations
    await this.storage.write('auth_invitations.json', JSON.stringify(this.invitations));
  }

  // User methods
  async createUser(email: string, name?: string, accountType: 'individual' | 'group' = 'individual'): Promise<User> {
    const id = uuidv4();
    const user: User = {
      id,
      email,
      name,
      accountType,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.users.set(id, user);
    await this.saveToStorage();
    return user;
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) || null;
  }

  async getUserByEmail(email: string): Promise<User | null> {
    for (const user of this.users.values()) {
      if (user.email === email) {
        return user;
      }
    }
    return null;
  }

  async updateUser(id: string, updates: Partial<User>): Promise<User | null> {
    const user = this.users.get(id);
    if (!user) return null;
    Object.assign(user, updates, { updatedAt: new Date() });
    this.users.set(id, user);
    await this.saveToStorage();
    return user;
  }

  // Session methods
  async createSession(userId: string): Promise<Session> {
    const id = uuidv4();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
    const session: Session = {
      id,
      userId,
      expiresAt,
      createdAt: new Date(),
    };
    this.sessions.set(id, session);
    await this.saveToStorage();
    return session;
  }

  async getSession(id: string): Promise<Session | null> {
    const session = this.sessions.get(id);
    if (!session) return null;
    if (new Date(session.expiresAt) < new Date()) {
      this.sessions.delete(id);
      return null;
    }
    return session;
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id);
    await this.saveToStorage();
  }

  // Group methods (formerly Organization)
  async createGroup(name: string, url?: string): Promise<Group> {
    const id = uuidv4();
    const group: Group = {
      id,
      name,
      url,
      createdAt: new Date(),
    };
    this.groups.set(id, group);
    await this.saveToStorage();
    return group;
  }

  async getGroup(id: string): Promise<Group | null> {
    return this.groups.get(id) || null;
  }

  async getGroupByUrl(url: string): Promise<Group | null> {
    for (const group of this.groups.values()) {
      if (group.url === url) {
        return group;
      }
    }
    return null;
  }

  async getUserGroups(userId: string): Promise<Group[]> {
    const groupIds = new Set<string>();
    
    // Add groups where user is a member
    for (const membership of this.memberships) {
      if (membership.userId === userId) {
        groupIds.add(membership.groupId);
      }
    }
    
    return Array.from(groupIds)
      .map((id) => this.groups.get(id))
      .filter((g): g is Group => g !== undefined);
  }

  // Membership methods
  async addMember(groupId: string, userId: string, role: 'owner' | 'admin' | 'member' = 'member'): Promise<GroupMember> {
    const id = uuidv4();
    const membership: GroupMember = {
      id,
      groupId,
      userId,
      role,
      createdAt: new Date(),
    };
    this.memberships.push(membership);
    await this.saveToStorage();
    return membership;
  }

  async getMembership(groupId: string, userId: string): Promise<GroupMember | null> {
    return this.memberships.find(
      (m) => m.groupId === groupId && m.userId === userId
    ) || null;
  }

  async getGroupMembers(groupId: string): Promise<GroupMember[]> {
    return this.memberships.filter((m) => m.groupId === groupId);
  }

  async updateMemberRole(groupId: string, userId: string, role: 'owner' | 'admin' | 'member'): Promise<GroupMember | null> {
    const membership = this.memberships.find(
      (m) => m.groupId === groupId && m.userId === userId
    );
    if (!membership) return null;
    membership.role = role;
    await this.saveToStorage();
    return membership;
  }

  async removeMember(groupId: string, userId: string): Promise<boolean> {
    const index = this.memberships.findIndex(
      (m) => m.groupId === groupId && m.userId === userId
    );
    if (index === -1) return false;
    this.memberships.splice(index, 1);
    await this.saveToStorage();
    return true;
  }

  // Invitation methods
  async createInvitation(
    groupId: string,
    createdBy: string,
    email?: string,
    role: 'owner' | 'admin' | 'member' = 'member',
    expiresInSeconds: number = 7 * 24 * 60 * 60 // 7 days
  ): Promise<Invitation> {
    const id = uuidv4();
    const code = this.generateInviteCode();
    const invitation: Invitation = {
      id,
      code,
      groupId,
      createdBy,
      email,
      role,
      expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      createdAt: new Date(),
    };
    this.invitations.push(invitation);
    await this.saveToStorage();
    return invitation;
  }

  async getInvitationByCode(code: string): Promise<Invitation | null> {
    return this.invitations.find((inv) => inv.code === code) || null;
  }

  async getGroupInvitations(groupId: string): Promise<Invitation[]> {
    return this.invitations.filter(
      (inv) => inv.groupId === groupId && !inv.usedAt
    );
  }

  async acceptInvitation(code: string, userId: string): Promise<GroupMember> {
    const invitation = this.invitations.find((inv) => inv.code === code);
    if (!invitation) {
      throw new Error('Invitation not found');
    }

    if (invitation.usedAt) {
      throw new Error('Invitation already used');
    }

    if (invitation.expiresAt && new Date(invitation.expiresAt) < new Date()) {
      throw new Error('Invitation expired');
    }

    invitation.usedAt = new Date();
    invitation.acceptedAt = new Date();

    const membership = await this.addMember(invitation.groupId, userId, invitation.role || 'member');
    await this.updateUser(userId, { accountType: 'group' });
    await this.saveToStorage();

    return membership;
  }

  async revokeInvitation(invitationId: string): Promise<boolean> {
    const index = this.invitations.findIndex((inv) => inv.id === invitationId);
    if (index === -1) return false;
    this.invitations.splice(index, 1);
    await this.saveToStorage();
    return true;
  }

  // Helper methods
  private generateInviteCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  // Create user with group (for group account creation)
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

// Export singleton instance
export const authService = new AuthService({ storage: 'sqlite' });