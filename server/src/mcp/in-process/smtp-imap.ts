/**
 * SMTP/IMAP In-Process MCP Module
 *
 * Wraps smtp-imap-mcp-lib for direct in-process email access via standard
 * SMTP/IMAP protocols.  Credentials are injected at construction time
 * (already decrypted by the adapter factory) so the AI never sees passwords.
 *
 * Tools:
 *  SMTP: smtpSendEmail, smtpTestConnection
 *  IMAP: imapTestConnection, imapListFolders, imapListMessages, imapGetMessage, imapSearchMessages
 */

import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import {
  CredentialResolver,
  smtpSendEmail,
  smtpTestConnection,
  imapTestConnection,
  imapListFolders,
  imapListMessages,
  imapGetMessage,
  imapSearchMessages,
  type ServerConfig,
} from 'smtp-imap-mcp-lib';

export interface SmtpImapCredentials {
  /** SMTP server configuration */
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  /** IMAP server configuration */
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  /** Shared credentials */
  username: string;
  password: string;
}

export class SmtpImapInProcess implements InProcessMCPModule {
  [key: string]: unknown;

  private readonly resolver: CredentialResolver;
  private readonly username: string;

  constructor(creds: SmtpImapCredentials) {
    this.username = creds.username;

    const smtpConfig: ServerConfig = {
      host: creds.smtpHost,
      port: creds.smtpPort,
      secure: creds.smtpSecure,
      username: creds.username,
      password: creds.password,
    };

    const imapConfig: ServerConfig = {
      host: creds.imapHost,
      port: creds.imapPort,
      secure: creds.imapSecure,
      username: creds.username,
      password: creds.password,
    };

    this.resolver = new CredentialResolver({
      config: { smtp: smtpConfig, imap: imapConfig },
    });

    console.log(`[SmtpImapInProcess] Initialized for ${creds.username}`);
  }

  getSystemPromptSummary(): string {
    return `SMTP/IMAP email — send and receive email via standard protocols (account: ${this.username}).`;
  }

  getSystemPrompt(): string {
    return `## SMTP/IMAP EMAIL
You have access to a standard email account (${this.username}) via SMTP and IMAP.
- Use imapSearchMessages or imapListMessages to read emails.
- Use smtpSendEmail to send messages.
- Always confirm with the user before sending emails.
- When listing messages, show subject, sender, and date — not raw IDs.`;
  }

  async getTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: 'smtpSendEmail',
        description: 'Send an email via SMTP.',
        inputSchema: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Sender email address' },
            to: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description: 'Recipient email address(es)',
            },
            cc: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description: 'CC recipients',
            },
            bcc: {
              oneOf: [
                { type: 'string' },
                { type: 'array', items: { type: 'string' } },
              ],
              description: 'BCC recipients',
            },
            subject: { type: 'string', description: 'Email subject' },
            text: { type: 'string', description: 'Plain-text body' },
            html: { type: 'string', description: 'HTML body (use instead of text for formatted email)' },
            replyTo: { type: 'string', description: 'Reply-To address' },
          },
          required: ['from', 'to', 'subject'],
        },
      },
      {
        name: 'smtpTestConnection',
        description: 'Test the SMTP server connection and authentication.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'imapTestConnection',
        description: 'Test the IMAP server connection and authentication.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'imapListFolders',
        description: 'List all mailbox folders/labels available on the IMAP server.',
        inputSchema: { type: 'object', properties: {} },
      },
      {
        name: 'imapListMessages',
        description: 'List recent messages from an IMAP mailbox folder.',
        inputSchema: {
          type: 'object',
          properties: {
            mailbox: { type: 'string', description: 'Folder name (default: INBOX)' },
            limit: { type: 'number', description: 'Max messages to return (default: 20)' },
          },
        },
      },
      {
        name: 'imapGetMessage',
        description: 'Get the full content of a specific email by its IMAP UID.',
        inputSchema: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: 'Message UID from imapListMessages or imapSearchMessages' },
            mailbox: { type: 'string', description: 'Folder containing the message (default: INBOX)' },
          },
          required: ['uid'],
        },
      },
      {
        name: 'imapSearchMessages',
        description: 'Search for messages in an IMAP folder by subject, sender, date range, or read status.',
        inputSchema: {
          type: 'object',
          properties: {
            mailbox: { type: 'string', description: 'Folder to search (default: INBOX)' },
            subject: { type: 'string', description: 'Filter by subject text' },
            from: { type: 'string', description: 'Filter by sender address' },
            to: { type: 'string', description: 'Filter by recipient address' },
            body: { type: 'string', description: 'Filter by body text' },
            since: { type: 'string', description: 'Return messages after this date (YYYY-MM-DD)' },
            before: { type: 'string', description: 'Return messages before this date (YYYY-MM-DD)' },
            unseen: { type: 'boolean', description: 'Only unread messages' },
            seen: { type: 'boolean', description: 'Only read messages' },
            limit: { type: 'number', description: 'Max results (default: 20)' },
          },
        },
      },
    ];
  }

  async smtpSendEmail(args: any): Promise<unknown> {
    console.log('[SmtpImapInProcess:smtpSendEmail] Sending to', args.to);
    return smtpSendEmail(this.resolver, { ...args, configId: 'smtp' });
  }

  async smtpTestConnection(_args: any): Promise<unknown> {
    console.log('[SmtpImapInProcess:smtpTestConnection] Testing SMTP');
    return smtpTestConnection(this.resolver, { configId: 'smtp' });
  }

  async imapTestConnection(_args: any): Promise<unknown> {
    console.log('[SmtpImapInProcess:imapTestConnection] Testing IMAP');
    return imapTestConnection(this.resolver, { configId: 'imap' });
  }

  async imapListFolders(_args: any): Promise<unknown> {
    console.log('[SmtpImapInProcess:imapListFolders] Listing folders');
    return imapListFolders(this.resolver, { configId: 'imap' });
  }

  async imapListMessages(args: any): Promise<unknown> {
    console.log('[SmtpImapInProcess:imapListMessages] Listing messages', args);
    return imapListMessages(this.resolver, { configId: 'imap', ...args });
  }

  async imapGetMessage(args: any): Promise<unknown> {
    console.log('[SmtpImapInProcess:imapGetMessage] Getting message uid', args.uid);
    return imapGetMessage(this.resolver, { configId: 'imap', ...args });
  }

  async imapSearchMessages(args: any): Promise<unknown> {
    console.log('[SmtpImapInProcess:imapSearchMessages] Searching', args);
    return imapSearchMessages(this.resolver, { configId: 'imap', ...args });
  }
}
