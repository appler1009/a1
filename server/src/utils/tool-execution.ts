import path from 'path';
import { authService } from '../auth/index.js';
import { GoogleOAuthHandler } from '../auth/google-oauth.js';
import { config } from '../config/index.js';
import { mcpManager, getMcpAdapter } from '../mcp/index.js';
import { sanitizeFilename, getExtensionForLanguage } from './text.js';
import { tempStorage } from '../shared-state.js';

// ---------------------------------------------------------------------------
// isValidCacheId
// ---------------------------------------------------------------------------

/**
 * Validate a cache ID is safe (no path traversal).
 * Cache IDs should only contain alphanumeric characters, underscores, and hyphens.
 */
export function isValidCacheId(cacheId: string): boolean {
  if (!cacheId || cacheId.length === 0) return false;
  if (cacheId.includes('/') || cacheId.includes('\\')) return false;
  if (cacheId.includes('..')) return false;
  return /^[a-zA-Z0-9_-]+$/.test(cacheId);
}

// ---------------------------------------------------------------------------
// downloadGoogleDriveFile
// ---------------------------------------------------------------------------

/**
 * Download a Google Drive file and cache it in temp storage.
 */
export async function downloadGoogleDriveFile(
  userId: string,
  fileId: string,
  filename?: string
): Promise<{ fileUri: string; absolutePath: string; cacheId: string } | null> {
  console.log(`[GDriveDownload] Downloading file ${fileId} for user ${userId}`);

  try {
    // Get user's Google Drive OAuth token
    let oauthToken = await authService.getOAuthToken(userId, 'google-drive');

    if (!oauthToken) {
      console.log('[GDriveDownload] No Google Drive OAuth token found for user');
      return null;
    }

    // Check if token is expired and refresh if needed
    const now = Date.now();
    if (oauthToken.expiryDate && oauthToken.expiryDate < now) {
      if (!oauthToken.refreshToken) {
        console.log('[GDriveDownload] Token expired and no refresh token available');
        return null;
      }

      try {
        const googleOAuth = new GoogleOAuthHandler({
          clientId: config.google.clientId,
          clientSecret: config.google.clientSecret,
          redirectUri: config.google.redirectUri,
        });

        const newTokens = await googleOAuth.refreshAccessToken(oauthToken.refreshToken);
        oauthToken = await authService.storeOAuthToken(userId, {
          provider: 'google-drive',
          accessToken: newTokens.access_token,
          refreshToken: newTokens.refresh_token || oauthToken.refreshToken,
          expiryDate: Date.now() + (newTokens.expires_in * 1000),
        } as any);

        console.log(`[GDriveDownload] Token refreshed successfully`);
      } catch (refreshError) {
        console.error('[GDriveDownload] Failed to refresh token:', refreshError);
        return null;
      }
    }

    // Download the file from Google Drive
    const driveApiUrl = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`;
    console.log(`[GDriveDownload] Fetching from Drive API: ${driveApiUrl}`);

    const response = await fetch(driveApiUrl, {
      headers: {
        'Authorization': `Bearer ${oauthToken.accessToken}`,
      },
    });

    if (!response.ok) {
      console.log(`[GDriveDownload] Drive API failed: ${response.status} ${response.statusText}`);
      return null;
    }

    // Get filename from Content-Disposition header if available
    let actualFilename = filename || `document-${fileId.substring(0, 8)}`;
    const contentDisposition = response.headers.get('content-disposition');
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename\*?=["']?(?:UTF-\d['"]*)?([^"';\r\n]+)/);
      if (filenameMatch) {
        actualFilename = decodeURIComponent(filenameMatch[1]);
      }
    }

    // Get content type
    const contentType = response.headers.get('content-type') || 'application/octet-stream';

    // Determine file extension
    let extension = actualFilename.includes('.') ? `.${actualFilename.split('.').pop()}` : '';
    if (!extension) {
      // Try to get extension from content type
      const mimeToExt: Record<string, string> = {
        'application/pdf': '.pdf',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
        'text/plain': '.txt',
        'text/html': '.html',
      };
      extension = mimeToExt[contentType] || '';
    }

    // Download the file
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    console.log(`[GDriveDownload] Downloaded ${buffer.length} bytes`);

    // Save to temp storage (S3 or local filesystem)
    const cacheId = fileId;
    const tempFilename = sanitizeFilename(`${cacheId}${extension}`);

    // Write to temp storage using TempStorage abstraction
    await tempStorage.writeTempFile(tempFilename, buffer);

    // Get the file URI for MCP tools
    const fileUri = await tempStorage.getFileUri(tempFilename);
    console.log(`[GDriveDownload] Saved to temp storage: ${tempFilename}, URI: ${fileUri}`);

    // For backward compatibility, provide absolute path info
    // Handle both file:// and s3:// URIs
    let absolutePath: string;
    if (fileUri.startsWith('file://')) {
      absolutePath = fileUri.replace('file://', '');
    } else if (fileUri.startsWith('s3://')) {
      // For S3, store the S3 URI as absolutePath for later resolution
      absolutePath = fileUri;
    } else {
      absolutePath = fileUri;
    }

    return { fileUri, absolutePath, cacheId };
  } catch (error) {
    console.error('[GDriveDownload] Error downloading file:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// resolveUriForMcp
// ---------------------------------------------------------------------------

// Tools that require local filesystem access (external STDIO processes)
// These tools cannot read S3 URIs directly
const TOOLS_REQUIRING_LOCAL_FILES = new Set([
  'convert_to_markdown', // liteparse in-process tool (handles S3 download itself, but kept here for safety)
]);

/**
 * Resolve URIs/cache IDs for MCP tools.
 * If the URI is a cache ID (or file://cacheId), find the temp file and return the full file:// URI.
 * If the URI is a Google Drive URL, download the file first and cache it.
 */
export async function resolveUriForMcp(uri: string, userId?: string, toolName?: string): Promise<string> {
  if (!uri) return uri;

  // Fast bail-out: plain text / long prose is never a URI or cache ID.
  // Cache IDs are short alphanumeric strings; URIs contain no whitespace.
  // Skipping early avoids noisy SECURITY log spam when tool args contain
  // free-text fields (e.g. scheduler prompt, email body, search queries).
  if (uri.length > 500 || /[\s\n\r]/.test(uri)) return uri;

  // Check if this is a Google Drive URL that needs to be downloaded first
  if (uri.startsWith('https://drive.google.com/') || uri.startsWith('http://drive.google.com/')) {
    // Extract Google Drive file ID from various URL formats
    const gdriveMatch = uri.match(/drive\.google\.com\/.*(?:file\/d\/|id=)([a-zA-Z0-9_-]+)/);
    const gdriveDownloadMatch = uri.match(/drive\.google\.com\/uc\?export=download&id=([a-zA-Z0-9_-]+)/);
    const gdriveFileId = gdriveMatch?.[1] || gdriveDownloadMatch?.[1];

    if (gdriveFileId && userId) {
      console.log(`[UriResolver] Detected Google Drive URL, file ID: ${gdriveFileId}`);

      // Check if file is already cached using tempStorage
      const cachedFile = await tempStorage.findTempFileByCacheId(gdriveFileId);

      if (cachedFile) {
        const fileUri = await tempStorage.getFileUri(cachedFile);
        console.log(`[UriResolver] Using cached Google Drive file: ${fileUri}`);
        return fileUri;
      }

      // Download the file
      console.log(`[UriResolver] Google Drive file not cached, downloading...`);
      const result = await downloadGoogleDriveFile(userId, gdriveFileId);
      if (result) {
        console.log(`[UriResolver] Downloaded Google Drive file to: ${result.fileUri}`);
        return result.fileUri;
      }

      console.log(`[UriResolver] Failed to download Google Drive file, using original URL`);
    }

    // Return original URL if we can't download
    return uri;
  }

  // Check if this is an http/https URL (non-Google Drive) - don't modify
  if (uri.startsWith('http://') || uri.startsWith('https://')) {
    return uri;
  }

  // Extract cache ID from the URI
  let cacheId = uri;

  // If it's a cache:// URI, extract the cache ID
  if (uri.startsWith('cache://')) {
    cacheId = uri.replace('cache://', '');
    console.log(`[UriResolver] Detected cache:// URI, extracted cache ID: ${cacheId}`);
  }
  // If it's a file:// URI, extract the path part
  else if (uri.startsWith('file://')) {
    const filePath = uri.replace('file://', '');
    // If it's a full path with slashes, return as-is (already resolved)
    if (filePath.includes('/')) {
      return uri;
    }
    // Otherwise, use the path as the cache ID
    cacheId = filePath;
  }
  // Check if this is a preview URL (starts with /api/viewer/temp/)
  else if (uri.startsWith('/api/viewer/temp/')) {
    // Extract the temp filename - the format is now {cacheId}.{ext}
    const tempFilename = uri.replace('/api/viewer/temp/', '');
    // Extract the cache ID (everything before the extension)
    const dotIndex = tempFilename.lastIndexOf('.');
    if (dotIndex > 0) {
      cacheId = tempFilename.substring(0, dotIndex);
    } else {
      cacheId = tempFilename;
    }
  }

  // Security: Validate the cache ID to prevent path traversal
  if (!isValidCacheId(cacheId)) {
    console.log(`[UriResolver] SECURITY: Invalid cache ID rejected: ${cacheId}`);
    return uri;
  }

  // Now we have a cache ID - look for the temp file using tempStorage
  try {
    // Use tempStorage to find the file by cache ID
    const matchingFile = await tempStorage.findTempFileByCacheId(cacheId);

    if (matchingFile) {
      let fileUri = await tempStorage.getFileUri(matchingFile);
      console.log(`[UriResolver] Resolved cache ID "${cacheId}" to temp file: ${fileUri}`);

      // For tools that require local filesystem (like liteparse),
      // download S3 files to local temp directory
      if (toolName && TOOLS_REQUIRING_LOCAL_FILES.has(toolName) && fileUri.startsWith('s3://')) {
        // Ensure local temp directory exists before writing
        const localTempDir = path.join(tempStorage.getAbsolutePath('..'), 'temp');
        const fsPromises = await import('fs/promises');
        await fsPromises.mkdir(localTempDir, { recursive: true });

        console.log(`[UriResolver] Tool "${toolName}" requires local file, downloading from S3...`);
        const filename = fileUri.replace('s3://temp/', '');
        const localData = await tempStorage.readTempFile(filename);
        if (localData) {
          // Write to a local temp file that external tools can access
          const localFilename = `liteparse-${Date.now()}-${filename}`;
          const localPath = path.join(localTempDir, localFilename);
          await fsPromises.writeFile(localPath, localData);
          fileUri = `file://${localPath}`;
          console.log(`[UriResolver] Downloaded S3 file to local: ${fileUri}`);
        }
      }

      return fileUri;
    }

    console.log(`[UriResolver] No temp file found for cache ID: ${cacheId}`);
  } catch (error) {
    console.error(`[UriResolver] Error looking up temp file:`, error);
  }

  return uri;
}

// ---------------------------------------------------------------------------
// resolveUrisInArgs
// ---------------------------------------------------------------------------

// Argument keys that are likely to hold file URIs or cache IDs.
// Only these keys are passed through the URI resolver; all other string
// fields (prompts, queries, email bodies, etc.) are left untouched.
const URI_ARG_KEYS = new Set([
  'uri', 'url', 'fileUri', 'file_uri', 'cacheId', 'cache_id',
  'fileId', 'file_id', 'path', 'filePath', 'file_path', 'src', 'source',
]);

/**
 * Recursively resolve URIs in an arguments object.
 * Only resolves string values whose key is in URI_ARG_KEYS.
 */
export async function resolveUrisInArgs(args: Record<string, unknown>, userId?: string, toolName?: string): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      // Only resolve strings in URI-like argument keys to avoid passing
      // free-text fields (prompts, queries, etc.) through the resolver.
      resolved[key] = URI_ARG_KEYS.has(key) ? await resolveUriForMcp(value, userId, toolName) : value;
    } else if (Array.isArray(value)) {
      // Recursively resolve URIs in arrays (only for URI keys)
      resolved[key] = URI_ARG_KEYS.has(key)
        ? await Promise.all(
            value.map(item =>
              typeof item === 'string' ? resolveUriForMcp(item, userId, toolName) : Promise.resolve(item)
            )
          )
        : value;
    } else if (typeof value === 'object' && value !== null) {
      // Recursively resolve URIs in nested objects
      resolved[key] = await resolveUrisInArgs(value as Record<string, unknown>, userId, toolName);
    } else {
      resolved[key] = value;
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// handleToolResult
// ---------------------------------------------------------------------------

/**
 * Handle tool result with special processing for certain tools.
 */
export async function handleToolResult(
  toolName: string,
  args: Record<string, unknown>,
  resultText: string,
  userId: string
): Promise<string> {
  // Check if this is a display_email result
  if (toolName === 'display_email') {
    // Return the result as-is - it contains the special marker that the client will recognize
    return resultText;
  }

  // For convert_to_markdown with sizable content (>10 lines), save to a markdown file
  // and return both the original file preview and the markdown preview
  const resultLines = resultText.split('\n').length;
  if (toolName === 'convert_to_markdown' && resultLines > 10) {
    try {
      // Generate filename from the source URI or timestamp
      const sourceUri = args.uri as string || '';
      let baseName = 'converted';
      let originalPreviewTag = '';

      if (sourceUri) {
        // Try to create a preview tag for the original file if it's a local file
        if (sourceUri.startsWith('file://')) {
          const localPath = sourceUri.replace('file://', '');
          const originalFilename = localPath.split('/').pop() || 'document';
          // Check if the original file exists in temp (it should if downloaded)
          const originalExt = originalFilename.split('.').pop() || '';
          if (['pdf', 'docx', 'xlsx', 'pptx'].includes(originalExt.toLowerCase())) {
            // Find the temp file by matching the filename pattern using tempStorage
            const cacheId = originalFilename.replace(/\.[^.]+$/, '');
            const matchingFile = await tempStorage.findTempFileByCacheId(cacheId);
            if (matchingFile) {
              originalPreviewTag = `[preview-file:${originalFilename}](/api/viewer/temp/${matchingFile})`;
            }
          }
        }
        const urlPath = sourceUri.split('/').pop() || '';
        baseName = urlPath.replace(/\.[^.]+$/, '') || 'converted';
      }

      // Extract just the markdown content (remove JSON wrapper if present)
      let markdownContent = resultText;
      try {
        const parsed = JSON.parse(resultText);
        if (parsed.content && Array.isArray(parsed.content)) {
          // Extract text from content array
          markdownContent = parsed.content
            .filter((item: any) => item.type === 'text')
            .map((item: any) => item.text)
            .join('\n');
        }
      } catch {
        // Not JSON, use as-is
      }

      // Extract long code blocks (>10 lines) into separate files
      const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
      let processedContent = markdownContent;
      const codeBlockFiles: Array<{ filename: string; previewUrl: string; language: string }> = [];
      let match;
      let blockIndex = 0;

      while ((match = codeBlockRegex.exec(markdownContent)) !== null) {
        const language = match[1] || 'text';
        const codeContent = match[2];
        const lines = codeContent.split('\n').length;

        // If code block is longer than 10 lines, extract to separate file
        if (lines > 10) {
          blockIndex++;
          const ext = getExtensionForLanguage(language);
          const codeFilename = sanitizeFilename(`${baseName}-code-${blockIndex}.${ext}`);

          // Write to temp storage using TempStorage abstraction (supports S3)
          await tempStorage.writeTempFile(codeFilename, Buffer.from(codeContent, 'utf-8'));

          const codePreviewUrl = `/api/viewer/temp/${codeFilename}`;
          codeBlockFiles.push({ filename: codeFilename, previewUrl: codePreviewUrl, language });

          // Replace the code block with a preview link
          const previewTag = `[preview-file:${codeFilename}](${codePreviewUrl})`;
          const replacement = `\n**Code Block (${language}):**\n${previewTag}\n`;
          processedContent = processedContent.replace(match[0], replacement);
        }
      }

      // Save the processed markdown file using TempStorage
      const mdFilename = sanitizeFilename(`${baseName}-markdown-${Date.now()}.md`);
      await tempStorage.writeTempFile(mdFilename, Buffer.from(processedContent, 'utf-8'));

      const mdPreviewUrl = `/api/viewer/temp/${mdFilename}`;
      console.log(`[ToolExecution] Saved markdown to temp storage: ${mdFilename}`);
      console.log(`[ToolExecution] Preview URL: ${mdPreviewUrl}`);
      if (codeBlockFiles.length > 0) {
        console.log(`[ToolExecution] Extracted ${codeBlockFiles.length} code blocks to separate files`);
      }

      // Build response with preview options
      let response = `Document converted successfully!\n\n`;
      response += `**Preview Options:**\n`;
      if (originalPreviewTag) {
        response += `- 📄 Original document: ${originalPreviewTag}\n`;
      }
      response += `- 📝 Markdown version: [preview-file:${mdFilename}](${mdPreviewUrl})\n`;

      // Add code block previews if any were extracted
      if (codeBlockFiles.length > 0) {
        response += `\n**Extracted Code Blocks:**\n`;
        for (const cb of codeBlockFiles) {
          response += `- 📋 ${cb.language || 'code'}: [preview-file:${cb.filename}](${cb.previewUrl})\n`;
        }
      }

      response += `\n---\n**Content Preview:**\n\`\`\`markdown\n${processedContent.substring(0, 500)}${processedContent.length > 500 ? '...\n' : ''}\`\`\`\n`;

      console.log(`[ToolExecution] ========================================\n`);
      return response;
    } catch (saveError) {
      console.error(`[ToolExecution] Failed to save markdown file:`, saveError);
      // Fall through to return the raw result
    }
  }

  console.log(`[ToolExecution] Result preview: ${resultText.substring(0, 300)}${resultText.length > 300 ? '...' : ''}`);
  console.log(`[ToolExecution] ========================================\n`);
  return resultText;
}

// ---------------------------------------------------------------------------
// executeToolWithAdapters
// ---------------------------------------------------------------------------

/**
 * New Adapter-Based Tool Execution Flow.
 *
 * Bridges the MCPManager-based server lifecycle management with the adapter
 * pattern for runtime tool execution.
 */
export async function executeToolWithAdapters(
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
  roleId?: string
): Promise<{ text: string; metadata?: Record<string, unknown>; accounts?: string[] }> {
  try {
    const { toolCache } = await import('../mcp/tool-cache.js');
    const cachedTool = toolCache.findToolServer(toolName);

    if (cachedTool) {
      try {
        const adapter = await getMcpAdapter(userId, cachedTool.serverId, roleId);
        const resolvedArgs = await resolveUrisInArgs(args, userId, toolName);
        const result = await adapter.callTool(toolName, resolvedArgs);

        if (result.type === 'error') return { text: `Error: ${result.error || 'Unknown error'}` };

        const finalResult = await handleToolResult(toolName, args, result.text || JSON.stringify(result), userId);
        return { text: finalResult, metadata: (result as any).metadata, accounts: (result as any).accounts };
      } catch (error) {
        console.error(`[ToolExecution] Cache-hit execution failed for ${toolName} on ${cachedTool.serverId}:`, error);
        // Fall through to full search
      }
    }

    // Cache miss — search all servers
    console.log(`[ToolExecution] Cache miss for "${toolName}", searching all servers`);
    const servers = mcpManager.getServers();

    for (const server of servers) {
      try {
        const adapter = await getMcpAdapter(userId, server.id, roleId);
        const tools = await adapter.listTools();
        toolCache.updateServerTools(server.id, tools);

        const tool = tools.find(t => t.name === toolName);
        if (tool) {
          const resolvedArgs = await resolveUrisInArgs(args, userId, toolName);
          const result = await adapter.callTool(toolName, resolvedArgs);

          if (result.type === 'error') return { text: `Error: ${result.error || 'Unknown error'}` };

          const finalResult = await handleToolResult(toolName, args, result.text || JSON.stringify(result), userId);
          return { text: finalResult, metadata: (result as any).metadata, accounts: (result as any).accounts };
        }
      } catch (error) {
        console.error(`[ToolExecution] Error searching server ${server.id} for ${toolName}:`, error);
      }
    }

    throw new Error(`Tool "${toolName}" not found on any MCP server`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ToolExecution] Failed to execute ${toolName}:`, error);
    return { text: `Error executing tool ${toolName}: ${errorMsg}` };
  }
}
