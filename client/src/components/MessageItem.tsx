import { memo, ReactNode, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../store';

const remarkPlugins = [remarkGfm];
import { useUIStore, type ViewerFile } from '../store';
import { apiFetch } from '../lib/api';

interface MessageItemProps {
  message: Message;
  highlightKeyword?: string;
}

/**
 * Process text nodes to highlight keywords
 */
function TextWithHighlight({ children, keyword }: { children: ReactNode; keyword?: string }) {
  if (!keyword || typeof children !== 'string') {
    return <>{children}</>;
  }

  // Memoize highlighted parts to avoid re-splitting on every render
  const parts = useMemo(() => {
    const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`(${escapedKeyword})`, 'gi');
    return children.split(regex);
  }, [children, keyword]);

  return (
    <>
      {parts.map((part, index) => {
        if (part.toLowerCase() === keyword.toLowerCase()) {
          return (
            <mark key={index} className="bg-yellow-200 dark:bg-yellow-700 text-inherit rounded px-0.5">
              {part}
            </mark>
          );
        }
        return part;
      })}
    </>
  );
}

/**
 * Memoized message item component to prevent unnecessary re-renders
 * when typing in the input field
 */
export const MessageItem = memo(function MessageItem({ message, highlightKeyword }: MessageItemProps) {
  const { setViewerFile, setViewerTab } = useUIStore();

  // Handle preview-file links by downloading and displaying in preview pane
  const handlePreviewFileClick = async (filename: string, url: string) => {
    // Import and use the centralized MIME type detection
    const { getMimeTypeFromExtension } = await import('../lib/preview-adapters');
    const mimeType = getMimeTypeFromExtension(filename);

    try {
      const response = await apiFetch('/api/viewer/download', {
        method: 'POST',
        body: JSON.stringify({ url, filename, mimeType }),
      });

      if (!response.ok) {
        console.error('Failed to download file for preview');
        return;
      }

      const data = await response.json();
      if (data.success && data.data) {
        const viewerFile: ViewerFile = {
          id: data.data.id,
          name: data.data.name,
          mimeType: data.data.mimeType,
          previewUrl: data.data.previewUrl,
          sourceUrl: url,  // Store original URL for "open in new window"
        };
        setViewerFile(viewerFile);
        setViewerTab('preview');
      }
    } catch (error) {
      console.error('Error downloading file for preview:', error);
    }
  };

  const isToolCall = message.from === 'tool';

  // Memoize markdown components to avoid recreating them on every render
  const markdownComponents = useMemo(() => ({
    text: ({ children }: { children: ReactNode }) => (
      <TextWithHighlight keyword={highlightKeyword}>
        {children}
      </TextWithHighlight>
    ),
    a: ({ href, children, ...props }: any) => {
      // Check if this is a preview-file link
      // Format: [preview-file:filename.ext](url)
      const linkText = children?.toString() || '';
      if (linkText.startsWith('preview-file:')) {
        let filename = linkText.replace('preview-file:', '');
        // Only remove .json extension for email cache files (not Google Drive .json files)
        // Email cache URLs contain "_email" in the cache ID pattern (e.g., gmail_email, outlook_email)
        const isEmailCache = href?.toLowerCase().includes('_email');
        if (isEmailCache && filename.toLowerCase().endsWith('.json') && filename.length > 5) {
          filename = filename.slice(0, -5);
        }
        return (
          <button
            onClick={() => handlePreviewFileClick(filename, href || '')}
            className="text-blue-500 hover:text-blue-600 underline cursor-pointer bg-transparent border-0 p-0 font-inherit"
          >
            {filename}
          </button>
        );
      }
      // Regular link
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
          {children}
        </a>
      );
    },
  } as any), [highlightKeyword, handlePreviewFileClick]);

  return (
    <div
      data-message-id={message.id}
      className={`flex ${
        message.from === 'user' ? 'justify-end' : 'justify-start'
      } ${isToolCall ? '-my-2' : ''}`}
    >
      <div
        className={`max-w-[80%] rounded-lg ${
          message.from === 'user'
            ? 'bg-primary text-primary-foreground px-4 py-2'
            : isToolCall
            ? 'bg-transparent text-xs italic text-muted-foreground leading-none'
            : 'bg-muted px-4 py-2'
        }`}
      >
        <div className={isToolCall ? 'system-message' : `prose prose-sm dark:prose-invert max-w-none leading-[1.5]`}>
          <ReactMarkdown
            remarkPlugins={remarkPlugins}
            components={markdownComponents}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        {!isToolCall && (
          <p className="text-xs opacity-70 mt-1 mb-0">
            {new Date(message.createdAt).toLocaleTimeString()}
          </p>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for memoization
  // Only re-render if the message content or id changes
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.from === nextProps.message.from &&
    prevProps.highlightKeyword === nextProps.highlightKeyword
  );
});
