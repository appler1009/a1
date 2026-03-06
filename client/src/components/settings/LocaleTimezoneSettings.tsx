import React from 'react';
import { useAuthStore } from '../../store';
import { apiFetch } from '../../lib/api';

export function LocaleTimezoneSettings() {
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
