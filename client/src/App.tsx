import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { useAuthStore, useEnvironmentStore, useUIStore, useRolesStore } from './store';
import { initializePreviewAdapters } from './lib/adapters';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { JoinPage } from './pages/JoinPage';
import { OAuthCallbackPage } from './pages/OAuthCallbackPage';
import { Sidebar } from './components/Sidebar';
import { ChatPane } from './components/panes/ChatPane';
import { ViewerPane, MCPManagerDialog } from './components/panes/ViewerPane';
import { OnboardingPane } from './components/panes/OnboardingPane';

function MainApp() {
  const { user } = useAuthStore();
  const { showMcpManager, setShowMcpManager } = useUIStore();
  const { currentRole, rolesLoaded } = useRolesStore();

  // Handle keyboard shortcuts: CMD+SHIFT+, to open Settings, ESC to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const isSettingsShortcut = (isMac ? e.metaKey : e.ctrlKey) && e.shiftKey && e.key === ',';

      if (isSettingsShortcut) {
        e.preventDefault();
        setShowMcpManager(true);
      } else if (e.key === 'Escape' && showMcpManager) {
        e.preventDefault();
        setShowMcpManager(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setShowMcpManager, showMcpManager]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Show onboarding when roles are loaded but no role is selected
  const showOnboarding = rolesLoaded && !currentRole;

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />

      <main className="flex-1 flex flex-col">
        {showOnboarding ? (
          /* Full-screen onboarding */
          <OnboardingPane />
        ) : (
          /* Main content with resizable panels */
          <div className="flex-1 h-full overflow-hidden">
            <PanelGroup direction="horizontal" autoSaveId="main-panels">
              <Panel defaultSize={50} minSize={30} className="h-full overflow-hidden">
                <ChatPane />
              </Panel>

              <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />

              <Panel defaultSize={50} minSize={30} className="h-full overflow-hidden">
                <ViewerPane />
              </Panel>
            </PanelGroup>
          </div>
        )}
      </main>

      {/* MCP Manager Modal */}
      {showMcpManager && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <MCPManagerDialog
            onClose={() => setShowMcpManager(false)}
          />
        </div>
      )}
    </div>
  );
}

function App() {
  const fetchEnvironment = useEnvironmentStore((state) => state.fetchEnvironment);
  const fetchRoles = useRolesStore((state) => state.fetchRoles);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    // Initialize preview adapters on app startup
    initializePreviewAdapters();

    // Fetch environment info on app startup
    fetchEnvironment();
  }, [fetchEnvironment]);

  // Fetch roles when user is authenticated
  useEffect(() => {
    if (user) {
      console.log('[App] User authenticated, fetching roles...');
      fetchRoles();
    }
  }, [user, fetchRoles]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/auth/google/callback" element={<OAuthCallbackPage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route path="/*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;