/**
 * Display Email Tool
 *
 * An in-process MCP tool that allows AI models to display emails in the preview pane.
 * The tool accepts an email object and serializes it for display via the preview adapter.
 */

import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import type { MCPToolInfo } from '@local-agent/shared';

/**
 * Email message structure matching EmailMessage from client
 */
export interface EmailDisplayInput {
  email?: Record<string, unknown>;
  thread?: Record<string, unknown>;
  messages?: Record<string, unknown>[];
  cacheId?: string; // Cache ID from gmailGetMessage or gmailGetThread
}

/**
 * Get the display_email tool definition
 */
export function getDisplayEmailToolDefinition(): MCPToolInfo {
  return {
    name: 'display_email',
    description: 'Display an email message, thread, or multiple messages in the preview pane. Pass the email object(s) with complete message details including headers, body, attachments, and threading information, or provide a cache ID from gmailGetMessage/gmailGetThread.',
    inputSchema: {
      type: 'object',
      properties: {
        email: {
          type: 'object',
          description: 'A single email message object with properties like id, subject, from, to, date, body, isHtml, attachments, etc.',
          properties: {
            id: { type: 'string', description: 'Unique message ID' },
            subject: { type: 'string', description: 'Message subject' },
            from: { type: 'string', description: 'Sender email address' },
            fromName: { type: 'string', description: 'Sender display name (optional)' },
            to: { type: 'array', items: { type: 'string' }, description: 'Recipient email addresses' },
            cc: { type: 'array', items: { type: 'string' }, description: 'Carbon copy recipients (optional)' },
            bcc: { type: 'array', items: { type: 'string' }, description: 'Blind carbon copy recipients (optional)' },
            date: { type: 'string', description: 'ISO 8601 date string' },
            body: { type: 'string', description: 'Email body content' },
            isHtml: { type: 'boolean', description: 'Whether body is HTML formatted (optional)' },
            attachments: {
              type: 'array',
              description: 'Email attachments (optional)',
              items: {
                type: 'object',
                properties: {
                  filename: { type: 'string' },
                  mimeType: { type: 'string' },
                  size: { type: 'number' },
                  url: { type: 'string' }
                }
              }
            },
            flags: {
              type: 'object',
              description: 'Message flags (optional)',
              properties: {
                read: { type: 'boolean' },
                starred: { type: 'boolean' },
                draft: { type: 'boolean' },
                spam: { type: 'boolean' },
                trash: { type: 'boolean' }
              }
            }
          }
        },
        thread: {
          type: 'object',
          description: 'An email thread object containing a conversation with multiple related messages',
          properties: {
            id: { type: 'string', description: 'Thread ID' },
            subject: { type: 'string', description: 'Conversation subject' },
            participants: { type: 'array', items: { type: 'string' }, description: 'All participant emails' },
            messages: { type: 'array', description: 'Array of email messages in thread' },
            messageCount: { type: 'number', description: 'Total messages in thread' },
            startDate: { type: 'string', description: 'First message date (ISO 8601)' },
            lastDate: { type: 'string', description: 'Last message date (ISO 8601)' }
          }
        },
        messages: {
          type: 'array',
          description: 'An array of email message objects to display as a list',
          items: {
            type: 'object',
            description: 'Email message object (same structure as email parameter above)'
          }
        },
        cacheId: {
          type: 'string',
          description: 'Cache ID from gmailGetMessage or gmailGetThread to retrieve email from temp directory'
        }
      },
      required: []
    },
    requiresDetailedSchema: true
  };
}

/**
 * Resolve email data from cache ID if provided
 * Reads from temp directory and returns the email data
 */
async function resolveEmailFromCache(cacheId: string): Promise<Record<string, unknown> | null> {
  try {
    const fs = await import('fs/promises');
    const path = await import('path');

    const storageRoot = process.env.STORAGE_ROOT || './data';
    const tempDir = path.join(storageRoot, 'temp');

    // Sanitize cache ID to prevent path traversal
    if (!cacheId || cacheId.includes('..') || cacheId.includes('/')) {
      console.error('[DisplayEmail] Invalid cache ID:', cacheId);
      return null;
    }

    // Try to find the cache file
    const cacheFileName = `${cacheId}.json`;
    const cachePath = path.join(tempDir, cacheFileName);

    console.log('[DisplayEmail] Reading email from cache:', cachePath);
    const data = await fs.readFile(cachePath, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[DisplayEmail] Failed to read email from cache:', error);
    return null;
  }
}

/**
 * Execute the display_email tool
 * Returns a special marker that the client recognizes to route to preview pane
 * Handles both direct email data and cache IDs
 */
export async function executeDisplayEmail(input: EmailDisplayInput): Promise<string> {
  let emailData = input.email || input.thread || input.messages;

  // If cache ID is provided, resolve from temp directory
  if (input.cacheId && !emailData) {
    console.log('[DisplayEmail] Resolving email from cache ID:', input.cacheId);
    const cachedData = await resolveEmailFromCache(input.cacheId);
    if (cachedData) {
      emailData = cachedData;
    } else {
      return `Error: Could not retrieve email from cache with ID: ${input.cacheId}`;
    }
  }

  if (!emailData) {
    return 'Error: No email data provided. Pass an email, thread, messages array, or cache ID.';
  }

  // Serialize the email data as a special marker for the client to recognize
  // The format is: ___DISPLAY_EMAIL___ followed by the JSON data
  const jsonData = JSON.stringify(emailData);
  return `___DISPLAY_EMAIL___${jsonData}___END_DISPLAY_EMAIL___`;
}

/**
 * Check if a result string is a display_email marker
 */
export function isDisplayEmailMarker(result: string): boolean {
  return result.includes('___DISPLAY_EMAIL___');
}

/**
 * Extract email data from a display_email marker
 */
export function extractEmailDataFromMarker(result: string): Record<string, unknown> | null {
  const match = result.match(/___DISPLAY_EMAIL___(.*?)___END_DISPLAY_EMAIL___/s);
  if (!match || !match[1]) {
    return null;
  }

  try {
    return JSON.parse(match[1]);
  } catch (error) {
    console.error('[DisplayEmail] Failed to parse email data:', error);
    return null;
  }
}

/**
 * In-process module for display_email tool
 */
export class DisplayEmailInProcess implements InProcessMCPModule {
  async getTools(): Promise<MCPToolInfo[]> {
    return [getDisplayEmailToolDefinition()];
  }

  async display_email(input: EmailDisplayInput): Promise<string> {
    return executeDisplayEmail(input);
  }

  // Index signature to satisfy InProcessMCPModule interface
  [key: string]: unknown;
}
