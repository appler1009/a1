import { sanitizeFilename, getExtensionForLanguage } from './text.js';
import { tempStorage } from '../shared-state.js';

/**
 * Extract long code blocks (>10 lines) from text and save them to temp storage as separate files.
 * Returns { processedText, extractedFiles }.
 */
export async function extractLongCodeBlocks(
  text: string,
  baseName: string = 'code'
): Promise<{ processedText: string; extractedFiles: Array<{ filename: string; previewUrl: string; language: string }> }> {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let processedText = text;
  const extractedFiles: Array<{ filename: string; previewUrl: string; language: string }> = [];
  const matches: Array<{ fullMatch: string; language: string; code: string }> = [];

  // First, collect all matches (we need to iterate separately to avoid issues with replacing while matching)
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    matches.push({
      fullMatch: match[0],
      language: match[1] || 'text',
      code: match[2],
    });
  }

  // Process each code block
  let blockIndex = 0;
  for (const { fullMatch, language, code } of matches) {
    const lines = code.split('\n').length;

    // If code block has more than 10 lines, extract to separate file
    if (lines > 10) {
      blockIndex++;
      const ext = getExtensionForLanguage(language);
      const codeFilename = sanitizeFilename(`${baseName}-${blockIndex}.${ext}`);

      // Write to temp storage using TempStorage abstraction (supports S3)
      await tempStorage.writeTempFile(codeFilename, Buffer.from(code, 'utf-8'));

      const codePreviewUrl = `/api/viewer/temp/${codeFilename}`;
      extractedFiles.push({ filename: codeFilename, previewUrl: codePreviewUrl, language });

      // Replace the code block with a preview link
      const previewTag = `[preview-file:${codeFilename}](${codePreviewUrl})`;
      const replacement = `\n**Code (${language}):**\n${previewTag}\n`;
      processedText = processedText.replace(fullMatch, replacement);
    }
  }

  return { processedText, extractedFiles };
}
