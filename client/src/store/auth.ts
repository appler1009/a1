import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch } from '../lib/api';

export interface User {
  id: string;
  email: string;
  name?: string;
  accountType: 'individual' | 'group';
  discordUserId?: string;
  telegramUserId?: string;
  locale?: string;
  timezone?: string;
  creditBalanceUsd?: number;
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
  fetchUser: () => Promise<void>;
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
      fetchUser: async () => {
        try {
          const response = await apiFetch('/api/auth/me', { excludeRoleId: true });
          if (!response.ok) return;
          const data = await response.json();
          if (data.success && data.data.user) {
            set({ user: data.data.user, groups: data.data.groups ?? [] });
          }
        } catch {
          // silently ignore — cached user remains
        }
      },
    }),
    {
      name: 'auth-storage',
    }
  )
);
