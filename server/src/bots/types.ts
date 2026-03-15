/**
 * Shared types for bot integrations (Discord, Telegram, etc.)
 */

export interface BotSession {
  appUserId: string;
  sessionId: string;
  currentRoleId: string | null;
  locale?: string;
  timezone?: string;
}

/**
 * Platform-agnostic message segment returned by the chat endpoint parser.
 * Each bot implementation renders these into its own format.
 */
export interface BotSegment {
  /** Main text content for this segment */
  text: string;
  /** Raw email data extracted from display_email markers */
  emailData?: Record<string, unknown>;
  /** File references to fetch and attach */
  fileRefs?: Array<{ url: string; filename: string }>;
}
