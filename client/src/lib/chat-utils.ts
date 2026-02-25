/**
 * Pure utility functions extracted from ChatPane for reuse and testability.
 */

/**
 * Format tool name for display: converts camelCase to words, underscores to spaces, lowercase.
 * Examples:
 * - "gmailSearchMessages" → "gmail search messages"
 * - "search_tool" → "search tool"
 * - "googleDriveListFiles" → "google drive list files"
 */
export function formatToolName(toolName: string): string {
  // Insert space before uppercase letters (camelCase to words)
  let formatted = toolName.replace(/([A-Z])/g, ' $1');
  // Replace underscores with spaces
  formatted = formatted.replace(/_/g, ' ');
  // Lowercase everything
  formatted = formatted.toLowerCase();
  // Remove extra spaces and trim
  formatted = formatted.replace(/\s+/g, ' ').trim();
  return formatted;
}

/**
 * Parse Google Drive search result to extract PDF files.
 * Format: "Report.pdf (ID: abc123, application/pdf)"
 */
export function parseGoogleDriveSearchResult(result: string): { id: string; name: string; mimeType: string; previewUrl: string } | null {
  const lines = result.split('\n');
  for (const line of lines) {
    // Match: "filename (ID: id123, application/pdf)"
    const match = line.match(/^(.+?)\s+\(ID:\s*(\S+?),\s*(.+?)\)$/);
    if (match) {
      const [, name, id, mimeType] = match;
      if (mimeType.trim() === 'application/pdf') {
        return {
          id,
          name: name.trim(),
          mimeType: mimeType.trim(),
          previewUrl: `https://drive.google.com/file/d/${id}/preview`,
        };
      }
    }
  }
  return null;
}

/**
 * Extract email data from display_email tool marker.
 * Format: ___DISPLAY_EMAIL__{json}___END_DISPLAY_EMAIL___
 */
export function parseDisplayEmailMarker(result: string): { id: string; name: string; mimeType: string; previewUrl: string } | null {
  const match = result.match(/___DISPLAY_EMAIL___(.*?)___END_DISPLAY_EMAIL___/s);
  if (!match || !match[1]) {
    return null;
  }

  try {
    const emailData = JSON.parse(match[1]);

    let emailName = 'Email';
    if (emailData.subject) {
      emailName = emailData.subject;
    } else if (emailData.messages && emailData.messages.length > 0) {
      emailName = emailData.messages[0].subject || 'Email Thread';
    }

    return {
      id: emailData.id || crypto.randomUUID(),
      name: emailName,
      mimeType: 'message/rfc822',
      previewUrl: `data:message/rfc822;base64,${btoa(match[1])}`,
    };
  } catch {
    return null;
  }
}
