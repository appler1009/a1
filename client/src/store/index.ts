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

// Chat Store
interface ChatState {
  messages: Message[];
  streaming: boolean;
  currentContent: string;
  addMessage: (message: Message) => void;
  setMessages: (messages: Message[]) => void;
  setStreaming: (streaming: boolean) => void;
  setCurrentContent: (content: string) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      streaming: false,
      currentContent: '',
      addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
      setMessages: (messages) => set({ messages }),
      setStreaming: (streaming) => set({ streaming }),
      setCurrentContent: (content) => set({ currentContent: content }),
      clearMessages: () => set({ messages: [], currentContent: '' }),
    }),
    {
      name: 'chat-storage',
    }
  )
);

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

export const useUIStore = create<UIState>()((set) => ({
  sidebarOpen: true,
  viewerTab: 'docs',
  viewerFile: null,
  showMcpManager: false,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setViewerTab: (tab) => set({ viewerTab: tab }),
  setViewerFile: (file) => set({ viewerFile: file }),
  setShowMcpManager: (show) => set({ showMcpManager: show }),
}));