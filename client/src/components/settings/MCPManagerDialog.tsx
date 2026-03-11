import React from 'react';
import { apiFetch } from '../../lib/api';
import { AccountSettings } from './AccountSettings';
import { BYOKSettings } from './BYOKSettings';
import { TokenUsageSettings } from './TokenUsageSettings';
import { DiscordSettings } from './DiscordSettings';
import { LocaleTimezoneSettings } from './LocaleTimezoneSettings';

interface MCPServer {
  id?: string;
  name?: string;
  command?: string;
  enabled?: boolean;
  config?: any;
}

interface PredefinedMCPServer {
  id: string;
  name: string;
  description: string;
  command: string;
  args: string[];
  auth?: {
    provider: 'google' | 'github' | 'none' | 'alphavantage' | 'twelvedata' | 'smtp-imap';
  };
  icon?: string;
  hidden?: boolean;
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
  const [activeTab, setActiveTab] = React.useState<'features' | 'region' | 'discord' | 'account' | 'models' | 'about'>('features');
  const [showLicenses, setShowLicenses] = React.useState(false);

  const [smtpImapForm, setSmtpImapForm] = React.useState<{
    open: boolean;
    saving: boolean;
    testing: boolean;
    testResult: { smtp: { ok: boolean; message: string }; imap: { ok: boolean; message: string } } | null;
    accountEmail: string;
    smtpHost: string;
    smtpPort: string;
    smtpSecure: boolean;
    imapHost: string;
    imapPort: string;
    imapSecure: boolean;
    username: string;
    password: string;
  }>({
    open: false,
    saving: false,
    testing: false,
    testResult: null,
    accountEmail: '',
    smtpHost: '',
    smtpPort: '587',
    smtpSecure: true,
    imapHost: '',
    imapPort: '993',
    imapSecure: true,
    username: '',
    password: '',
  });

  const containerRef = React.useRef<HTMLDivElement>(null);
  const pendingAddRef = React.useRef<string | null>(null);
  const oauthPopupRef = React.useRef<Window | null>(null);
  const oauthPollIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const selectedServerIdRef = React.useRef<string | null>(null);
  const knownAccountEmailsRef = React.useRef<Set<string>>(new Set());

  React.useEffect(() => {
    if (smtpImapForm.open) {
      containerRef.current?.scrollTo({ top: 0 });
    }
  }, [smtpImapForm.open]);

  React.useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  React.useEffect(() => {
    return () => {
      if (oauthPollIntervalRef.current) {
        clearInterval(oauthPollIntervalRef.current);
      }
    };
  }, []);

  const fetchServers = React.useCallback(async () => {
    try {
      const response = await apiFetch('/api/mcp/servers');
      const data = await response.json();
      if (data.success) {
        let serverList: MCPServer[] = [];
        if (Array.isArray(data.data)) {
          serverList = data.data.map((server: any) => ({
            id: server.id,
            name: server.config?.name || server.name,
            command: server.config?.command || '',
            enabled: server.config?.enabled !== false,
            config: server.config,
          }));
        } else if (data.data && typeof data.data === 'object') {
          const serversObj = data.data;
          if (serversObj.servers && Array.isArray(serversObj.servers)) {
            serverList = serversObj.servers.map((server: any) => ({
              id: server.id,
              name: server.config?.name || server.name,
              command: server.config?.command || '',
              enabled: server.config?.enabled !== false,
              config: server.config,
            }));
          }
        }
        setServers(serverList);
      }
    } catch (error) {
      console.error('Failed to fetch MCP servers:', error);
    }
  }, []);

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

  const clearOAuthState = React.useCallback(() => {
    setAuthRequired(false);
    setConnecting(false);
    setSelectedServerId(null);
    selectedServerIdRef.current = null;
    setAuthProvider(null);
  }, []);

  const addServerAfterAuth = React.useCallback(async (serverId: string, accountEmail?: string) => {
    if (pendingAddRef.current === serverId) {
      console.log(`[addServerAfterAuth] Duplicate call prevented for serverId: ${serverId}`);
      return;
    }

    pendingAddRef.current = serverId;
    console.log(`[addServerAfterAuth] Adding server: ${serverId} (account: ${accountEmail})`);

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
        console.log(`[addServerAfterAuth] Server added successfully: ${serverId}`);
        const serverInfo = predefinedServers.find(s => s.id === serverId);
        const displayName = accountEmail ? `${serverInfo?.name} (${accountEmail})` : serverInfo?.name;
        setToast({ message: `✅ Successfully added ${displayName || 'MCP server'}!`, type: 'success' });
        setSelectedServerId(null);
        selectedServerIdRef.current = null;
        clearOAuthState();
        fetchServers();
      } else {
        console.error(`[addServerAfterAuth] Failed to add server:`, data.error);
        setToast({ message: `Failed to add server: ${data.error?.message || 'Unknown error'}`, type: 'error' });
        setSelectedServerId(null);
        selectedServerIdRef.current = null;
        setAuthRequired(false);
        setAuthProvider(null);
      }
    } catch (error) {
      console.error(`[addServerAfterAuth] Error:`, error);
      setToast({ message: `Error adding server: ${error instanceof Error ? error.message : 'Unknown error'}`, type: 'error' });
      setSelectedServerId(null);
      selectedServerIdRef.current = null;
      setAuthRequired(false);
      setAuthProvider(null);
    } finally {
      setAdding(false);
      setConnecting(false);
      pendingAddRef.current = null;
    }
  }, [onClose, predefinedServers]);

  const startOAuthPolling = React.useCallback((provider: string) => {
    if (oauthPollIntervalRef.current) {
      clearInterval(oauthPollIntervalRef.current);
    }

    console.log(`[OAuth] Starting polling for ${provider} token...`);
    console.log(`[OAuth] Selected server ID: ${selectedServerIdRef.current}`);

    let attempts = 0;
    let attemptsAfterClose = 0;
    const maxAttempts = 60;
    const maxAttemptsAfterClose = 5;

    oauthPollIntervalRef.current = setInterval(async () => {
      attempts++;

      const popupClosed = oauthPopupRef.current?.closed;
      const newAccountEmail = await checkForNewOAuthAccount(provider);

      console.log(`[OAuth] Poll attempt ${attempts}: newAccount=${newAccountEmail}, popupClosed=${popupClosed}`);

      if (newAccountEmail) {
        console.log(`[OAuth] New ${provider} account detected: ${newAccountEmail}`);
        clearInterval(oauthPollIntervalRef.current!);
        oauthPollIntervalRef.current = null;
        oauthPopupRef.current = null;

        const serverId = selectedServerIdRef.current;
        if (serverId) {
          console.log(`[OAuth] Adding server via polling: ${serverId} (account: ${newAccountEmail})`);
          addServerAfterAuth(serverId, newAccountEmail);
        }
        return;
      }

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

  React.useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      console.log('[OAuth] Message received:', event.data);
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === 'oauth_success') {
        const { provider, accountEmail } = event.data;
        console.log(`[OAuth] Received success message for ${provider} (account: ${accountEmail})`);

        if (oauthPollIntervalRef.current) {
          clearInterval(oauthPollIntervalRef.current);
          oauthPollIntervalRef.current = null;
        }

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

  // BroadcastChannel listener — handles oauth_success when window.opener is null
  // (Google's Cross-Origin-Opener-Policy severs the opener reference)
  React.useEffect(() => {
    const channel = new BroadcastChannel('oauth-callback');
    channel.onmessage = (event) => {
      if (event.data?.type === 'oauth_success') {
        const { provider, accountEmail } = event.data;
        console.log(`[OAuth] BroadcastChannel: success for ${provider} (account: ${accountEmail})`);

        if (oauthPollIntervalRef.current) {
          clearInterval(oauthPollIntervalRef.current);
          oauthPollIntervalRef.current = null;
        }

        const serverId = selectedServerIdRef.current;
        if (serverId) {
          addServerAfterAuth(serverId, accountEmail);
        }
      }
    };
    return () => channel.close();
  }, [addServerAfterAuth]);

  const startOAuthFlow = async (provider: string): Promise<boolean> => {
    try {
      // google-gmail/google-drive/google-calendar all use the same /api/auth/google/start
      // route but with a ?service= param so each gets its own scoped token
      let endpoint = `/api/auth/${provider}/start`;
      if (provider.startsWith('google-')) {
        const service = provider.replace('google-', '');
        endpoint = `/api/auth/google/start?service=${service}`;
      }
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

        if (popup) {
          oauthPopupRef.current = popup;
          startOAuthPolling(provider);
        }

        return true;
      }
    } catch (error) {
      console.error(`Error starting ${provider} OAuth:`, error);
    }
    return false;
  };

  const handleSmtpImapTest = async () => {
    const { smtpHost, smtpPort, smtpSecure, imapHost, imapPort, imapSecure, username, password } = smtpImapForm;
    if (!smtpHost || !imapHost || !username || !password) {
      setToast({ message: 'Fill in all connection fields before testing', type: 'error' });
      return;
    }
    setSmtpImapForm(f => ({ ...f, testing: true, testResult: null }));
    try {
      const resp = await apiFetch('/api/smtp-imap/test', {
        method: 'POST',
        body: JSON.stringify({
          smtpHost, smtpPort: parseInt(smtpPort, 10), smtpSecure,
          imapHost, imapPort: parseInt(imapPort, 10), imapSecure,
          username, password,
        }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setSmtpImapForm(f => ({ ...f, testResult: data.data }));
      } else {
        setToast({ message: `Test failed: ${data.error?.message || 'Unknown error'}`, type: 'error' });
      }
    } catch (err) {
      setToast({ message: `Test error: ${err instanceof Error ? err.message : 'Unknown error'}`, type: 'error' });
    } finally {
      setSmtpImapForm(f => ({ ...f, testing: false }));
    }
  };

  const handleSmtpImapSubmit = async () => {
    const { accountEmail, smtpHost, smtpPort, smtpSecure, imapHost, imapPort, imapSecure, username, password } = smtpImapForm;
    if (!accountEmail || !smtpHost || !imapHost || !username || !password) {
      setToast({ message: 'All fields are required', type: 'error' });
      return;
    }
    setSmtpImapForm(f => ({ ...f, saving: true }));
    try {
      const saveResp = await apiFetch('/api/smtp-imap/accounts', {
        method: 'POST',
        body: JSON.stringify({
          accountEmail,
          smtpHost,
          smtpPort: parseInt(smtpPort, 10),
          smtpSecure,
          imapHost,
          imapPort: parseInt(imapPort, 10),
          imapSecure,
          username,
          password,
        }),
      });
      if (!saveResp.ok) {
        const d = await saveResp.json();
        setToast({ message: `Failed to save credentials: ${d.error?.message || 'Unknown error'}`, type: 'error' });
        return;
      }
      const addResp = await apiFetch('/api/mcp/servers/add-predefined', {
        method: 'POST',
        body: JSON.stringify({ serverId: 'smtp-imap-mcp-lib', accountEmail }),
      });
      const addData = await addResp.json();
      if (addResp.ok) {
        setToast({ message: `✅ SMTP/IMAP connected (${accountEmail})!`, type: 'success' });
        setSmtpImapForm(f => ({ ...f, open: false }));
        fetchServers();
      } else {
        setToast({ message: `Failed: ${addData.error?.message || 'Unknown error'}`, type: 'error' });
      }
    } catch (err) {
      setToast({ message: `Error: ${err instanceof Error ? err.message : 'Unknown error'}`, type: 'error' });
    } finally {
      setSmtpImapForm(f => ({ ...f, saving: false }));
    }
  };

  const handleAddServer = async (serverId: string) => {
    const server = predefinedServers.find(s => s.id === serverId);
    if (!server) {
      setToast({ message: 'Server not found', type: 'error' });
      return;
    }

    if (server.auth?.provider === 'smtp-imap') {
      setSmtpImapForm(f => ({ ...f, open: true }));
      return;
    }

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

    const requiresAuth = server.auth?.provider && server.auth.provider !== 'none';

    if (requiresAuth && server.auth?.provider) {
      try {
        const connResp = await apiFetch('/api/mcp/oauth/connections');
        const connData = await connResp.json();
        const existing: { accountEmail: string }[] = connData.data?.[server.auth.provider] || [];
        knownAccountEmailsRef.current = new Set(existing.map(a => a.accountEmail));
        console.log(`[OAuth] Snapshot of known ${server.auth.provider} accounts:`, [...knownAccountEmailsRef.current]);
      } catch {
        knownAccountEmailsRef.current = new Set();
      }

      setSelectedServerId(serverId);
      selectedServerIdRef.current = serverId;
      setAuthProvider(server.auth.provider);
      setAuthRequired(true);

      const authStarted = await startOAuthFlow(server.auth.provider);
      if (authStarted) {
        return;
      } else {
        setAuthRequired(false);
        setToast({ message: `Failed to start ${server.auth.provider} authentication`, type: 'error' });
        return;
      }
    }

    await addServerWithOptions(serverId);
  };

  const addServerWithOptions = async (serverId: string, accountEmail?: string) => {
    const server = predefinedServers.find(s => s.id === serverId);
    if (!server) {
      setToast({ message: 'Server not found', type: 'error' });
      return;
    }

    if (server.auth?.provider && server.auth.provider.startsWith('google') && !accountEmail) {
      try {
        const response = await apiFetch('/api/mcp/oauth/connections');
        const data = await response.json();
        const providerAccounts: { accountEmail: string }[] = data.data?.[server.auth.provider] || [];
        if (data.success && providerAccounts.length > 0) {
          if (providerAccounts.length === 1) {
            accountEmail = providerAccounts[0].accountEmail;
          } else if (providerAccounts.length > 1) {
            const selectedAccount = providerAccounts[0].accountEmail;
            const userChoice = prompt(
              `Select Google account:\n${providerAccounts.map((acc: any) => acc.accountEmail).join('\n')}`,
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
      } catch {
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
        const displayName = accountEmail ? `${server.name} (${accountEmail})` : server.name;
        setToast({ message: `✅ Successfully added ${displayName}!`, type: 'success' });
        fetchServers();
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
    if (!confirm(`Are you sure you want to remove this feature?`)) return;

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
    <div ref={containerRef} className={`relative bg-background border border-border rounded-lg p-6 w-full max-w-2xl max-h-[70vh] ${smtpImapForm.open ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">Settings</h2>
        <button
          onClick={() => {
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
        {(['account', 'models', 'features', 'region', 'discord', 'about'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium capitalize rounded-t transition-colors ${
              activeTab === tab
                ? 'border-b-2 border-primary text-foreground -mb-px'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'region' ? 'Region' : tab === 'models' ? 'Models' : tab.charAt(0).toUpperCase() + tab.slice(1)}
          </button>
        ))}
      </div>

      {/* Toast notification */}
      {toast && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${toast.type === 'success' ? 'bg-green-500/20 text-green-700' : 'bg-red-500/20 text-red-700'}`}>
          {toast.message}
        </div>
      )}

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
          {/* Account tab */}
          {activeTab === 'account' && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold mb-3">Account</h3>
              <AccountSettings />
            </div>
          )}

          {/* Models tab */}
          {activeTab === 'models' && (
            <div className="mb-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold mb-3">Token Usage</h3>
                <TokenUsageSettings />
              </div>
              <div>
                <h3 className="text-sm font-semibold mb-3">Bring Your Own Key</h3>
                <BYOKSettings />
              </div>
            </div>
          )}

          {/* Features tab */}
          {activeTab === 'features' && (
            <>
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

          {/* About tab */}
          {activeTab === 'about' && (
            <div className="mb-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold mb-3">Version</h3>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm bg-muted px-2 py-1 rounded select-all">{import.meta.env.COMMIT_HASH || 'unknown'}</span>
                  <span className="text-xs text-muted-foreground">build commit</span>
                </div>
              </div>

              <div>
                <button
                  onClick={() => setShowLicenses((v) => !v)}
                  className="flex items-center gap-2 text-sm font-semibold hover:text-foreground text-muted-foreground transition-colors"
                >
                  <span>{showLicenses ? '▾' : '▸'}</span>
                  Open-source licenses
                </button>
                {showLicenses && (
                  <div className="mt-3 space-y-2 max-h-72 overflow-y-auto pr-1">
                    {([
                      { name: 'React', license: 'MIT', author: 'Meta Platforms, Inc.' },
                      { name: 'react-router-dom', license: 'MIT', author: 'Remix Software' },
                      { name: 'Zustand', license: 'MIT', author: 'Paul Henschel' },
                      { name: 'Tailwind CSS', license: 'MIT', author: 'Tailwind Labs' },
                      { name: 'Vite', license: 'MIT', author: 'Yuxi (Evan) You' },
                      { name: '@radix-ui', license: 'MIT', author: 'WorkOS' },
                      { name: 'lucide-react', license: 'ISC', author: 'Lucide Contributors' },
                      { name: 'react-markdown', license: 'MIT', author: 'Titus Wormer' },
                      { name: 'react-resizable-panels', license: 'MIT', author: 'Brian Vaughn' },
                      { name: '@tanstack/react-query', license: 'MIT', author: 'TanStack' },
                      { name: 'fuse.js', license: 'Apache 2.0', author: 'Kiro Risk' },
                      { name: 'marked', license: 'MIT', author: 'Christopher Jeffrey' },
                      { name: 'clsx', license: 'MIT', author: 'Luke Edwards' },
                      { name: 'class-variance-authority', license: 'Apache 2.0', author: 'Joe Bell' },
                      { name: 'Fastify', license: 'MIT', author: 'Fastify Contributors' },
                      { name: 'better-sqlite3', license: 'MIT', author: 'Joshua Wise' },
                      { name: '@aws-sdk', license: 'Apache 2.0', author: 'Amazon Web Services' },
                      { name: 'Bun', license: 'MIT', author: 'Oven' },
                    ] as const).map(({ name, license, author }) => (
                      <div key={name} className="flex items-baseline justify-between text-sm py-1 border-b border-border/50 last:border-0">
                        <span className="font-medium">{name}</span>
                        <span className="text-muted-foreground text-xs ml-4 shrink-0">{license} · {author}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* SMTP/IMAP setup overlay — covers the entire dialog */}
      {smtpImapForm.open && (
        <div className="absolute inset-0 z-10 bg-background rounded-lg p-6 overflow-y-auto flex flex-col gap-3">
          <h3 className="text-sm font-semibold">SMTP / IMAP Account Setup</h3>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-xs text-muted-foreground mb-1">Account email (used as identifier)</label>
              <input
                type="email"
                className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background"
                placeholder="you@example.com"
                value={smtpImapForm.accountEmail}
                onChange={e => setSmtpImapForm(f => ({ ...f, accountEmail: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">Username</label>
              <input
                type="text"
                className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background"
                placeholder="you@example.com"
                value={smtpImapForm.username}
                onChange={e => setSmtpImapForm(f => ({ ...f, username: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Password</label>
              <input
                type="password"
                className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background"
                placeholder="App password or SMTP password"
                value={smtpImapForm.password}
                onChange={e => setSmtpImapForm(f => ({ ...f, password: e.target.value }))}
              />
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">SMTP host</label>
              <input
                type="text"
                className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background"
                placeholder="smtp.example.com"
                value={smtpImapForm.smtpHost}
                onChange={e => setSmtpImapForm(f => ({ ...f, smtpHost: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-muted-foreground mb-1">SMTP port</label>
                <input
                  type="number"
                  className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background"
                  value={smtpImapForm.smtpPort}
                  onChange={e => setSmtpImapForm(f => ({ ...f, smtpPort: e.target.value }))}
                />
              </div>
              <div className="flex flex-col justify-end pb-1.5">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={smtpImapForm.smtpSecure}
                    onChange={e => setSmtpImapForm(f => ({ ...f, smtpSecure: e.target.checked }))}
                  />
                  TLS
                </label>
              </div>
            </div>

            <div>
              <label className="block text-xs text-muted-foreground mb-1">IMAP host</label>
              <input
                type="text"
                className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background"
                placeholder="imap.example.com"
                value={smtpImapForm.imapHost}
                onChange={e => setSmtpImapForm(f => ({ ...f, imapHost: e.target.value }))}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="block text-xs text-muted-foreground mb-1">IMAP port</label>
                <input
                  type="number"
                  className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background"
                  value={smtpImapForm.imapPort}
                  onChange={e => setSmtpImapForm(f => ({ ...f, imapPort: e.target.value }))}
                />
              </div>
              <div className="flex flex-col justify-end pb-1.5">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={smtpImapForm.imapSecure}
                    onChange={e => setSmtpImapForm(f => ({ ...f, imapSecure: e.target.checked }))}
                  />
                  TLS
                </label>
              </div>
            </div>
          </div>

          {smtpImapForm.testResult && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className={`px-2 py-1.5 rounded ${smtpImapForm.testResult.smtp.ok ? 'bg-green-500/15 text-green-700' : 'bg-red-500/15 text-red-700'}`}>
                <span className="font-medium">SMTP: </span>{smtpImapForm.testResult.smtp.ok ? '✓ Connected' : `✗ ${smtpImapForm.testResult.smtp.message}`}
              </div>
              <div className={`px-2 py-1.5 rounded ${smtpImapForm.testResult.imap.ok ? 'bg-green-500/15 text-green-700' : 'bg-red-500/15 text-red-700'}`}>
                <span className="font-medium">IMAP: </span>{smtpImapForm.testResult.imap.ok ? '✓ Connected' : `✗ ${smtpImapForm.testResult.imap.message}`}
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1 mt-auto">
            <button
              onClick={() => setSmtpImapForm(f => ({ ...f, open: false, testResult: null }))}
              disabled={smtpImapForm.saving || smtpImapForm.testing}
              className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted/50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSmtpImapTest}
              disabled={smtpImapForm.saving || smtpImapForm.testing}
              className="px-3 py-1.5 text-sm border border-border rounded hover:bg-muted/50 disabled:opacity-50"
            >
              {smtpImapForm.testing ? 'Testing…' : 'Test Connection'}
            </button>
            <button
              onClick={handleSmtpImapSubmit}
              disabled={smtpImapForm.saving || smtpImapForm.testing}
              className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
            >
              {smtpImapForm.saving ? 'Saving…' : 'Save & Connect'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
