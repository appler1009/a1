/**
 * Shared text utilities used by both client and server.
 */

// Words longer than this are counted as multiple words proportionally,
// preventing bypasses like repeating a single long token (e.g. 50 dots).
const MAX_WORD_LENGTH = 20;

export function countWords(text: string): number {
  if (text.trim() === '') return 0;
  return text.trim().split(/\s+/).reduce((sum, word) => {
    return sum + Math.ceil(word.length / MAX_WORD_LENGTH);
  }, 0);
}
