import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message } from '../store';

interface MessageItemProps {
  message: Message;
}

/**
 * Memoized message item component to prevent unnecessary re-renders
 * when typing in the input field
 */
export const MessageItem = memo(function MessageItem({ message }: MessageItemProps) {
  return (
    <div
      className={`flex ${
        message.role === 'user' ? 'justify-end' : 'justify-start'
      }`}
    >
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 ${
          message.role === 'user'
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted'
        }`}
      >
        <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {message.content}
          </ReactMarkdown>
        </div>
        <p className="text-xs opacity-70 mt-1">
          {new Date(message.createdAt).toLocaleTimeString()}
        </p>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparison function for memoization
  // Only re-render if the message content or id changes
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.role === nextProps.message.role
  );
});
