import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch } from '../lib/api';
import { useAuthStore } from './auth';

export interface Role {
  id: string;
  groupId: string;
  name: string;
  jobDesc?: string;
  systemPrompt?: string;
  model?: string;
  createdAt: string;
}

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

              const { currentRole, currentRoleId } = get();

              console.log('[Roles] Client localStorage - currentRole:', currentRole ? `${currentRole.name} (${currentRole.id})` : 'null');
              console.log('[Roles] Client localStorage - backup ID:', currentRoleId || 'null');

              let newCurrentRole: Role | null = null;
              let newCurrentRoleId: string | null = null;

              if (currentRole) {
                const existingRole = fetchedRoles.find(r => r.id === currentRole.id);
                if (existingRole) {
                  console.log('[Roles] Keeping existing currentRole from localStorage:', currentRole.id);
                  newCurrentRole = existingRole;
                  newCurrentRoleId = existingRole.id;
                } else {
                  console.log('[Roles] Current role no longer exists, trying backup ID');
                }
              }

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

              if (!newCurrentRole && serverCurrentRoleId) {
                const existingRole = fetchedRoles.find(r => r.id === serverCurrentRoleId);
                if (existingRole) {
                  console.log('[Roles] Restored role from server per-user currentRoleId:', serverCurrentRoleId);
                  newCurrentRole = existingRole;
                  newCurrentRoleId = existingRole.id;
                }
              }

              if (!newCurrentRole) {
                const primaryRoleId = useAuthStore.getState().user?.primaryRoleId;
                if (primaryRoleId) {
                  const primaryRole = fetchedRoles.find(r => r.id === primaryRoleId);
                  if (primaryRole) {
                    console.log('[Roles] Using primary role from user profile:', primaryRoleId);
                    newCurrentRole = primaryRole;
                    newCurrentRoleId = primaryRole.id;
                  }
                }
              }

              if (!newCurrentRole && fetchedRoles.length > 0) {
                console.log('[Roles] No stored role found, using first available role:', fetchedRoles[0].id);
                newCurrentRole = fetchedRoles[0];
                newCurrentRoleId = fetchedRoles[0].id;
              }

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
        const { currentRole } = get();
        if (currentRole?.id === role.id) {
          console.log('[Roles] Already on role', role.name);
          return;
        }

        console.log('[Roles] Switching to role:', role.name, role.id);
        setRoleSwitching(true);

        try {
          const response = await apiFetch(`/api/roles/${role.id}/switch`, {
            method: 'POST',
          });

          if (!response.ok) {
            throw new Error('Failed to switch role on server');
          }

          const data = await response.json();
          if (data.success) {
            console.log('[Roles] ✓ Server confirmed role switch to:', role.name);
            set({
              currentRole: role,
              currentRoleId: role.id,
            });
          } else {
            throw new Error(data.error?.message || 'Failed to switch role');
          }
        } catch (error) {
          console.error('[Roles] Failed to switch role:', error);
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
      partialize: (state) => ({
        roles: state.roles,
        currentRole: state.currentRole,
        currentRoleId: state.currentRoleId,
      }),
    }
  )
);
