import { useUIStore, useAuthStore } from '../../store';
import React, { useRef, useEffect, useState } from 'react';
import { TopBanner } from '../TopBanner';
import { apiFetch } from '../../lib/api';
import { previewAdapterRegistry } from '../../lib/preview-adapters';

interface MCPServer {
  id?: string;
  name?: string;
  command?: string;
  enabled?: boolean;
  config?: any; // Full server config including accountEmail
}

interface PredefinedMCPServer {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  auth?: {
    provider: 'google' | 'github' | 'none' | 'alphavantage' | 'twelvedata';
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

interface DiscordSettingsProps {
  onUpdate?: () => void;
}

function DiscordSettings({ onUpdate: _onUpdate }: DiscordSettingsProps) {
  const [discordUserId, setDiscordUserId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [savedMessage, setSavedMessage] = React.useState('');
  const { user } = useAuthStore();

  React.useEffect(() => {
    // Load current Discord ID when component mounts
    if (user?.discordUserId) {
      setDiscordUserId(user.discordUserId);
    }
  }, [user?.discordUserId]);

  const handleSaveDiscordId = async () => {
    if (!discordUserId.trim()) {
      setSavedMessage('Please enter a Discord User ID');
      setTimeout(() => setSavedMessage(''), 3000);
      return;
    }

    setLoading(true);
    try {
      const response = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ discordUserId }),
      });

      const data = await response.json();
      if (data.success) {
        setSavedMessage('Discord ID saved successfully');
        // Update auth store with new user data
        if (data.data.user) {
          const authStore = useAuthStore.getState();
          authStore.setUser(data.data.user);
        }
        setTimeout(() => setSavedMessage(''), 3000);
      } else {
        setSavedMessage('Failed to save Discord ID');
        setTimeout(() => setSavedMessage(''), 3000);
      }
    } catch (error) {
      console.error('Failed to save Discord ID:', error);
      setSavedMessage('Error saving Discord ID');
      setTimeout(() => setSavedMessage(''), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border border-border rounded-lg bg-muted/20">
      <p className="text-sm text-muted-foreground mb-3">
        Link your Discord account to enable the Discord bot. Your Discord messages will be connected to this app account.
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Discord User ID
          </label>
          <input
            type="text"
            value={discordUserId}
            onChange={(e) => setDiscordUserId(e.target.value)}
            placeholder="Your Discord User ID (right-click username with Developer Mode on)"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground mt-1">
            To find your ID: Enable Developer Mode in Discord settings → right-click your username → Copy User ID
          </p>
        </div>
        <button
          onClick={handleSaveDiscordId}
          disabled={loading}
          className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-wait text-sm font-medium"
        >
          {loading ? 'Saving...' : 'Save Discord ID'}
        </button>
        {savedMessage && (
          <p className={`text-xs ${savedMessage.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
            {savedMessage}
          </p>
        )}
      </div>
    </div>
  );
}

function LocaleTimezoneSettings() {
  const { user } = useAuthStore();
  const detectedLocale = navigator.language;
  const detectedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const [locale, setLocale] = React.useState(user?.locale || detectedLocale);
  const [timezone, setTimezone] = React.useState(user?.timezone || detectedTimezone);
  const [loading, setLoading] = React.useState(false);
  const [savedMessage, setSavedMessage] = React.useState('');

  React.useEffect(() => {
    setLocale(user?.locale || detectedLocale);
    setTimezone(user?.timezone || detectedTimezone);
  }, [user?.locale, user?.timezone]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSave = async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ locale, timezone }),
      });
      const data = await response.json();
      if (data.success) {
        setSavedMessage('Saved successfully');
        if (data.data.user) {
          useAuthStore.getState().setUser(data.data.user);
        }
        setTimeout(() => setSavedMessage(''), 3000);
      } else {
        setSavedMessage('Failed to save');
        setTimeout(() => setSavedMessage(''), 3000);
      }
    } catch {
      setSavedMessage('Error saving');
      setTimeout(() => setSavedMessage(''), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border border-border rounded-lg bg-muted/20">
      <p className="text-sm text-muted-foreground mb-3">
        Your locale and timezone are auto-detected from the browser. You can override them here.
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Locale
          </label>
          <input
            type="text"
            value={locale}
            onChange={(e) => setLocale(e.target.value)}
            placeholder={detectedLocale}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Browser detected: <span className="font-mono">{detectedLocale}</span>. Examples: en-US, en-CA, fr-FR, de-DE
          </p>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Timezone
          </label>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            placeholder={detectedTimezone}
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Browser detected: <span className="font-mono">{detectedTimezone}</span>
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-wait text-sm font-medium"
        >
          {loading ? 'Saving...' : 'Save'}
        </button>
        {savedMessage && (
          <p className={`text-xs ${savedMessage.includes('success') ? 'text-green-600' : 'text-red-600'}`}>
            {savedMessage}
          </p>
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
  const [activeTab, setActiveTab] = React.useState<'features' | 'region' | 'discord'>('features');

  // Prevent duplicate add calls during OAuth flow
  const pendingAddRef = React.useRef<string | null>(null);

  // Track OAuth popup window for polling
  const oauthPopupRef = React.useRef<Window | null>(null);
  const oauthPollIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  // Track selected server ID for polling callback (avoids closure issues)
  const selectedServerIdRef = React.useRef<string | null>(null);

  // Snapshot of Google accounts that existed BEFORE OAuth started
  // Polling only triggers addServerAfterAuth when a NEW account appears
  const knownAccountEmailsRef = React.useRef<Set<string>>(new Set());

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
            config: server.config, // Preserve full config for accountEmail display
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
              config: server.config, // Preserve full config for accountEmail display
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

  // Fetch available OAuth connections (user-level, shared across roles)
  React.useEffect(() => {
    fetchServers();
    fetchPredefinedServers();
  }, [fetchServers, fetchPredefinedServers]);

  // Check for a NEW OAuth account that didn't exist before OAuth started.
  // Returns the new account email, or null if no new account found.
  const checkForNewOAuthAccount = async (provider: string): Promise<string | null> => {
    try {
      const response = await apiFetch(`/api/mcp/oauth/connections`);
      if (!response.ok) return null;
      const data = await response.json();
      const accounts: { accountEmail: string }[] = data.data?.[provider] || [];
      const newAccount = accounts.find(a => !knownAccountEmailsRef.current.has(a.accountEmail));
      return newAccount?.accountEmail ?? null;
    } catch {
      return null;
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
  // accountEmail is passed directly from postMessage or polling - no need to re-fetch
  const addServerAfterAuth = React.useCallback(async (serverId: string, accountEmail?: string) => {
    // Prevent duplicate calls during OAuth flow
    if (pendingAddRef.current === serverId) {
      console.log(`[addServerAfterAuth] Duplicate call prevented for serverId: ${serverId}`);
      return;
    }

    pendingAddRef.current = serverId;
    console.log(`[addServerAfterAuth] Adding server: ${serverId} (account: ${accountEmail})`);

    // Immediately clear "Authentication Required" and show "Connecting..." so the
    // user knows OAuth succeeded even while the API call is still in progress
    setAuthRequired(false);
    setAuthProvider(null);
    setConnecting(true);
    setAdding(true);

    try {
      const response = await apiFetch('/api/mcp/servers/add-predefined', {
        method: 'POST',
        body: JSON.stringify({ serverId, accountEmail }),
      });

      const data = await response.json();

      if (response.ok) {
        // Success - refresh servers list and keep dialog open
        console.log(`[addServerAfterAuth] Server added successfully: ${serverId}`);
        const serverInfo = predefinedServers.find(s => s.id === serverId);
        const displayName = accountEmail ? `${serverInfo?.name} (${accountEmail})` : serverInfo?.name;
        setToast({ message: `✅ Successfully added ${displayName || 'MCP server'}!`, type: 'success' });
        setSelectedServerId(null);
        selectedServerIdRef.current = null;
        clearOAuthState();
        fetchServers(); // Refresh the servers list to show the newly added server
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

      // Only trigger when a NEW account appears (not an already-known one)
      const newAccountEmail = await checkForNewOAuthAccount(provider);

      console.log(`[OAuth] Poll attempt ${attempts}: newAccount=${newAccountEmail}, popupClosed=${popupClosed}`);

      if (newAccountEmail) {
        console.log(`[OAuth] New ${provider} account detected: ${newAccountEmail}`);
        clearInterval(oauthPollIntervalRef.current!);
        oauthPollIntervalRef.current = null;
        oauthPopupRef.current = null;

        // Add the server using the newly authenticated account
        const serverId = selectedServerIdRef.current;
        if (serverId) {
          console.log(`[OAuth] Adding server via polling: ${serverId} (account: ${newAccountEmail})`);
          addServerAfterAuth(serverId, newAccountEmail);
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
        const { provider, accountEmail } = event.data;
        console.log(`[OAuth] Received success message for ${provider} (account: ${accountEmail})`);

        // Stop polling since we got the message
        if (oauthPollIntervalRef.current) {
          clearInterval(oauthPollIntervalRef.current);
          oauthPollIntervalRef.current = null;
        }

        // Add the server using the email from the postMessage (authoritative)
        const serverId = selectedServerIdRef.current;
        if (serverId) {
          console.log(`[OAuth] Adding server after auth: ${serverId} (account: ${accountEmail})`);
          addServerAfterAuth(serverId, accountEmail);
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

    // API key servers: prompt for the key and POST it directly (no OAuth flow)
    if (server.auth?.provider === 'alphavantage' || server.auth?.provider === 'twelvedata') {
      const apiKey = prompt(`Enter your ${server.name} API key:`);
      if (!apiKey?.trim()) {
        setToast({ message: 'API key is required', type: 'error' });
        return;
      }
      setAdding(true);
      try {
        const response = await apiFetch('/api/mcp/servers/add-predefined', {
          method: 'POST',
          body: JSON.stringify({ serverId, apiKey: apiKey.trim() }),
        });
        const data = await response.json();
        if (response.ok) {
          setToast({ message: `✅ Successfully connected ${server.name}!`, type: 'success' });
          fetchServers();
        } else {
          setToast({ message: `Failed: ${data.error?.message || 'Unknown error'}`, type: 'error' });
        }
      } catch (error) {
        setToast({ message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`, type: 'error' });
      } finally {
        setAdding(false);
      }
      return;
    }

    // Check if this server requires authentication
    const requiresAuth = server.auth?.provider && server.auth.provider !== 'none';

    if (requiresAuth && server.auth?.provider) {
      // Snapshot existing accounts before OAuth so polling only fires on NEW accounts
      try {
        const connResp = await apiFetch('/api/mcp/oauth/connections');
        const connData = await connResp.json();
        const existing: { accountEmail: string }[] = connData.data?.[server.auth.provider] || [];
        knownAccountEmailsRef.current = new Set(existing.map(a => a.accountEmail));
        console.log(`[OAuth] Snapshot of known ${server.auth.provider} accounts:`, [...knownAccountEmailsRef.current]);
      } catch {
        knownAccountEmailsRef.current = new Set();
      }

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
    await addServerWithOptions(serverId);
  };

  const addServerWithOptions = async (serverId: string, accountEmail?: string) => {
    const server = predefinedServers.find(s => s.id === serverId);
    if (!server) {
      setToast({ message: 'Server not found', type: 'error' });
      return;
    }

    // If this is a Google service and account not specified, fetch available accounts and prompt
    if (server.auth?.provider === 'google' && !accountEmail) {
      try {
        const response = await apiFetch('/api/mcp/oauth/connections');
        const data = await response.json();
        if (data.success && data.data?.google && data.data.google.length > 0) {
          if (data.data.google.length === 1) {
            // Only one account, use it automatically
            accountEmail = data.data.google[0].accountEmail;
          } else if (data.data.google.length > 1) {
            // Multiple accounts, prompt user to select
            const selectedAccount = data.data.google[0].accountEmail;
            const userChoice = prompt(
              `Select Google account:\n${data.data.google.map((acc: any) => acc.accountEmail).join('\n')}`,
              selectedAccount
            );
            if (!userChoice) {
              setToast({ message: 'Account selection cancelled', type: 'error' });
              return;
            }
            accountEmail = userChoice;
          }
        } else {
          setToast({ message: 'No Google accounts connected', type: 'error' });
          return;
        }
      } catch (error) {
        setToast({ message: 'Failed to fetch available accounts', type: 'error' });
        return;
      }
    }

    setAdding(true);
    try {
      const response = await apiFetch('/api/mcp/servers/add-predefined', {
        method: 'POST',
        body: JSON.stringify({ serverId, accountEmail }),
      });

      const data = await response.json();

      if (response.ok) {
        // Success - show toast and refresh servers list (keep dialog open)
        const displayName = accountEmail ? `${server.name} (${accountEmail})` : server.name;
        setToast({ message: `✅ Successfully added ${displayName}!`, type: 'success' });
        fetchServers(); // Refresh to show newly added server
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

  // Group servers by base ID (strips ~accountEmail suffix for multi-account services)
  const getBaseServerId = (id: string) => id.includes('~') ? id.split('~')[0] : id;

  const groupedServers = React.useMemo(() => {
    const groups = new Map<string, MCPServer[]>();
    for (const server of servers) {
      const baseId = getBaseServerId(server.id || '');
      if (!groups.has(baseId)) groups.set(baseId, []);
      groups.get(baseId)!.push(server);
    }
    return groups;
  }, [servers]);

  return (
    <div className="bg-background border border-border rounded-lg p-6 w-full max-w-2xl max-h-[70vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Settings</h2>
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
          className="text-muted-foreground hover:text-foreground"
        >
          ✕
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-5 border-b border-border">
        {(['features', 'region', 'discord'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize rounded-t transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-primary text-foreground -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'region' ? 'Region' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
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
          {/* Features tab */}
          {activeTab === 'features' && (
            <>
              {/* Active Features */}
              {groupedServers.size > 0 && (
                <div className="mb-6">
                  <h3 className="text-sm font-semibold mb-3">Active Features</h3>
                  <div className="space-y-2">
                    {Array.from(groupedServers.entries()).map(([baseId, groupServers]) => {
                      const displayName = groupServers[0]?.name || baseId;
                      const isMultiAccount = groupServers.some(s => (s.id || '').includes('~'));
                      const predefined = predefinedServers.find(p => p.id === baseId);
                      const supportsMultiAccount = predefined?.auth?.provider && predefined.auth.provider !== 'none';

                      return (
                        <div key={baseId} className="border border-border rounded-lg overflow-hidden">
                          <div className="flex items-center justify-between px-3 py-2 bg-muted/30">
                            <h4 className="font-semibold text-sm">{displayName}</h4>
                            {isMultiAccount && supportsMultiAccount ? (
                              <button
                                onClick={() => handleAddServer(baseId)}
                                disabled={adding}
                                className="text-xs text-blue-600 hover:underline disabled:opacity-50 whitespace-nowrap"
                              >
                                + Add account
                              </button>
                            ) : !isMultiAccount ? (
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleToggleServer(groupServers[0].id!)}
                                  className="px-2 py-1 text-xs bg-blue-500/20 text-blue-600 rounded hover:bg-blue-500/30 whitespace-nowrap"
                                >
                                  {groupServers[0].enabled ? 'Disable' : 'Enable'}
                                </button>
                                <button
                                  onClick={() => handleRemoveServer(groupServers[0].id!)}
                                  className="px-2 py-1 text-xs bg-red-500/20 text-red-600 rounded hover:bg-red-500/30 whitespace-nowrap"
                                >
                                  Remove
                                </button>
                              </div>
                            ) : null}
                          </div>
                          {isMultiAccount && groupServers.map(server => {
                            const accountEmail = server.config?.accountEmail || server.id?.split('~')[1];
                            return (
                              <div key={server.id} className="flex items-center justify-between px-3 py-1.5 border-t border-border/50">
                                <span className="text-xs text-muted-foreground">{accountEmail || server.id}</span>
                                <button
                                  onClick={() => handleRemoveServer(server.id!)}
                                  className="px-2 py-1 text-xs bg-red-500/20 text-red-600 rounded hover:bg-red-500/30 whitespace-nowrap"
                                >
                                  Remove
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
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

          {/* Region tab */}
          {activeTab === 'region' && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold mb-3">Locale & Timezone</h3>
              <LocaleTimezoneSettings />
            </div>
          )}

          {/* Discord tab */}
          {activeTab === 'discord' && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold mb-3">Discord Integration</h3>
              <DiscordSettings onUpdate={fetchServers} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
