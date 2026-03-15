import React from 'react';
import { useAuthStore } from '../../store';
import { apiFetch } from '../../lib/api';

interface WhatsAppSettingsProps {
  onUpdate?: () => void;
}

export function WhatsAppSettings({ onUpdate: _onUpdate }: WhatsAppSettingsProps) {
  const [whatsappUserId, setWhatsappUserId] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [savedMessage, setSavedMessage] = React.useState('');
  const { user } = useAuthStore();

  React.useEffect(() => {
    if ((user as any)?.whatsappUserId) {
      setWhatsappUserId((user as any).whatsappUserId);
    }
  }, [(user as any)?.whatsappUserId]);

  const handleSave = async () => {
    if (!whatsappUserId.trim()) {
      setSavedMessage('Please enter a WhatsApp phone number');
      setTimeout(() => setSavedMessage(''), 3000);
      return;
    }

    setLoading(true);
    try {
      const response = await apiFetch('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({ whatsappUserId }),
      });

      const data = await response.json();
      if (data.success) {
        setSavedMessage('WhatsApp number saved successfully');
        if (data.data.user) {
          useAuthStore.getState().setUser(data.data.user);
        }
        setTimeout(() => setSavedMessage(''), 3000);
      } else {
        setSavedMessage('Failed to save WhatsApp number');
        setTimeout(() => setSavedMessage(''), 3000);
      }
    } catch (error) {
      console.error('Failed to save WhatsApp number:', error);
      setSavedMessage('Error saving WhatsApp number');
      setTimeout(() => setSavedMessage(''), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 border border-border rounded-lg bg-muted/20">
      <p className="text-sm text-muted-foreground mb-3">
        Link your WhatsApp account to enable the WhatsApp bot. Messages sent to the bot will be connected to this app account.
      </p>
      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-1">
            WhatsApp Phone Number
          </label>
          <input
            type="text"
            value={whatsappUserId}
            onChange={(e) => setWhatsappUserId(e.target.value)}
            placeholder="e.g. 15551234567 (digits only, with country code)"
            className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Enter your phone number in international format without the + sign (e.g. <code className="bg-muted px-1 rounded">15551234567</code>). The bot will tell you your number when you first message it.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-wait text-sm font-medium"
        >
          {loading ? 'Saving...' : 'Save WhatsApp Number'}
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
