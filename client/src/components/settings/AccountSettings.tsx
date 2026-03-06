import React from 'react';
import { useAuthStore } from '../../store';
import { apiFetch } from '../../lib/api';
import { getPricing, calculateCost, type TokenCounts } from '../../lib/token-pricing';

type ModelTokens = TokenCounts;

function AccountSettings() {
  const { user } = useAuthStore();
  const [displayName, setDisplayName] = React.useState(user?.name || '');
  const [loading, setLoading] = React.useState(false);
  const [savedMessage, setSavedMessage] = React.useState('');
  const [tokenUsage, setTokenUsage] = React.useState<{
    month: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    cacheCreationTokens: number;
    byModel: Record<string, ModelTokens>;
  } | null>(null);
  const [tokenUsageLoading, setTokenUsageLoading] = React.useState(true);

  React.useEffect(() => {
    setDisplayName(user?.name || '');
  }, [user?.name]);

  React.useEffect(() => {
    apiFetch('/api/auth/me/token-usage')
      .then(r => r.json())
      .then(data => {
        if (data.success) setTokenUsage(data.data);
      })
      .catch(() => {})
      .finally(() => setTokenUsageLoading(false));
  }, []);

  const handleSave = async () => {
    setLoading(true);
    try {
      const response = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: displayName }),
      });
      const data = await response.json();
      if (data.success) {
        setSavedMessage('Name saved successfully');
        if (data.data.user) {
          useAuthStore.getState().setUser(data.data.user);
        }
        setTimeout(() => setSavedMessage(''), 3000);
      } else {
        setSavedMessage('Failed to save name');
        setTimeout(() => setSavedMessage(''), 3000);
      }
    } catch {
      setSavedMessage('Error saving name');
      setTimeout(() => setSavedMessage(''), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border border-border rounded-lg bg-muted/20">
      <p className="text-sm text-muted-foreground mb-3">
        Manage your account information.
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Display Name
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your display name"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Email
          </label>
          <input
            type="email"
            value={user?.email || ''}
            disabled
            className="w-full px-3 py-2 bg-muted border border-border rounded-lg text-sm opacity-60 cursor-not-allowed"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Email cannot be changed
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

      <div className="mt-4 pt-4 border-t border-border">
        <label className="text-xs font-medium text-muted-foreground block mb-2">
          Token Usage — {tokenUsage ? new Date(tokenUsage.month + '-01').toLocaleString('default', { month: 'long', year: 'numeric' }) : 'This Month'}
        </label>
        {tokenUsageLoading ? (
          <p className="text-xs text-muted-foreground">Loading...</p>
        ) : tokenUsage ? (() => {
          const totalCost = Object.entries(tokenUsage.byModel).reduce((sum, [model, t]) => {
            const cost = calculateCost(model, t);
            return cost !== null ? sum + cost : sum;
          }, 0);
          const hasCost = Object.keys(tokenUsage.byModel).some(m => getPricing(m) !== null);
          return (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-muted/40 rounded-lg p-2 text-center">
                  <p className="text-xs text-muted-foreground">Input</p>
                  <p className="text-sm font-semibold">{tokenUsage.promptTokens.toLocaleString()}</p>
                </div>
                <div className="bg-muted/40 rounded-lg p-2 text-center">
                  <p className="text-xs text-muted-foreground">Output</p>
                  <p className="text-sm font-semibold">{tokenUsage.completionTokens.toLocaleString()}</p>
                </div>
                <div className="bg-muted/40 rounded-lg p-2 text-center">
                  <p className="text-xs text-muted-foreground">Total</p>
                  <p className="text-sm font-semibold">{tokenUsage.totalTokens.toLocaleString()}</p>
                  {hasCost && (
                    <p className="text-xs text-muted-foreground mt-0.5">${totalCost.toFixed(4)}</p>
                  )}
                </div>
              </div>
              {(tokenUsage.cachedInputTokens > 0 || tokenUsage.cacheCreationTokens > 0) && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-2 text-center">
                    <p className="text-xs text-muted-foreground">Cache Read</p>
                    <p className="text-sm font-semibold text-green-600">{tokenUsage.cachedInputTokens.toLocaleString()}</p>
                  </div>
                  <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-2 text-center">
                    <p className="text-xs text-muted-foreground">Cache Write</p>
                    <p className="text-sm font-semibold text-yellow-600">{tokenUsage.cacheCreationTokens.toLocaleString()}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })() : (
          <p className="text-xs text-muted-foreground">No usage data available.</p>
        )}
      </div>
    </div>
  );
}

export { AccountSettings };
