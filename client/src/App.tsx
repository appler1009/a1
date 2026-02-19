import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { useAuthStore, useEnvironmentStore, useUIStore } from './store';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { JoinPage } from './pages/JoinPage';
import { OAuthCallbackPage } from './pages/OAuthCallbackPage';
import { Sidebar } from './components/Sidebar';
import { ChatPane } from './components/panes/ChatPane';
import { ViewerPane, MCPManagerDialog } from './components/panes/ViewerPane';

function MainApp() {
  const { user } = useAuthStore();
  const { showMcpManager, setShowMcpManager } = useUIStore();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />

      <main className="flex-1 flex flex-col">

        {/* Main content with resizable panels */}
        <div className="flex-1 h-full overflow-hidden">
          <PanelGroup direction="horizontal">
            <Panel defaultSize={50} minSize={30} className="h-full overflow-hidden">
              <ChatPane />
            </Panel>

            <PanelResizeHandle className="w-1 bg-border hover:bg-primary/50 transition-colors" />

            <Panel defaultSize={50} minSize={30} className="h-full overflow-hidden">
              <ViewerPane />
            </Panel>
          </PanelGroup>
        </div>
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

  useEffect(() => {
    // Fetch environment info on app startup
    fetchEnvironment();
  }, [fetchEnvironment]);

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