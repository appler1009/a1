import React from 'react';
import { useAuthStore } from '../../store';
import { apiFetch } from '../../lib/api';

interface TelegramSettingsProps {
  onUpdate?: () => void;
}

export function TelegramSettings({ onUpdate: _onUpdate }: TelegramSettingsProps) {
  const [telegramUserId, setTelegramUserId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [savedMessage, setSavedMessage] = React.useState('');
  const { user } = useAuthStore();

  React.useEffect(() => {
    if (user?.telegramUserId) {
      setTelegramUserId(user.telegramUserId);
    }
  }, [user?.telegramUserId]);

  const handleSave = async () => {
    if (!telegramUserId.trim()) {
      setSavedMessage('Please enter a Telegram User ID');
      setTimeout(() => setSavedMessage(''), 3000);
      return;
    }

    setLoading(true);
    try {
      const response = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ telegramUserId }),
      });

      const data = await response.json();
      if (data.success) {
        setSavedMessage('Telegram ID saved successfully');
        if (data.data.user) {
          useAuthStore.getState().setUser(data.data.user);
        }
        setTimeout(() => setSavedMessage(''), 3000);
      } else {
        setSavedMessage('Failed to save Telegram ID');
        setTimeout(() => setSavedMessage(''), 3000);
      }
    } catch (error) {
      console.error('Failed to save Telegram ID:', error);
      setSavedMessage('Error saving Telegram ID');
      setTimeout(() => setSavedMessage(''), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border border-border rounded-lg bg-muted/20">
      <p className="text-sm text-muted-foreground mb-3">
        Link your Telegram account to enable the Telegram bot. Your Telegram messages will be connected to this app account.
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            Telegram User ID
          </label>
          <input
            type="text"
            value={telegramUserId}
            onChange={(e) => setTelegramUserId(e.target.value)}
            placeholder="Your Telegram User ID (send /start to @userinfobot to find it)"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground mt-1">
            To find your ID: message <code className="bg-muted px-1 rounded">@userinfobot</code> on Telegram and it will reply with your user ID. Alternatively, the bot will tell you your ID when you first message it.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-wait text-sm font-medium"
        >
          {loading ? 'Saving...' : 'Save Telegram ID'}
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
