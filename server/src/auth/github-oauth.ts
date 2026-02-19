import { URL } from 'url';

export interface GitHubOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GitHubTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
}

// GitHub OAuth scopes for repository access
const GITHUB_OAUTH_SCOPES = [
  'repo',  // Full repository access
  'read:user', // Read user profile
];

export class GitHubOAuthHandler {
  private config: GitHubOAuthConfig;
  private stateTokens: Map<string, { expiresAt: number; redirectTo?: string }> = new Map();

  constructor(config: GitHubOAuthConfig) {
    this.config = config;
    // Clean up expired state tokens every minute
    setInterval(() => this.cleanupExpiredStates(), 60000);
  }

  private cleanupExpiredStates() {
    const now = Date.now();
    for (const [key, value] of this.stateTokens.entries()) {
      if (value.expiresAt < now) {
        this.stateTokens.delete(key);
      }
    }
  }

  /**
   * Generate authorization URL for OAuth flow
   */
  getAuthorizationUrl(state: string, redirectTo?: string): string {
    // Store state token with expiry (15 minutes)
    this.stateTokens.set(state, {
      expiresAt: Date.now() + 15 * 60 * 1000,
      redirectTo,
    });

    const params = new URL('https://github.com/login/oauth/authorize');
    params.searchParams.set('client_id', this.config.clientId);
    params.searchParams.set('redirect_uri', this.config.redirectUri);
    params.searchParams.set('scope', GITHUB_OAUTH_SCOPES.join(' '));
    params.searchParams.set('state', state);
    params.searchParams.set('allow_signup', 'true');

    return params.toString();
  }

  /**
   * Verify state token
   */
  verifyState(state: string): { valid: boolean; redirectTo?: string } {
    const storedState = this.stateTokens.get(state);

    if (!storedState) {
      return { valid: false };
    }

    if (storedState.expiresAt < Date.now()) {
      this.stateTokens.delete(state);
      return { valid: false };
    }

    this.stateTokens.delete(state);
    return { valid: true, redirectTo: storedState.redirectTo };
  }

  /**
   * Exchange authorization code for tokens
   */
  async exchangeCodeForTokens(code: string): Promise<GitHubTokenResponse> {
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        redirect_uri: this.config.redirectUri,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[GitHubOAuth] Token exchange failed:', error);
      throw new Error(`Failed to exchange code for tokens: ${response.statusText}`);
    }

    return response.json() as Promise<GitHubTokenResponse>;
  }

  /**
   * Revoke access token
   */
  async revokeToken(token: string): Promise<void> {
    const response = await fetch('https://api.github.com/applications/' + this.config.clientId + '/token', {
      method: 'DELETE',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Basic ${Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')}`,
      },
      body: JSON.stringify({ access_token: token }),
    });

    if (!response.ok) {
      console.error('[GitHubOAuth] Token revocation failed:', response.statusText);
      // Don't throw - revocation is not critical
    }
  }
}
