import { URL } from 'url';

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

// Google OAuth scopes for Drive and Gmail access
// Note: Drive scope grants access to all Google Workspace files (Docs, Sheets, etc.)
// Gmail scope grants full read/write access to Gmail (needed for sending, drafts, labels, etc.)
// OpenID scopes provide user profile information (email, name, etc.)
const GOOGLE_OAUTH_SCOPES = [
  'openid',                                         // OpenID Connect: request ID token with user info
  'profile',                                        // Get user profile (name, picture, etc.)
  'email',                                          // Get user email address
  'https://www.googleapis.com/auth/drive',           // Full Drive access (includes Docs, Sheets, etc.)
  'https://www.googleapis.com/auth/gmail.modify',   // Full read/write access to Gmail
];

export class GoogleOAuthHandler {
  private config: GoogleOAuthConfig;
  private stateTokens: Map<string, { expiresAt: number; redirectTo?: string }> = new Map();

  constructor(config: GoogleOAuthConfig) {
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

    const params = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    params.searchParams.set('client_id', this.config.clientId);
    params.searchParams.set('redirect_uri', this.config.redirectUri);
    params.searchParams.set('response_type', 'code');
    params.searchParams.set('scope', GOOGLE_OAUTH_SCOPES.join(' ')); // Space-separated list of scopes
    params.searchParams.set('access_type', 'offline'); // Request offline access to get refresh token
    params.searchParams.set('prompt', 'consent'); // Force consent screen to ensure refresh token is returned
    params.searchParams.set('state', state);

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
  async exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.config.redirectUri,
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[GoogleOAuth] Token exchange failed:', error);
      throw new Error(`Failed to exchange code for tokens: ${response.statusText}`);
    }

    return response.json() as Promise<GoogleTokenResponse>;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<GoogleTokenResponse> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('[GoogleOAuth] Token refresh failed:', error);
      throw new Error(`Failed to refresh access token: ${response.statusText}`);
    }

    return response.json() as Promise<GoogleTokenResponse>;
  }

  /**
   * Revoke access token
   */
  async revokeToken(token: string): Promise<void> {
    const response = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ token }).toString(),
    });

    if (!response.ok) {
      console.error('[GoogleOAuth] Token revocation failed:', response.statusText);
      // Don't throw - revocation is not critical
    }
  }
}
