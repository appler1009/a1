// Re-export types for backward compatibility
export interface OAuthToken {
  provider: string;
  accessToken: string;
  refreshToken?: string;
  expiryDate?: number;
  userId: string;
  createdAt: Date;
  updatedAt: Date;
}

// Re-export from new auth service
export { AuthService, getAuthService } from './auth-service.js';

// Import the new auth service
import { getAuthService } from './auth-service.js';
import type { OAuthTokenEntry } from '../storage/main-db.js';

// Singleton instance using the new auth service
const authServiceInstance = getAuthService('./data');

// Export singleton for backward compatibility
export const authService = {
  initialize: () => authServiceInstance.initialize(),
  
  // User methods
  createUser: (email: string, name?: string, accountType?: 'individual' | 'group') => 
    authServiceInstance.createUser(email, name, accountType),
  getUser: (id: string) => authServiceInstance.getUser(id),
  getUserByEmail: (email: string) => authServiceInstance.getUserByEmail(email),
  updateUser: (id: string, updates: Parameters<typeof authServiceInstance.updateUser>[1]) => 
    authServiceInstance.updateUser(id, updates),
  
  // Session methods
  createSession: (userId: string) => authServiceInstance.createSession(userId),
  getSession: (id: string) => authServiceInstance.getSession(id),
  deleteSession: (id: string) => authServiceInstance.deleteSession(id),
  
  // Group methods
  createGroup: (name: string, url?: string) => authServiceInstance.createGroup(name, url),
  getGroup: (id: string) => authServiceInstance.getGroup(id),
  getGroupByUrl: (url: string) => authServiceInstance.getGroupByUrl(url),
  getUserGroups: (userId: string) => authServiceInstance.getUserGroups(userId),
  
  // Membership methods
  addMember: (groupId: string, userId: string, role?: 'owner' | 'admin' | 'member') => 
    authServiceInstance.addMember(groupId, userId, role),
  getMembership: (groupId: string, userId: string) => authServiceInstance.getMembership(groupId, userId),
  getGroupMembers: (groupId: string) => authServiceInstance.getGroupMembers(groupId),
  updateMemberRole: (groupId: string, userId: string, role: 'owner' | 'admin' | 'member') => 
    authServiceInstance.updateMemberRole(groupId, userId, role),
  removeMember: (groupId: string, userId: string) => authServiceInstance.removeMember(groupId, userId),
  
  // Invitation methods
  createInvitation: (
    groupId: string,
    createdBy: string,
    email?: string,
    role?: 'owner' | 'admin' | 'member',
    expiresInSeconds?: number
  ) => authServiceInstance.createInvitation(groupId, createdBy, email, role, expiresInSeconds),
  getInvitationByCode: (code: string) => authServiceInstance.getInvitationByCode(code),
  getGroupInvitations: (groupId: string) => authServiceInstance.getGroupInvitations(groupId),
  acceptInvitation: (code: string, userId: string) => authServiceInstance.acceptInvitation(code, userId),
  revokeInvitation: (invitationId: string) => authServiceInstance.revokeInvitation(invitationId),
  
  // Helper methods
  createGroupUser: (
    email: string,
    name: string | undefined,
    groupName: string,
    groupUrl: string | undefined
  ) => authServiceInstance.createGroupUser(email, name, groupName, groupUrl),
  
  // Legacy aliases
  createOrganization: (name: string, url?: string, ownerId?: string) => 
    authServiceInstance.createOrganization(name, url, ownerId),
  getOrganization: (id: string) => authServiceInstance.getOrganization(id),
  getUserOrganizations: (userId: string) => authServiceInstance.getUserOrganizations(userId),
  createOrgUser: (
    email: string,
    name: string | undefined,
    groupId: string,
    role?: 'owner' | 'admin' | 'member'
  ) => authServiceInstance.createOrgUser(email, name, groupId, role),
  
  // OAuth token methods - convert to old format for backward compatibility
  storeOAuthToken: async (userId: string, token: Omit<OAuthToken, 'createdAt' | 'updatedAt'>): Promise<OAuthToken> => {
    const result = await authServiceInstance.storeOAuthToken(userId, {
      provider: token.provider,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiryDate: token.expiryDate,
    });
    return {
      provider: result.provider,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken || undefined,
      expiryDate: result.expiryDate || undefined,
      userId,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  },
  getOAuthToken: async (userId: string, provider: string): Promise<OAuthToken | null> => {
    const result = await authServiceInstance.getOAuthToken(userId, provider);
    if (!result) return null;
    return {
      provider: result.provider,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken || undefined,
      expiryDate: result.expiryDate || undefined,
      userId,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
    };
  },
  revokeOAuthToken: (userId: string, provider: string) => 
    authServiceInstance.revokeOAuthToken(userId, provider),
};