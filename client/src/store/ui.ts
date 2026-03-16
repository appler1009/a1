import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { apiFetch } from '../lib/api';

export interface ViewerFile {
  id: string;
  name: string;
  mimeType: string;
  previewUrl: string;
  sourceUrl?: string;
  serverId?: string;
  fileUri?: string;
  absolutePath?: string;
}

export interface EnvironmentInfo {
  env: 'development' | 'test' | 'production';
  isDevelopment: boolean;
  isTest: boolean;
  isProduction: boolean;
  port: number;
  host: string;
}

// Environment Store
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

export interface RoleRef {
  id: string;
  name: string;
  jobDesc?: string;
}

// UI Store
interface UIState {
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  viewerTab: string;
  viewerFile: ViewerFile | null;
  showSettings: boolean;
  showScheduledJobs: boolean;
  roleSwitching: boolean;
  memoryDialogRole: RoleRef | null;
  descriptionDialogRole: RoleRef | null;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
  setViewerTab: (tab: string) => void;
  setViewerFile: (file: ViewerFile | null) => void;
  setShowSettings: (show: boolean) => void;
  setShowScheduledJobs: (show: boolean) => void;
  setRoleSwitching: (switching: boolean) => void;
  setMemoryDialogRole: (role: RoleRef | null) => void;
  setDescriptionDialogRole: (role: RoleRef | null) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      mobileSidebarOpen: false,
      viewerTab: 'docs',
      viewerFile: null,
      showSettings: false,
      showScheduledJobs: false,
      roleSwitching: false,
      memoryDialogRole: null,
      descriptionDialogRole: null,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
      setViewerTab: (tab) => set({ viewerTab: tab }),
      setViewerFile: (file) => set({ viewerFile: file }),
      setShowSettings: (show) => set({ showSettings: show }),
      setShowScheduledJobs: (show) => set({ showScheduledJobs: show }),
      setRoleSwitching: (switching) => set({ roleSwitching: switching }),
      setMemoryDialogRole: (role) => set({ memoryDialogRole: role }),
      setDescriptionDialogRole: (role) => set({ descriptionDialogRole: role }),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        viewerTab: state.viewerTab,
        viewerFile: state.viewerFile,
        showSettings: state.showSettings,
      }),
    }
  )
);
