import React from 'react';
import { apiFetch } from '../../lib/api';
import { getPricing, calculateCost, type TokenCounts } from '../../lib/token-pricing';

type ModelTokens = TokenCounts;

export function TokenUsageSettings() {
  const [tokenUsage, setTokenUsage] = React.useState<{
    month: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedInputTokens: number;
    cacheCreationTokens: number;
    byModel: Record<string, ModelTokens>;
    byProvider: Record<string, ModelTokens & { totalTokens: number }>;
  } | null>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    apiFetch('/api/auth/me/token-usage')
      .then(r => r.json())
      .then(data => { if (data.success) setTokenUsage(data.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const providerLabel = (p: string) => {
    if (p.startsWith('byok:')) {
      const name = p.slice(5);
      return name === 'xai' ? 'xAI' : name.charAt(0).toUpperCase() + name.slice(1);
    }
    return p === 'grok' ? 'xAI' : p.charAt(0).toUpperCase() + p.slice(1);
  };

  return (
    <div className="p-4 border border-border rounded-lg bg-muted/20">
      <label className="text-xs font-medium text-muted-foreground block mb-2">
        Token Usage — {tokenUsage ? new Date(tokenUsage.month + '-01').toLocaleString('default', { month: 'long', year: 'numeric' }) : 'This Month'}
      </label>
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : tokenUsage ? (() => {
        const totalCost = Object.entries(tokenUsage.byModel).reduce((sum, [model, t]) => {
          const cost = calculateCost(model, t);
          return cost !== null ? sum + cost : sum;
        }, 0);
        const hasCost = Object.keys(tokenUsage.byModel).some(m => getPricing(m) !== null);

        const byProvider = tokenUsage.byProvider ?? {};
        const defaultProviders = Object.entries(byProvider).filter(([p]) => !p.startsWith('byok:'));
        const byokProviders = Object.entries(byProvider).filter(([p]) => p.startsWith('byok:'));

        return (
          <div className="space-y-3">
            {/* Total usage */}
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

            {/* Cache stats — subdued boxes */}
            {(tokenUsage.cachedInputTokens > 0 || tokenUsage.cacheCreationTokens > 0) && (
              <div className="grid grid-cols-2 gap-2">
                {tokenUsage.cachedInputTokens > 0 && (
                  <div className="bg-muted/30 rounded-lg p-2 text-center">
                    <p className="text-xs text-muted-foreground">Cache Read</p>
                    <p className="text-xs font-medium tabular-nums text-muted-foreground">{tokenUsage.cachedInputTokens.toLocaleString()}</p>
                  </div>
                )}
                {tokenUsage.cacheCreationTokens > 0 && (
                  <div className="bg-muted/30 rounded-lg p-2 text-center">
                    <p className="text-xs text-muted-foreground">Cache Write</p>
                    <p className="text-xs font-medium tabular-nums text-muted-foreground">{tokenUsage.cacheCreationTokens.toLocaleString()}</p>
                  </div>
                )}
              </div>
            )}

            {/* By key source */}
            {(defaultProviders.length > 0 || byokProviders.length > 0) && (
              <div className="pt-1 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">By key source</p>
                {[...defaultProviders, ...byokProviders].map(([provider, t]) => {
                  const isByok = provider.startsWith('byok:');
                  // Compute cost for this provider by summing matching models
                  const providerPrefix = isByok ? provider.slice(5) : provider; // e.g. 'anthropic', 'grok'
                  const providerCost = Object.entries(tokenUsage.byModel).reduce((sum, [model, mt]) => {
                    const modelProvider = model.startsWith('claude-') ? 'anthropic'
                      : model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') ? 'openai'
                      : model.startsWith('grok-') ? 'grok'
                      : null;
                    if (modelProvider !== providerPrefix) return sum;
                    const cost = calculateCost(model, mt);
                    return cost !== null ? sum + cost : sum;
                  }, 0);
                  const hasProviderCost = Object.keys(tokenUsage.byModel).some(model => {
                    const modelProvider = model.startsWith('claude-') ? 'anthropic'
                      : model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') ? 'openai'
                      : model.startsWith('grok-') ? 'grok'
                      : null;
                    return modelProvider === providerPrefix && getPricing(model) !== null;
                  });
                  return (
                    <div
                      key={provider}
                      className={`rounded-lg p-2 ${isByok ? 'bg-primary/5 border border-primary/20' : 'bg-muted/30'}`}
                    >
                      <p className="text-xs text-muted-foreground mb-1.5">
                        {isByok ? 'Your key' : 'App default'} · {providerLabel(provider)}
                      </p>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-muted/40 rounded-lg p-2 text-center">
                          <p className="text-xs text-muted-foreground">Input</p>
                          <p className="text-sm font-semibold">{t.promptTokens.toLocaleString()}</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg p-2 text-center">
                          <p className="text-xs text-muted-foreground">Output</p>
                          <p className="text-sm font-semibold">{t.completionTokens.toLocaleString()}</p>
                        </div>
                        <div className="bg-muted/40 rounded-lg p-2 text-center">
                          <p className="text-xs text-muted-foreground">Total</p>
                          <p className="text-sm font-semibold">{t.totalTokens.toLocaleString()}</p>
                          {hasProviderCost && (
                            <p className="text-xs text-muted-foreground mt-0.5">${providerCost.toFixed(4)}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })() : (
        <p className="text-xs text-muted-foreground">No usage data available.</p>
      )}
    </div>
  );
}
