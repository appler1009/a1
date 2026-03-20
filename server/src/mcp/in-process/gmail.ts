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
import type { TempStorage } from '../../storage/temp-storage.js';
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

// TempStorage for caching emails - uses S3 or local FS based on config
let tempStorage: TempStorage | null = null;

/**
 * Validate that an ID contains only safe characters to prevent path traversal
 */
function isValidCacheId(id: string): boolean {
  // IDs should only contain alphanumeric characters, underscores, and hyphens
  // This prevents path traversal attacks if IDs are ever used in file paths
  if (!id || id.length === 0) return false;
  if (id.includes('/') || id.includes('\\')) return false;
  if (id.includes('..')) return false;
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

/**
 * Convert Gmail API message format to EmailPreviewAdapter format
 * Exported for use by viewer download endpoint
 */
export function parseGmailMessage(gmailMessage: any): Record<string, any> {
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

  // Extract attachments from MIME tree
  const attachments: Array<{
    filename: string;
    mimeType: string;
    size: number;
    url?: string;
    contentId?: string;
  }> = [];

  const extractAttachments = (part: any) => {
    const partMimeType = part.mimeType || '';
    const isMultipart = partMimeType.startsWith('multipart/');

    // Filename can be set directly on the part or in Content-Disposition header
    const cdHeader = part.headers?.find((h: any) => h.name?.toLowerCase() === 'content-disposition')?.value || '';
    const cdFilename = cdHeader.match(/filename\*?=(?:UTF-8'')?(?:"([^"]+)"|([^\s;]+))/i);
    const filename = part.filename || cdFilename?.[1] || cdFilename?.[2];

    // Content-ID for inline CID images (strip surrounding angle brackets)
    const rawCid = part.headers?.find((h: any) => h.name?.toLowerCase() === 'content-id')?.value || '';
    const contentId = rawCid ? rawCid.replace(/^<|>$/g, '') : undefined;

    if ((filename || contentId) && !isMultipart) {
      const attachMimeType = partMimeType || 'application/octet-stream';
      const size = part.body?.size || 0;
      const effectiveFilename = filename || contentId || 'inline';

      if (part.body?.data) {
        // Small inline attachment — serve as data URL directly
        attachments.push({
          filename: effectiveFilename,
          mimeType: attachMimeType,
          size,
          url: `data:${attachMimeType};base64,${part.body.data}`,
          contentId,
        });
      } else if (part.body?.attachmentId) {
        // Large attachment — download via server proxy endpoint.
        // All IDs go in query params to avoid Fastify's maxParamLength limit
        // (Gmail attachment IDs can be 400+ chars).
        const qs = new URLSearchParams({
          messageId,
          attachmentId: part.body.attachmentId,
          filename: effectiveFilename,
          mimeType: attachMimeType,
        }).toString();
        attachments.push({
          filename: effectiveFilename,
          mimeType: attachMimeType,
          size,
          url: `/api/gmail/attachment?${qs}`,
          contentId,
        });
      }
    }

    // Recurse into sub-parts
    if (part.parts) {
      part.parts.forEach((sub: any) => extractAttachments(sub));
    }
  };

  extractAttachments(gmailMessage.payload);

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
    attachments: attachments.length > 0 ? attachments : undefined,
  };

  return result;
}

/**
 * Initialize TempStorage - called once from adapter factory
 */
export function initializeGmailInProcess(tempStorageInstance: TempStorage): void {
  tempStorage = tempStorageInstance;
  console.log('[GmailInProcess] TempStorage initialized for email caching');
}

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

  getSystemPromptSummary(): string {
    return 'Gmail — search, read, draft, and send emails across connected Google accounts.';
  }

  getSystemPrompt(): string {
    return `## GMAIL: SEARCH AND SYNTHESIS WORKFLOW
When the user asks to find, read, or summarise emails:
1. **Search first**: call gmailSearchMessages with a targeted query. If 0 results, immediately retry with 2–3 broader or alternative phrasings — do not ask the user until alternatives are exhausted.
2. **Fetch in parallel — prefer threads for context**:
   - Each search result contains a \`threadId\`. When the user asks about a topic, incident, or conversation (anything where back-and-forth context matters), call **gmailGetThread** with the threadId instead of gmailGetMessage — you get the full conversation in one call.
   - Use gmailGetMessage only when you need a single isolated message (e.g. a newsletter, a notification, or when the user asks for a specific message).
   - Fetch up to ~8 threads/messages simultaneously — never one at a time, never ask "shall I continue?".
3. **Synthesise**: write a single structured response with:
   - A concise paragraph summary
   - ## Key Topics section with bullet points
   - ## Action Items section (if any)
   - ## Contacts table (Name | Email | Role) when multiple senders appear
   - Numbered citations [1][2][3]... mapping to specific emails so the user can trace claims
4. Include [preview-file:Subject.json](cache-id) links for each email so the user can open them.

**NEVER**:
- List raw message IDs, thread IDs, attachment IDs, or cache IDs in responses
- Quote full email bodies in the response text (the preview pane shows them)
- Ask "Ready to retrieve the next one?" — fetch all, then respond once
- Show emails as numbered standalone sections; distil into a synthesis

## GMAIL: DISPLAY-ONLY REQUESTS
When the user explicitly asks to "show" or "open" each email (not summarise):
- Retrieve all in parallel, then list them with [preview-file:Subject.json](cache-id) links and one-line subject/sender/date descriptions.

## GMAIL EMAIL DRAFT CREATION
**CRITICAL RULES for gmailCreateDraft:**
1. **ALWAYS show the exact draft to the user BEFORE and AFTER creation:**
   - Display the full draft with: To, Subject, and complete Body text
   - Show exactly what will be saved to drafts
   - Never paraphrase or summarize the draft content
2. **When replying to an email:**
   - ONLY create the draft to the same email account that received the original email
   - Do NOT create drafts to different accounts unless explicitly requested
3. **Draft content verification:**
   - Format the draft display clearly with labeled sections
   - Verify subject, body, and recipient(s) match what the user intended

## GMAIL SEARCH RECENCY
Always include \`newer_than:90d\` in Gmail search queries unless the user specifies a different timeframe or is explicitly looking for something historical. For "recent" or "today" use \`newer_than:7d\` or \`newer_than:1d\`. Gmail returns results newest-first by default.`;
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
      {
        name: 'gmailDownloadAttachment',
        description: 'Download a Gmail message attachment to temporary storage and return a cache ID that can be passed to convert_to_markdown to read its content. Use this when the user wants to read or summarize a PDF or document attached to an email.',
        inputSchema: {
          type: 'object',
          properties: {
            messageId: {
              type: 'string',
              description: 'The Gmail message ID that contains the attachment',
            },
            attachmentId: {
              type: 'string',
              description: 'The attachment ID (from the message\'s attachments list)',
            },
            filename: {
              type: 'string',
              description: 'The attachment filename (e.g. "report.pdf") — used to set the file extension',
            },
          },
          required: ['messageId', 'attachmentId', 'filename'],
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

    // Extract attachments from MIME tree
    const attachments: Array<{
      filename: string;
      mimeType: string;
      size: number;
      url?: string;
      contentId?: string;
    }> = [];

    const extractAttachments = (part: any) => {
      const partMimeType = part.mimeType || '';
      const isMultipart = partMimeType.startsWith('multipart/');

      // Filename can be set directly on the part or in Content-Disposition header
      const cdHeader = part.headers?.find((h: any) => h.name?.toLowerCase() === 'content-disposition')?.value || '';
      const cdFilename = cdHeader.match(/filename\*?=(?:UTF-8'')?(?:"([^"]+)"|([^\s;]+))/i);
      const filename = part.filename || cdFilename?.[1] || cdFilename?.[2];

      // Content-ID for inline CID images (strip surrounding angle brackets)
      const rawCid = part.headers?.find((h: any) => h.name?.toLowerCase() === 'content-id')?.value || '';
      const contentId = rawCid ? rawCid.replace(/^<|>$/g, '') : undefined;

      if ((filename || contentId) && !isMultipart) {
        const attachMimeType = partMimeType || 'application/octet-stream';
        const size = part.body?.size || 0;
        const effectiveFilename = filename || contentId || 'inline';

        if (part.body?.data) {
          // Small inline attachment — serve as data URL directly
          attachments.push({
            filename: effectiveFilename,
            mimeType: attachMimeType,
            size,
            url: `data:${attachMimeType};base64,${part.body.data}`,
            contentId,
          });
        } else if (part.body?.attachmentId) {
          // Large attachment — download via server proxy endpoint.
          // All IDs go in query params to avoid Fastify's maxParamLength limit
          // (Gmail attachment IDs can be 400+ chars).
          const qs = new URLSearchParams({
            messageId,
            attachmentId: part.body.attachmentId,
            filename: effectiveFilename,
            mimeType: attachMimeType,
          }).toString();
          attachments.push({
            filename: effectiveFilename,
            mimeType: attachMimeType,
            size,
            url: `/api/gmail/attachment?${qs}`,
            contentId,
          });
        }
      }

      // Recurse into sub-parts
      if (part.parts) {
        part.parts.forEach((sub: any) => extractAttachments(sub));
      }
    };

    extractAttachments(gmailMessage.payload);

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
      attachments: attachments.length > 0 ? attachments : undefined,
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
      
      // Validate messageId for safety before using in cache ID
      if (!isValidCacheId(messageId)) {
        console.error('[GmailInProcess:gmailGetMessage] Invalid messageId format:', messageId);
        throw new Error('Invalid message ID format');
      }
      
      console.log('[GmailInProcess:gmailGetMessage] Getting message', { ...args, messageId });
      // Always request full format for complete email data
      const result = await getMessage(messageId, this.tokens, 'full');

      // Cache the message using TempStorage (handles S3 or local FS based on config)
      try {
        // Use message ID as cache key directly
        // Include "email" in name so EmailPreviewAdapter recognizes it
        const cacheId = `gmail_email_${messageId}`;
        const cacheFileName = `${cacheId}.json`;

        // Convert to EmailPreviewAdapter format for nice rendering (use exported function)
        const emailData = parseGmailMessage(result);

        // Store the formatted email data using TempStorage abstraction
        if (!tempStorage) {
          throw new Error('TempStorage not initialized - cannot cache email. Please ensure TempStorage is configured.');
        }
        await tempStorage.writeTempFile(cacheFileName, Buffer.from(JSON.stringify(emailData, null, 2)));
        console.log(`[GmailInProcess:gmailGetMessage] Cached message to temp storage: ${cacheFileName}`);

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
      
      // Validate threadId for safety before using in cache ID
      if (!isValidCacheId(threadId)) {
        console.error('[GmailInProcess:gmailGetThread] Invalid threadId format:', threadId);
        throw new Error('Invalid thread ID format');
      }
      
      console.log('[GmailInProcess:gmailGetThread] Getting thread', { ...args, threadId });
      // Always request full format for complete email data
      const result = await getThread(threadId, this.tokens, 'full');

      // Cache the thread using TempStorage (handles S3 or local FS based on config)
      try {
        // Use thread ID as cache key directly
        // Include "email" in name so EmailPreviewAdapter recognizes it
        const cacheId = `gmail_email_thread_${threadId}`;
        const cacheFileName = `${cacheId}.json`;

        // Convert messages to EmailPreviewAdapter format (use exported function)
        const messages = result.messages?.map((msg: any) => parseGmailMessage(msg)) || [];

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

        // Store the formatted thread data using TempStorage abstraction
        if (!tempStorage) {
          throw new Error('TempStorage not initialized - cannot cache thread. Please ensure TempStorage is configured.');
        }
        await tempStorage.writeTempFile(cacheFileName, Buffer.from(JSON.stringify(threadData, null, 2)));
        console.log(`[GmailInProcess:gmailGetThread] Cached thread to temp storage: ${cacheFileName}`);

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

  /**
   * Download a Gmail attachment to temp storage and return a cache ID for convert_to_markdown
   */
  async gmailDownloadAttachment(args: any): Promise<unknown> {
    const { messageId, attachmentId, filename } = args;

    if (!messageId || !attachmentId || !filename) {
      throw new Error('messageId, attachmentId, and filename are all required');
    }

    try {
      const { google } = await import('googleapis');
      const { OAuth2Client } = await import('google-auth-library');

      const oauth2Client = new OAuth2Client();
      oauth2Client.setCredentials({
        access_token: this.tokens.access_token,
        refresh_token: this.tokens.refresh_token,
        expiry_date: this.tokens.expiry_date,
        token_type: this.tokens.token_type || 'Bearer',
      });

      const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
      const response = await gmail.users.messages.attachments.get({
        userId: 'me',
        messageId,
        id: attachmentId,
      });

      if (!response.data.data) {
        throw new Error('Attachment data not found in Gmail response');
      }

      const buffer = Buffer.from(response.data.data, 'base64');
      const ext = filename.includes('.') ? filename.split('.').pop()! : 'bin';
      // Build a stable cache ID from message + filename (no attachment ID — too long for path)
      const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
      const cacheId = `gmail_att_${messageId}_${safeFilename}`;
      const cacheFileName = `${cacheId}.${ext}`;

      if (!tempStorage) {
        throw new Error('TempStorage not initialized');
      }

      await tempStorage.writeTempFile(cacheFileName, buffer);
      console.log(`[GmailInProcess:gmailDownloadAttachment] Saved attachment to temp storage: ${cacheFileName}`);

      return {
        type: 'text',
        text: `Attachment "${filename}" downloaded successfully.\nCache ID: ${cacheId}\n\nYou can now call convert_to_markdown with uri="${cacheId}" to read its content.`,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error('[GmailInProcess:gmailDownloadAttachment] Error:', errorMsg);
      throw error;
    }
  }
}

/**
 * Check if a cache ID is a Gmail email ID (not thread)
 */
export function isGmailCacheId(cacheId: string): boolean {
  return cacheId.startsWith('gmail_email_') && !cacheId.startsWith('gmail_email_thread_');
}

/**
 * Check if a cache ID is a Gmail thread ID
 */
export function isGmailThreadCacheId(cacheId: string): boolean {
  return cacheId.startsWith('gmail_email_thread_');
}

/**
 * Extract Gmail message ID from cache ID
 * Returns null if not a valid Gmail email cache ID
 */
export function getGmailMessageIdFromCacheId(cacheId: string): string | null {
  if (!isGmailCacheId(cacheId)) return null;
  return cacheId.replace('gmail_email_', '');
}

/**
 * Extract Gmail thread ID from cache ID
 * Returns null if not a valid Gmail thread cache ID
 */
export function getGmailThreadIdFromCacheId(cacheId: string): string | null {
  if (!isGmailThreadCacheId(cacheId)) return null;
  return cacheId.replace('gmail_email_thread_', '');
}

/**
 * Fetch a Gmail message and format it for caching
 * This is used by the viewer download endpoint when cache misses occur
 */
export async function fetchAndCacheGmailMessage(
  messageId: string,
  tokens: Tokens
): Promise<{ cacheId: string; filename: string; data: Buffer }> {
  // Validate that we have an access token
  if (!tokens.access_token) {
    throw new Error('Gmail access token is required to fetch messages');
  }

  // Fetch the message from Gmail
  const result = await getMessage(messageId, tokens, 'full');
  
  // Parse into EmailPreviewAdapter format using the exported function
  const emailData = parseGmailMessage(result);
  
  const cacheId = `gmail_email_${messageId}`;
  const filename = `${cacheId}.json`;
  const data = Buffer.from(JSON.stringify(emailData, null, 2), 'utf-8');
  
  return { cacheId, filename, data };
}
