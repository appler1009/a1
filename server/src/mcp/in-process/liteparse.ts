/**
 * LiteParse In-Process MCP Module
 *
 * Wraps @llamaindex/liteparse for direct in-process document parsing.
 * Replaces the external markitdown-mcp stdio server with a zero-subprocess
 * implementation that can read local files (and S3 files downloaded by the
 * URI resolver) using the same `convert_to_markdown` tool name so existing
 * agent prompts continue to work without changes.
 */

import type { InProcessMCPModule } from '../adapters/InProcessAdapter.js';
import { tempStorage } from '../../shared-state.js';

// Index signature for dynamic tool access
export class LiteParseInProcess implements InProcessMCPModule {
  [key: string]: unknown;

  getSystemPromptSummary(): string {
    return 'LiteParse — convert PDF and office documents to markdown text for AI processing.';
  }

  getTools() {
    return [
      {
        name: 'convert_to_markdown',
        description:
          'Convert a document (PDF, DOCX, XLSX, PPTX, or image) to markdown text. ' +
          'Pass the file URI (file:// or cache://) you received when the file was uploaded.',
        inputSchema: {
          type: 'object',
          properties: {
            uri: {
              type: 'string',
              description: 'The file URI or cache ID of the document to convert.',
            },
          },
          required: ['uri'],
        },
      },
    ];
  }

  async convert_to_markdown(args: Record<string, unknown>): Promise<{ type: 'text'; text: string }> {
    const uri = String(args.uri ?? '');
    if (!uri) {
      throw new Error('Missing required argument: uri');
    }

    let filePath: string;

    if (uri.startsWith('file://')) {
      // Strip file:// prefix to get the local path
      filePath = uri.replace('file://', '');
    } else if (uri.startsWith('s3://')) {
      // In-process: download from S3 via tempStorage
      const filename = uri.replace('s3://temp/', '');
      const data = await tempStorage.readTempFile(filename);
      if (!data) {
        throw new Error(`File not found in S3 storage: ${uri}`);
      }
      const { writeFileSync, mkdirSync } = await import('fs');
      const { join } = await import('path');
      const localTempDir = join(tempStorage.getAbsolutePath('..'), 'temp');
      mkdirSync(localTempDir, { recursive: true });
      const localPath = join(localTempDir, `liteparse-${Date.now()}-${filename}`);
      writeFileSync(localPath, data);
      filePath = localPath;
    } else {
      throw new Error(`Unsupported URI scheme: ${uri}`);
    }

    const { LiteParse } = await import('@llamaindex/liteparse');
    const parser = new LiteParse({ outputFormat: 'text', ocrEnabled: true });
    const result = await parser.parse(filePath, true /* quiet */);

    const text = result.text?.trim() ?? '';
    if (!text) {
      return { type: 'text', text: '(No text content extracted from document.)' };
    }

    return { type: 'text', text };
  }
}
