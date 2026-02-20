import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, Trash2, ExternalLink } from 'lucide-react';
import type { Message } from '../store';

interface TopBannerProps {
  // Search functionality
  roleId?: string;
  onSearchResults?: (results: Message[], keyword: string) => void;
  onClearSearch?: () => void;
  isSearchMode?: boolean;
  
  // Clear history
  onClearHistory?: () => void;
  clearHistoryLabel?: string;
  
  // Open in new window
  sourceUrl?: string;
  openInNewWindowLabel?: string;
  
  // File name to display on the left
  fileName?: string;
  
  // Additional actions can be passed as children
  children?: React.ReactNode;
}

export function TopBanner({
  roleId,
  onSearchResults,
  onClearSearch,
  isSearchMode,
  onClearHistory,
  clearHistoryLabel = 'Clear History',
  sourceUrl,
  openInNewWindowLabel = 'Open in New Window',
  fileName,
  children,
}: TopBannerProps) {
  const [keyword, setKeyword] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Search messages
  const searchMessages = useCallback(async (searchKeyword: string) => {
    if (!roleId || !onSearchResults || !onClearSearch) return;
    
    if (!searchKeyword.trim()) {
      onClearSearch();
      return;
    }

    setIsSearching(true);
    try {
      const params = new URLSearchParams({
        keyword: searchKeyword,
        roleId,
        limit: '100',
      });
      
      const response = await fetch(`/api/messages/search?${params}`, {
        credentials: 'include',
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          onSearchResults(data.data as Message[], searchKeyword);
        }
      }
    } catch (error) {
      console.error('Failed to search messages:', error);
    } finally {
      setIsSearching(false);
    }
  }, [roleId, onSearchResults, onClearSearch]);

  // Debounced search
  useEffect(() => {
    if (!onSearchResults) return;
    
    const timer = setTimeout(() => {
      if (keyword.trim()) {
        searchMessages(keyword);
      } else if (isSearchMode && onClearSearch) {
        onClearSearch();
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [keyword, searchMessages, isSearchMode, onSearchResults, onClearSearch]);

  const handleClearSearch = () => {
    setKeyword('');
    if (onClearSearch) {
      onClearSearch();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      handleClearSearch();
      inputRef.current?.blur();
    }
  };

  const handleOpenInNewWindow = () => {
    if (sourceUrl) {
      window.open(sourceUrl, '_blank', 'noopener,noreferrer');
    }
  };

  const hasSearch = roleId && onSearchResults && onClearSearch;

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-card border-b border-border h-11 shrink-0">
      {/* File Name - Display on the left for viewer pane */}
      {fileName && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate max-w-[500px]" title={fileName}>
            {fileName}
          </span>
        </div>
      )}
      
      {/* Search Section - Always visible when search is available */}
      {hasSearch && (
        <div className="flex items-center gap-1">
          {/* Search Icon */}
          <Search className={`w-4 h-4 text-muted-foreground ${isSearching ? 'animate-pulse' : ''}`} />
          
          {/* Search Input - Always visible */}
          <input
            ref={inputRef}
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search messages..."
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck="false"
            className="w-40 bg-background border border-border rounded-md px-2 py-0.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary leading-normal"
          />
          
          {/* Clear button */}
          {keyword.length > 0 && (
            <button
              onClick={handleClearSearch}
              className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right Side Actions */}
      <div className="flex items-center gap-1">
        {/* Clear History Button */}
        {onClearHistory && (
          <button
            onClick={onClearHistory}
            className="flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
            title={clearHistoryLabel}
          >
            <Trash2 className="w-4 h-4" />
            <span className="text-xs hidden sm:inline">{clearHistoryLabel}</span>
          </button>
        )}

        {/* Open in New Window Button */}
        {sourceUrl && (
          <button
            onClick={handleOpenInNewWindow}
            className="flex items-center gap-1.5 px-2 py-1.5 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title={openInNewWindowLabel}
          >
            <ExternalLink className="w-4 h-4" />
            <span className="text-xs hidden sm:inline">{openInNewWindowLabel}</span>
          </button>
        )}

        {/* Additional Actions */}
        {children}
      </div>
    </div>
  );
}
