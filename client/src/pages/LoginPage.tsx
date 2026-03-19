import { useState, useRef } from 'react';
import { Mail, LogIn, ChevronDown, Bot, Zap, Layers, Key, Brain } from 'lucide-react';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const introRef = useRef<HTMLDivElement>(null);

  const scrollToIntro = () => {
    introRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleMagicLink = async () => {
    if (!email) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/magic-link/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email }),
      });

      const data = await response.json();

      if (data.success) {
        setMagicLinkSent(true);
      } else {
        setError(data.error?.message || 'Failed to send magic link');
      }
    } catch (err) {
      setError('Failed to send magic link');
    } finally {
      setLoading(false);
    }
  };

  if (magicLinkSent) {
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
              <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
                <Mail className="w-8 h-8 text-primary" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Check your email</h2>
              <p className="text-muted-foreground mb-4">
                We sent a login link to <strong>{email}</strong>
              </p>
              <p className="text-sm text-muted-foreground">
                Click the link in the email to sign in.<br />
                The link expires in 5 minutes.
              </p>
            </div>

            <div className="mt-6 pt-6 border-t border-border">
              <p className="text-sm text-muted-foreground text-center">
                Didn't receive the email?{' '}
                <button
                  onClick={() => setMagicLinkSent(false)}
                  className="text-primary hover:underline"
                >
                  Try again
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-background">
      {/* Login section — full viewport height */}
      <div className="h-screen flex flex-col items-center justify-center p-4 relative">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">assist1</h1>
            <p className="text-muted-foreground">
              Your own assistant
            </p>
          </div>

          <div className="bg-card border border-border rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">Sign in</h2>

            <div className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-medium mb-2">
                  Email address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && email && !loading) {
                        handleMagicLink();
                      }
                    }}
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-2 bg-muted rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    required
                  />
                </div>
              </div>

              {error && (
                <div className="p-3 bg-destructive/10 text-destructive rounded-lg text-sm">
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={handleMagicLink}
                disabled={!email || loading}
                className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? (
                  'Sending...'
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Send login link
                  </>
                )}
              </button>
            </div>

            <div className="mt-6 pt-6 border-t border-border space-y-3">
              <p className="text-sm text-muted-foreground text-center">
                Have an invitation code?{' '}
                <a href="/join" className="text-primary hover:underline">
                  Join a group
                </a>
              </p>
              <p className="text-xs text-muted-foreground/70 text-center">
                By signing in, you agree that we store your email to manage your account.
                We use a session cookie to keep you logged in — no tracking, no third parties.{' '}
                <a href="/privacy" className="hover:underline">Privacy Policy</a>.
              </p>
            </div>
          </div>
        </div>

        {/* Scroll-to-intro chevron */}
        <button
          onClick={scrollToIntro}
          aria-label="Learn more"
          className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 text-muted-foreground hover:text-foreground transition-colors group"
        >
          <span className="text-xs tracking-wide">Learn more</span>
          <ChevronDown className="w-6 h-6 animate-bounce group-hover:text-primary" />
        </button>
      </div>

      {/* Introduction section */}
      <div ref={introRef} className="bg-muted/30 border-t border-border">
        {/* Hero intro */}
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h2 className="text-4xl font-bold mb-4">Your personal AI workspace</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            assist1 brings together powerful AI agents, tool integrations, and a customizable assistant experience.
          </p>
        </div>

        {/* Feature highlights */}
        <div className="max-w-4xl mx-auto px-6 pb-20">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-20">
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Bot className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Configurable AI agents</h3>
              <p className="text-muted-foreground text-sm">
                Define agents with custom roles. Switch between them instantly to match your current task.
              </p>
            </div>

            <div className="bg-card border border-border rounded-xl p-6">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Layers className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">External feature integrations</h3>
              <p className="text-muted-foreground text-sm">
                Connect your agents to external tools and services — from web search to email, calendar, and beyond.
              </p>
            </div>

            <div className="bg-card border border-border rounded-xl p-6">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Zap className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Scheduled jobs</h3>
              <p className="text-muted-foreground text-sm">
                Ask your agents to run on a schedule and deliver results directly to chat. Automate recurring research, summaries, or any repeatable task.
              </p>
            </div>

            <div className="bg-card border border-border rounded-xl p-6">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Key className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Bring your own key</h3>
              <p className="text-muted-foreground text-sm">
                Use your own AI service API key for full control over costs and usage. Claude and Grok are supported. Your keys, your data.
              </p>
            </div>

            <div className="bg-card border border-border rounded-xl p-6">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Brain className="w-5 h-5 text-primary" />
              </div>
              <h3 className="font-semibold text-lg mb-2">Persistent memory</h3>
              <p className="text-muted-foreground text-sm">
                Agents remember what matters. Key facts are extracted automatically from your conversations, and you can manually add, edit, or remove memories at any time.
              </p>
            </div>
          </div>

          {/* Screenshot placeholders */}
          <div className="space-y-16">
            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-2xl font-semibold mb-2">Chat with your agents</h3>
                <p className="text-muted-foreground">
                  A clean, distraction-free interface for focused conversations with your AI assistants.
                </p>
              </div>
              <img
                src="/screenshots/chat.png"
                alt="Chat with your agents"
                className="w-full rounded-xl border border-border shadow-md"
              />
            </div>

            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-2xl font-semibold mb-2">Manage external features</h3>
                <p className="text-muted-foreground">
                  Browse and connect external features to extend your agents with new capabilities.
                </p>
              </div>
              <img
                src="/screenshots/mcp.png"
                alt="Manage external features"
                className="w-full rounded-xl border border-border shadow-md"
              />
            </div>

            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-2xl font-semibold mb-2">Automate with scheduled jobs</h3>
                <p className="text-muted-foreground">
                  Set up recurring tasks and wake up to fresh insights delivered to your conversations.
                </p>
              </div>
              <img
                src="/screenshots/scheduled.png"
                alt="Automate with scheduled jobs"
                className="w-full rounded-xl border border-border shadow-md"
              />
            </div>

            <div className="space-y-4">
              <div className="text-center">
                <h3 className="text-2xl font-semibold mb-2">Memory that grows with you</h3>
                <p className="text-muted-foreground">
                  Facts are extracted automatically as you chat — and you can highlight any memory to edit or remove it as you wish.
                </p>
              </div>
              <img
                src="/screenshots/memory.png"
                alt="Memory that grows with you"
                className="w-full rounded-xl border border-border shadow-md"
              />
            </div>
          </div>
        </div>

        {/* Footer CTA */}
        <div className="border-t border-border text-center px-6 py-12 space-y-3">
          <p className="text-muted-foreground text-sm">
            Ready to get started?{' '}
            <button
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              className="text-primary hover:underline"
            >
              Sign in above
            </button>
          </p>
          <p className="text-muted-foreground/60 text-xs flex items-center justify-center gap-3">
            <span>© 2026 Genoworks</span>
            <span>·</span>
            <a
              href="https://github.com/appler1009/a1"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-muted-foreground transition-colors"
            >
              GitHub
            </a>
            <span>·</span>
            <a href="/privacy" className="hover:text-muted-foreground transition-colors">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
