import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuthStore, useRolesStore, useChatStore, useUIStore, type ViewerFile } from '../../store';

/**
 * Parse Google Drive search result to extract PDF files
 * Format: "Report.pdf (ID: abc123, application/pdf)"
 */
function parseGoogleDriveSearchResult(result: string): { id: string; name: string; mimeType: string; previewUrl: string } | null {
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
 * Parse preview file tags from model response
 * Format: [preview-file:filename.ext](url) or <preview-file name="filename.ext" url="..." type="mime-type" />
 */
function parsePreviewFileTags(content: string): Array<{ name: string; url: string; mimeType: string }> {
  console.log('[PreviewFile] Parsing content for preview file tags...');
  const files: Array<{ name: string; url: string; mimeType: string }> = [];
  
  // Parse markdown-style tag: [preview-file:filename.ext](url)
  const markdownRegex = /\[preview-file:([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownRegex.exec(content)) !== null) {
    const [, name, url] = match;
    // Determine mime type from extension
    const ext = name.split('.').pop()?.toLowerCase() || '';
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      html: 'text/html',
    };
    console.log(`[PreviewFile] Found preview-file tag: name="${name}", url="${url}"`);
    files.push({
      name: name.trim(),
      url: url.trim(),
      mimeType: mimeTypes[ext] || 'application/octet-stream',
    });
  }
  
  // Parse HTML-style tag: <preview-file name="..." url="..." type="..." />
  const htmlRegex = /<preview-file\s+name="([^"]+)"\s+url="([^"]+)"(?:\s+type="([^"]+)")?\s*\/?>/gi;
  while ((match = htmlRegex.exec(content)) !== null) {
    const [, name, url, type] = match;
    console.log(`[PreviewFile] Found HTML preview-file tag: name="${name}", url="${url}", type="${type}"`);
    files.push({
      name: name.trim(),
      url: url.trim(),
      mimeType: type?.trim() || 'application/octet-stream',
    });
  }
  
  // Fallback: Auto-detect Google Drive PDF links and convert them
  // Match: https://drive.google.com/file/d/FILE_ID/view or /view?usp=sharing
  const gdriveViewRegex = /https:\/\/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)(?:\/view|\S*)?/g;
  while ((match = gdriveViewRegex.exec(content)) !== null) {
    const fileId = match[1];
    const originalUrl = match[0];
    const downloadUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    console.log(`[PreviewFile] Detected Google Drive link: ${originalUrl}`);
    console.log(`[PreviewFile] Converting to download URL: ${downloadUrl}`);
    // Check if this file wasn't already added via preview-file tag
    if (!files.some(f => f.url.includes(fileId))) {
      console.log(`[PreviewFile] Adding auto-detected file: document-${fileId.substring(0, 8)}.pdf`);
      files.push({
        name: `document-${fileId.substring(0, 8)}.pdf`,
        url: downloadUrl,
        mimeType: 'application/pdf',
      });
    } else {
      console.log(`[PreviewFile] Skipping duplicate file (already in list): ${fileId}`);
    }
  }
  
  console.log(`[PreviewFile] Total files found: ${files.length}`);
  return files;
}

/**
 * Download file to temp directory and get preview URL
 */
async function downloadFileForPreview(url: string, filename: string, mimeType: string): Promise<ViewerFile | null> {
  console.log(`[PreviewFile] Downloading file for preview...`);
  console.log(`[PreviewFile]   URL: ${url}`);
  console.log(`[PreviewFile]   Filename: ${filename}`);
  console.log(`[PreviewFile]   MIME Type: ${mimeType}`);
  
  try {
    const response = await fetch('/api/viewer/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ url, filename, mimeType }),
    });
    
    if (!response.ok) {
      console.error(`[PreviewFile] Failed to download file: ${response.status} ${response.statusText}`);
      return null;
    }
    
    const data = await response.json();
    if (data.success && data.data) {
      console.log(`[PreviewFile] File downloaded successfully!`);
      console.log(`[PreviewFile]   ID: ${data.data.id}`);
      console.log(`[PreviewFile]   Name: ${data.data.name}`);
      console.log(`[PreviewFile]   Preview URL: ${data.data.previewUrl}`);
      console.log(`[PreviewFile]   Size: ${data.data.size} bytes`);
      return {
        id: data.data.id,
        name: data.data.name,
        mimeType: data.data.mimeType,
        previewUrl: data.data.previewUrl,
      };
    }
    console.error('[PreviewFile] Download response was not successful:', data);
    return null;
  } catch (error) {
    console.error('[PreviewFile] Error downloading file for preview:', error);
    return null;
  }
}

export function ChatPane() {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const { user, currentGroup } = useAuthStore();
  const { currentRole } = useRolesStore();
  const { messages, streaming, currentContent, addMessage, setStreaming, setCurrentContent, clearMessages } = useChatStore();
  const { setViewerFile, setViewerTab } = useUIStore();

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      if (messagesContainerRef.current) {
        const container = messagesContainerRef.current;
        container.scrollTop = container.scrollHeight;
      }
    });
    // Fallback with setTimeout
    setTimeout(() => {
      if (messagesContainerRef.current) {
        const container = messagesContainerRef.current;
        container.scrollTop = container.scrollHeight;
      }
    }, 100);
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
        credentials: 'include',
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

                // Handle error messages
                if (parsed.type === 'error' || parsed.error) {
                  const errorMessage = parsed.message || parsed.error;
                  fullContent = `❌ **Error**: ${errorMessage}`;
                  setCurrentContent(fullContent);
                  break;
                }

                // Handle regular content
                if (parsed.content) {
                  fullContent += parsed.content;
                  setCurrentContent(fullContent);
                }

                // Handle info messages
                if (parsed.type === 'info' && parsed.message) {
                  fullContent += `\n\n*${parsed.message}*`;
                  setCurrentContent(fullContent);
                }

                // Handle tool results - check for PDFs from Google Drive
                if (parsed.type === 'tool_result' && parsed.result) {
                  const pdfFile = parseGoogleDriveSearchResult(parsed.result);
                  if (pdfFile) {
                    // PDF found - update viewer
                    setViewerFile({ ...pdfFile, serverId: parsed.serverId });
                    // Switch to the MCP server tab that found the PDF
                    if (parsed.serverId) {
                      setViewerTab(`mcp-${parsed.serverId}`);
                    }
                  }
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

        // Check for preview file tags in the response and download them
        console.log('[PreviewFile] Checking response for preview file tags...');
        const previewFiles = parsePreviewFileTags(fullContent);
        if (previewFiles.length > 0) {
          console.log(`[PreviewFile] Found ${previewFiles.length} file(s) to preview`);
          // Download the first file for preview
          const file = previewFiles[0];
          console.log(`[PreviewFile] Processing first file: ${file.name}`);
          const viewerFile = await downloadFileForPreview(file.url, file.name, file.mimeType);
          if (viewerFile) {
            console.log('[PreviewFile] Setting viewer file and switching to preview tab...');
            setViewerFile(viewerFile);
            setViewerTab('preview');
            console.log(`[PreviewFile] File "${viewerFile.name}" should now be displayed in the preview pane!`);
          } else {
            console.error('[PreviewFile] Failed to get viewer file - preview not displayed');
          }
        } else {
          console.log('[PreviewFile] No preview files found in response');
        }
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
    <div className="flex flex-col h-full w-full overflow-hidden">
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
      <div ref={messagesContainerRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
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