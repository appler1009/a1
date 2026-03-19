export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="mb-10">
          <a href="/login" className="text-sm text-primary hover:underline">
            ← Back
          </a>
        </div>

        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-muted-foreground text-sm mb-10">Last updated: March 2026</p>

        <div className="space-y-8 text-sm leading-relaxed">
          <section>
            <h2 className="text-lg font-semibold mb-2">Who we are</h2>
            <p className="text-muted-foreground">
              assist1 is a personal AI workspace operated by Genoworks. If you have any
              questions about this policy or your data, contact us at{' '}
              <a href="mailto:info@assist1.me" className="text-primary hover:underline">
                info@assist1.me
              </a>
              .
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">What data we collect</h2>
            <p className="text-muted-foreground mb-3">We collect only what's necessary to run the service:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li><strong className="text-foreground">Email address</strong> — to identify your account and send login links</li>
              <li><strong className="text-foreground">Session cookie</strong> — a single <code>session_id</code> cookie to keep you logged in</li>
              <li><strong className="text-foreground">Conversation content</strong> — messages and AI responses you create while using the service</li>
              <li><strong className="text-foreground">API keys (optional)</strong> — if you provide your own AI service keys (BYOK), they are stored encrypted</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Why we collect it</h2>
            <p className="text-muted-foreground mb-3">Your data is used solely to provide the service:</p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Authentication and account management</li>
              <li>Storing your conversations and agent configurations</li>
              <li>Running scheduled jobs you set up</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              We do not use your data for advertising, profiling, or any purpose other than operating the service.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Cookies</h2>
            <p className="text-muted-foreground">
              We use one cookie: <code>session_id</code>. It is strictly necessary for login and
              contains no personal information. It is not used for tracking or analytics.
              Because it is essential to the service, it does not require your consent under GDPR.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Third parties</h2>
            <p className="text-muted-foreground">
              Your conversation content may be sent to AI providers (such as Anthropic or xAI)
              to generate responses. This happens only when you actively use the chat feature.
              We do not share your data with any other third parties.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">How long we keep your data</h2>
            <p className="text-muted-foreground">
              Your data is kept for as long as your account is active. If you delete your account,
              your data is removed from our systems within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Your rights</h2>
            <p className="text-muted-foreground mb-3">
              Under GDPR, you have the right to:
            </p>
            <ul className="list-disc list-inside space-y-1 text-muted-foreground">
              <li>Access the personal data we hold about you</li>
              <li>Correct inaccurate data</li>
              <li>Request deletion of your data ("right to be forgotten")</li>
              <li>Export your data in a portable format</li>
            </ul>
            <p className="text-muted-foreground mt-3">
              To exercise any of these rights, email us at{' '}
              <a href="mailto:info@assist1.me" className="text-primary hover:underline">
                info@assist1.me
              </a>
              . We will respond within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Changes to this policy</h2>
            <p className="text-muted-foreground">
              If we make significant changes to this policy, we will notify you by email before
              they take effect.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
