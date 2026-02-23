import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2 } from 'lucide-react';
import { useAuthStore, useRolesStore, useChatStore, useUIStore, type ViewerFile, type Message } from '../../store';
import { MessageItem } from '../MessageItem';
import { TopBanner } from '../TopBanner';
import { apiFetch } from '../../lib/api';

/**
 * Format tool name for display: converts camelCase to words, underscores to spaces, lowercase, italic
 * Examples:
 * - "gmailSearchMessages" → "gmail search messages"
 * - "search_tool" → "search tool"
 * - "googleDriveListFiles" → "google drive list files"
 */
function formatToolName(toolName: string): string {
  // Insert space before uppercase letters (camelCase to words)
  let formatted = toolName.replace(/([A-Z])/g, ' $1');
  // Replace underscores with spaces
  formatted = formatted.replace(/_/g, ' ');
  // Lowercase everything
  formatted = formatted.toLowerCase();
  // Remove extra spaces and trim
  formatted = formatted.replace(/\s+/g, ' ').trim();
  return formatted;
}

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
 * Extract email data from display_email tool marker
 * Format: ___DISPLAY_EMAIL__{json}___END_DISPLAY_EMAIL___
 */
function parseDisplayEmailMarker(result: string): { id: string; name: string; mimeType: string; previewUrl: string } | null {
  console.log('[DisplayEmail] Attempting to parse email marker from result:', result.substring(0, 150));

  const match = result.match(/___DISPLAY_EMAIL___(.*?)___END_DISPLAY_EMAIL___/s);
  if (!match || !match[1]) {
    console.log('[DisplayEmail] No marker found in result');
    return null;
  }

  console.log('[DisplayEmail] Marker found, parsing JSON...');
  try {
    const emailData = JSON.parse(match[1]);
    console.log('[DisplayEmail] Successfully parsed email data:', { subject: emailData.subject, from: emailData.from });

    // Determine what type of email data we have
    let emailName = 'Email';
    if (emailData.subject) {
      emailName = emailData.subject;
    } else if (emailData.messages && emailData.messages.length > 0) {
      emailName = emailData.messages[0].subject || 'Email Thread';
    }

    return {
      id: emailData.id || crypto.randomUUID(),
      name: emailName,
      mimeType: 'message/rfc822',
      previewUrl: `data:message/rfc822;base64,${btoa(match[1])}`,
    };
  } catch (error) {
    console.error('[DisplayEmail] Failed to parse email marker:', error);
    return null;
  }
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
    const response = await apiFetch('/api/viewer/download', {
      method: 'POST',
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
      console.log(`[PreviewFile]   File URI: ${data.data.fileUri}`);
      console.log(`[PreviewFile]   Size: ${data.data.size} bytes`);
      return {
        id: data.data.id,
        name: data.data.name,
        mimeType: data.data.mimeType,
        previewUrl: data.data.previewUrl,
        sourceUrl: url,  // Store original URL for "open in new window"
        fileUri: data.data.fileUri,  // Local file:// URI for MCP tools
        absolutePath: data.data.absolutePath,  // Absolute path for MCP tools
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
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [searchResults, setSearchResults] = useState<Message[]>([]);
  const [searchKeyword, setSearchKeyword] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isLoadingOlderRef = useRef(false);
  const loadMoreTriggeredRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const trimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MESSAGE_LIMIT = 10; // Keep only this many messages when trimming

  const { user, currentGroup } = useAuthStore();
  const { currentRole, currentRoleId: storedRoleId, rolesLoaded } = useRolesStore();
  const {
    messages,
    streaming,
    currentContent,
    hasMore,
    loading,
    migrated,
    addMessage,
    setStreaming,
    setCurrentContent,
    fetchMessages,
    migrateFromLocalStorage,
    clearServerMessages,
    trimMessages,
  } = useChatStore();
  const { setViewerFile, setViewerTab, viewerFile } = useUIStore();

  // Use currentRole.id if available, fallback to stored role ID, then 'default'
  const activeRoleId = currentRole?.id || storedRoleId || 'default';

  // Handle search results
  const handleSearchResults = useCallback((results: Message[], keyword: string) => {
    setSearchResults(results);
    setSearchKeyword(keyword);
    setIsSearchMode(true);
  }, []);

  // Clear search and return to normal chat view
  const handleClearSearch = useCallback(() => {
    setIsSearchMode(false);
    setSearchResults([]);
    setSearchKeyword('');
  }, []);

  // Migrate localStorage messages on first load
  useEffect(() => {
    if (!migrated) {
      migrateFromLocalStorage();
    }
  }, [migrated, migrateFromLocalStorage]);

  // Fetch messages only after roles are loaded and we have a valid currentRole
  useEffect(() => {
    // Wait for roles to be loaded from server before fetching messages
    if (!rolesLoaded) {
      console.log('[ChatPane] Waiting for roles to load...');
      return;
    }
    
    // Only fetch if we have a valid currentRole (not 'default')
    if (currentRole?.id) {
      console.log('[ChatPane] Roles loaded, fetching messages for role:', currentRole.id);
      fetchMessages(currentRole.id, { limit: 10 });
    } else {
      console.log('[ChatPane] No current role set, skipping message fetch');
    }
  }, [rolesLoaded, currentRole?.id, fetchMessages]);

  // Filter messages for current role
  const roleMessages = messages.filter(
    (m) => m.roleId === activeRoleId
  );

  // Maintain scroll position when older messages are prepended
  useEffect(() => {
    if (containerRef.current && isLoadingOlderRef.current) {
      // Wait for the scroll bounce to settle (scrollTop >= 0) before restoring position
      const checkAndRestore = () => {
        if (!containerRef.current) return;
        
        const { scrollTop } = containerRef.current;
        
        // If still in bounce (negative scrollTop), wait and check again
        if (scrollTop < 0) {
          requestAnimationFrame(checkAndRestore);
          return;
        }
        
        // Bounce has settled, now restore scroll position
        const newScrollHeight = containerRef.current.scrollHeight;
        const scrollDiff = newScrollHeight - prevScrollHeightRef.current;
        containerRef.current.scrollTop = scrollDiff;
        isLoadingOlderRef.current = false;
      };
      
      // Start checking after a small delay to let the bounce start
      const timeoutId = setTimeout(() => {
        requestAnimationFrame(checkAndRestore);
      }, 50);
      
      return () => clearTimeout(timeoutId);
    }
  }, [roleMessages.length]);

  // Scroll to bottom when new messages arrive (not when loading older)
  useEffect(() => {
    if (containerRef.current && !isLoadingOlderRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [currentContent]);

  // Scroll to bottom when any new message is added (user, assistant, or system/MCP)
  useEffect(() => {
    if (containerRef.current && !isLoadingOlderRef.current && roleMessages.length > 0) {
      // Small delay to ensure DOM is updated with the new message
      requestAnimationFrame(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [roleMessages.length]);

  // Scroll to bottom when search mode changes or search results update
  useEffect(() => {
    if (containerRef.current) {
      // Small delay to ensure DOM is updated
      const timer = setTimeout(() => {
        if (containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [searchResults, isSearchMode]);

  // Handle scroll to detect when user scrolls to top and auto-load more messages
  // Also detect when user is at bottom to trigger message trimming
  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      // Consider "scrolled to top" when within 50px of the top
      const atTop = scrollTop < 50;
      // Consider "at bottom" when within 100px of the bottom
      const atBottom = scrollTop + clientHeight >= scrollHeight - 100;
      
      // Auto-load older messages when hitting the top
      // Use loadMoreTriggeredRef to prevent multiple calls during the same scroll-to-top event
      if (atTop && hasMore && !loading && roleMessages.length > 0 && !isLoadingOlderRef.current && !loadMoreTriggeredRef.current) {
        loadMoreTriggeredRef.current = true;
        isLoadingOlderRef.current = true;
        // Save current scroll height before loading
        prevScrollHeightRef.current = scrollHeight;
        const oldestMessage = roleMessages[0];
        fetchMessages(activeRoleId, { before: oldestMessage.id, limit: 10 });
      }
      
      // Reset the trigger when user scrolls away from top
      if (!atTop) {
        loadMoreTriggeredRef.current = false;
      }
      
      // Trim messages when user is at the bottom and has extra messages loaded
      // Only trim in-memory, not from database
      if (atBottom && roleMessages.length > MESSAGE_LIMIT * 2) {
        // Clear any existing timeout
        if (trimTimeoutRef.current) {
          clearTimeout(trimTimeoutRef.current);
        }
        // Set a new timeout to trim after 10 seconds of being at bottom
        trimTimeoutRef.current = setTimeout(() => {
          trimMessages(activeRoleId, MESSAGE_LIMIT);
          trimTimeoutRef.current = null;
        }, 10000);
      } else if (!atBottom && trimTimeoutRef.current) {
        // Cancel trim if user scrolls away from bottom
        clearTimeout(trimTimeoutRef.current);
        trimTimeoutRef.current = null;
      }
    }
  }, [hasMore, loading, roleMessages, activeRoleId, fetchMessages, trimMessages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || streaming || !user) return;

    const userMessage = {
      id: crypto.randomUUID(),
      roleId: activeRoleId,
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
      const response = await apiFetch('/api/chat/stream', {
        method: 'POST',
        body: JSON.stringify({
          messages: [...roleMessages, userMessage].map((m) => ({
            role: m.role,
            content: m.content,
          })),
          roleId: currentRole?.id,
          groupId: currentGroup?.id,
          viewerFile: viewerFile ? {
            id: viewerFile.id,
            name: viewerFile.name,
            mimeType: viewerFile.mimeType,
            previewUrl: viewerFile.previewUrl,
            fileUri: viewerFile.fileUri,
            absolutePath: viewerFile.absolutePath,
          } : null,
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
                  fullContent = `**Error**: ${errorMessage}`;
                  setCurrentContent(fullContent);
                  break;
                }

                // Handle regular content
                if (parsed.content) {
                  fullContent += parsed.content;
                  setCurrentContent(fullContent);
                }

                // Handle tool call - save current content as a message and prepare for next response
                if (parsed.type === 'tool_call' && parsed.toolCall) {
                  // If we have content before the tool call, save it as a message
                  if (fullContent.trim()) {
                    const partialMessage = {
                      id: crypto.randomUUID(),
                      roleId: activeRoleId,
                      groupId: currentGroup?.id || null,
                      userId: user.id,
                      role: 'assistant' as const,
                      content: fullContent.trim(),
                      createdAt: new Date().toISOString(),
                    };
                    addMessage(partialMessage);
                    fullContent = '';
                    setCurrentContent('');
                  }
                }

                // Handle tool results - display as system message and prepare for next response
                if (parsed.type === 'tool_result' && parsed.result) {
                  console.log('[ChatPane] Tool result received:', { toolName: parsed.toolName, resultPreview: parsed.result.substring(0, 100) });

                  // Check for emails from display_email tool
                  const emailFile = parseDisplayEmailMarker(parsed.result);
                  if (emailFile) {
                    console.log('[ChatPane] Email marker detected, setting viewer file:', emailFile.name);
                    // Email found - update viewer
                    setViewerFile({
                      ...emailFile,
                      serverId: parsed.serverId,
                    });
                    // Switch to the preview tab
                    if (parsed.serverId) {
                      setViewerTab(`mcp-${parsed.serverId}`);
                    }
                  } else {
                    console.log('[ChatPane] No email marker found in tool result');
                  }

                  // Check for PDFs from Google Drive
                  const pdfFile = parseGoogleDriveSearchResult(parsed.result);
                  if (pdfFile) {
                    // PDF found - update viewer
                    setViewerFile({
                      ...pdfFile,
                      serverId: parsed.serverId,
                      sourceUrl: pdfFile.previewUrl,  // Store original URL for "open in new window"
                    });
                    // Switch to the MCP server tab that found the PDF
                    if (parsed.serverId) {
                      setViewerTab(`mcp-${parsed.serverId}`);
                    }
                  }
                  
                  // Add tool call as a compact system message with friendly formatted tool name
                  const toolMessage = {
                    id: crypto.randomUUID(),
                    roleId: activeRoleId,
                    groupId: currentGroup?.id || null,
                    userId: user.id,
                    role: 'system' as const,
                    content: `*${formatToolName(parsed.toolName || 'tool')}*`,
                    createdAt: new Date().toISOString(),
                  };
                  addMessage(toolMessage);
                  
                  // Reset for next assistant response
                  fullContent = '';
                  setCurrentContent('');
                }

                // Handle info messages
                if (parsed.type === 'info' && parsed.message) {
                  fullContent += `\n\n*${parsed.message}*`;
                  setCurrentContent(fullContent);
                }
              } catch {
                // Skip invalid JSON
              }
            }
          }
        }

        // Save final assistant message if there's content
        if (fullContent.trim()) {
          const assistantMessage = {
            id: crypto.randomUUID(),
            roleId: activeRoleId,
            groupId: currentGroup?.id || null,
            userId: user.id,
            role: 'assistant' as const,
            content: fullContent,
            createdAt: new Date().toISOString(),
          };

          addMessage(assistantMessage);
        }

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

  // Auto-resize textarea up to 5 lines
  useEffect(() => {
    const textarea = inputRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Calculate line height (approximately 24px per line with py-2 and text)
      const lineHeight = 24;
      const maxHeight = lineHeight * 5;
      // Set height to scrollHeight, capped at maxHeight
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, [input]);

  const handleClear = async () => {
    const confirmed = window.confirm('Are you sure you want to delete all chat messages for this role? This action cannot be undone.');
    if (!confirmed) return;
    
    await clearServerMessages(activeRoleId);
  };

  // Cleanup trim timeout on unmount
  useEffect(() => {
    return () => {
      if (trimTimeoutRef.current) {
        clearTimeout(trimTimeoutRef.current);
      }
    };
  }, []);

  // Debug: Log role info on every render
  useEffect(() => {
    console.log('[ChatPane] Debug Info:');
    console.log('  - activeRoleId:', activeRoleId);
    console.log('  - currentRole:', currentRole?.id, currentRole?.name);
    console.log('  - storedRoleId:', storedRoleId);
    console.log('  - rolesLoaded:', rolesLoaded);
    console.log('  - roleMessages.length:', roleMessages.length);
  }, [activeRoleId, currentRole, storedRoleId, rolesLoaded, roleMessages.length]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Debug Banner - Show current role ID */}
      <div className="px-4 py-1 bg-yellow-100 border-b border-yellow-300 text-xs text-yellow-800 font-mono">
        <span>Role ID: <strong>{activeRoleId}</strong></span>
        {currentRole && <span className="ml-3">| Role: <strong>{currentRole.name}</strong></span>}
        {rolesLoaded ? <span className="ml-3 text-green-600">✓ Loaded</span> : <span className="ml-3 text-red-600">⟳ Loading...</span>}
      </div>

      {/* Top Banner */}
      <TopBanner
        roleId={activeRoleId}
        onSearchResults={handleSearchResults}
        onClearSearch={handleClearSearch}
        isSearchMode={isSearchMode}
        onClearHistory={handleClear}
        clearHistoryLabel="Clear History"
      />

      {/* Messages */}
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
        {/* Search Mode - Show search results */}
        {isSearchMode && (
          <>
            {searchResults.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <p>No messages found for "{searchKeyword}"</p>
              </div>
            ) : (
              searchResults.map((message) => (
                <MessageItem
                  key={message.id}
                  message={message}
                  highlightKeyword={searchKeyword}
                />
              ))
            )}
          </>
        )}

        {/* Normal Mode - Show regular messages */}
        {!isSearchMode && (
          <>
            {roleMessages.length === 0 && !streaming && (
              <div className="text-center text-muted-foreground py-8">
                <p>Start a conversation</p>
                {currentRole?.jobDesc && (
                  <p className="text-sm mt-2">{currentRole.jobDesc}</p>
                )}
              </div>
            )}

            {roleMessages.map((message) => (
              <MessageItem key={message.id} message={message} />
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
          </>
        )}
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
            className="flex-1 bg-muted rounded-lg px-4 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-primary overflow-y-auto"
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
