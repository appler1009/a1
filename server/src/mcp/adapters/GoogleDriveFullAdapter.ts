import path from 'path';
import { promises as fs } from 'fs';
import { BaseStdioAdapter } from './BaseStdioAdapter.js';

export interface GoogleToken {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
  credentialsPath?: string;
}

/**
 * Google Drive MCP Adapter
 * Handles token file creation in a temporary/working directory
 * and passes the path via environment variable to the MCP server
 */
export class GoogleDriveFullAdapter extends BaseStdioAdapter {
  constructor(
    id: string,
    userId: string,
    serverKey: string,
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    private tokenData: GoogleToken
  ) {
    super(id, userId, serverKey, command, args, cwd, env);
  }

  protected override async prepare(): Promise<void> {
    // Create token file in a working directory (not in ~/.config)
    // The path is passed to the MCP server via environment variable
    const tokenPath = path.join(this.cwd, 'tokens.json');

    console.log(`[GoogleDriveFullAdapter:prepare] Starting token setup`);
    console.log(`[GoogleDriveFullAdapter:prepare] User ID: ${this.userId}`);
    console.log(`[GoogleDriveFullAdapter:prepare] Server Key: ${this.serverKey}`);
    console.log(`[GoogleDriveFullAdapter:prepare] CWD: ${this.cwd}`);
    console.log(`[GoogleDriveFullAdapter:prepare] Token path: ${tokenPath}`);

    // Validate token data exists
    if (!this.tokenData) {
      console.error(`[GoogleDriveFullAdapter:prepare] ERROR: No token data provided!`);
      throw new Error('Token data is required for Google Drive MCP adapter');
    }

    if (!this.tokenData.access_token) {
      console.error(`[GoogleDriveFullAdapter:prepare] ERROR: No access_token in token data!`);
      throw new Error('access_token is required in token data');
    }

    // Log token data structure (without exposing sensitive tokens)
    console.log(`[GoogleDriveFullAdapter:prepare] Token data validation:`, {
      has_access_token: !!this.tokenData.access_token,
      access_token_length: this.tokenData.access_token?.length,
      access_token_prefix: this.tokenData.access_token?.substring(0, 10) + '...',
      has_refresh_token: !!this.tokenData.refresh_token,
      refresh_token_length: this.tokenData.refresh_token?.length,
      expiry_date: this.tokenData.expiry_date,
      token_type: this.tokenData.token_type,
      credentialsPath: this.tokenData.credentialsPath,
    });

    // Format token for google-drive-mcp
    const formattedToken = {
      access_token: this.tokenData.access_token,
      refresh_token: this.tokenData.refresh_token,
      scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents https://www.googleapis.com/auth/spreadsheets',
      token_type: this.tokenData.token_type || 'Bearer',
      expiry_date: this.tokenData.expiry_date,
    };

    console.log(`[GoogleDriveFullAdapter:prepare] Formatted token structure:`, {
      keys: Object.keys(formattedToken),
      access_token_present: !!formattedToken.access_token,
      refresh_token_present: !!formattedToken.refresh_token,
      scope: formattedToken.scope,
      token_type: formattedToken.token_type,
    });

    // Create parent directory if needed
    const dir = path.dirname(tokenPath);
    await fs.mkdir(dir, { recursive: true });
    console.log(`[GoogleDriveFullAdapter:prepare] Created directory: ${dir}`);

    // Write token file with restricted permissions
    const tokenJson = JSON.stringify(formattedToken, null, 2);
    await fs.writeFile(tokenPath, tokenJson, { mode: 0o600 });
    console.log(`[GoogleDriveFullAdapter:prepare] Token file written successfully`);
    console.log(`[GoogleDriveFullAdapter:prepare] Token file size: ${tokenJson.length} bytes`);

    // Verify file was written
    try {
      const stats = await fs.stat(tokenPath);
      console.log(`[GoogleDriveFullAdapter:prepare] Token file verification:`, {
        path: tokenPath,
        size: stats.size,
        mode: '0o' + stats.mode.toString(8),
        exists: true,
      });
    } catch (error) {
      console.error(`[GoogleDriveFullAdapter:prepare] ERROR: Failed to verify token file:`, error);
      throw error;
    }

    // Pass token path to the MCP server via environment variable
    // The google-drive-mcp server will read GOOGLE_DRIVE_MCP_TOKEN_PATH
    this.env.GOOGLE_DRIVE_MCP_TOKEN_PATH = tokenPath;
    console.log(`[GoogleDriveFullAdapter:prepare] Environment variable set: GOOGLE_DRIVE_MCP_TOKEN_PATH=${tokenPath}`);

    // Pass credentials path to the MCP server via environment variable
    // The google-drive-mcp server will read GOOGLE_DRIVE_OAUTH_CREDENTIALS
    if (this.tokenData.credentialsPath) {
      this.env.GOOGLE_DRIVE_OAUTH_CREDENTIALS = this.tokenData.credentialsPath;
      console.log(`[GoogleDriveFullAdapter:prepare] Environment variable set: GOOGLE_DRIVE_OAUTH_CREDENTIALS=${this.tokenData.credentialsPath}`);
    }

    // Verify environment variables are set
    console.log(`[GoogleDriveFullAdapter:prepare] Env var verification:`, {
      'GOOGLE_DRIVE_MCP_TOKEN_PATH': this.env.GOOGLE_DRIVE_MCP_TOKEN_PATH,
      'GOOGLE_DRIVE_OAUTH_CREDENTIALS': this.env.GOOGLE_DRIVE_OAUTH_CREDENTIALS,
      'matches_tokenPath': this.env.GOOGLE_DRIVE_MCP_TOKEN_PATH === tokenPath,
    });

    console.log(`[GoogleDriveFullAdapter:prepare] ✅ Token setup complete`);
  }
}
