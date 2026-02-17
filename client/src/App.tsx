import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PanelGroup, Panel, PanelResizeHandle } from 'react-resizable-panels';
import { useAuthStore } from './store';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { JoinPage } from './pages/JoinPage';
import { Sidebar } from './components/Sidebar';
import { ChatPane } from './components/panes/ChatPane';
import { ViewerPane } from './components/panes/ViewerPane';

function MainApp() {
  const { user, currentGroup } = useAuthStore();

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <Sidebar />
      
      <main className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-14 border-b border-border flex items-center justify-between px-4">
          <div>
            <h1 className="text-lg font-semibold">a1</h1>
            <p className="text-xs text-muted-foreground">
              {currentGroup ? currentGroup.name : 'Personal workspace'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {user.email}
            </span>
          </div>
        </header>

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
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/onboarding" element={<OnboardingPage />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/*" element={<MainApp />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;