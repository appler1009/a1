/**
 * Abstract base class for bot integrations (Discord, Telegram, etc.)
 *
 * Handles shared concerns:
 * - Session management (platform user → app session)
 * - Calling /api/chat/stream and parsing SSE
 * - Message splitting utilities
 * - Scheduled job completion notifications
 */

import type { User } from '@local-agent/shared';
import { getMainDatabase } from '../storage/index.js';
import { authService } from '../auth/index.js';
import { pendingRoleChanges } from './pending-role-changes.js';
import { config as appConfig } from '../config/index.js';
import { extractEmailDataFromMarker, isDisplayEmailMarker } from '../mcp/in-process/display-email.js';
import type { BotSegment, BotSession } from './types.js';

export { BotSegment, BotSession };

export abstract class BaseBot {
  protected sessions = new Map<string, BotSession>();

  constructor(protected port: number) {}

  abstract getName(): string;

  /** Max characters per message for this platform */
  abstract getMessageChunkSize(): number;

  /** Look up an app user linked to this platform user ID */
  abstract getUserByPlatformId(platformUserId: string): Promise<User | null>;

  /** Send a direct message/notification to a platform user by their platform ID */
  abstract notifyUserByPlatformId(platformUserId: string, message: string): Promise<void>;

  /** Start the bot (connect to platform APIs, register handlers, etc.) */
  abstract start(): Promise<void>;

  /**
   * Notify a user that a scheduled job completed.
   * Finds all active sessions for the app user and sends a DM on the platform.
   */
  async notifyScheduledJobCompletion(
    appUserId: string,
    roleName: string,
    jobDescription: string,
  ): Promise<void> {
    const platformUserIds = Array.from(this.sessions.entries())
      .filter(([, session]) => session.appUserId === appUserId)
      .map(([id]) => id);

    if (platformUserIds.length === 0) {
      console.log(`[${this.getName()}] No active sessions for app user ${appUserId}`);
      return;
    }

    const message =
      `✅ Scheduled job completed in role **${roleName}**:\n\n` +
      `${jobDescription.slice(0, 100)}${jobDescription.length > 100 ? '…' : ''}`;

    for (const platformUserId of platformUserIds) {
      await this.notifyUserByPlatformId(platformUserId, message).catch((err) => {
        console.error(`[${this.getName()}] Failed to notify user ${platformUserId}:`, err);
      });
    }
  }

  /**
   * Get or create a session for a platform user.
   * Call this after verifying the app user exists.
   */
  protected async getOrCreateSession(
    platformUserId: string,
    appUser: User,
  ): Promise<BotSession> {
    let session = this.sessions.get(platformUserId);

    if (!session) {
      console.log(`[${this.getName()}] Creating new session for app user ${appUser.id}`);
      const authSession = await authService.createSession(appUser.id);

      // Ensure role-manager is in user's MCP servers
      const mainDb = await getMainDatabase(appConfig.storage.root);
      const mcpServerKey = 'role-manager';
      const mcpConfig = await mainDb.getMCPServerConfig(mcpServerKey);
      if (!mcpConfig) {
        await mainDb.saveMCPServerConfig(mcpServerKey, {
          name: 'Role Manager',
          transport: 'in-process',
          enabled: true,
          hidden: true,
        });
      }

      const roles = await mainDb.getUserRoles(appUser.id);
      const defaultRoleId = roles.length > 0 ? roles[0].id : null;

      session = {
        appUserId: appUser.id,
        sessionId: authSession.id,
        currentRoleId: defaultRoleId,
        locale: appUser.locale,
        timezone: appUser.timezone,
      };
      this.sessions.set(platformUserId, session);
    } else {
      // Refresh locale/timezone in case user updated via web UI
      session.locale = appUser.locale;
      session.timezone = appUser.timezone;
    }

    return session;
  }

  /**
   * Call /api/chat/stream and parse the SSE response into platform-agnostic segments.
   * Each segment represents a logical chunk: pre-tool thinking or the final answer.
   */
  protected async callChatEndpoint(
    session: BotSession,
    conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<BotSegment[]> {
    const requestBody: Record<string, unknown> = {
      messages: conversationHistory,
      roleId: session.currentRoleId,
      stream: true,
    };
    if (session.locale) requestBody.locale = session.locale;
    if (session.timezone) requestBody.timezone = session.timezone;

    console.log(`[${this.getName()}:ChatAPI] Calling with roleId: ${session.currentRoleId}`);

    const response = await fetch(`http://localhost:${this.port}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session_id=${session.sessionId}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error(`[${this.getName()}:ChatAPI] HTTP ${response.status}: ${response.statusText}`);
      return [{ text: `Error: HTTP ${response.status}` }];
    }

    const reader = response.body?.getReader();
    if (!reader) return [];

    const segments: BotSegment[] = [];
    let currentText = '';
    const pendingEmailData: Record<string, unknown>[] = [];
    const pendingFileRefs: Array<{ url: string; filename: string }> = [];

    const flushSegment = () => {
      const text = this.stripPreviewFileTags(currentText).trim();
      if (text || pendingEmailData.length || pendingFileRefs.length) {
        segments.push({
          text,
          emailData: pendingEmailData.length > 0 ? pendingEmailData[0] : undefined,
          fileRefs: pendingFileRefs.length > 0 ? [...pendingFileRefs] : undefined,
        });
        pendingEmailData.length = 0;
        pendingFileRefs.length = 0;
      }
      currentText = '';
    };

    const decoder = new TextDecoder();
    let done = false;

    try {
      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.substring(6);

          if (data === '[DONE]') { done = true; break; }

          try {
            const json = JSON.parse(data);

            if (json.content) currentText += json.content;

            // Tool call boundary → flush current text as its own segment
            if (json.type === 'tool_call') flushSegment();

            // Tool result → collect email data and file refs for the next segment
            if (json.type === 'tool_result' && json.result) {
              const result: string = json.result;

              if (isDisplayEmailMarker(result)) {
                const emailData = extractEmailDataFromMarker(result);
                if (emailData) pendingEmailData.push(emailData);
              }

              const pdfRef = parseGoogleDrivePdf(result);
              if (pdfRef) {
                pendingFileRefs.push({
                  url: `/api/viewer/temp/${encodeURIComponent(pdfRef.name)}`,
                  filename: pdfRef.name,
                });
              }

              const previewMatch = result.match(/\[preview-file:([^\]]+)\]\(([^)]+)\)/);
              if (previewMatch) {
                const [, filename, url] = previewMatch;
                if (!url.includes('drive.google.com')) {
                  pendingFileRefs.push({ url, filename });
                }
              }
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    flushSegment();

    return segments.length > 0 ? segments : [{ text: 'No response' }];
  }

  /**
   * Process an incoming message from a platform user.
   * Handles user lookup, session management, chat API call, and role change tracking.
   * Returns the response segments, or null if the message should be ignored/rejected.
   */
  protected async processMessage(
    platformUserId: string,
    text: string,
  ): Promise<{ segments: BotSegment[]; session: BotSession } | null> {
    const appUser = await this.getUserByPlatformId(platformUserId);

    if (!appUser) {
      console.log(`[${this.getName()}] User ${platformUserId} not linked to app`);
      return null;
    }

    const session = await this.getOrCreateSession(platformUserId, appUser);
    console.log(`[${this.getName()}] Session role: ${session.currentRoleId || 'none'}`);

    const mainDb = await getMainDatabase(appConfig.storage.root);

    // Load recent conversation history from DB
    const historyRows = session.currentRoleId
      ? await mainDb.listMessages(session.appUserId, session.currentRoleId, { limit: 20 })
      : [];
    const conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...historyRows
        .filter(r => r.from === 'user' || r.from === 'assistant')
        .map(r => ({ role: r.from as 'user' | 'assistant', content: r.content })),
      { role: 'user', content: text },
    ];

    // Persist incoming user message
    if (session.currentRoleId) {
      await mainDb.saveMessage({
        id: crypto.randomUUID(),
        userId: session.appUserId,
        roleId: session.currentRoleId,
        groupId: null,
        from: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      });
    }

    const segments = await this.callChatEndpoint(session, conversationHistory);
    const fullText = segments.map((s) => s.text).filter(Boolean).join('\n');

    // Persist assistant response
    if (session.currentRoleId && fullText) {
      await mainDb.saveMessage({
        id: crypto.randomUUID(),
        userId: session.appUserId,
        roleId: session.currentRoleId,
        groupId: null,
        from: 'assistant',
        content: fullText,
        createdAt: new Date().toISOString(),
      });
    }

    // Apply any pending role change triggered by role-manager tool
    const pendingChange = pendingRoleChanges.get(session.appUserId);
    if (pendingChange) {
      console.log(`[${this.getName()}] Applying pending role change: ${pendingChange.roleName}`);
      session.currentRoleId = pendingChange.roleId;
      pendingRoleChanges.delete(session.appUserId);
    }

    return { segments, session };
  }

  /** Split text into chunks respecting the platform's max message length */
  protected splitMessage(text: string, maxLength: number = this.getMessageChunkSize()): string[] {
    if (text.length <= maxLength) return [text];

    const chunks: string[] = [];
    let currentChunk = '';

    for (const line of text.split('\n')) {
      if ((currentChunk + line + '\n').length > maxLength) {
        if (currentChunk) chunks.push(currentChunk.trim());
        currentChunk = line + '\n';
      } else {
        currentChunk += line + '\n';
      }
    }
    if (currentChunk) chunks.push(currentChunk.trim());
    return chunks;
  }

  /** Remove web-only preview-file tags */
  protected stripPreviewFileTags(text: string): string {
    return text
      .replace(/\[preview-file:[^\]]+\]\([^)]+\)/g, '')
      .replace(/<preview-file[^>]*\/>/gi, '')
      .trim();
  }
}

/**
 * Parse a Google Drive PDF reference from a tool result string.
 * Format: "filename (ID: abc123, application/pdf)"
 */
function parseGoogleDrivePdf(result: string): { id: string; name: string } | null {
  for (const line of result.split('\n')) {
    const match = line.match(/^(.+?)\s+\(ID:\s*(\S+?),\s*application\/pdf\)$/);
    if (match) return { name: match[1].trim(), id: match[2] };
  }
  return null;
}
