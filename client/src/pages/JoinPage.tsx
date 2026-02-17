import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Users } from 'lucide-react';
import { useAuthStore } from '../store';

export function JoinPage() {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { setUser, setSession, setCurrentGroup } = useAuthStore();

  const handleJoin = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/auth/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, name: name || undefined, inviteCode }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setUser(data.data.user);
        setSession(data.data.session);
        setCurrentGroup(data.data.group);
        navigate('/');
      } else {
        setError(data.error?.message || 'Failed to join group');
      }
    } catch (err) {
      setError('Failed to join group');
    } finally {
      setLoading(false);
    }
  };

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
          <button
            onClick={() => navigate('/login')}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to login
          </button>

          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              <Users className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-semibold">Join a group</h2>
              <p className="text-sm text-muted-foreground">
                Enter your invitation code to join
              </p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label htmlFor="email" className="block text-sm font-medium mb-2">
                Your email address
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2 bg-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                required
              />
            </div>

            <div>
              <label htmlFor="name" className="block text-sm font-medium mb-2">
                Your name (optional)
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-4 py-2 bg-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            <div className="pt-2 border-t border-border">
              <label htmlFor="inviteCode" className="block text-sm font-medium mb-2">
                Invitation code
              </label>
              <input
                id="inviteCode"
                type="text"
                value={inviteCode}
                onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                placeholder="XXXXXXXX"
                className="w-full px-4 py-2 bg-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono text-center text-lg tracking-wider"
                maxLength={8}
                required
              />
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleJoin}
            disabled={!email || !inviteCode || loading}
            className="mt-4 w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Joining group...' : 'Join group'}
          </button>
        </div>
      </div>
    </div>
  );
}