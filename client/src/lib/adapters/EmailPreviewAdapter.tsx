/**
 * Email Preview Adapter
 *
 * Renders email messages and threaded conversations with support for:
 * - Single message preview
 * - Threaded conversations
 * - Email headers (From, To, Cc, Date, Subject)
 * - HTML and plain text bodies
 * - Attachments
 * - Message threading and replies
 */

import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { PreviewAdapter } from '../preview-adapters';
import { ViewerFile } from '../../store';
import { EmailMessage, EmailThread } from './types';

/**
 * Email message header display
 */
function EmailHeader({ email }: { email: EmailMessage }) {
  const date = typeof email.date === 'string' ? new Date(email.date) : email.date;
  const formattedDate = date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return (
    <div className="border-b bg-muted/50 p-4 space-y-3">
      {/* Subject */}
      <div className="text-lg font-semibold text-foreground">
        {email.subject}
      </div>

      {/* From */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">
              {email.fromName || email.from || 'Unknown Sender'}
            </span>
            {email.fromName && email.from && <span className="text-xs text-muted-foreground">&lt;{email.from}&gt;</span>}
          </div>
          <div className="text-xs text-muted-foreground">{formattedDate}</div>
        </div>

        {/* Flags */}
        {email.flags && (
          <div className="flex gap-2">
            {email.flags.starred && <span title="Starred">⭐</span>}
            {email.flags.draft && (
              <span className="text-xs bg-yellow-500/20 text-yellow-700 px-2 py-1 rounded">
                Draft
              </span>
            )}
          </div>
        )}
      </div>

      {/* Recipients */}
      <div className="space-y-1 text-sm">
        {email.to.length > 0 && (
          <div className="flex gap-2">
            <span className="font-medium text-muted-foreground min-w-fit">To:</span>
            <span className="text-foreground break-all">{email.to.join(', ')}</span>
          </div>
        )}

        {email.cc && email.cc.length > 0 && (
          <div className="flex gap-2">
            <span className="font-medium text-muted-foreground min-w-fit">Cc:</span>
            <span className="text-foreground break-all">{email.cc.join(', ')}</span>
          </div>
        )}

        {email.bcc && email.bcc.length > 0 && (
          <div className="flex gap-2">
            <span className="font-medium text-muted-foreground min-w-fit">Bcc:</span>
            <span className="text-foreground break-all">{email.bcc.join(', ')}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Email body display
 */
function EmailBody({ email }: { email: EmailMessage }) {
  if (email.isHtml) {
    // NOTE: For production use, install and use DOMPurify for HTML sanitization:
    // npm install dompurify
    // import DOMPurify from 'dompurify';
    // const sanitized = DOMPurify.sanitize(email.body);
    //
    // This implementation renders HTML as-is. Only use with trusted email sources!

    return (
      <>
        <style>{`
          .email-html-body table,
          .email-html-body table * {
            border: none !important;
            border-collapse: collapse;
          }
        `}</style>
        <div
          className="email-html-body prose prose-sm dark:prose-invert max-w-none p-4"
          dangerouslySetInnerHTML={{ __html: email.body }}
          // WARNING: dangerouslySetInnerHTML can be a security risk
          // Only use if email content is from a trusted source
        />
      </>
    );
  }

  // Plain text - render as markdown for formatting
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none p-4">
      <ReactMarkdown
        components={{
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              {children}
            </a>
          ),
        }}
      >
        {email.body}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Email attachments display
 */
function EmailAttachments({ email }: { email: EmailMessage }) {
  if (!email.attachments || email.attachments.length === 0) {
    return null;
  }

  return (
    <div className="border-t bg-muted/30 p-4">
      <h3 className="text-sm font-semibold text-foreground mb-3">Attachments ({email.attachments.length})</h3>
      <div className="space-y-2">
        {email.attachments.map((attachment, idx) => (
          <div
            key={idx}
            className="flex items-center justify-between p-2 bg-background border rounded hover:bg-muted/50"
          >
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-lg">📎</span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground truncate">
                  {attachment.filename}
                </div>
                <div className="text-xs text-muted-foreground">
                  {attachment.mimeType} • {formatFileSize(attachment.size)}
                </div>
              </div>
            </div>
            {attachment.url && (
              <a
                href={attachment.url}
                download={attachment.filename}
                className="px-2 py-1 text-xs bg-primary text-primary-foreground rounded hover:opacity-90 whitespace-nowrap"
              >
                Download
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Single email message display
 */
function EmailMessageComponent({ email }: { email: EmailMessage }) {
  return (
    <div className="flex flex-col h-full bg-background">
      <EmailHeader email={email} />
      <div className="flex-1 overflow-auto">
        <EmailBody email={email} />
      </div>
      <EmailAttachments email={email} />
    </div>
  );
}

/**
 * Threaded conversation display
 */
function EmailThreadComponent({ thread }: { thread: EmailThread }) {
  const [expandedMessages, setExpandedMessages] = useState<Set<string>>(
    new Set([thread.messages[thread.messages.length - 1]?.id]) // Expand last message by default
  );

  const toggleMessage = (messageId: string) => {
    setExpandedMessages(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  const expandAll = () => {
    setExpandedMessages(new Set(thread.messages.map(m => m.id)));
  };

  const collapseAll = () => {
    setExpandedMessages(new Set());
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Thread header */}
      <div className="border-b bg-muted/50 p-4">
        <h2 className="text-lg font-semibold text-foreground mb-2">
          {thread.subject}
        </h2>
        <div className="text-sm text-muted-foreground space-y-1">
          <div>{thread.messageCount} messages</div>
          <div>{thread.participants.length} participants</div>
          <div className="flex gap-2 text-xs mt-2">
            <button
              onClick={expandAll}
              className="px-2 py-1 bg-muted hover:bg-muted/80 rounded"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="px-2 py-1 bg-muted hover:bg-muted/80 rounded"
            >
              Collapse All
            </button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-auto">
        <div className="space-y-0">
          {thread.messages.map((message, idx) => {
            const isExpanded = expandedMessages.has(message.id);
            const isLastMessage = idx === thread.messages.length - 1;

            return (
              <div
                key={message.id}
                className={`border-b ${isLastMessage ? '' : 'border-b-muted'}`}
              >
                {/* Message preview bar */}
                <button
                  onClick={() => toggleMessage(message.id)}
                  className="w-full text-left p-3 hover:bg-muted/50 transition-colors flex items-center justify-between gap-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground truncate">
                      {message.fromName || message.from}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {message.subject}
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap ml-2">
                    {formatDate(message.date)}
                  </div>
                  <span className="text-lg">
                    {isExpanded ? '▼' : '▶'}
                  </span>
                </button>

                {/* Expanded message */}
                {isExpanded && (
                  <div className="bg-background/50 border-t">
                    <EmailHeader email={message} />
                    <EmailBody email={message} />
                    <EmailAttachments email={message} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * Multiple messages display
 */
function EmailMessagesComponent({ messages }: { messages: EmailMessage[] }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedMessage = messages[selectedIndex];

  return (
    <div className="flex h-full bg-background">
      {/* Message list */}
      <div className="w-64 border-r bg-muted/30 overflow-y-auto flex flex-col">
        <div className="p-3 border-b bg-background">
          <h3 className="text-sm font-semibold text-foreground">
            Messages ({messages.length})
          </h3>
        </div>
        <div className="flex-1 space-y-0">
          {messages.map((message, idx) => (
            <button
              key={message.id}
              onClick={() => setSelectedIndex(idx)}
              className={`w-full text-left p-3 border-b transition-colors ${
                idx === selectedIndex
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              }`}
            >
              <div className="font-medium text-sm truncate">
                {message.fromName || message.from}
              </div>
              <div className={`text-xs truncate ${
                idx === selectedIndex ? 'opacity-90' : 'text-muted-foreground'
              }`}>
                {message.subject}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Message detail */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {selectedMessage && (
          <EmailMessageComponent email={selectedMessage} />
        )}
      </div>
    </div>
  );
}

/**
 * Format file size in human-readable format
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Format date for display
 */
function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  ) {
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return 'Yesterday';
  }

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/**
 * Async email loader component that handles fetching and rendering email data
 */
function AsyncEmailLoader({ file }: { file: ViewerFile }) {
  const [emailData, setEmailData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadEmailData();
  }, [file.previewUrl]);

  const loadEmailData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Handle data: URLs (from display_email tool)
      if (file.previewUrl?.startsWith('data:')) {
        const match = file.previewUrl.match(/^data:[^;]+;base64,(.+)$/);
        if (match && match[1]) {
          try {
            const decodedJson = atob(match[1]);
            const data = JSON.parse(decodedJson);
            setEmailData(structureEmailData(data));
            return;
          } catch (parseError) {
            console.error('[EmailPreviewAdapter] Failed to parse email data:', parseError);
            setError('Failed to parse email data');
            return;
          }
        }
      }

      // Handle file URLs (cached emails from temp directory)
      if (file.previewUrl && (file.previewUrl.startsWith('/') || file.previewUrl.startsWith('http'))) {
        console.log('[EmailPreviewAdapter] Loading email from file URL:', file.previewUrl);
        const res = await fetch(file.previewUrl);
        if (!res.ok) {
          setError(`Failed to load email: ${res.statusText}`);
          return;
        }
        const data = await res.json();
        console.log('[EmailPreviewAdapter] Loaded email data from URL');
        setEmailData(structureEmailData(data));
        return;
      }

      // No URL available
      setError('No email data available');
    } catch (err) {
      console.error('[EmailPreviewAdapter] Error loading email:', err);
      setError('Error loading email');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>Loading email...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-destructive">
        <p>{error}</p>
      </div>
    );
  }

  if (!emailData) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>No email content available</p>
      </div>
    );
  }

  // Render based on content type
  if (emailData.thread) {
    return <EmailThreadComponent thread={emailData.thread} />;
  } else if (emailData.messages && emailData.messages.length > 1) {
    return <EmailMessagesComponent messages={emailData.messages} />;
  } else if (emailData.message) {
    return <EmailMessageComponent email={emailData.message} />;
  } else {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        <p>No email content available</p>
      </div>
    );
  }
}

/**
 * Structure email data into the format expected by render components
 */
function structureEmailData(emailData: any): any {
  try {
    // Determine content type
    if (emailData.thread) {
      return { thread: emailData };
    } else if (emailData.messages && Array.isArray(emailData.messages)) {
      return { messages: emailData.messages };
    } else if (emailData.subject || emailData.from) {
      return { message: emailData };
    } else {
      return emailData;
    }
  } catch (error) {
    console.error('[EmailPreviewAdapter] Error structuring email data:', error);
    return null;
  }
}

/**
 * Email Preview Adapter
 * Handles email messages and threaded conversations
 */
export class EmailPreviewAdapter implements PreviewAdapter {
  readonly id = 'email-preview';
  readonly name = 'Email Viewer';

  canHandle(file: ViewerFile): boolean {
    // Check for email-specific MIME types
    if (file.mimeType?.startsWith('message/')) {
      return true;
    }

    // For JSON files, only handle if they look like email data
    if (file.mimeType === 'application/json') {
      // Handle data: URLs (from display_email tool) or files from Gmail cache
      if (file.previewUrl?.startsWith('data:')) {
        return true; // Direct email data
      }

      // Check if it's from Gmail cache (includes "gmail_email" in URL) or has .json extension
      const nameLower = file.name.toLowerCase();
      if (file.previewUrl?.includes('gmail_email') ||
          nameLower.endsWith('.json') ||
          nameLower.includes('email')) {
        return true;
      }
      // Otherwise, let TextPreviewAdapter handle generic JSON files
      return false;
    }

    // Check by extension
    const ext = file.name.split('.').pop()?.toLowerCase();
    return ['eml', 'msg', 'mbox'].includes(ext || '');
  }

  render(file: ViewerFile): React.ReactNode {
    return <AsyncEmailLoader file={file} />;
  }
}
