/**
 * Shared text utilities used by both client and server.
 */

// Words longer than this are counted as multiple words proportionally,
// preventing bypasses like repeating a single long token (e.g. 50 dots).
const MAX_WORD_LENGTH = 20;

/**
 * Strip HTML tags and decode common HTML entities, preserving line breaks
 * from block-level elements so the resulting plain text remains readable.
 */
export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function countWords(text: string): number {
  if (text.trim() === '') return 0;
  return text.trim().split(/\s+/).reduce((sum, word) => {
    return sum + Math.ceil(word.length / MAX_WORD_LENGTH);
  }, 0);
}
