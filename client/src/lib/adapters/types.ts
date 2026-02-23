/**
 * Type definitions for preview adapters
 * Shared types used across multiple adapters
 */

/**
 * Email message with RFC 5322 fields
 */
export interface EmailMessage {
  /**
   * Unique message ID (RFC 5322)
   */
  id: string;

  /**
   * Message subject
   */
  subject: string;

  /**
   * Sender email address
   */
  from: string;

  /**
   * Sender display name (optional)
   */
  fromName?: string;

  /**
   * Recipient email addresses
   */
  to: string[];

  /**
   * Carbon copy recipients
   */
  cc?: string[];

  /**
   * Blind carbon copy recipients
   */
  bcc?: string[];

  /**
   * Message date (ISO 8601 string or Date)
   */
  date: string | Date;

  /**
   * Email body text (plain text or HTML)
   */
  body: string;

  /**
   * Is body HTML formatted
   */
  isHtml?: boolean;

  /**
   * Parent message ID (for threading)
   */
  inReplyTo?: string;

  /**
   * Thread ID (groups related messages)
   */
  threadId?: string;

  /**
   * Message attachments
   */
  attachments?: EmailAttachment[];

  /**
   * Message flags (read, starred, etc.)
   */
  flags?: {
    read?: boolean;
    starred?: boolean;
    draft?: boolean;
    spam?: boolean;
    trash?: boolean;
  };

  /**
   * Additional headers
   */
  headers?: Record<string, string>;
}

/**
 * Email attachment
 */
export interface EmailAttachment {
  /**
   * Filename
   */
  filename: string;

  /**
   * MIME type
   */
  mimeType: string;

  /**
   * File size in bytes
   */
  size: number;

  /**
   * Download URL
   */
  url?: string;

  /**
   * Base64 encoded content
   */
  data?: string;
}

/**
 * Email thread (conversation)
 */
export interface EmailThread {
  /**
   * Thread ID
   */
  id: string;

  /**
   * Subject of the conversation
   */
  subject: string;

  /**
   * Participant email addresses
   */
  participants: string[];

  /**
   * All messages in the thread (ordered by date)
   */
  messages: EmailMessage[];

  /**
   * Total message count
   */
  messageCount: number;

  /**
   * Date of first message
   */
  startDate: string | Date;

  /**
   * Date of last message
   */
  lastDate: string | Date;

  /**
   * Is thread unread
   */
  unread?: boolean;

  /**
   * Is thread starred
   */
  starred?: boolean;
}

/**
 * Email preview file format
 * Extends standard ViewerFile with email-specific content
 */
export interface EmailPreviewFile {
  /**
   * Single email message
   */
  message?: EmailMessage;

  /**
   * Email thread (conversation)
   */
  thread?: EmailThread;

  /**
   * Multiple messages (not necessarily threaded)
   */
  messages?: EmailMessage[];
}
