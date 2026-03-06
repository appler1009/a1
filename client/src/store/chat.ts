import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch } from '../lib/api';

export type MessageFrom = 'user' | 'assistant' | 'tool' | 'system';

export interface Message {
  id: string;
  roleId: string;
  content: string;
  from: MessageFrom;
  createdAt: string;
}

export interface Memory {
  id: string;
  roleId: string;
  content: string;
  embedding?: number[];
  createdAt: string;
}

// Chat Store
interface ChatState {
  messages: Message[];
  streaming: boolean;
  currentContent: string;
  hasMore: boolean;
  loading: boolean;
  migrated: boolean;
  lastFetchTime: Record<string, number>;
  addMessage: (message: Message) => Promise<void>;
  receiveMessage: (message: Message) => void;
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
  lastFetchTime: {},

  addMessage: async (message) => {
    set((state) => ({ messages: [...state.messages, message] }));

    try {
      const response = await apiFetch('/api/messages', {
        method: 'POST',
        body: JSON.stringify({
          id: message.id,
          roleId: message.roleId,
          from: message.from,
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

  receiveMessage: (message) => set((state) => {
    if (state.messages.some((m) => m.id === message.id)) return {};
    return { messages: [...state.messages, message] };
  }),

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

    if (roleMessages.length > keepCount) {
      const messagesToKeep = roleMessages.slice(-keepCount);
      const otherRoleMessages = messages.filter((m) => m.roleId !== roleId);
      set({ messages: [...otherRoleMessages, ...messagesToKeep], hasMore: true });
    }
  },

  fetchMessages: async (roleId, options = {}) => {
    const { loading, lastFetchTime, messages } = get();

    if (loading && options.before) return;

    if (!options.before) {
      const lastFetch = lastFetchTime?.[roleId];
      const now = Date.now();
      if (lastFetch && (now - lastFetch) < 30000) {
        const existingMessages = messages.filter(m => m.roleId === roleId);
        if (existingMessages.length > 0) {
          console.log('[ChatStore] Using cached messages for role:', roleId);
          set({ messages: existingMessages, hasMore: true, loading: false });
          return;
        }
      }

      set((state) => ({
        messages: state.messages.filter(m => m.roleId !== roleId),
        hasMore: true,
        loading: true,
        lastFetchTime: { ...state.lastFetchTime, [roleId]: now }
      }));
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
            const current = get().messages;
            set({ messages: [...fetchedMessages, ...current], hasMore: fetchedMessages.length === (options.limit || 50) });
          } else {
            const otherMessages = get().messages.filter(m => m.roleId !== roleId);
            set({ messages: [...otherMessages, ...fetchedMessages], hasMore: fetchedMessages.length === (options.limit || 50) });
          }
          set((state) => ({
            lastFetchTime: { ...state.lastFetchTime, [roleId]: Date.now() }
          }));
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

      const response = await apiFetch('/api/messages/migrate', {
        method: 'POST',
        body: JSON.stringify({ messages: localMessages }),
      });

      if (response.ok) {
        console.log('Migrated messages from localStorage to server');
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
