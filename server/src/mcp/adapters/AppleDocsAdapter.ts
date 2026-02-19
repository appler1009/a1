import path from 'path';
import { promises as fs } from 'fs';
import { BaseStdioAdapter } from './BaseStdioAdapter.js';

export interface AppleToken {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
}

/**
 * Apple Docs MCP Adapter
 * Handles token file creation and environment setup for apple-docs-mcp
 */
export class AppleDocsAdapter extends BaseStdioAdapter {
  constructor(
    id: string,
    userId: string,
    serverKey: string,
    command: string,
    args: string[],
    cwd: string,
    env: Record<string, string>,
    private tokenData?: AppleToken
  ) {
    super(id, userId, serverKey, command, args, cwd, env);
  }

  protected override async prepare(): Promise<void> {
    // Apple Docs doesn't require token file like google-drive-mcp
    // But we can store token in a known location if needed
    if (this.tokenData) {
      const tokenPath = path.join(this.cwd, 'apple_token.json');

      const formattedToken = {
        access_token: this.tokenData.access_token,
        refresh_token: this.tokenData.refresh_token,
        token_type: this.tokenData.token_type || 'Bearer',
        expiry_date: this.tokenData.expiry_date,
      };

      const dir = path.dirname(tokenPath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(tokenPath, JSON.stringify(formattedToken, null, 2), { mode: 0o600 });

      console.log(`[AppleDocsAdapter] Created token file: ${tokenPath}`);

      // Pass token path to the MCP server
      this.env.APPLE_DOCS_TOKEN_PATH = tokenPath;
    }

    // Set any Apple-specific env vars
    if (!this.env.APPLE_DOCS_WORKSPACE) {
      this.env.APPLE_DOCS_WORKSPACE = this.cwd;
    }
  }
}
