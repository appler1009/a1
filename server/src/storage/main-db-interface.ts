import type { User, Session, Group, GroupMember, Invitation } from '@local-agent/shared';
import type { RoleDefinition, OAuthTokenEntry, SkillRecord, ScheduledJob } from './main-db.js';

export type { RoleDefinition, OAuthTokenEntry, SkillRecord, ScheduledJob };

export type MessageRow = {
  id: string;
  userId: string;
  roleId: string;
  groupId: string | null;
  role: string;
  content: string;
  createdAt: string;
};

/**
 * Async interface for the main relational database.
 * Implemented by SQLiteMainDatabase (local) and PostgresMainDatabase (AWS Aurora).
 */
export interface IMainDatabase {
  initialize(): Promise<void>;
  close(): void;

  // ---- Users ----
  createUser(email: string, name?: string, accountType?: string): Promise<User>;
  getUser(id: string): Promise<User | null>;
  getUserByEmail(email: string): Promise<User | null>;
  getUserByDiscordId(discordUserId: string): Promise<User | null>;
  updateUser(id: string, updates: Partial<User>): Promise<User | null>;
  getAllUsers(): Promise<User[]>;
  deleteUser(id: string): Promise<boolean>;

  // ---- Sessions ----
  createSession(userId: string): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  deleteSession(id: string): Promise<void>;

  // ---- Groups ----
  createGroup(name: string, url?: string): Promise<Group>;
  getGroup(id: string): Promise<Group | null>;
  getGroupByUrl(url: string): Promise<Group | null>;
  getUserGroups(userId: string): Promise<Group[]>;

  // ---- Memberships ----
  addMember(groupId: string, userId: string, role?: 'owner' | 'admin' | 'member'): Promise<GroupMember>;
  getMembership(groupId: string, userId: string): Promise<GroupMember | null>;
  getGroupMembers(groupId: string): Promise<GroupMember[]>;
  updateMemberRole(groupId: string, userId: string, role: 'owner' | 'admin' | 'member'): Promise<GroupMember | null>;
  removeMember(groupId: string, userId: string): Promise<boolean>;

  // ---- Invitations ----
  createInvitation(
    groupId: string,
    createdBy: string,
    email?: string,
    role?: 'owner' | 'admin' | 'member',
    expiresInSeconds?: number
  ): Promise<Invitation>;
  getInvitationByCode(code: string): Promise<Invitation | null>;
  getGroupInvitations(groupId: string): Promise<Invitation[]>;
  acceptInvitation(code: string, userId: string): Promise<GroupMember>;
  revokeInvitation(invitationId: string): Promise<boolean>;

  // ---- Roles ----
  createRole(
    userId: string,
    name: string,
    groupId?: string,
    jobDesc?: string,
    systemPrompt?: string,
    model?: string
  ): Promise<RoleDefinition>;
  getRole(id: string): Promise<RoleDefinition | null>;
  getUserRoles(userId: string): Promise<RoleDefinition[]>;
  getGroupRoles(groupId: string): Promise<RoleDefinition[]>;
  updateRole(id: string, updates: Partial<Omit<RoleDefinition, 'id' | 'userId' | 'createdAt'>>): Promise<RoleDefinition | null>;
  deleteRole(id: string): Promise<boolean>;

  // ---- OAuth Tokens ----
  storeOAuthToken(
    userId: string,
    provider: string,
    accessToken: string,
    refreshToken?: string,
    expiryDate?: number,
    accountEmail?: string
  ): Promise<OAuthTokenEntry>;
  getOAuthToken(userId: string, provider: string, accountEmail?: string): Promise<OAuthTokenEntry | null>;
  getAllUserOAuthTokens(userId: string, provider: string): Promise<OAuthTokenEntry[]>;
  getOAuthTokenByAccountEmail(provider: string, accountEmail: string): Promise<OAuthTokenEntry | null>;
  revokeOAuthToken(userId: string, provider: string, accountEmail?: string): Promise<boolean>;

  // ---- MCP Servers ----
  saveMCPServerConfig(serverId: string, config: Record<string, unknown>): Promise<void>;
  getMCPServerConfigs(): Promise<Array<{ id: string; config: Record<string, unknown> }>>;
  getMCPServerConfig(serverId: string): Promise<Record<string, unknown> | null>;
  deleteMCPServerConfig(serverId: string): Promise<boolean>;

  // ---- Messages ----
  saveMessage(entry: {
    id: string;
    userId: string;
    roleId: string;
    groupId: string | null;
    role: string;
    content: string;
    createdAt: string | Date;
  }): Promise<void>;
  listMessages(
    userId: string,
    roleId: string,
    options?: { limit?: number; before?: string }
  ): Promise<MessageRow[]>;
  searchMessages(
    userId: string,
    roleId: string,
    keyword: string,
    options?: { limit?: number }
  ): Promise<MessageRow[]>;
  clearMessages(userId: string, roleId: string): Promise<void>;

  // ---- Settings ----
  getSetting<T = unknown>(key: string): Promise<T | null>;
  setSetting(key: string, value: unknown): Promise<void>;
  deleteSetting(key: string): Promise<void>;
  getAllSettings(): Promise<Record<string, unknown>>;

  // ---- Skills ----
  upsertSkill(skill: {
    id: string;
    name: string;
    description?: string;
    content: string;
    type?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  }): Promise<void>;
  getSkill(id: string): Promise<SkillRecord | null>;
  listSkills(enabledOnly?: boolean): Promise<SkillRecord[]>;

  // ---- Scheduled Jobs ----
  createScheduledJob(params: {
    userId: string;
    roleId: string;
    description: string;
    scheduleType: 'once' | 'recurring';
    runAt?: Date;
  }): Promise<ScheduledJob>;
  getScheduledJob(id: string): Promise<ScheduledJob | null>;
  listScheduledJobs(userId: string, opts?: { status?: string; roleId?: string }): Promise<ScheduledJob[]>;
  getDueOnceJobs(): Promise<ScheduledJob[]>;
  getPendingRecurringJobs(userId?: string): Promise<ScheduledJob[]>;
  updateScheduledJobStatus(id: string, update: {
    status?: ScheduledJob['status'];
    lastRunAt?: Date;
    lastError?: string;
    holdUntil?: Date | null;
    runCount?: number;
  }): Promise<void>;
  cancelScheduledJob(id: string, userId: string): Promise<boolean>;
}
