import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useAuthStore } from '../store/auth';

export function LoginVerifyPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, setUser, setSession } = useAuthStore();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const token = searchParams.get('token');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setErrorMessage('Missing token');
      return;
    }

    // If already authenticated, redirect to home
    if (user) {
      navigate('/');
      return;
    }

    const verifyToken = async () => {
      try {
        const response = await fetch(`/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`, {
          method: 'GET',
          credentials: 'include',
        });
        
        const data = await response.json();
        
        if (data.success) {
          setUser(data.data.user);
          setSession(data.data.session);
          setStatus('success');
          
          // Redirect to home after a brief moment
          setTimeout(() => {
            navigate('/');
          }, 1500);
        } else {
          setStatus('error');
          setErrorMessage(data.error?.message || 'Failed to verify token');
        }
      } catch (err) {
        setStatus('error');
        setErrorMessage('Failed to verify token');
      }
    };

    verifyToken();
  }, [token, navigate, setUser, setSession, user]);

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md">
          <div className="bg-card border border-border rounded-lg p-6">
            <div className="text-center">
              <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Successfully signed in!</h2>
              <p className="text-muted-foreground">
                Redirecting you to the app...
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">assist1</h1>
            <p className="text-muted-foreground">
              Your own assistant
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <div className="text-center">
              <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
              <h2 className="text-xl font-semibold mb-2">Sign in failed</h2>
              <p className="text-muted-foreground mb-4">
                {errorMessage || 'The magic link is invalid or has expired.'}
              </p>
              <a 
                href="/login" 
                className="inline-block py-2 px-4 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
              >
                Back to sign in
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">a1</h1>
          <p className="text-muted-foreground">
            Your own assistant
          </p>
        </div>

        <div className="bg-card border border-border rounded-lg p-6">
          <div className="text-center">
            <Loader2 className="w-16 h-16 text-primary mx-auto mb-4 animate-spin" />
            <h2 className="text-xl font-semibold mb-2">Verifying...</h2>
            <p className="text-muted-foreground">
              Please wait while we sign you in.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
