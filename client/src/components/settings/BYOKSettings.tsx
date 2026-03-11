import React from 'react';
import { apiFetch } from '../../lib/api';

const PROVIDERS = [
  { id: 'xai', name: 'xAI', placeholder: 'e.g. grok-4-0709' },
  { id: 'openai', name: 'OpenAI', placeholder: 'e.g. gpt-4o' },
  { id: 'anthropic', name: 'Anthropic', placeholder: 'e.g. claude-sonnet-4-20250514' },
] as const;

type ProviderId = (typeof PROVIDERS)[number]['id'];

interface ByokEntry {
  provider: ProviderId;
  model: string;
  enabled: boolean;
  apiKeyHint: string;
}

export function BYOKSettings() {
  const [entries, setEntries] = React.useState<ByokEntry[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [form, setForm] = React.useState<{
    open: boolean;
    provider: ProviderId;
    apiKey: string;
    model: string;
    saving: boolean;
  }>({
    open: false,
    provider: 'xai',
    apiKey: '',
    model: '',
    saving: false,
  });
  const [message, setMessage] = React.useState('');

  const showMsg = (msg: string) => {
    setMessage(msg);
    setTimeout(() => setMessage(''), 3000);
  };

  const fetchEntries = React.useCallback(async () => {
    try {
      const res = await apiFetch('/api/byok');
      const data = await res.json();
      if (data.success) setEntries(data.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  const openForm = (providerId: ProviderId) => {
    const existing = entries.find(e => e.provider === providerId);
    setForm({
      open: true,
      provider: providerId,
      apiKey: '',
      model: existing?.model || '',
      saving: false,
    });
  };

  const handleSave = async (activate: boolean) => {
    if (!form.apiKey.trim() || !form.model.trim()) {
      showMsg('API key and model are required');
      return;
    }
    setForm(f => ({ ...f, saving: true }));
    try {
      const res = await apiFetch('/api/byok', {
        method: 'POST',
        body: JSON.stringify({
          provider: form.provider,
          apiKey: form.apiKey.trim(),
          model: form.model.trim(),
          activate,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showMsg(activate ? 'Saved and activated' : 'Saved');
        setForm(f => ({ ...f, open: false }));
        fetchEntries();
      } else {
        showMsg(data.error?.message || 'Failed to save');
      }
    } catch {
      showMsg('Error saving');
    } finally {
      setForm(f => ({ ...f, saving: false }));
    }
  };

  const handleActivate = async (provider: ProviderId) => {
    try {
      const res = await apiFetch(`/api/byok/${provider}/activate`, { method: 'POST' });
      if (res.ok) {
        showMsg('Activated');
        fetchEntries();
      }
    } catch {
      showMsg('Error activating');
    }
  };

  const handleDeactivate = async () => {
    try {
      const res = await apiFetch('/api/byok/deactivate', { method: 'POST' });
      if (res.ok) {
        showMsg('Using app default');
        fetchEntries();
      }
    } catch {
      showMsg('Error');
    }
  };

  const handleRemove = async (provider: ProviderId) => {
    if (!confirm(`Remove ${PROVIDERS.find(p => p.id === provider)?.name} API key?`)) return;
    try {
      const res = await apiFetch(`/api/byok/${provider}`, { method: 'DELETE' });
      if (res.ok) {
        showMsg('Removed');
        fetchEntries();
      }
    } catch {
      showMsg('Error removing');
    }
  };

  const activeEntry = entries.find(e => e.enabled);

  return (
    <div className="p-4 border border-border rounded-lg bg-muted/20 space-y-4">
      <p className="text-sm text-muted-foreground">
        Use your own API key instead of the app's default model.
        {activeEntry
          ? ` Currently using: ${PROVIDERS.find(p => p.id === activeEntry.provider)?.name} (${activeEntry.model})`
          : ' No custom key active — using app default.'}
      </p>

      {message && (
        <p className={`text-xs ${message.includes('Error') || message.includes('Failed') ? 'text-red-600' : 'text-green-600'}`}>
          {message}
        </p>
      )}

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading...</p>
      ) : (
        <div className="space-y-2">
          {PROVIDERS.map(({ id, name }) => {
            const entry = entries.find(e => e.provider === id);
            return (
              <div
                key={id}
                className={`border rounded-lg px-3 py-2 flex items-center gap-3 ${entry?.enabled ? 'border-primary bg-primary/5' : 'border-border'}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{name}</span>
                    {entry?.enabled && (
                      <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded">Active</span>
                    )}
                  </div>
                  {entry ? (
                    <p className="text-xs text-muted-foreground">{entry.apiKeyHint} · {entry.model}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Not configured</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {entry && !entry.enabled && (
                    <button
                      onClick={() => handleActivate(id)}
                      className="text-xs px-2 py-1 bg-primary/20 text-primary rounded hover:bg-primary/30"
                    >
                      Use this
                    </button>
                  )}
                  {entry?.enabled && (
                    <button
                      onClick={handleDeactivate}
                      className="text-xs px-2 py-1 bg-muted rounded hover:bg-muted/80"
                    >
                      Deactivate
                    </button>
                  )}
                  <button
                    onClick={() => openForm(id)}
                    className="text-xs px-2 py-1 border border-border rounded hover:bg-muted/50"
                  >
                    {entry ? 'Edit' : 'Add'}
                  </button>
                  {entry && (
                    <button
                      onClick={() => handleRemove(id)}
                      className="text-xs px-2 py-1 bg-red-500/20 text-red-600 rounded hover:bg-red-500/30"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {form.open && (() => {
        const providerInfo = PROVIDERS.find(p => p.id === form.provider)!;
        return (
          <div className="border border-border rounded-lg p-3 bg-background space-y-2">
            <h4 className="text-sm font-medium">{providerInfo.name} API Key</h4>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">API Key</label>
              <input
                type="password"
                autoFocus
                className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background"
                placeholder="Paste your API key"
                value={form.apiKey}
                onChange={e => setForm(f => ({ ...f, apiKey: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Model name</label>
              <input
                type="text"
                className="w-full px-2 py-1.5 text-sm border border-border rounded bg-background"
                placeholder={providerInfo.placeholder}
                value={form.model}
                onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setForm(f => ({ ...f, open: false }))}
                disabled={form.saving}
                className="text-sm px-3 py-1.5 border border-border rounded hover:bg-muted/50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleSave(false)}
                disabled={form.saving}
                className="text-sm px-3 py-1.5 border border-border rounded hover:bg-muted/50 disabled:opacity-50"
              >
                Save only
              </button>
              <button
                onClick={() => handleSave(true)}
                disabled={form.saving}
                className="text-sm px-3 py-1.5 bg-primary text-primary-foreground rounded hover:bg-primary/90 disabled:opacity-50"
              >
                {form.saving ? 'Saving...' : 'Save & Activate'}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
