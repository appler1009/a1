import React from 'react';
import { useAuthStore } from '../../store';
import { apiFetch } from '../../lib/api';

function AccountSettings() {
  const { user } = useAuthStore();
  const [displayName, setDisplayName] = React.useState(user?.name || '');
  const [loading, setLoading] = React.useState(false);
  const [savedMessage, setSavedMessage] = React.useState('');

  React.useEffect(() => {
    setDisplayName(user?.name || '');
  }, [user?.name]);

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

    </div>
  );
}

export { AccountSettings };
