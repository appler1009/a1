import React from 'react';
import { apiFetch } from '../../lib/api';
import { getPricing, calculateCost, type TokenCounts } from '../../lib/token-pricing';

type ModelTokens = TokenCounts;

type UsageData = {
  month: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cacheCreationTokens: number;
  byModel: Record<string, ModelTokens>;
  byProvider: Record<string, ModelTokens & { totalTokens: number }>;
  margin: number;
};

function toMonthParam(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function lastMonthParam(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return toMonthParam(d);
}

export function TokenUsageSettings() {
  const now = new Date();
  const thisMonth = toMonthParam(now);
  const lastMonth = lastMonthParam();

  const [activeTab, setActiveTab] = React.useState<'this' | 'last'>('this');
  const [cache, setCache] = React.useState<Partial<Record<string, UsageData>>>({});
  const [loading, setLoading] = React.useState(false);

  const currentMonth = activeTab === 'this' ? thisMonth : lastMonth;
  const tokenUsage = cache[currentMonth] ?? null;

  React.useEffect(() => {
    if (cache[currentMonth] !== undefined) return;
    setLoading(true);
    apiFetch(`/api/auth/me/token-usage?month=${currentMonth}`)
      .then(r => r.json())
      .then(data => {
        if (data.success) setCache(prev => ({ ...prev, [currentMonth]: data.data }));
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [currentMonth]);

  const providerLabel = (p: string) => {
    if (p.startsWith('byok:')) {
      const name = p.slice(5);
      return name === 'xai' ? 'xAI' : name.charAt(0).toUpperCase() + name.slice(1);
    }
    return p === 'grok' ? 'xAI' : p.charAt(0).toUpperCase() + p.slice(1);
  };

  const tabLabel = (tab: 'this' | 'last') => {
    const month = tab === 'this' ? thisMonth : lastMonth;
    return new Date(month + '-02').toLocaleString('default', { month: 'long', year: 'numeric' });
  };

  return (
    <div className="p-4 border border-border rounded-lg bg-muted/20">
      {/* Tabs */}
      <div className="flex gap-1 mb-3 bg-muted/40 rounded-md p-0.5 w-fit">
        {(['this', 'last'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`text-xs px-3 py-1 rounded transition-colors ${
              activeTab === tab
                ? 'bg-background text-foreground shadow-sm font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'this' ? 'This Month' : 'Last Month'}
          </button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground mb-3">{tabLabel(activeTab)}</p>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : tokenUsage ? (() => {
        const margin = tokenUsage.margin ?? 1;
        const totalCost = Object.entries(tokenUsage.byModel).reduce((sum, [model, t]) => {
          const cost = calculateCost(model, t);
          return cost !== null ? sum + cost : sum;
        }, 0) * margin;
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
                  const providerPrefix = isByok ? provider.slice(5) : provider;
                  const providerCost = Object.entries(tokenUsage.byModel).reduce((sum, [model, mt]) => {
                    const modelProvider = model.startsWith('claude-') ? 'anthropic'
                      : model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') ? 'openai'
                      : model.startsWith('grok-') ? 'grok'
                      : null;
                    if (modelProvider !== providerPrefix) return sum;
                    const cost = calculateCost(model, mt);
                    return cost !== null ? sum + cost : sum;
                  }, 0) * margin;
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
