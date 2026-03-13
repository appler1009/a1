import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { useAuthStore, useEnvironmentStore, useUIStore, useRolesStore } from './store';
import { initializePreviewAdapters } from './lib/adapters';
import { Sidebar } from './components/Sidebar';
import { ChatPane } from './components/panes/ChatPane';
import { ViewerPane, SettingsDialog } from './components/panes/ViewerPane';
import { OnboardingPane } from './components/panes/OnboardingPane';
import { useIsMobile } from './hooks/useIsMobile';
import { useTheme } from './hooks/useTheme';
import { DialogOverlay } from './components/DialogOverlay';

// Lazy-load route-only pages to keep the main bundle lean
const LoginPage = lazy(() => import('./pages/LoginPage').then(m => ({ default: m.LoginPage })));
const LoginVerifyPage = lazy(() => import('./pages/LoginVerifyPage').then(m => ({ default: m.LoginVerifyPage })));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then(m => ({ default: m.OnboardingPage })));
const JoinPage = lazy(() => import('./pages/JoinPage').then(m => ({ default: m.JoinPage })));
const OAuthCallbackPage = lazy(() => import('./pages/OAuthCallbackPage').then(m => ({ default: m.OAuthCallbackPage })));

function MainApp() {
  const isMobile = useIsMobile();
  const { user } = useAuthStore();
  const { showSettings, setShowSettings, viewerFile, setViewerFile, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore();
  const { currentRole, rolesLoaded } = useRolesStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform);
      const isSettingsShortcut = (isMac ? e.metaKey : e.ctrlKey) && e.shiftKey && e.key === ',';
      if (isSettingsShortcut) {
        e.preventDefault();
        setShowSettings(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setShowSettings]);

  useEffect(() => {
    document.title = currentRole ? `${currentRole.name} - assist1` : 'assist1';
  }, [currentRole?.name]);

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const showOnboarding = rolesLoaded && !currentRole;

  return (
    <div className="flex h-screen bg-background text-foreground safe-top">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0">
        {showOnboarding ? (
          <OnboardingPane />
        ) : isMobile ? (
          <div className="flex-1 h-full overflow-hidden">
            <ChatPane />
            {viewerFile && (
              <div className="fixed inset-0 z-[30] bg-background flex flex-col">
                <ViewerPane onClose={() => setViewerFile(null)} />
              </div>
            )}
          </div>
        ) : (
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

      {isMobile && mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[50]"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {showSettings && (
        <DialogOverlay onClose={() => setShowSettings(false)}>
          <SettingsDialog
            onClose={() => setShowSettings(false)}
          />
        </DialogOverlay>
      )}
    </div>
  );
}

function App() {
  useTheme();
  const fetchEnvironment = useEnvironmentStore((state) => state.fetchEnvironment);
  const fetchRoles = useRolesStore((state) => state.fetchRoles);
  const user = useAuthStore((state) => state.user);

  useEffect(() => {
    initializePreviewAdapters();
    fetchEnvironment();
  }, [fetchEnvironment]);

  useEffect(() => {
    if (user) {
      console.log('[App] User authenticated, fetching roles...');
      fetchRoles();
    }
  }, [user, fetchRoles]);

  return (
    <BrowserRouter>
      <Suspense fallback={null}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/login/verify" element={<LoginVerifyPage />} />
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="/join" element={<JoinPage />} />
          <Route path="/auth/google/callback" element={<OAuthCallbackPage />} />
          <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
          <Route path="/*" element={<MainApp />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default App;
