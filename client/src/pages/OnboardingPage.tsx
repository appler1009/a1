import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft, Users, User, Building2, Copy, Check } from 'lucide-react';
import { useAuthStore } from '../store';

type OnboardingStep = 'choose' | 'individual' | 'create-group' | 'join-group' | 'created-group';

export function OnboardingPage() {
  const [step, setStep] = useState<OnboardingStep>('choose');
  const [email, setEmail] = useState(() => {
    const location = useLocation();
    return (location.state as { email?: string })?.email || '';
  });
  const [name, setName] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupUrl, setGroupUrl] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdInviteCode, setCreatedInviteCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const { setUser, setSession, setCurrentGroup } = useAuthStore();

  const handleIndividualSignup = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/auth/signup/individual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, name: name || undefined }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setUser(data.data.user);
        setSession(data.data.session);
        navigate('/');
      } else {
        setError(data.error?.message || 'Signup failed');
      }
    } catch (err) {
      setError('Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateGroup = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/auth/signup/group', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          email, 
          name: name || undefined,
          groupName,
          groupUrl: groupUrl || undefined 
        }),
      });
      
      const data = await response.json();
      
      if (data.success) {
        setUser(data.data.user);
        setSession(data.data.session);
        setCurrentGroup(data.data.group);
        setCreatedInviteCode(data.data.inviteCode);
        setStep('created-group');
      } else {
        setError(data.error?.message || 'Group creation failed');
      }
    } catch (err) {
      setError('Failed to create group');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinGroup = async () => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await fetch('/api/auth/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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

  const copyInviteCode = () => {
    if (createdInviteCode) {
      navigator.clipboard.writeText(createdInviteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const renderChooseStep = () => (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold mb-4">How will you use a1?</h2>
      
      <div className="grid gap-3">
        <button
          onClick={() => setStep('individual')}
          className="flex items-start gap-4 p-4 bg-muted hover:bg-muted/80 rounded-lg text-left transition-colors"
        >
          <User className="w-6 h-6 mt-0.5 text-primary" />
          <div>
            <div className="font-medium">Personal use</div>
            <div className="text-sm text-muted-foreground">
              Create an individual account for personal use
            </div>
          </div>
        </button>

        <button
          onClick={() => setStep('create-group')}
          className="flex items-start gap-4 p-4 bg-muted hover:bg-muted/80 rounded-lg text-left transition-colors"
        >
          <Building2 className="w-6 h-6 mt-0.5 text-primary" />
          <div>
            <div className="font-medium">Create a group</div>
            <div className="text-sm text-muted-foreground">
              Create a group account for your team or organization
            </div>
          </div>
        </button>

        <button
          onClick={() => setStep('join-group')}
          className="flex items-start gap-4 p-4 bg-muted hover:bg-muted/80 rounded-lg text-left transition-colors"
        >
          <Users className="w-6 h-6 mt-0.5 text-primary" />
          <div>
            <div className="font-medium">Join a group</div>
            <div className="text-sm text-muted-foreground">
              Join an existing group with an invitation code
            </div>
          </div>
        </button>
      </div>
    </div>
  );

  const renderIndividualForm = () => {
    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      handleIndividualSignup();
    };

    return (
      <div className="space-y-4">
        <button
          onClick={() => setStep('choose')}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <h2 className="text-xl font-semibold">Create your account</h2>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="email" className="block text-sm font-medium mb-2">
              Email address
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
              Name (optional)
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

          {error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!email || loading}
            className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating account...' : 'Create account'}
          </button>
        </form>
      </div>
    );
  };

  const renderCreateGroupForm = () => {
    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      handleCreateGroup();
    };

    return (
      <div className="space-y-4">
        <button
          onClick={() => setStep('choose')}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <h2 className="text-xl font-semibold">Create a group</h2>

        <form onSubmit={handleSubmit} className="space-y-3">
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
            <label htmlFor="groupName" className="block text-sm font-medium mb-2">
              Group name
            </label>
            <input
              id="groupName"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="My Team"
              className="w-full px-4 py-2 bg-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              required
            />
          </div>

          <div>
            <label htmlFor="groupUrl" className="block text-sm font-medium mb-2">
              Group URL (optional)
            </label>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">a1.io/</span>
              <input
                id="groupUrl"
                type="text"
                value={groupUrl}
                onChange={(e) => setGroupUrl(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="my-team"
                className="flex-1 px-4 py-2 bg-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!email || !groupName || loading}
            className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Creating group...' : 'Create group'}
          </button>
        </form>
      </div>
    );
  };

  const renderJoinGroupForm = () => {
    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      handleJoinGroup();
    };

    return (
      <div className="space-y-4">
        <button
          onClick={() => setStep('choose')}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        <h2 className="text-xl font-semibold">Join a group</h2>

        <form onSubmit={handleSubmit} className="space-y-3">
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
              className="w-full px-4 py-2 bg-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono"
              maxLength={8}
              required
            />
          </div>

          {error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!email || !inviteCode || loading}
            className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Joining group...' : 'Join group'}
          </button>
        </form>
      </div>
    );
  };

  const renderCreatedGroup = () => (
    <div className="space-y-4">
      <div className="text-center">
        <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check className="w-8 h-8 text-primary" />
        </div>
        <h2 className="text-xl font-semibold">Group created!</h2>
        <p className="text-muted-foreground mt-2">
          Share this invitation code with your team members
        </p>
      </div>

      <div className="bg-muted rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Invitation code</div>
            <div className="font-mono text-lg">{createdInviteCode}</div>
          </div>
          <button
            onClick={copyInviteCode}
            className="p-2 hover:bg-muted-foreground/10 rounded-lg transition-colors"
          >
            {copied ? (
              <Check className="w-5 h-5 text-primary" />
            ) : (
              <Copy className="w-5 h-5" />
            )}
          </button>
        </div>
      </div>

      <button
        onClick={() => navigate('/')}
        className="w-full py-2 px-4 bg-primary text-primary-foreground rounded-lg hover:opacity-90"
      >
        Continue to a1
      </button>
    </div>
  );

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
          {step === 'choose' && renderChooseStep()}
          {step === 'individual' && renderIndividualForm()}
          {step === 'create-group' && renderCreateGroupForm()}
          {step === 'join-group' && renderJoinGroupForm()}
          {step === 'created-group' && renderCreatedGroup()}
        </div>
      </div>
    </div>
  );
}