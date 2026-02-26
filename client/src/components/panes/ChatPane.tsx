import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Loader2, BookmarkPlus, Check } from 'lucide-react';
import { useAuthStore, useRolesStore, useChatStore, useUIStore, type ViewerFile, type Message } from '../../store';
import { MessageItem } from '../MessageItem';
import { TopBanner } from '../TopBanner';
import { apiFetch } from '../../lib/api';
import { formatToolName, parseGoogleDriveSearchResult, parseDisplayEmailMarker } from '../../lib/chat-utils';

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
  const [pendingRoleSwitch, setPendingRoleSwitch] = useState<{ roleId: string; roleName: string } | null>(null);
  const [memoryTask, setMemoryTask] = useState<{ status: 'extracting' | 'done'; count?: number } | null>(null);
  const [chatSelection, setChatSelection] = useState<{ text: string; rect: DOMRect } | null>(null);
  const [savingMemory, setSavingMemory] = useState(false);
  const [memorySaved, setMemorySaved] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isLoadingOlderRef = useRef(false);
  const loadMoreTriggeredRef = useRef(false);
  const prevScrollHeightRef = useRef(0);
  const isRestoringScrollRef = useRef(false);
  const trimTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fillViewportFetchRef = useRef(false); // Prevent repeated auto-fetches when content doesn't fill viewport
  const MESSAGE_LIMIT = 100; // Keep only this many messages when trimming

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
      fetchMessages(currentRole.id, { limit: 50 });
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
      isRestoringScrollRef.current = true;

      // Wait for DOM to fully render new messages before restoring scroll
      // Use multiple requestAnimationFrame calls to ensure DOM is painted
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!containerRef.current) {
            isRestoringScrollRef.current = false;
            isLoadingOlderRef.current = false;
            return;
          }

          // Calculate how much the scroll height increased
          const newScrollHeight = containerRef.current.scrollHeight;
          const scrollDiff = newScrollHeight - prevScrollHeightRef.current;

          // Restore scroll position: old scroll position + the height of new content
          containerRef.current.scrollTop = scrollDiff;

          // Clean up refs after scroll is restored
          setTimeout(() => {
            isLoadingOlderRef.current = false;
            isRestoringScrollRef.current = false;
          }, 0);
        });
      });
    }
  }, [roleMessages.length]);

  // Consolidated scroll-to-bottom effect
  // Fires when: new messages, streaming content, or search mode changes
  // Skips when: loading older messages or restoring scroll position
  useEffect(() => {
    if (containerRef.current && !isLoadingOlderRef.current && !isRestoringScrollRef.current) {
      requestAnimationFrame(() => {
        if (containerRef.current && !isLoadingOlderRef.current && !isRestoringScrollRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    }
  }, [currentContent, roleMessages.length, searchResults, isSearchMode]);

  // Auto-fetch more messages when content doesn't fill the viewport (no scrollbar = scroll events never fire).
  // Runs whenever loading transitions to false. Resets its guard on every new fetch start so role switches
  // always get a fresh check.
  useEffect(() => {
    if (loading) {
      fillViewportFetchRef.current = false;
      return;
    }
    if (fillViewportFetchRef.current || !hasMore || roleMessages.length === 0) return;

    const rafId = requestAnimationFrame(() => {
      if (!containerRef.current || fillViewportFetchRef.current) return;
      const { scrollHeight, clientHeight } = containerRef.current;
      if (scrollHeight <= clientHeight) {
        fillViewportFetchRef.current = true;
        // Don't set isLoadingOlderRef — we want scroll-to-bottom (not restore) after prepend
        fetchMessages(activeRoleId, { before: roleMessages[0].id, limit: 50 });
      }
    });

    return () => cancelAnimationFrame(rafId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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
        fetchMessages(activeRoleId, { before: oldestMessage.id, limit: 50 });
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
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          locale: navigator.language,
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

                  // Check for role switch metadata from role-manager tool
                  if (parsed.metadata?.roleSwitch) {
                    const roleSwitch = parsed.metadata.roleSwitch;
                    console.log('[ChatPane] Role switch detected:', roleSwitch);
                    // Show pending state with spinner
                    setPendingRoleSwitch({ roleId: roleSwitch.roleId, roleName: roleSwitch.roleName });

                    // Schedule the actual role switch after 3 seconds
                    setTimeout(() => {
                      const { roles } = useRolesStore.getState();
                      const targetRole = roles.find(r => r.id === roleSwitch.roleId);
                      if (targetRole) {
                        console.log('[ChatPane] Executing role switch:', targetRole.name);
                        const { switchRole } = useRolesStore.getState();
                        switchRole(targetRole, () => {})
                          .then(() => {
                            console.log('[ChatPane] Role switched successfully');
                            setPendingRoleSwitch(null);
                          })
                          .catch(err => {
                            console.error('[ChatPane] Failed to switch role:', err);
                            setPendingRoleSwitch(null);
                          });
                      } else {
                        setPendingRoleSwitch(null);
                      }
                    }, 3000);
                  }

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
                  // Include account(s) for multi-account servers
                  const toolLabel = formatToolName(parsed.toolName || 'tool');
                  const accounts: string[] | undefined = parsed.accounts;
                  const accountSuffix = accounts?.length ? ` · ${accounts.join(', ')}` : '';
                  const toolMessage = {
                    id: crypto.randomUUID(),
                    roleId: activeRoleId,
                    groupId: currentGroup?.id || null,
                    userId: user.id,
                    role: 'system' as const,
                    content: `*${toolLabel}*${accountSuffix}`,
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

                // Handle memory extraction status
                if (parsed.type === 'memory_task') {
                  if (parsed.status === 'started') {
                    setMemoryTask({ status: 'extracting' });
                  } else if (parsed.status === 'completed') {
                    setMemoryTask({ status: 'done', count: parsed.count ?? 0 });
                    setTimeout(() => setMemoryTask(null), 4000);
                  }
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

  const handleChatMouseUp = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim() ?? '';
    if (!text || text.length < 3) {
      setChatSelection(null);
      return;
    }
    if (!containerRef.current) return;
    const range = sel?.getRangeAt(0);
    if (!range || !containerRef.current.contains(range.commonAncestorContainer)) {
      setChatSelection(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    setChatSelection({ text, rect });
  };

  const handleChatMouseDown = () => {
    setChatSelection(null);
    setMemorySaved(false);
  };

  const handleSaveToMemory = async () => {
    if (!chatSelection || !activeRoleId) return;
    setSavingMemory(true);
    try {
      const res = await apiFetch(`/api/roles/${activeRoleId}/save-to-memory`, {
        method: 'POST',
        body: JSON.stringify({ text: chatSelection.text }),
      });
      const data = await res.json();
      if (data.success) {
        setMemorySaved(true);
        setChatSelection(null);
        window.getSelection()?.removeAllRanges();
        setTimeout(() => setMemorySaved(false), 2000);
      }
    } catch {
      // silent fail
    } finally {
      setSavingMemory(false);
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

      {/* Pending Role Switch Indicator */}
      {pendingRoleSwitch && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-200 flex items-center gap-3">
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
          <span className="text-sm text-blue-800">
            Switching to <strong>{pendingRoleSwitch.roleName}</strong>...
          </span>
        </div>
      )}

      {/* Messages */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        onClick={() => { if (!window.getSelection()?.toString()) inputRef.current?.focus(); }}
        onMouseUp={handleChatMouseUp}
        onMouseDown={handleChatMouseDown}
        className={`flex-1 min-h-0 overflow-y-auto p-4 space-y-2 transition-opacity duration-500 ${pendingRoleSwitch ? 'opacity-0' : 'opacity-100'}`}
      >
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

      {/* Floating "Remember" popover on text selection */}
      {chatSelection && (
        <div
          style={{
            position: 'fixed',
            top: chatSelection.rect.top - 40,
            left: chatSelection.rect.left + chatSelection.rect.width / 2,
            transform: 'translateX(-50%)',
            zIndex: 50,
          }}
        >
          <button
            onClick={handleSaveToMemory}
            disabled={savingMemory}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg shadow-lg hover:opacity-90 disabled:opacity-50 transition-opacity whitespace-nowrap"
          >
            {savingMemory ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookmarkPlus className="w-3 h-3" />}
            Remember
          </button>
        </div>
      )}

      {/* "Saved to memory" toast */}
      {memorySaved && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-green-600 text-white rounded-lg shadow-lg">
            <Check className="w-3 h-3" />
            Saved to memory
          </div>
        </div>
      )}

      {/* Memory extraction indicator */}
      {memoryTask && (
        <div className="px-4 py-0.5 text-xs text-muted-foreground/40 italic select-none">
          {memoryTask.status === 'extracting'
            ? '~ extracting insights...'
            : `~ saved ${memoryTask.count} insight${memoryTask.count !== 1 ? 's' : ''} to memory`}
        </div>
      )}

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
            aria-label="Send"
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
