import { useUIStore } from '../../store';
import React from 'react';
import { TopBanner } from '../TopBanner';

interface MCPServer {
  id?: string;
  name?: string;
  command?: string;
  enabled?: boolean;
}

interface PredefinedMCPServer {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  auth?: {
    provider: 'google' | 'github' | 'none';
  };
  icon?: string;
  hidden?: boolean; // If true, won't show in UI feature list but can still be used
}

export function ViewerPane() {
  const { viewerFile } = useUIStore();

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Top Banner */}
      <TopBanner
        fileName={viewerFile?.name}
        sourceUrl={viewerFile?.sourceUrl}
        openInNewWindowLabel="Open in New Window"
      />
      
      <div className="flex-1 overflow-hidden">
        {viewerFile ? (
          <iframe
            src={viewerFile.previewUrl}
            className="w-full h-full"
            title={viewerFile.name}
            allow="autoplay"
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <p className="text-sm">Document Preview</p>
              <p className="text-xs text-muted-foreground mt-1">
                Documents shared from the chat will appear here
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface MCPManagerDialogProps {
  onClose: () => void;
}

export function MCPManagerDialog({ onClose }: MCPManagerDialogProps) {
  const [servers, setServers] = React.useState<MCPServer[]>([]);
  const [predefinedServers, setPredefinedServers] = React.useState<PredefinedMCPServer[]>([]);
  const [adding, setAdding] = React.useState(false);
  const [selectedServerId, setSelectedServerId] = React.useState<string | null>(null);
  const [authRequired, setAuthRequired] = React.useState(false);
  const [authProvider, setAuthProvider] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Prevent duplicate add calls during OAuth flow
  const pendingAddRef = React.useRef<string | null>(null);

  // Auto-dismiss toast after 3 seconds
  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  // Fetch current servers
  const fetchServers = React.useCallback(async () => {
    try {
      const response = await fetch('/api/mcp/servers');
      const data = await response.json();
      if (data.success) {
        const serverList = (data.data || []).map((server: any) => ({
          id: server.id,
          name: server.config?.name || server.name,
          command: server.config?.command || '',
          enabled: server.config?.enabled !== false,
        }));
        setServers(serverList);
      }
    } catch (error) {
      console.error('Failed to fetch MCP servers:', error);
    }
  }, []);

  // Fetch predefined available servers
  const fetchPredefinedServers = React.useCallback(async () => {
    try {
      const response = await fetch('/api/mcp/available-servers');
      const data = await response.json();
      if (data.success) {
        setPredefinedServers(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch available MCP servers:', error);
    }
  }, []);

  React.useEffect(() => {
    fetchServers();
    fetchPredefinedServers();
  }, [fetchServers, fetchPredefinedServers]);

  // Start OAuth flow for any provider
  const startOAuthFlow = async (provider: string): Promise<boolean> => {
    try {
      const endpoint = `/api/auth/${provider}/start`;
      const authResponse = await fetch(endpoint);

      if (!authResponse.ok) {
        console.error(`Failed to start ${provider} OAuth:`, authResponse.status);
        return false;
      }

      const authData = await authResponse.json();

      if (authData.data?.authUrl) {
        const width = 500;
        const height = 600;
        const left = window.screenX + (window.outerWidth - width) / 2;
        const top = window.screenY + (window.outerHeight - height) / 2;

        window.open(
          authData.data.authUrl,
          `${provider}-auth`,
          `width=${width},height=${height},left=${left},top=${top}`
        );
        return true;
      }
    } catch (error) {
      console.error(`Error starting ${provider} OAuth:`, error);
    }
    return false;
  };

  // Add server after auth is complete (called after OAuth success)
  const addServerAfterAuth = React.useCallback(async (serverId: string) => {
    // Prevent duplicate calls during OAuth flow
    if (pendingAddRef.current === serverId) {
      console.log(`[addServerAfterAuth] Duplicate call prevented for serverId: ${serverId}`);
      return;
    }

    pendingAddRef.current = serverId;
    console.log(`[addServerAfterAuth] Adding server: ${serverId}`);
    setAdding(true);
    try {
      const response = await fetch('/api/mcp/servers/add-predefined', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId }),
      });

      const data = await response.json();

      if (response.ok) {
        // Success - clear auth state and close dialog
        console.log(`[addServerAfterAuth] Server added successfully: ${serverId}`);
        const server = predefinedServers.find(s => s.id === serverId);
        setToast({ message: `✅ Successfully added ${server?.name || 'MCP server'}!`, type: 'success' });
        setAuthRequired(false);
        setSelectedServerId(null);
        setAuthProvider(null);
        onClose();
      } else {
        console.error(`[addServerAfterAuth] Failed to add server:`, data.error);
        setToast({ message: `Failed to add server: ${data.error?.message || 'Unknown error'}`, type: 'error' });
        // Clear auth state but don't close dialog so user can retry
        setAuthRequired(false);
        setSelectedServerId(null);
      }
    } catch (error) {
      console.error(`[addServerAfterAuth] Error:`, error);
      setToast({ message: `Error adding server: ${error instanceof Error ? error.message : 'Unknown error'}`, type: 'error' });
      setAuthRequired(false);
      setSelectedServerId(null);
    } finally {
      setAdding(false);
      pendingAddRef.current = null;
    }
  }, [onClose, predefinedServers]);

  // Listen for OAuth success messages from popup
  React.useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      console.log('[OAuth] Message received:', event.data);
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'oauth_success') {
        console.log(`[OAuth] Received success message for ${event.data.provider}`);
        // Try adding the server after OAuth completes
        if (selectedServerId) {
          console.log(`[OAuth] Adding server after auth: ${selectedServerId}`);
          addServerAfterAuth(selectedServerId);
        }
      }
    };

    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [selectedServerId, addServerAfterAuth]);

  // Handle server selection - checks auth requirements proactively
  const handleAddServer = async (serverId: string) => {
    const server = predefinedServers.find(s => s.id === serverId);
    if (!server) {
      setToast({ message: 'Server not found', type: 'error' });
      return;
    }

    // Check if this server requires authentication
    const requiresAuth = server.auth?.provider && server.auth.provider !== 'none';

    if (requiresAuth && server.auth?.provider) {
      // Trigger OAuth immediately for this provider
      setSelectedServerId(serverId);
      setAuthProvider(server.auth.provider);
      setAuthRequired(true);

      const authStarted = await startOAuthFlow(server.auth.provider);
      if (authStarted) {
        return; // Wait for OAuth success message to trigger addServerAfterAuth
      } else {
        setAuthRequired(false);
        setToast({ message: `Failed to start ${server.auth.provider} authentication`, type: 'error' });
        return;
      }
    }

    // No auth required, proceed with adding the server immediately
    setAdding(true);
    try {
      const response = await fetch('/api/mcp/servers/add-predefined', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId }),
      });

      const data = await response.json();

      if (response.ok) {
        // Success - show toast and close dialog
        setToast({ message: `✅ Successfully added ${server.name}!`, type: 'success' });
        onClose();
      } else {
        setToast({ message: `Failed to add server: ${data.error?.message || 'Unknown error'}`, type: 'error' });
      }
    } catch (error) {
      setToast({ message: `Error adding server: ${error instanceof Error ? error.message : 'Unknown error'}`, type: 'error' });
    } finally {
      setAdding(false);
    }
  };

  const handleToggleServer = async (serverId: string) => {
    try {
      const currentServer = servers.find(s => s.id === serverId);
      const newEnabled = !currentServer?.enabled;

      const response = await fetch(`/api/mcp/servers/${serverId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      });

      if (response.ok) {
        fetchServers();
      } else {
        const data = await response.json();
        setToast({ message: `Failed to update server: ${data.error?.message || 'Unknown error'}`, type: 'error' });
      }
    } catch (error) {
      setToast({ message: `Error updating server: ${error instanceof Error ? error.message : 'Unknown error'}`, type: 'error' });
    }
  };

  const handleRemoveServer = async (serverId: string) => {
    if (!confirm(`Are you sure you want to remove this server?`)) return;

    try {
      const response = await fetch(`/api/mcp/servers/${serverId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchServers();
      } else {
        const data = await response.json();
        setToast({ message: `Failed to remove server: ${data.error?.message || 'Unknown error'}`, type: 'error' });
      }
    } catch (error) {
      setToast({ message: `Error removing server: ${error instanceof Error ? error.message : 'Unknown error'}`, type: 'error' });
    }
  };

  return (
    <div className="bg-background border border-border rounded-lg p-6 w-full max-w-2xl max-h-[70vh] overflow-y-auto">
      {/* Toast notification */}
      {toast && (
        <div className={`mb-4 p-3 rounded-lg text-sm animate-in fade-in ${
          toast.type === 'success'
            ? 'bg-green-500/20 text-green-700 border border-green-300'
            : 'bg-red-500/20 text-red-700 border border-red-300'
        }`}>
          {toast.message}
        </div>
      )}

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold">Manage Features</h2>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {authRequired && authProvider ? (
        <div className="text-center py-8">
          <div className="mb-4">
            <div className="inline-block p-3 rounded-full bg-blue-500/20 mb-4">
              <div className="text-2xl">🔐</div>
            </div>
            <h3 className="text-lg font-semibold mb-2">Authentication Required</h3>
            <p className="text-muted-foreground mb-4">
              This Feature requires {authProvider} authentication.
            </p>
            <p className="text-sm text-muted-foreground">
              A popup window should have opened. Please complete the authentication flow and the server will be added automatically.
            </p>
          </div>
          <button
            onClick={() => {
              setAuthRequired(false);
              setSelectedServerId(null);
            }}
            className="px-4 py-2 bg-muted rounded-lg hover:bg-muted/80"
          >
            Close
          </button>
        </div>
      ) : (
        <>
          {/* Current Features */}
          {servers.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold mb-3">Active Features</h3>
              <div className="space-y-2">
                {servers.map((server) => (
                  <div key={server.id} className="p-3 border border-border rounded-lg bg-muted/30 flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-semibold text-sm">{server.name}</h4>
                    </div>
                    <div className="flex gap-2 ml-2">
                      <button
                        onClick={() => handleToggleServer(server.id!)}
                        className="px-2 py-1 text-xs bg-blue-500/20 text-blue-600 rounded hover:bg-blue-500/30 whitespace-nowrap"
                      >
                        {server.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button
                        onClick={() => handleRemoveServer(server.id!)}
                        className="px-2 py-1 text-xs bg-red-500/20 text-red-600 rounded hover:bg-red-500/30 whitespace-nowrap"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <hr className="my-4" />
            </div>
          )}

          {/* Available Features */}
          <h3 className="text-sm font-semibold mb-3">Available Features</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {predefinedServers.map((server) => (
              <button
                key={server.id}
                onClick={() => handleAddServer(server.id)}
                disabled={adding}
                className="p-4 text-left border border-border rounded-lg hover:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                <div className="mb-2">
                  <h4 className="font-semibold text-sm">{server.name}</h4>
                  {server.auth?.provider && server.auth.provider !== 'none' && (
                    <span className="inline-block text-xs bg-blue-500/20 text-blue-600 px-2 py-1 rounded mt-1">
                      🔐 {server.auth.provider}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{server.description}</p>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="flex gap-2 mt-6 pt-4 border-t border-border">
        <button
          onClick={() => {
            onClose();
            setAuthRequired(false);
            setSelectedServerId(null);
          }}
          className="flex-1 px-4 py-2 bg-muted rounded-lg hover:bg-muted/80"
        >
          Close
        </button>
      </div>
    </div>
  );
}
