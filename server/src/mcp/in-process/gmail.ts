/**
 * Gmail In-Process MCP Module
 *
 * Uses gmail-mcp-lib for direct in-process Gmail API calls.
 * This provides lower latency compared to STDIO-based MCP servers.
 *
 * Tools provided:
 * - gmailListMessages - List messages from mailbox
 * - gmailGetMessage - Get a specific message by ID
 * - gmailSearchMessages - Search for messages using Gmail search syntax
 * - gmailSendMessage - Send an email message
 * - gmailCreateDraft - Create a draft email
 * - gmailModifyMessageLabels - Add/remove labels from messages
 * - gmailTrashMessage - Move message to trash
 * - gmailUntrashMessage - Restore message from trash
 * - gmailArchiveMessage - Archive a message
 * - gmailUnarchiveMessage - Unarchive a message
 * - gmailListLabels - List all available labels
 * - gmailListThreads - List conversation threads
 * - gmailGetThread - Get a specific thread by ID
 */

import type { MCPToolInfo } from '@local-agent/shared';
import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import {
  listMessages,
  getMessage,
  searchMessages,
  sendMessage,
  createDraft,
  modifyMessageLabels,
  trashMessage,
  untrashMessage,
  archiveMessage,
  unarchiveMessage,
  listLabels,
  listThreads,
  getThread,
  type Tokens,
} from 'gmail-mcp-lib';

/**
 * Token data passed from the adapter factory
 */
interface GmailTokenData {
  access_token: string;
  refresh_token?: string;
  expiry_date?: number;
  token_type?: string;
}

/**
 * Gmail In-Process MCP Module
 *
 * Provides tools for Gmail operations using the gmail-mcp-lib package.
 */
export class GmailInProcess implements InProcessMCPModule {
  private tokens: Tokens;
  private storageRoot: string;

  // Index signature for dynamic tool access
  [key: string]: unknown;

  constructor(tokenData: GmailTokenData, storageRoot?: string) {
    this.tokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date: tokenData.expiry_date,
      token_type: tokenData.token_type || 'Bearer',
    };
    // Get storageRoot from parameter, tokenData, env, or default
    this.storageRoot = storageRoot || (tokenData as any).storageRoot || process.env.STORAGE_ROOT || './data';

    console.log('[GmailInProcess] Initialized with token data and storage root:', this.storageRoot);
  }

  /**
   * Get available tools for Gmail operations
   */
  async getTools(): Promise<MCPToolInfo[]> {
    return [
      {
        name: 'gmailListMessages',
        description: 'List messages from the Gmail mailbox',
        inputSchema: {
          type: 'object',
          properties: {
            q: {
              type: 'string',
              description: 'Gmail search query (e.g., "from:user@example.com", "is:unread")',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of messages to return',
            },
            pageToken: {
              type: 'string',
              description: 'Page token for pagination',
            },
            includeSpamTrash: {
              type: 'boolean',
              description: 'Include spam and trash in results',
            },
            labelIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by label IDs',
            },
          },
        },
      },
      {
        name: 'gmailGetMessage',
        description: 'Get a specific message by ID',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: {
              type: 'string',
              description: 'The message ID',
            },
            format: {
              type: 'string',
              enum: ['full', 'minimal', 'raw', 'metadata'],
              description: 'Format of the message',
            },
          },
          required: ['messageId'],
        },
      },
      {
        name: 'gmailSearchMessages',
        description: 'Search for messages using Gmail search syntax. Use operators like: from:user@example.com, subject:text, after:YYYY-MM-DD, before:YYYY-MM-DD, newer_than:Nd (e.g. newer_than:1d for last 24h, newer_than:7d for last week), has:attachment, is:unread, is:starred, in:inbox. For "today" or "recent" emails use after:CURRENT_DATE or newer_than:1d. The current date is available in the system prompt. Examples: "from:support@example.com", "subject:invoice after:2026-02-20", "newer_than:1d", "has:attachment is:unread"',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Gmail search query using operators: from:, to:, subject:, after:YYYY-MM-DD, before:YYYY-MM-DD, newer_than:Nd (e.g. newer_than:1d = last 24h, newer_than:7d = last week), has:attachment, is:unread, is:starred, is:important, in:LABEL. Combine multiple terms with AND/OR. Use the current date from the system prompt for date-relative queries.',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of messages to return',
            },
            pageToken: {
              type: 'string',
              description: 'Page token for pagination',
            },
            includeSpamTrash: {
              type: 'boolean',
              description: 'Include spam and trash in results',
            },
            labelIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by label IDs',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'gmailSendMessage',
        description: 'Send an email message',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address(es), comma-separated',
            },
            subject: {
              type: 'string',
              description: 'Email subject',
            },
            body: {
              type: 'string',
              description: 'Email body',
            },
            html: {
              type: 'boolean',
              description: 'Is the body HTML formatted',
            },
            threadId: {
              type: 'string',
              description: 'Reply to a specific thread',
            },
            labelIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Labels to apply to the message',
            },
            inReplyTo: {
              type: 'string',
              description: 'Message ID this is replying to',
            },
          },
          required: ['to'],
        },
      },
      {
        name: 'gmailCreateDraft',
        description: 'Create a draft email',
        inputSchema: {
          type: 'object',
          properties: {
            to: {
              type: 'string',
              description: 'Recipient email address(es), comma-separated',
            },
            subject: {
              type: 'string',
              description: 'Email subject',
            },
            body: {
              type: 'string',
              description: 'Email body',
            },
            html: {
              type: 'boolean',
              description: 'Is the body HTML formatted',
            },
            threadId: {
              type: 'string',
              description: 'Thread to create draft in',
            },
          },
          required: ['to'],
        },
      },
      {
        name: 'gmailListLabels',
        description: 'List all available labels in Gmail',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
      {
        name: 'gmailModifyMessageLabels',
        description: 'Add or remove labels from a message',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: {
              type: 'string',
              description: 'The message ID',
            },
            addLabelIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Label IDs to add',
            },
            removeLabelIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Label IDs to remove',
            },
          },
          required: ['messageId'],
        },
      },
      {
        name: 'gmailTrashMessage',
        description: 'Move a message to trash',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: {
              type: 'string',
              description: 'The message ID',
            },
          },
          required: ['messageId'],
        },
      },
      {
        name: 'gmailUntrashMessage',
        description: 'Restore a message from trash',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: {
              type: 'string',
              description: 'The message ID',
            },
          },
          required: ['messageId'],
        },
      },
      {
        name: 'gmailArchiveMessage',
        description: 'Archive a message (remove from inbox but keep in account)',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: {
              type: 'string',
              description: 'The message ID',
            },
          },
          required: ['messageId'],
        },
      },
      {
        name: 'gmailUnarchiveMessage',
        description: 'Unarchive a message (restore to inbox)',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: {
              type: 'string',
              description: 'The message ID',
            },
          },
          required: ['messageId'],
        },
      },
      {
        name: 'gmailListThreads',
        description: 'List conversation threads',
        inputSchema: {
          type: 'object',
          properties: {
            q: {
              type: 'string',
              description: 'Gmail search query to filter threads',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of threads to return',
            },
            pageToken: {
              type: 'string',
              description: 'Page token for pagination',
            },
            includeSpamTrash: {
              type: 'boolean',
              description: 'Include spam and trash in results',
            },
            labelIds: {
              type: 'array',
              items: { type: 'string' },
              description: 'Filter by label IDs',
            },
          },
        },
      },
      {
        name: 'gmailGetThread',
        description: 'Get a specific thread by ID',
        inputSchema: {
          type: 'object',
          properties: {
            threadId: {
              type: 'string',
              description: 'The thread ID',
            },
            format: {
              type: 'string',
              enum: ['full', 'minimal', 'metadata'],
              description: 'Format of the thread',
            },
          },
          required: ['threadId'],
        },
      },
    ];
  }

  /**
   * List messages from the mailbox
   */
  async gmailListMessages(args: any): Promise<unknown> {
    try {
      console.log('[GmailInProcess:gmailListMessages] Listing messages', args);
      const result = await listMessages('me', args, this.tokens);
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailListMessages] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Convert Gmail API message format to EmailPreviewAdapter format
   */
  private parseGmailMessage(gmailMessage: any): Record<string, any> {
    const messageId = gmailMessage.id;

    const headers = gmailMessage.payload?.headers || [];
    const getHeader = (name: string) => headers.find((h: any) => h.name === name)?.value || '';

    const subject = getHeader('Subject') || '(no subject)';
    const from = getHeader('From') || '(no from)';
    const mimeType = gmailMessage.payload?.mimeType || 'unknown';

    // Extract body content with proper MIME type detection
    let bodyContent = '';
    let isHtml = false;

    const getBodyFromPart = (part: any, depth: number = 0): { content: string; isHtml: boolean } | null => {
      const mimeType = part.mimeType || 'unknown';

      // If this part has body data, return it with MIME type
      if (part.body?.data) {
        try {
          const content = Buffer.from(part.body.data, 'base64').toString('utf-8');
          const partIsHtml = part.mimeType?.includes('text/html') || false;

          return { content, isHtml: partIsHtml };
        } catch (err) {
          return null;
        }
      }

      // For multipart/alternative, prefer HTML over plain text
      if (part.mimeType === 'multipart/alternative' && part.parts && part.parts.length > 0) {
        // First pass: try to find HTML part
        for (let i = 0; i < part.parts.length; i++) {
          const subpart = part.parts[i];
          if (subpart.mimeType?.includes('text/html')) {
            const result = getBodyFromPart(subpart, depth + 1);
            if (result) {
              return result;
            }
          }
        }

        // Second pass: fall back to plain text
        for (let i = 0; i < part.parts.length; i++) {
          const subpart = part.parts[i];
          if (subpart.mimeType?.includes('text/plain')) {
            const result = getBodyFromPart(subpart, depth + 1);
            if (result) {
              return result;
            }
          }
        }
      }

      // Otherwise, recurse into subparts
      if (part.parts && part.parts.length > 0) {
        for (let i = 0; i < part.parts.length; i++) {
          const subpart = part.parts[i];
          const result = getBodyFromPart(subpart, depth + 1);
          if (result) {
            return result;
          }
        }
      }

      return null;
    };

    const bodyResult = getBodyFromPart(gmailMessage.payload);
    if (bodyResult) {
      bodyContent = bodyResult.content;
      isHtml = bodyResult.isHtml;
    } else {
      // Fallback to snippet
      bodyContent = gmailMessage.snippet || 'No content';
    }

    // Parse From header: extract display name and email address
    // Format: "Display Name <email@example.com>" splits into name and email
    // Format: "email@example.com" or anything else is used as-is
    const fromHeader = getHeader('From');
    let fromName = '';
    let fromEmail = '';

    // Only try to split if it has angle brackets format: "Name <email>"
    const angleMatch = fromHeader.match(/^(.+?)\s*<(.+?)>\s*$/);
    if (angleMatch && angleMatch[1] && angleMatch[2]) {
      fromName = angleMatch[1].trim().replace(/^"|"$/g, ''); // Remove quotes if present
      fromEmail = angleMatch[2].trim();
    } else {
      // Use as-is for any other format (plain email or other)
      fromEmail = fromHeader.trim();
    }

    // Parse recipients
    const toHeader = getHeader('To');
    const toEmails = toHeader.split(',').map((e: string) => e.trim()).filter((e: string) => e);
    const ccHeader = getHeader('Cc');
    const ccEmails = ccHeader.split(',').map((e: string) => e.trim()).filter((e: string) => e);

    const result = {
      id: gmailMessage.id,
      subject: getHeader('Subject') || 'No subject',
      from: fromEmail,
      fromName: fromName,
      to: toEmails,
      cc: ccEmails.length > 0 ? ccEmails : undefined,
      date: new Date(parseInt(gmailMessage.internalDate || 0)).toISOString(),
      body: bodyContent || gmailMessage.snippet || 'No content',
      isHtml,
      snippet: gmailMessage.snippet,
    };

    return result;
  }

  /**
   * Get a specific message by ID
   * Caches the result to temp directory and returns cache ID
   */
  async gmailGetMessage(args: any): Promise<unknown> {
    try {
      // Accept both 'messageId' and 'id' (AI sometimes reuses the id field from search results)
      const messageId = args.messageId ?? args.id;
      console.log('[GmailInProcess:gmailGetMessage] Getting message', { ...args, messageId });
      // Always request full format for complete email data
      const result = await getMessage(messageId, this.tokens, 'full');

      // Cache the message to temp directory
      try {
        const fs = await import('fs/promises');
        const path = await import('path');

        const tempDir = path.join(this.storageRoot, 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        // Use message ID as cache key directly
        // Include "email" in name so EmailPreviewAdapter recognizes it
        const cacheId = `gmail_email_${messageId}`;
        const cacheFileName = `${cacheId}.json`;
        const cachePath = path.join(tempDir, cacheFileName);

        // Convert to EmailPreviewAdapter format for nice rendering
        const emailData = this.parseGmailMessage(result);

        // Store the formatted email data
        await fs.writeFile(cachePath, JSON.stringify(emailData, null, 2));
        console.log(`[GmailInProcess:gmailGetMessage] Cached message to: ${cachePath}`);

        // Return with cache ID and a hint for preview pane
        return {
          type: 'text',
          text: `[GMAIL_CACHE_ID: ${cacheId}]\n\nSubject: ${emailData.subject}\nFrom: ${emailData.from}\nDate: ${emailData.date}\n\nEmail cached for preview. Click the preview link to view in the preview pane.`,
        };
      } catch (cacheError) {
        console.warn('[GmailInProcess:gmailGetMessage] Failed to cache message:', cacheError);
        // Fall back to returning the raw result if caching fails
        return {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailGetMessage] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Search for messages using Gmail search syntax
   */
  async gmailSearchMessages(args: any): Promise<unknown> {
    try {
      console.log('[GmailInProcess:gmailSearchMessages] Searching messages', args);
      const { query, ...options } = args;
      const result = await searchMessages(query, this.tokens, options);
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailSearchMessages] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Send an email message
   */
  async gmailSendMessage(args: any): Promise<unknown> {
    try {
      console.log('[GmailInProcess:gmailSendMessage] Sending message', args);
      const result = await sendMessage(args, this.tokens);
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailSendMessage] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Create a draft email
   */
  async gmailCreateDraft(args: any): Promise<unknown> {
    try {
      console.log('[GmailInProcess:gmailCreateDraft] Creating draft', args);
      const result = await createDraft(args, this.tokens);
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailCreateDraft] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * List all available labels
   */
  async gmailListLabels(): Promise<unknown> {
    try {
      console.log('[GmailInProcess:gmailListLabels] Listing labels');
      const result = await listLabels(this.tokens);
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailListLabels] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Modify labels on a message
   */
  async gmailModifyMessageLabels(args: any): Promise<unknown> {
    try {
      console.log('[GmailInProcess:gmailModifyMessageLabels] Modifying labels', args);
      const { messageId, ...labelOptions } = args;
      const result = await modifyMessageLabels(messageId, labelOptions, this.tokens);
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailModifyMessageLabels] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Move a message to trash
   */
  async gmailTrashMessage(args: any): Promise<unknown> {
    try {
      const messageId = args.messageId ?? args.id;
      console.log('[GmailInProcess:gmailTrashMessage] Trashing message', { ...args, messageId });
      const result = await trashMessage(messageId, this.tokens);
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailTrashMessage] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Restore a message from trash
   */
  async gmailUntrashMessage(args: any): Promise<unknown> {
    try {
      const messageId = args.messageId ?? args.id;
      console.log('[GmailInProcess:gmailUntrashMessage] Untrashing message', { ...args, messageId });
      const result = await untrashMessage(messageId, this.tokens);
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailUntrashMessage] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Archive a message
   */
  async gmailArchiveMessage(args: any): Promise<unknown> {
    try {
      const messageId = args.messageId ?? args.id;
      console.log('[GmailInProcess:gmailArchiveMessage] Archiving message', { ...args, messageId });
      const result = await archiveMessage(messageId, this.tokens);
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailArchiveMessage] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Unarchive a message
   */
  async gmailUnarchiveMessage(args: any): Promise<unknown> {
    try {
      const messageId = args.messageId ?? args.id;
      console.log('[GmailInProcess:gmailUnarchiveMessage] Unarchiving message', { ...args, messageId });
      const result = await unarchiveMessage(messageId, this.tokens);
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailUnarchiveMessage] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * List conversation threads
   */
  async gmailListThreads(args: any): Promise<unknown> {
    try {
      console.log('[GmailInProcess:gmailListThreads] Listing threads', args);
      const result = await listThreads(this.tokens, args);
      return {
        type: 'text',
        text: JSON.stringify(result, null, 2),
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailListThreads] Error:', errorMsg);
      throw error;
    }
  }

  /**
   * Get a specific thread by ID
   * Caches the result to temp directory and returns cache ID
   */
  async gmailGetThread(args: any): Promise<unknown> {
    try {
      // Accept both 'threadId' and 'id' (AI sometimes reuses the id field from search results)
      const threadId = args.threadId ?? args.id;
      console.log('[GmailInProcess:gmailGetThread] Getting thread', { ...args, threadId });
      // Always request full format for complete email data
      const result = await getThread(threadId, this.tokens, 'full');

      // Cache the thread to temp directory
      try {
        const fs = await import('fs/promises');
        const path = await import('path');

        const tempDir = path.join(this.storageRoot, 'temp');
        await fs.mkdir(tempDir, { recursive: true });

        // Use thread ID as cache key directly
        // Include "email" in name so EmailPreviewAdapter recognizes it
        const cacheId = `gmail_email_thread_${threadId}`;
        const cacheFileName = `${cacheId}.json`;
        const cachePath = path.join(tempDir, cacheFileName);

        // Convert messages to EmailPreviewAdapter format
        const messages = result.messages?.map((msg: any) => this.parseGmailMessage(msg)) || [];

        const threadData = {
          id: result.id,
          subject: messages[0]?.subject || 'No subject',
          participants: Array.from(
            new Set(messages.flatMap(m => [m.from, ...m.to].filter(Boolean)))
          ),
          messages,
          messageCount: messages.length,
          startDate: messages[messages.length - 1]?.date || new Date().toISOString(),
          lastDate: messages[0]?.date || new Date().toISOString(),
        };

        // Store the formatted thread data
        await fs.writeFile(cachePath, JSON.stringify(threadData, null, 2));
        console.log(`[GmailInProcess:gmailGetThread] Cached thread to: ${cachePath}`);

        // Return with cache ID and a hint for preview pane
        return {
          type: 'text',
          text: `[GMAIL_CACHE_ID: ${cacheId}]\n\nSubject: ${threadData.subject}\nMessages: ${threadData.messageCount}\nParticipants: ${threadData.participants.slice(0, 2).join(', ')}${threadData.participants.length > 2 ? ' ...' : ''}\n\nThread cached for preview. Click the preview link to view in the preview pane.`,
        };
      } catch (cacheError) {
        console.warn('[GmailInProcess:gmailGetThread] Failed to cache thread:', cacheError);
        // Fall back to returning the raw result if caching fails
        return {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        };
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailGetThread] Error:', errorMsg);
      throw error;
    }
  }
}
