import React from 'react';
import { useAuthStore } from '../../store';
import { apiFetch } from '../../lib/api';

interface DiscordSettingsProps {
  onUpdate?: () => void;
}

export function DiscordSettings({ onUpdate: _onUpdate }: DiscordSettingsProps) {
  const [discordUserId, setDiscordUserId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [savedMessage, setSavedMessage] = React.useState('');
  const { user } = useAuthStore();

  React.useEffect(() => {
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
        if (data.data.user) {
          useAuthStore.getState().setUser(data.data.user);
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
