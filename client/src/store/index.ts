import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch } from '../lib/api';

// Types
export interface User {
  id: string;
  email: string;
  name?: string;
  accountType: 'individual' | 'group';
  discordUserId?: string;
  locale?: string;
  timezone?: string;
  createdAt: string;
}

export interface Session {
  id: string;
  userId: string;
  expiresAt: string;
}

export interface Group {
  id: string;
  name: string;
  url?: string;
  createdAt: string;
}

export interface Role {
  id: string;
  groupId: string;
  name: string;
  jobDesc?: string;
  systemPrompt?: string;
  model?: string;
  createdAt: string;
}

export interface Message {
  id: string;
  roleId: string;
  content: string;
  role: 'user' | 'assistant' | 'system';
  createdAt: string;
}

export interface Memory {
  id: string;
  roleId: string;
  content: string;
  embedding?: number[];
  createdAt: string;
}

// Auth Store
interface AuthState {
  user: User | null;
  session: Session | null;
  currentGroup: Group | null;
  groups: Group[];
  setUser: (user: User | null) => void;
  setSession: (session: Session | null) => void;
  setCurrentGroup: (group: Group | null) => void;
  setGroups: (groups: Group[]) => void;
  addGroup: (group: Group) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      session: null,
      currentGroup: null,
      groups: [],
      setUser: (user) => set({ user }),
      setSession: (session) => set({ session }),
      setCurrentGroup: (group) => set({ currentGroup: group }),
      setGroups: (groups) => set({ groups }),
      addGroup: (group) => set((state) => ({ groups: [...state.groups, group] })),
      logout: () => set({ user: null, session: null, currentGroup: null, groups: [] }),
    }),
    {
      name: 'auth-storage',
    }
  )
);

// Roles Store
interface RolesState {
  roles: Role[];
  currentRole: Role | null;
  currentRoleId: string | null;  // Redundant explicit role ID backup
  rolesLoaded: boolean;  // Track if roles have been fetched from server
  setRoles: (roles: Role[]) => void;
  addRole: (role: Role) => void;
  updateRole: (id: string, updates: Partial<Role>) => void;
  deleteRole: (id: string) => void;
  setCurrentRole: (role: Role | null) => void;
  setCurrentRoleId: (id: string | null) => void;
  fetchRoles: () => Promise<void>;
  switchRole: (role: Role, setRoleSwitching: (switching: boolean) => void) => Promise<void>;
}

export const useRolesStore = create<RolesState>()(
  persist(
    (set, get) => ({
      roles: [],
      currentRole: null,
      currentRoleId: null,
      rolesLoaded: false,
      setRoles: (roles) => set({ roles }),
      addRole: (role) => set((state) => ({ roles: [...state.roles, role] })),
      updateRole: (id, updates) =>
        set((state) => ({
          roles: state.roles.map((r) => (r.id === id ? { ...r, ...updates } : r)),
        })),
      deleteRole: (id) =>
        set((state) => ({
          roles: state.roles.filter((r) => r.id !== id),
          currentRole: state.currentRole?.id === id ? null : state.currentRole,
          currentRoleId: state.currentRoleId === id ? null : state.currentRoleId,
        })),
      setCurrentRole: (role) => set({
        currentRole: role,
        currentRoleId: role?.id || null,
      }),
      setCurrentRoleId: (id) => set({ currentRoleId: id }),
      fetchRoles: async () => {
        try {
          console.log('[Roles] Starting fetchRoles...');
          const response = await apiFetch('/api/roles');
          if (response.ok) {
            const data = await response.json();
            if (data.success) {
              const fetchedRoles = data.data.roles as Role[];
              const serverCurrentRoleId = data.data.currentRoleId as string | null;

              console.log('[Roles] ✓ Fetched from server:', fetchedRoles.map(r => `${r.name} (${r.id})`).join(', '));
              console.log('[Roles] Server reports current role ID:', serverCurrentRoleId);

              // Get the currently stored currentRole and currentRoleId from localStorage
              const { currentRole, currentRoleId } = get();

              console.log('[Roles] Client localStorage - currentRole:', currentRole ? `${currentRole.name} (${currentRole.id})` : 'null');
              console.log('[Roles] Client localStorage - backup ID:', currentRoleId || 'null');

              // Determine the new currentRole
              let newCurrentRole: Role | null = null;
              let newCurrentRoleId: string | null = null;

              // Try to restore from currentRole object first
              if (currentRole) {
                const existingRole = fetchedRoles.find(r => r.id === currentRole.id);
                if (existingRole) {
                  console.log('[Roles] Keeping existing currentRole from localStorage:', currentRole.id);
                  newCurrentRole = existingRole;
                  newCurrentRoleId = existingRole.id;
                } else {
                  console.log('[Roles] Current role no longer exists, trying backup ID');
                  // Fall through to try currentRoleId
                }
              }

              // If currentRole didn't work, try the backup ID
              if (!newCurrentRole && currentRoleId) {
                const existingRole = fetchedRoles.find(r => r.id === currentRoleId);
                if (existingRole) {
                  console.log('[Roles] Restored role from backup ID:', currentRoleId);
                  newCurrentRole = existingRole;
                  newCurrentRoleId = existingRole.id;
                } else {
                  console.log('[Roles] Backup role ID no longer exists');
                }
              }

              // If neither worked, use the first available role
              if (!newCurrentRole && fetchedRoles.length > 0) {
                console.log('[Roles] No stored role found, using first available role:', fetchedRoles[0].id);
                newCurrentRole = fetchedRoles[0];
                newCurrentRoleId = fetchedRoles[0].id;
              }

              // Update state with roles and the resolved currentRole
              set({
                roles: fetchedRoles,
                currentRole: newCurrentRole,
                currentRoleId: newCurrentRoleId,
                rolesLoaded: true
              });

              console.log('[Roles] ✓ FINAL STATE - Role:', newCurrentRole?.name, 'ID:', newCurrentRole?.id || 'null');
              console.log('[Roles] ✓ rolesLoaded: true');
            }
          }
        } catch (error) {
          console.error('[Roles] Failed to fetch roles:', error);
        }
      },
      switchRole: async (role, setRoleSwitching) => {
        // Don't switch if already on this role
        const { currentRole } = get();
        if (currentRole?.id === role.id) {
          console.log('[Roles] Already on role', role.name);
          return;
        }

        console.log('[Roles] Switching to role:', role.name, role.id);
        setRoleSwitching(true);

        try {
          // Call the server-side switch endpoint
          const response = await apiFetch(`/api/roles/${role.id}/switch`, {
            method: 'POST',
          });

          if (!response.ok) {
            throw new Error('Failed to switch role on server');
          }

          const data = await response.json();
          if (data.success) {
            console.log('[Roles] ✓ Server confirmed role switch to:', role.name);
            // Update local state
            set({
              currentRole: role,
              currentRoleId: role.id,
            });
          } else {
            throw new Error(data.error?.message || 'Failed to switch role');
          }
        } catch (error) {
          console.error('[Roles] Failed to switch role:', error);
          // Still update local state even if server call fails
          set({
            currentRole: role,
            currentRoleId: role.id,
          });
        } finally {
          setRoleSwitching(false);
        }
      },
    }),
    {
      name: 'roles-storage',
      // Don't persist rolesLoaded - it should always start as false
      partialize: (state) => ({
        roles: state.roles,
        currentRole: state.currentRole,
        currentRoleId: state.currentRoleId,
      }),
    }
  )
);

// Chat Store - No longer persists to localStorage, uses server-side storage
interface ChatState {
  messages: Message[];
  streaming: boolean;
  currentContent: string;
  hasMore: boolean;
  loading: boolean;
  migrated: boolean;
  addMessage: (message: Message) => Promise<void>;
  prependMessages: (messages: Message[]) => void;
  setMessages: (messages: Message[]) => void;
  setStreaming: (streaming: boolean) => void;
  setCurrentContent: (content: string) => void;
  setHasMore: (hasMore: boolean) => void;
  setLoading: (loading: boolean) => void;
  setMigrated: (migrated: boolean) => void;
  clearMessages: () => void;
  trimMessages: (roleId: string, keepCount: number) => void;
  fetchMessages: (roleId: string, options?: { before?: string; limit?: number }) => Promise<void>;
  migrateFromLocalStorage: () => Promise<void>;
  clearServerMessages: (roleId: string) => Promise<void>;
}

export const useChatStore = create<ChatState>()((set, get) => ({
  messages: [],
  streaming: false,
  currentContent: '',
  hasMore: true,
  loading: false,
  migrated: false,
  
  addMessage: async (message) => {
    // Add to local state immediately for UI responsiveness
    set((state) => ({ messages: [...state.messages, message] }));
    
    // Persist to server
    try {
      const response = await apiFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          id: message.id,
          roleId: message.roleId,
          role: message.role,
          content: message.content,
        }),
      });
      
      if (!response.ok) {
        console.error('Failed to save message to server');
      }
    } catch (error) {
      console.error('Failed to save message:', error);
    }
  },
  
  prependMessages: (olderMessages) => set((state) => ({ messages: [...olderMessages, ...state.messages] })),
  setMessages: (messages) => set({ messages }),
  setStreaming: (streaming) => set({ streaming }),
  setCurrentContent: (content) => set({ currentContent: content }),
  setHasMore: (hasMore) => set({ hasMore }),
  setLoading: (loading) => set({ loading }),
  setMigrated: (migrated) => set({ migrated }),
  clearMessages: () => set({ messages: [], currentContent: '', hasMore: true }),
  
  trimMessages: (roleId, keepCount) => {
    const { messages } = get();
    const roleMessages = messages.filter((m) => m.roleId === roleId);
    
    // Only trim if we have more messages than we want to keep
    if (roleMessages.length > keepCount) {
      // Keep only the most recent messages for this role
      const messagesToKeep = roleMessages.slice(-keepCount);
      const otherRoleMessages = messages.filter((m) => m.roleId !== roleId);
      set({ messages: [...otherRoleMessages, ...messagesToKeep], hasMore: true });
    }
  },
  
  fetchMessages: async (roleId, options = {}) => {
    const { loading } = get();

    // For pagination (loading older messages), skip if a fetch is already in progress
    if (loading && options.before) return;

    // For initial loads (role switch), clear messages immediately so stale messages
    // from the previous role never appear, then always proceed with the fetch.
    if (!options.before) {
      set({ messages: [], hasMore: true, loading: true });
    } else {
      set({ loading: true });
    }

    try {
      const params = new URLSearchParams({ roleId });
      if (options.limit) params.append('limit', String(options.limit));
      if (options.before) params.append('before', options.before);

      const response = await apiFetch(`/api/messages?${params}`);
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const fetchedMessages = data.data as Message[];
          if (options.before) {
            // Prepend older messages — use get() to avoid stale closure
            const current = get().messages;
            set({ messages: [...fetchedMessages, ...current], hasMore: fetchedMessages.length === (options.limit || 50) });
          } else {
            // Initial load — replace all messages
            set({ messages: fetchedMessages, hasMore: fetchedMessages.length === (options.limit || 50) });
          }
        }
      }
    } catch (error) {
      console.error('Failed to fetch messages:', error);
    } finally {
      set({ loading: false });
    }
  },
  
  migrateFromLocalStorage: async () => {
    const { migrated } = get();
    if (migrated) return;
    
    // Get messages from localStorage
    const stored = localStorage.getItem('chat-storage');
    if (!stored) {
      set({ migrated: true });
      return;
    }
    
    try {
      const parsed = JSON.parse(stored);
      const localMessages = parsed?.state?.messages as Message[] | undefined;
      if (!localMessages || localMessages.length === 0) {
        set({ migrated: true });
        return;
      }
      
      // Send to server
      const response = await apiFetch('/api/messages/migrate', {
        method: 'POST',
        body: JSON.stringify({ messages: localMessages }),
      });
      
      if (response.ok) {
        console.log('Migrated messages from localStorage to server');
        // Clear localStorage
        localStorage.removeItem('chat-storage');
        set({ migrated: true });
      }
    } catch (error) {
      console.error('Failed to migrate messages:', error);
    }
  },
  
  clearServerMessages: async (roleId) => {
    try {
      await apiFetch(`/api/messages?roleId=${roleId}`, {
        method: 'DELETE',
      });
      set({ messages: [], hasMore: true });
    } catch (error) {
      console.error('Failed to clear messages:', error);
    }
  },
}));

// Memory Store
interface MemoryState {
  memories: Memory[];
  addMemory: (memory: Memory) => void;
  setMemories: (memories: Memory[]) => void;
  deleteMemory: (id: string) => void;
}

export const useMemoryStore = create<MemoryState>()(
  persist(
    (set) => ({
      memories: [],
      addMemory: (memory) => set((state) => ({ memories: [...state.memories, memory] })),
      setMemories: (memories) => set({ memories }),
      deleteMemory: (id) =>
        set((state) => ({
          memories: state.memories.filter((m) => m.id !== id),
        })),
    }),
    {
      name: 'memory-storage',
    }
  )
);

// Environment Store
export interface EnvironmentInfo {
  env: 'development' | 'test' | 'production';
  isDevelopment: boolean;
  isTest: boolean;
  isProduction: boolean;
  port: number;
  host: string;
}

interface EnvironmentState {
  environment: EnvironmentInfo | null;
  setEnvironment: (env: EnvironmentInfo) => void;
  fetchEnvironment: () => Promise<void>;
}

export const useEnvironmentStore = create<EnvironmentState>()((set) => ({
  environment: null,
  setEnvironment: (environment) => set({ environment }),
  fetchEnvironment: async () => {
    try {
      const response = await apiFetch('/api/env', { excludeRoleId: true });
      if (response.ok) {
        const data = await response.json();
        set({ environment: data.data });
      }
    } catch (error) {
      console.error('Failed to fetch environment info:', error);
    }
  },
}));

// UI Store
export interface ViewerFile {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string;
  sourceUrl?: string;  // Original URL for opening in new window
  serverId?: string;
  fileUri?: string;    // Local file:// URI for MCP tools
  absolutePath?: string; // Absolute path for MCP tools
}

interface UIState {
  sidebarOpen: boolean;
  viewerTab: string;
  viewerFile: ViewerFile | null;
  showMcpManager: boolean;
  showScheduledJobs: boolean;
  roleSwitching: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setViewerTab: (tab: string) => void;
  setViewerFile: (file: ViewerFile | null) => void;
  setShowMcpManager: (show: boolean) => void;
  setShowScheduledJobs: (show: boolean) => void;
  setRoleSwitching: (switching: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      viewerTab: 'docs',
      viewerFile: null,
      showMcpManager: false,
      showScheduledJobs: false,
      roleSwitching: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setViewerTab: (tab) => set({ viewerTab: tab }),
      setViewerFile: (file) => set({ viewerFile: file }),
      setShowMcpManager: (show) => set({ showMcpManager: show }),
      setShowScheduledJobs: (show) => set({ showScheduledJobs: show }),
      setRoleSwitching: (switching) => set({ roleSwitching: switching }),
    }),
    {
      name: 'ui-storage',
      // Don't persist roleSwitching state
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        viewerTab: state.viewerTab,
        viewerFile: state.viewerFile,
        showMcpManager: state.showMcpManager,
      }),
    }
  )
);