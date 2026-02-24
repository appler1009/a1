import { useUIStore } from '../../store';
import React, { useRef, useEffect, useState } from 'react';
import { TopBanner } from '../TopBanner';
import { apiFetch } from '../../lib/api';
import { previewAdapterRegistry } from '../../lib/preview-adapters';

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
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(600);

  // Update container width on resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // Find the appropriate preview adapter for the current file
  const adapter = viewerFile ? previewAdapterRegistry.findAdapter(viewerFile) : undefined;
  const previewContent = adapter && viewerFile ? adapter.render(viewerFile, containerWidth) : null;

  // Remove .json extension from email files for display (added for adapter detection)
  const displayFileName = viewerFile?.name?.endsWith('.json') && viewerFile?.name?.length > 5
    ? viewerFile.name.slice(0, -5) // Remove ".json"
    : viewerFile?.name;

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Top Banner */}
      <TopBanner
        fileName={displayFileName}
        sourceUrl={viewerFile?.sourceUrl}
        openInNewWindowLabel="Open in New Window"
      />

      {/* Preview Content */}
      <div ref={containerRef} className="flex flex-col flex-1 overflow-hidden">
        {viewerFile ? (
          previewContent ? (
            previewContent
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <div className="text-center">
                <p className="text-sm font-semibold mb-2">Unsupported File Type</p>
                <p className="text-xs text-muted-foreground">
                  No preview available for {viewerFile.mimeType || 'this file type'}
                </p>
                <p className="text-xs text-muted-foreground mt-2">
                  Supported: PDF, Images, Text, Markdown
                </p>
              </div>
            </div>
          )
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
  // @ts-ignore: selectedServerId is kept for state consistency, but logic uses selectedServerIdRef
  const [selectedServerId, setSelectedServerId] = React.useState<string | null>(null);
  const [authRequired, setAuthRequired] = React.useState(false);
  const [authProvider, setAuthProvider] = React.useState<string | null>(null);
  const [connecting, setConnecting] = React.useState(false);
  const [toast, setToast] = React.useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Prevent duplicate add calls during OAuth flow
  const pendingAddRef = React.useRef<string | null>(null);
  
  // Track OAuth popup window for polling
  const oauthPopupRef = React.useRef<Window | null>(null);
  const oauthPollIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  
  // Track selected server ID for polling callback (avoids closure issues)
  const selectedServerIdRef = React.useRef<string | null>(null);

  // Auto-dismiss toast after 3 seconds
  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  
  // Cleanup OAuth polling on unmount
  React.useEffect(() => {
    return () => {
      if (oauthPollIntervalRef.current) {
        clearInterval(oauthPollIntervalRef.current);
      }
    };
  }, []);

  // Fetch current servers
  const fetchServers = React.useCallback(async () => {
    try {
      const response = await apiFetch('/api/mcp/servers');
      const data = await response.json();
      if (data.success) {
        // Handle both array and object responses
        let serverList: MCPServer[] = [];
        if (Array.isArray(data.data)) {
          serverList = data.data.map((server: any) => ({
            id: server.id,
            name: server.config?.name || server.name,
            command: server.config?.command || '',
            enabled: server.config?.enabled !== false,
          }));
        } else if (data.data && typeof data.data === 'object') {
          // Handle case where data.data might be an object with servers as properties
          const serversObj = data.data;
          if (serversObj.servers && Array.isArray(serversObj.servers)) {
            serverList = serversObj.servers.map((server: any) => ({
              id: server.id,
              name: server.config?.name || server.name,
              command: server.config?.command || '',
              enabled: server.config?.enabled !== false,
            }));
          }
        }
        setServers(serverList);
      }
    } catch (error) {
      console.error('Failed to fetch MCP servers:', error);
    }
  }, []);

  // Fetch predefined available servers
  const fetchPredefinedServers = React.useCallback(async () => {
    try {
      const response = await apiFetch('/api/mcp/available-servers');
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

  // Check if OAuth token exists for a provider
  const checkOAuthToken = async (provider: string): Promise<boolean> => {
    try {
      const response = await apiFetch(`/api/auth/oauth/token/${provider}`, { excludeRoleId: true });
      return response.ok;
    } catch {
      return false;
    }
  };

  // Helper function to clear OAuth state
  const clearOAuthState = React.useCallback(() => {
    setAuthRequired(false);
    setConnecting(false);
    setSelectedServerId(null);
    selectedServerIdRef.current = null;
    setAuthProvider(null);
  }, []);

  // Add server after auth is complete (called after OAuth success)
  const addServerAfterAuth = React.useCallback(async (serverId: string) => {
    // Prevent duplicate calls during OAuth flow
    if (pendingAddRef.current === serverId) {
      console.log(`[addServerAfterAuth] Duplicate call prevented for serverId: ${serverId}`);
      return;
    }

    pendingAddRef.current = serverId;
    console.log(`[addServerAfterAuth] Adding server: ${serverId}`);

    // Immediately clear "Authentication Required" and show "Connecting..." so the
    // user knows OAuth succeeded even while the API call is still in progress
    setAuthRequired(false);
    setAuthProvider(null);
    setConnecting(true);
    setAdding(true);

    try {
      const response = await apiFetch('/api/mcp/servers/add-predefined', {
        method: 'POST',
        body: JSON.stringify({ serverId }),
      });

      const data = await response.json();

      if (response.ok) {
        // Success - clear state and close dialog
        console.log(`[addServerAfterAuth] Server added successfully: ${serverId}`);
        const server = predefinedServers.find(s => s.id === serverId);
        setToast({ message: `✅ Successfully added ${server?.name || 'MCP server'}!`, type: 'success' });
        setSelectedServerId(null);
        selectedServerIdRef.current = null;
        onClose();
      } else {
        console.error(`[addServerAfterAuth] Failed to add server:`, data.error);
        setToast({ message: `Failed to add server: ${data.error?.message || 'Unknown error'}`, type: 'error' });
        setSelectedServerId(null);
        selectedServerIdRef.current = null;
        // Clear auth state even on failure so "Authentication Required" message goes away
        setAuthRequired(false);
        setAuthProvider(null);
      }
    } catch (error) {
      console.error(`[addServerAfterAuth] Error:`, error);
      setToast({ message: `Error adding server: ${error instanceof Error ? error.message : 'Unknown error'}`, type: 'error' });
      setSelectedServerId(null);
      selectedServerIdRef.current = null;
      // Clear auth state even on error so "Authentication Required" message goes away
      setAuthRequired(false);
      setAuthProvider(null);
    } finally {
      setAdding(false);
      setConnecting(false);
      pendingAddRef.current = null;
    }
  }, [onClose, predefinedServers]);

  // Start OAuth flow for any provider
  const startOAuthFlow = async (provider: string): Promise<boolean> => {
    try {
      const endpoint = `/api/auth/${provider}/start`;
      const authResponse = await apiFetch(endpoint, { excludeRoleId: true });

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

        const popup = window.open(
          authData.data.authUrl,
          `${provider}-auth`,
          `width=${width},height=${height},left=${left},top=${top}`
        );

        // Store popup reference for polling
        if (popup) {
          oauthPopupRef.current = popup;

          // Start polling for OAuth completion
          startOAuthPolling(provider);
        }

        return true;
      }
    } catch (error) {
      console.error(`Error starting ${provider} OAuth:`, error);
    }
    return false;
  };

  // Poll for OAuth completion as a fallback to postMessage
  const startOAuthPolling = React.useCallback((provider: string) => {
    // Clear any existing polling
    if (oauthPollIntervalRef.current) {
      clearInterval(oauthPollIntervalRef.current);
    }

    console.log(`[OAuth] Starting polling for ${provider} token...`);
    console.log(`[OAuth] Selected server ID: ${selectedServerIdRef.current}`);

    let attempts = 0;
    let attemptsAfterClose = 0;
    const maxAttempts = 60; // 60 seconds max
    // After the popup closes, keep polling a few more seconds before giving up.
    // This prevents a race where the token is stored but the first check after
    // close returns false due to a slow network or async DB write.
    const maxAttemptsAfterClose = 5;

    oauthPollIntervalRef.current = setInterval(async () => {
      attempts++;

      // Check if popup is closed
      const popupClosed = oauthPopupRef.current?.closed;

      // Check if token exists
      const hasToken = await checkOAuthToken(provider);

      console.log(`[OAuth] Poll attempt ${attempts}: hasToken=${hasToken}, popupClosed=${popupClosed}`);

      if (hasToken) {
        console.log(`[OAuth] Token found for ${provider} after ${attempts} attempts`);
        clearInterval(oauthPollIntervalRef.current!);
        oauthPollIntervalRef.current = null;
        oauthPopupRef.current = null;

        // Add the server now that we have the token
        const serverId = selectedServerIdRef.current;
        if (serverId) {
          console.log(`[OAuth] Adding server via polling: ${serverId}`);
          addServerAfterAuth(serverId);
        }
        return;
      }

      // If popup is closed and still no token, keep retrying briefly before giving up.
      // This guards against the race condition where the token is being written to the
      // DB at the same moment the popup closes.
      if (popupClosed) {
        attemptsAfterClose++;
        console.log(`[OAuth] Popup closed, no token yet (retry ${attemptsAfterClose}/${maxAttemptsAfterClose})`);
        if (attemptsAfterClose >= maxAttemptsAfterClose) {
          console.log(`[OAuth] Giving up after ${attemptsAfterClose} retries post-close`);
          clearInterval(oauthPollIntervalRef.current!);
          oauthPollIntervalRef.current = null;
          oauthPopupRef.current = null;
          clearOAuthState();
        }
        return;
      }

      // Timeout after max attempts
      if (attempts >= maxAttempts) {
        console.log(`[OAuth] Polling timed out after ${maxAttempts} attempts`);
        clearInterval(oauthPollIntervalRef.current!);
        oauthPollIntervalRef.current = null;
        oauthPopupRef.current = null;
        setToast({ message: 'Authentication timed out. Please try again.', type: 'error' });
        clearOAuthState();
      }
    }, 1000);
  }, [addServerAfterAuth, clearOAuthState]);

  // Listen for OAuth success messages from popup
  React.useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      console.log('[OAuth] Message received:', event.data);
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'oauth_success') {
        console.log(`[OAuth] Received success message for ${event.data.provider}`);

        // Stop polling since we got the message
        if (oauthPollIntervalRef.current) {
          clearInterval(oauthPollIntervalRef.current);
          oauthPollIntervalRef.current = null;
        }

        // Try adding the server after OAuth completes using the ref to avoid stale closure
        const serverId = selectedServerIdRef.current;
        if (serverId) {
          console.log(`[OAuth] Adding server after auth: ${serverId}`);
          addServerAfterAuth(serverId);
        } else {
          console.warn('[OAuth] No server ID found in ref, cannot complete OAuth flow');
        }
      }
    };

    window.addEventListener('message', handleOAuthMessage);
    return () => window.removeEventListener('message', handleOAuthMessage);
  }, [addServerAfterAuth]);

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
      selectedServerIdRef.current = serverId; // Set ref for polling callback
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
      const response = await apiFetch('/api/mcp/servers/add-predefined', {
        method: 'POST',
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

      const response = await apiFetch(`/api/mcp/servers/${serverId}`, {
        method: 'PATCH',
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
      const response = await apiFetch(`/api/mcp/servers/${serverId}`, {
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

      {connecting ? (
        <div className="text-center py-8">
          <div className="mb-4">
            <div className="inline-block p-3 rounded-full bg-green-500/20 mb-4">
              <div className="text-2xl animate-spin">⚙️</div>
            </div>
            <h3 className="text-lg font-semibold mb-2">Connecting...</h3>
            <p className="text-muted-foreground">
              Authentication successful. Setting up the server, please wait.
            </p>
          </div>
        </div>
      ) : authRequired && authProvider ? (
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
              // Stop any ongoing OAuth polling
              if (oauthPollIntervalRef.current) {
                clearInterval(oauthPollIntervalRef.current);
                oauthPollIntervalRef.current = null;
              }
              oauthPopupRef.current = null;
              clearOAuthState();
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
            // Stop any ongoing OAuth polling when closing the dialog
            if (oauthPollIntervalRef.current) {
              clearInterval(oauthPollIntervalRef.current);
              oauthPollIntervalRef.current = null;
            }
            clearOAuthState();
            onClose();
          }}
          className="flex-1 px-4 py-2 bg-muted rounded-lg hover:bg-muted/80"
        >
          Close
        </button>
      </div>
    </div>
  );
}
