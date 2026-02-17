import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useAuthStore, useRolesStore, useChatStore } from '../../store';

export function ChatPane() {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  const { user, currentGroup } = useAuthStore();
  const { currentRole } = useRolesStore();
  const { messages, streaming, currentContent, addMessage, setStreaming, setCurrentContent, clearMessages } = useChatStore();

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentContent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming || !user) return;

    const userMessage = {
      id: crypto.randomUUID(),
      roleId: currentRole?.id || 'default',
      groupId: currentGroup?.id || null,
      userId: user.id,
      role: 'user' as const,
      content: input.trim(),
      createdAt: new Date().toISOString(),
    };

    addMessage(userMessage);
    setInput('');
    setStreaming(true);
    setCurrentContent('');

    try {
      const response = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          roleId: currentRole?.id,
          groupId: currentGroup?.id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (reader) {
        let fullContent = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') {
                break;
              }
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  fullContent += parsed.content;
                  setCurrentContent(fullContent);
                }
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }

        const assistantMessage = {
          id: crypto.randomUUID(),
          roleId: currentRole?.id || 'default',
          groupId: currentGroup?.id || null,
          userId: user.id,
          role: 'assistant' as const,
          content: fullContent,
          createdAt: new Date().toISOString(),
        };

        addMessage(assistantMessage);
      }
    } catch (error) {
      console.error('Chat error:', error);
    } finally {
      setStreaming(false);
      setCurrentContent('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const roleMessages = messages.filter(
    (m) => m.roleId === (currentRole?.id || 'default')
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="h-12 border-b border-border flex items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="font-medium">
            {currentRole?.name || 'Default Chat'}
          </span>
          {currentRole?.model && (
            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
              {currentRole.model}
            </span>
          )}
        </div>
        <button
          onClick={clearMessages}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {roleMessages.length === 0 && !streaming && (
          <div className="text-center text-muted-foreground py-8">
            <p>Start a conversation</p>
            {currentRole?.jobDesc && (
              <p className="text-sm mt-2">{currentRole.jobDesc}</p>
            )}
          </div>
        )}

        {roleMessages.map((message) => (
          <div
            key={message.id}
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
              <p className="whitespace-pre-wrap">{message.content}</p>
              <p className="text-xs opacity-70 mt-1">
                {new Date(message.createdAt).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}

        {streaming && currentContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted">
              <p className="whitespace-pre-wrap">{currentContent}</p>
            </div>
          </div>
        )}

        {streaming && !currentContent && (
          <div className="flex justify-start">
            <div className="max-w-[80%] rounded-lg px-4 py-2 bg-muted">
              <Loader2 className="w-4 h-4 animate-spin" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-border">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 bg-muted rounded-lg px-4 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary"
            rows={1}
            disabled={streaming}
          />
          <button
            type="submit"
            disabled={!input.trim() || streaming}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </form>
    </div>
  );
}