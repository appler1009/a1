import { useEffect, useState } from 'react';

export function OAuthCallbackPage() {
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('Completing authentication...');

  useEffect(() => {
    const completeAuth = async () => {
      try {
        // Get query parameters
        const params = new URLSearchParams(window.location.search);
        const code = params.get('code');
        const state = params.get('state');
        const provider = params.get('provider') || 'google';
        const accountEmail = params.get('accountEmail');

        if (!code) {
          setStatus('error');
          setMessage('Authentication failed: No authorization code received');
          setTimeout(() => window.close(), 3000);
          return;
        }

        // Show success message
        setStatus('success');
        setMessage(`Successfully authenticated with ${provider}! Closing this window...`);

        // Notify parent window (if opened from popup)
        if (window.opener) {
          window.opener.postMessage(
            {
              type: 'oauth_success',
              provider,
              accountEmail,
              code,
              state,
            },
            window.location.origin
          );
        }

        // Close popup after 2 seconds
        setTimeout(() => {
          window.close();
        }, 2000);
      } catch (error) {
        setStatus('error');
        setMessage(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        setTimeout(() => window.close(), 3000);
      }
    };

    completeAuth();
  }, []);

  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="text-center p-8 max-w-md">
        <div className="mb-6">
          {status === 'loading' && (
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
          )}
          {status === 'success' && (
            <div className="text-4xl mb-4">✅</div>
          )}
          {status === 'error' && (
            <div className="text-4xl mb-4">❌</div>
          )}
        </div>

        <h1 className="text-2xl font-bold mb-4 text-foreground">
          {status === 'loading' && 'Authenticating...'}
          {status === 'success' && 'Authentication Successful!'}
          {status === 'error' && 'Authentication Failed'}
        </h1>

        <p className={`text-lg mb-6 ${
          status === 'error' ? 'text-red-500' : 'text-muted-foreground'
        }`}>
          {message}
        </p>

        {status === 'error' && (
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
          >
            Close Window
          </button>
        )}

        {status === 'success' && (
          <p className="text-sm text-muted-foreground animate-pulse">
            This window will close automatically...
          </p>
        )}
      </div>
    </div>
  );
}
