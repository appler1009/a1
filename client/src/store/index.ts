import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// Types
export interface User {
  id: string;
  email: string;
  name?: string;
  accountType: 'individual' | 'group';
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
  setRoles: (roles: Role[]) => void;
  addRole: (role: Role) => void;
  updateRole: (id: string, updates: Partial<Role>) => void;
  deleteRole: (id: string) => void;
  setCurrentRole: (role: Role | null) => void;
}

export const useRolesStore = create<RolesState>()(
  persist(
    (set) => ({
      roles: [],
      currentRole: null,
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
        })),
      setCurrentRole: (role) => set({ currentRole: role }),
    }),
    {
      name: 'roles-storage',
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
      const response = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
  
  fetchMessages: async (roleId, options = {}) => {
    const { loading, messages } = get();
    if (loading) return;
    
    set({ loading: true });
    try {
      const params = new URLSearchParams({ roleId });
      if (options.limit) params.append('limit', String(options.limit));
      if (options.before) params.append('before', options.before);
      
      const response = await fetch(`/api/messages?${params}`, { credentials: 'include' });
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          const fetchedMessages = data.data as Message[];
          if (options.before) {
            // Prepend older messages
            set({ messages: [...fetchedMessages, ...messages], hasMore: fetchedMessages.length === (options.limit || 50) });
          } else {
            // Initial load
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
      const response = await fetch('/api/messages/migrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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
      await fetch(`/api/messages?roleId=${roleId}`, {
        method: 'DELETE',
        credentials: 'include',
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
      const response = await fetch('/api/env');
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
  serverId?: string;
}

interface UIState {
  sidebarOpen: boolean;
  viewerTab: string;
  viewerFile: ViewerFile | null;
  showMcpManager: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setViewerTab: (tab: string) => void;
  setViewerFile: (file: ViewerFile | null) => void;
  setShowMcpManager: (show: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      viewerTab: 'docs',
      viewerFile: null,
      showMcpManager: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setViewerTab: (tab) => set({ viewerTab: tab }),
      setViewerFile: (file) => set({ viewerFile: file }),
      setShowMcpManager: (show) => set({ showMcpManager: show }),
    }),
    {
      name: 'ui-storage',
    }
  )
);