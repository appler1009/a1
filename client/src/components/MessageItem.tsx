import { memo, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../store';
import { useUIStore, type ViewerFile } from '../store';

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

  // Escape special regex characters
  const escapedKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedKeyword})`, 'gi');
  const parts = children.split(regex);

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
    // Determine mime type from extension
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      html: 'text/html',
    };
    const mimeType = mimeTypes[ext] || 'application/octet-stream';

    try {
      const response = await fetch('/api/viewer/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
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

  return (
    <div
      data-message-id={message.id}
      className={`flex ${
        message.role === 'user' ? 'justify-end' : 'justify-start'
      }`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          message.role === 'user'
            ? 'bg-primary text-primary-foreground'
            : message.role === 'system'
            ? 'bg-transparent text-xs italic text-muted-foreground'
            : 'bg-muted'
        }`}
      >
        <div className={`prose prose-sm dark:prose-invert max-w-none ${message.role === 'system' ? 'leading-[1.5]' : 'leading-[2]'}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              // Highlight keywords in text nodes
              text: ({ children }) => (
                <TextWithHighlight keyword={highlightKeyword}>
                  {children}
                </TextWithHighlight>
              ),
              a: ({ href, children, ...props }) => {
                // Check if this is a preview-file link
                // Format: [preview-file:filename.ext](url)
                const linkText = children?.toString() || '';
                if (linkText.startsWith('preview-file:')) {
                  const filename = linkText.replace('preview-file:', '');
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
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>
        {message.role !== 'system' && (
          <p className="text-xs opacity-70 mt-1">
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
    prevProps.message.role === nextProps.message.role &&
    prevProps.highlightKeyword === nextProps.highlightKeyword
  );
});
