/**
 * Text/Markdown Preview Adapter
 *
 * Renders plain text and markdown files with syntax highlighting and formatting
 */

import React, { useState, useEffect } from 'react';
import { PreviewAdapter } from '../preview-adapters';
import { ViewerFile } from '../../store';

/**
 * Text Preview Component
 * Manages text rendering with optional markdown formatting
 */
function TextPreviewComponent({ file }: { file: ViewerFile }) {
  const [content, setContent] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fontSize, setFontSize] = useState(14);
  const wordWrap = true; // Always enabled for better readability

  useEffect(() => {
    const loadContent = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const response = await fetch(file.previewUrl);
        if (!response.ok) {
          throw new Error(`Failed to load file: ${response.statusText}`);
        }
        const text = await response.text();
        setContent(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load file');
        console.error('Error loading text file:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadContent();
  }, [file.previewUrl]);

  // Note: markdown detection available for future markdown-specific rendering
  // const isMarkdown = file.mimeType === 'text/markdown' || file.name.endsWith('.md');

  return (
    <>
      {/* Text Controls */}
      <div className="flex items-center justify-end gap-4 py-2 border-b bg-muted/30 px-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFontSize(prev => Math.max(prev - 2, 10))}
            className="px-2 py-1 text-sm rounded bg-muted hover:bg-muted/80"
            title="Decrease font size"
          >
            A−
          </button>
          <span className="text-sm w-10 text-center">{fontSize}px</span>
          <button
            onClick={() => setFontSize(prev => Math.min(prev + 2, 24))}
            className="px-2 py-1 text-sm rounded bg-muted hover:bg-muted/80"
            title="Increase font size"
          >
            A+
          </button>
        </div>
      </div>

      {/* Text Viewer */}
      <div className="flex-1 overflow-auto p-4">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <p className="text-muted-foreground">Loading file...</p>
          </div>
        )}

        {error && (
          <div className="flex items-center justify-center h-full">
            <p className="text-destructive">{error}</p>
          </div>
        )}

        {!isLoading && !error && (
          <pre
            style={{
              fontSize: `${fontSize}px`,
              whiteSpace: wordWrap ? 'pre-wrap' : 'pre',
              wordBreak: wordWrap ? 'break-word' : 'normal',
              fontFamily: 'monospace',
            }}
            className="text-foreground"
          >
            {content}
          </pre>
        )}
      </div>
    </>
  );
}

/**
 * Text Preview Adapter
 * Handles text/plain, text/markdown, and other text-based MIME types
 */
export class TextPreviewAdapter implements PreviewAdapter {
  readonly id = 'text-preview';
  readonly name = 'Text Viewer';

  canHandle(file: ViewerFile): boolean {
    // Don't handle application/json if it looks like an email
    if (file.mimeType === 'application/json') {
      const nameLower = file.name.toLowerCase();
      if (nameLower.includes('email')) {
        return false; // Let EmailPreviewAdapter handle it
      }
      return true; // Generic JSON file
    }

    return (
      file.mimeType.startsWith('text/') ||
      file.mimeType === 'application/xml'
    );
  }

  render(file: ViewerFile): React.ReactNode {
    return <TextPreviewComponent file={file} />;
  }
}
