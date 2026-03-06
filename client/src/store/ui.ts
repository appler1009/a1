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

// UI Store
interface UIState {
  sidebarOpen: boolean;
  mobileSidebarOpen: boolean;
  viewerTab: string;
  viewerFile: ViewerFile | null;
  showMcpManager: boolean;
  showScheduledJobs: boolean;
  roleSwitching: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;
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
      mobileSidebarOpen: false,
      viewerTab: 'docs',
      viewerFile: null,
      showMcpManager: false,
      showScheduledJobs: false,
      roleSwitching: false,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
      setViewerTab: (tab) => set({ viewerTab: tab }),
      setViewerFile: (file) => set({ viewerFile: file }),
      setShowMcpManager: (show) => set({ showMcpManager: show }),
      setShowScheduledJobs: (show) => set({ showScheduledJobs: show }),
      setRoleSwitching: (switching) => set({ roleSwitching: switching }),
    }),
    {
      name: 'ui-storage',
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        viewerTab: state.viewerTab,
        viewerFile: state.viewerFile,
        showMcpManager: state.showMcpManager,
      }),
    }
  )
);
