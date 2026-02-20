// Load environment-specific .env file
import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeEnv = process.env.NODE_ENV || 'development';
// .env files are in the server directory (one level up from src/)
const envFile = path.join(__dirname, '..', `.env.${nodeEnv}`);
dotenvConfig({ path: envFile });

import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import { v4 as uuidv4 } from 'uuid';
import type { User, Session } from '@local-agent/shared';
import { createStorage } from './storage/index.js';
import { createLLMRouter } from './ai/router.js';
import { mcpManager, getMcpAdapter, closeUserAdapters, listPredefinedServers, getPredefinedServer, requiresAuth, PREDEFINED_MCP_SERVERS } from './mcp/index.js';
import { authRoutes } from './api/auth.js';
import { authService } from './auth/index.js';
import { GoogleOAuthHandler } from './auth/google-oauth.js';

// Configuration
const config = {
  env: {
    nodeEnv,
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test',
    isProduction: nodeEnv === 'production',
  },
  port: parseInt(process.env.PORT || '3000', 10),
  host: process.env.HOST || '0.0.0.0',
  database: {
    type: 'sqlite' as const,
    path: process.env.DATABASE_PATH || './data/metadata.db',
  },
  storage: {
    type: (process.env.STORAGE_TYPE as 'fs' | 'sqlite' | 's3') || 'fs',
    root: process.env.STORAGE_ROOT || './data',
    bucket: process.env.STORAGE_BUCKET || undefined,
    endpoint: process.env.STORAGE_ENDPOINT || undefined,
    region: process.env.STORAGE_REGION || undefined,
  },
  auth: {
    secret: process.env.AUTH_SECRET || uuidv4(),
    sessionTTL: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID || '',
    clientSecret: process.env.GMAIL_CLIENT_SECRET || '',
    redirectUri: process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/api/gmail/callback',
  },
  llm: {
    provider: (process.env.LLM_PROVIDER as 'grok' | 'openai' | 'anthropic') || 'grok',
    grokKey: process.env.GROK_API_KEY || '',
    openaiKey: process.env.OPENAI_API_KEY || '',
    anthropicKey: process.env.ANTHROPIC_API_KEY || '',
    defaultModel: process.env.DEFAULT_MODEL,
    routerEnabled: process.env.ROUTER_ENABLED === 'true',
  },
};

// Helper function to get file extension for a programming language
function getExtensionForLanguage(language: string): string {
  const extensions: Record<string, string> = {
    javascript: 'js',
    typescript: 'ts',
    python: 'py',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    csharp: 'cs',
    go: 'go',
    rust: 'rs',
    ruby: 'rb',
    php: 'php',
    swift: 'swift',
    kotlin: 'kt',
    scala: 'scala',
    r: 'r',
    sql: 'sql',
    html: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    json: 'json',
    xml: 'xml',
    yaml: 'yaml',
    yml: 'yml',
    markdown: 'md',
    shell: 'sh',
    bash: 'sh',
    powershell: 'ps1',
    dockerfile: 'dockerfile',
    makefile: 'mk',
    cmake: 'cmake',
    graphql: 'graphql',
    vue: 'vue',
    svelte: 'svelte',
    jsx: 'jsx',
    tsx: 'tsx',
  };
  return extensions[language.toLowerCase()] || 'txt';
}

// Helper function to strip emojis from text
function stripEmojis(text: string): string {
  // Remove emojis using Unicode ranges
  // This covers most common emoji ranges
  return text.replace(/[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{1F900}-\u{1F9FF}]|[\u{1FA00}-\u{1FA6F}]|[\u{1FA70}-\u{1FAFF}]|[\u{231A}-\u{231B}]|[\u{23E9}-\u{23F3}]|[\u{23F8}-\u{23FA}]|[\u{25AA}-\u{25AB}]|[\u{25B6}]|[\u{25C0}]|[\u{25FB}-\u{25FE}]|[\u{2614}-\u{2615}]|[\u{2648}-\u{2653}]|[\u{267F}]|[\u{2693}]|[\u{26A1}]|[\u{26AA}-\u{26AB}]|[\u{26BD}-\u{26BE}]|[\u{26C4}-\u{26C5}]|[\u{26CE}]|[\u{26D4}]|[\u{26EA}]|[\u{26F2}-\u{26F3}]|[\u{26F5}]|[\u{26FA}]|[\u{26FD}]|[\u{2702}]|[\u{2705}]|[\u{2708}-\u{270D}]|[\u{270F}]|[\u{2712}]|[\u{2714}]|[\u{2716}]|[\u{271D}]|[\u{2721}]|[\u{2728}]|[\u{2733}-\u{2734}]|[\u{2744}]|[\u{2747}]|[\u{274C}]|[\u{274E}]|[\u{2753}-\u{2755}]|[\u{2757}]|[\u{2763}-\u{2764}]|[\u{2795}-\u{2797}]|[\u{27A1}]|[\u{27B0}]|[\u{27BF}]|[\u{2934}-\u{2935}]|[\u{2B05}-\u{2B07}]|[\u{2B1B}-\u{2B1C}]|[\u{2B50}]|[\u{2B55}]|[\u{3030}]|[\u{303D}]|[\u{3297}]|[\u{3299}]|[\u{200D}]|[\u{20E3}]|[\u{E0020}-\u{E007F}]/gu, '');
}

// Helper function to extract long code blocks from text and save to files
// Returns { processedText, extractedFiles }
async function extractLongCodeBlocks(
  text: string,
  tempDir: string,
  baseName: string = 'code'
): Promise<{ processedText: string; extractedFiles: Array<{ filename: string; previewUrl: string; language: string }> }> {
  const fs = await import('fs/promises');
  
  // Ensure temp directory exists
  await fs.mkdir(tempDir, { recursive: true });
  
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)```/g;
  let processedText = text;
  const extractedFiles: Array<{ filename: string; previewUrl: string; language: string }> = [];
  const matches: Array<{ fullMatch: string; language: string; code: string }> = [];
  
  // First, collect all matches (we need to iterate separately to avoid issues with replacing while matching)
  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    matches.push({
      fullMatch: match[0],
      language: match[1] || 'text',
      code: match[2],
    });
  }
  
  // Process each code block
  let blockIndex = 0;
  for (const { fullMatch, language, code } of matches) {
    const lines = code.split('\n').length;
    
    // If code block has more than 10 lines, extract to separate file
    if (lines > 10) {
      blockIndex++;
      const ext = getExtensionForLanguage(language);
      const codeFilename = sanitizeFilename(`${baseName}-${blockIndex}.${ext}`);
      const codeFilePath = path.join(tempDir, codeFilename);
      
      await fs.writeFile(codeFilePath, code);
      
      const codePreviewUrl = `/api/viewer/temp/${codeFilename}`;
      extractedFiles.push({ filename: codeFilename, previewUrl: codePreviewUrl, language });
      
      // Replace the code block with a preview link
      const previewTag = `[preview-file:${codeFilename}](${codePreviewUrl})`;
      const replacement = `\n**Code (${language}):**\n${previewTag}\n`;
      processedText = processedText.replace(fullMatch, replacement);
    }
  }
  
  return { processedText, extractedFiles };
}

// Extend Fastify types
declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
    session: Session | null;
  }
}

// Create Fastify instance
const fastify = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

// Global LLM router instance
let llmRouter: ReturnType<typeof createLLMRouter>;

// Global storage instance - initialized before routes
const storage = createStorage({
  type: (process.env.STORAGE_TYPE as 'fs' | 'sqlite' | 's3') || 'fs',
  root: process.env.STORAGE_ROOT || './data',
  bucket: process.env.STORAGE_BUCKET || '',
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION,
});

// Default settings
const DEFAULT_SETTINGS: Record<string, unknown> = {
  MAX_TOOL_ITERATIONS: 10,
};

/**
 * Initialize default settings in the database
 * Only sets values that don't already exist
 */
async function initializeDefaultSettings(): Promise<void> {
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = await storage.getSetting(key);
    if (existing === null) {
      console.log(`[Settings] Initializing default setting: ${key} = ${value}`);
      await storage.setSetting(key, value);
    }
  }
}

/**
 * Get a setting value with fallback to default
 */
async function getSettingWithDefault<T>(key: string, defaultValue: T): Promise<T> {
  const value = await storage.getSetting<T>(key);
  return value !== null ? value : defaultValue;
}

// Google OAuth handler for token refresh
let googleOAuthHandler: GoogleOAuthHandler | null = null;

// Helper function to validate a cache ID is safe (no path traversal)
function isValidCacheId(cacheId: string): boolean {
  // Cache IDs should only contain alphanumeric characters, underscores, hyphens, and dots
  // This prevents path traversal attacks
  if (!cacheId || cacheId.length === 0) return false;
  if (cacheId.includes('/') || cacheId.includes('\\')) return false;
  if (cacheId.includes('..')) return false;
  // Only allow safe characters: alphanumeric, underscore, hyphen
  return /^[a-zA-Z0-9_-]+$/.test(cacheId);
}

// Helper function to sanitize a filename for safe file system operations
// Removes path separators and other dangerous characters
function sanitizeFilename(filename: string): string {
  if (!filename) return 'file';
  
  // Remove any path separators
  let sanitized = filename.replace(/[/\\]/g, '_');
  
  // Remove parent directory references
  sanitized = sanitized.replace(/\.\./g, '');
  
  // Remove null bytes and other control characters
  sanitized = sanitized.replace(/[\x00-\x1f\x7f]/g, '');
  
  // Limit length to prevent DoS
  if (sanitized.length > 255) {
    const ext = sanitized.split('.').pop() || '';
    const baseName = sanitized.substring(0, sanitized.length - ext.length - 1);
    sanitized = baseName.substring(0, 250 - ext.length) + '.' + ext;
  }
  
  return sanitized || 'file';
}

// Helper function to download a Google Drive file and cache it locally
async function downloadGoogleDriveFile(
  userId: string,
  fileId: string,
  filename?: string
): Promise<{ fileUri: string; absolutePath: string; cacheId: string } | null> {
  console.log(`[GDriveDownload] Downloading file ${fileId} for user ${userId}`);
  
  try {
    // Get user's Google OAuth token
    let oauthToken = await authService.getOAuthToken(userId, 'google');
    
    if (!oauthToken) {
      console.log('[GDriveDownload] No Google OAuth token found for user');
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
          clientId: process.env.GOOGLE_CLIENT_ID || '',
          clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
          redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
        });
        
        const newTokens = await googleOAuth.refreshAccessToken(oauthToken.refreshToken);
        oauthToken = await authService.storeOAuthToken(userId, {
          provider: 'google',
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
    
    // Save to temp directory
    const fs = await import('fs/promises');
    const tempDir = path.join(config.storage.root, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    // Use Google Drive file ID as cache key
    const cacheId = fileId;
    const tempFilename = sanitizeFilename(`${cacheId}${extension}`);
    const tempFilePath = path.join(tempDir, tempFilename);
    
    await fs.writeFile(tempFilePath, buffer);
    console.log(`[GDriveDownload] Saved to: ${tempFilePath}`);
    
    const absolutePath = path.resolve(tempFilePath);
    const fileUri = `file://${absolutePath}`;
    
    return { fileUri, absolutePath, cacheId };
  } catch (error) {
    console.error('[GDriveDownload] Error downloading file:', error);
    return null;
  }
}

// Helper function to resolve URIs/cache IDs for MCP tools
// If the URI is a cache ID (or file://cacheId), find the temp file and return the full file:// URI
// If the URI is a Google Drive URL, download the file first and cache it
async function resolveUriForMcp(uri: string, userId?: string): Promise<string> {
  if (!uri) return uri;
  
  // Check if this is a Google Drive URL that needs to be downloaded first
  if (uri.startsWith('https://drive.google.com/') || uri.startsWith('http://drive.google.com/')) {
    // Extract Google Drive file ID from various URL formats
    const gdriveMatch = uri.match(/drive\.google\.com\/.*(?:file\/d\/|id=)([a-zA-Z0-9_-]+)/);
    const gdriveDownloadMatch = uri.match(/drive\.google\.com\/uc\?export=download&id=([a-zA-Z0-9_-]+)/);
    const gdriveFileId = gdriveMatch?.[1] || gdriveDownloadMatch?.[1];
    
    if (gdriveFileId && userId) {
      console.log(`[UriResolver] Detected Google Drive URL, file ID: ${gdriveFileId}`);
      
      // Check if file is already cached
      const fs = await import('fs/promises');
      const tempDir = path.join(config.storage.root, 'temp');
      const tempFiles = await fs.readdir(tempDir).catch(() => []);
      const cachedFile = tempFiles.find(f => {
        const dotIndex = f.lastIndexOf('.');
        const fileCacheId = dotIndex > 0 ? f.substring(0, dotIndex) : f;
        return fileCacheId === gdriveFileId;
      });
      
      if (cachedFile) {
        const absolutePath = path.resolve(tempDir, cachedFile);
        const fileUri = `file://${absolutePath}`;
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
  
  // If it's a file:// URI, extract the path part
  if (uri.startsWith('file://')) {
    const filePath = uri.replace('file://', '');
    // If it's a full path with slashes, return as-is (already resolved)
    if (filePath.includes('/')) {
      return uri;
    }
    // Otherwise, use the path as the cache ID
    cacheId = filePath;
  }
  
  // Check if this is a preview URL (starts with /api/viewer/temp/)
  if (uri.startsWith('/api/viewer/temp/')) {
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
  
  // Now we have a cache ID - look for the temp file in the temp directory
  try {
    const fs = await import('fs/promises');
    const tempDir = path.join(config.storage.root, 'temp');
    const tempFiles = await fs.readdir(tempDir).catch(() => []);
    
    // Find a file that starts with the cache ID (regardless of extension)
    // The format is {cacheId}.{ext}
    const matchingFile = tempFiles.find(f => {
      const dotIndex = f.lastIndexOf('.');
      const fileCacheId = dotIndex > 0 ? f.substring(0, dotIndex) : f;
      return fileCacheId === cacheId;
    });
    
    if (matchingFile) {
      // Security: Verify the resolved path is within temp directory
      const absolutePath = path.resolve(tempDir, matchingFile);
      const resolvedTempDir = path.resolve(tempDir);
      if (!absolutePath.startsWith(resolvedTempDir + path.sep) && absolutePath !== resolvedTempDir) {
        console.log(`[UriResolver] SECURITY: Path escape attempt - resolved to: ${absolutePath}`);
        return uri;
      }
      
      const fileUri = `file://${absolutePath}`;
      console.log(`[UriResolver] Resolved cache ID "${cacheId}" to local file: ${fileUri}`);
      return fileUri;
    }
    
    console.log(`[UriResolver] No temp file found for cache ID: ${cacheId}`);
  } catch (error) {
    console.error(`[UriResolver] Error looking up temp file:`, error);
  }
  
  return uri;
}

// Helper function to recursively resolve URIs in an arguments object
async function resolveUrisInArgs(args: Record<string, unknown>, userId?: string): Promise<Record<string, unknown>> {
  const resolved: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      // Resolve string values that might be URIs or cache IDs
      resolved[key] = await resolveUriForMcp(value, userId);
    } else if (Array.isArray(value)) {
      // Recursively resolve URIs in arrays
      resolved[key] = await Promise.all(
        value.map(item => 
          typeof item === 'string' ? resolveUriForMcp(item, userId) : Promise.resolve(item)
        )
      );
    } else if (typeof value === 'object' && value !== null) {
      // Recursively resolve URIs in nested objects
      resolved[key] = await resolveUrisInArgs(value as Record<string, unknown>, userId);
    } else {
      resolved[key] = value;
    }
  }
  
  return resolved;
}

// Register plugins
fastify.register(cors, {
  origin: true,
  credentials: true,
});

fastify.register(cookie, {
  secret: config.auth.secret,
});

fastify.register(websocket);

// Register static file serving for the client build
fastify.register(fastifyStatic, {
  root: path.join(__dirname, '..', '..', 'client', 'dist'),
  prefix: '/',
});

// SPA fallback: serve index.html for any non-API routes
fastify.setNotFoundHandler(async (request, reply) => {
  if (!request.url.startsWith('/api/') && request.method === 'GET') {
    // Serve index.html for client-side routing
    return reply.sendFile('index.html');
  }
  reply.code(404).send({ message: `Route ${request.method}:${request.url} not found`, error: 'Not Found', statusCode: 404 });
});

// Health check
fastify.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Environment info endpoint
fastify.get('/api/env', async () => {
  return {
    success: true,
    data: {
      env: config.env.nodeEnv,
      isDevelopment: config.env.isDevelopment,
      isTest: config.env.isTest,
      isProduction: config.env.isProduction,
      port: config.port,
      host: config.host,
    },
  };
});

// Auth middleware
fastify.addHook('onRequest', async (request) => {
  const sessionId = request.cookies.session_id;
  if (sessionId) {
    const session = await authService.getSession(sessionId);
    if (session) {
      const user = await authService.getUser(session.userId);
      request.user = user;
      request.session = session;
    } else {
      request.user = null;
      request.session = null;
    }
  } else {
    request.user = null;
    request.session = null;
  }
});

/**
 * New Adapter-Based Tool Execution Flow
 *
 * This function bridges the current MCPManager-based server lifecycle management
 * with the new adapter pattern for runtime tool execution.
 *
 * Flow:
 * 1. Get all MCP servers from MCPManager (server lifecycle)
 * 2. For each server, get an adapter from the factory
 * 3. The factory handles:
 *    - Loading config from database
 *    - Preparing auth files (credentials.json, token.json)
 *    - Caching connections per user+server
 *    - Connection pooling and reuse
 * 4. Use uniform adapter interface to call tools
 *
 * Benefits:
 * - Uniform interface regardless of MCP server type
 * - Auth file preparation on-demand during adapter creation
 * - Transparent connection caching and pooling
 * - Ready for future WebSocket/HTTP transport expansion
 */
async function executeToolWithAdapters(
  userId: string,
  toolName: string,
  args: Record<string, unknown>
): Promise<string> {
  try {
    console.log(`\n[ToolExecution] ========================================`);
    console.log(`[ToolExecution] Tool Request: ${toolName}`);
    console.log(`[ToolExecution] Arguments: ${JSON.stringify(args, null, 2)}`);
    console.log(`[ToolExecution] User: ${userId}`);

    // Get all MCP servers from manager
    const servers = mcpManager.getServers();
    console.log(`[ToolExecution] Searching across ${servers.length} servers for tool: ${toolName}`);
    if (servers.length > 0) {
      console.log(`[ToolExecution] Available servers: ${servers.map(s => s.id).join(', ')}`);
    }

    // Try to find the tool and execute it
    for (const server of servers) {
      try {
        console.log(`[ToolExecution] Checking server: ${server.id}`);
        const adapter = await getMcpAdapter(userId, server.id);
        const tools = await adapter.listTools();
        console.log(`[ToolExecution] Server ${server.id} has ${tools.length} tools available`);

        const tool = tools.find(t => t.name === toolName);

        if (tool) {
          console.log(`[ToolExecution] Found tool "${toolName}" on server: ${server.id}`);
          console.log(`[ToolExecution] Tool description: ${tool.description}`);
          console.log(`[ToolExecution] Executing tool...`);

          // Resolve any URIs/filenames in the arguments to local file URIs
          const resolvedArgs = await resolveUrisInArgs(args, userId);
          console.log(`[ToolExecution] Resolved arguments: ${JSON.stringify(resolvedArgs, null, 2)}`);

          const result = await adapter.callTool(toolName, resolvedArgs);

          console.log(`[ToolExecution] Raw response type: ${result.type}`);
          console.log(`[ToolExecution] Raw response:`, JSON.stringify(result, null, 2));

          // Format result as string
          if (result.type === 'error') {
            const errorMsg = `Error: ${result.error || 'Unknown error'}`;
            console.log(`[ToolExecution] Tool returned error: ${errorMsg}`);
            console.log(`[ToolExecution] ========================================\n`);
            return errorMsg;
          }

          const resultText = result.text || JSON.stringify(result);
          console.log(`[ToolExecution] Tool execution successful`);
          console.log(`[ToolExecution] Result length: ${resultText.length} chars`);
          
          // For convert_to_markdown with sizable content (>10 lines), save to a markdown file
          // and return both the original file preview and the markdown preview
          const resultLines = resultText.split('\n').length;
          if (toolName === 'convert_to_markdown' && resultLines > 10) {
            try {
              const fs = await import('fs/promises');
              const tempDir = path.join(config.storage.root, 'temp');
              await fs.mkdir(tempDir, { recursive: true });
              
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
                    // Find the temp file by matching the filename pattern
                    const tempFiles = await fs.readdir(tempDir);
                    const matchingFile = tempFiles.find(f => f.includes(originalFilename.replace(/\.[^.]+$/, '')));
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
                  const codeFilePath = path.join(tempDir, codeFilename);
                  
                  await fs.writeFile(codeFilePath, codeContent);
                  
                  const codePreviewUrl = `/api/viewer/temp/${codeFilename}`;
                  codeBlockFiles.push({ filename: codeFilename, previewUrl: codePreviewUrl, language });
                  
                  // Replace the code block with a preview link
                  const previewTag = `[preview-file:${codeFilename}](${codePreviewUrl})`;
                  const replacement = `\n**Code Block (${language}):**\n${previewTag}\n`;
                  processedContent = processedContent.replace(match[0], replacement);
                }
              }
              
              // Save the processed markdown file
              const mdFilename = sanitizeFilename(`${baseName}-markdown-${Date.now()}.md`);
              const mdFilePath = path.join(tempDir, mdFilename);
              await fs.writeFile(mdFilePath, processedContent);
              
              const mdPreviewUrl = `/api/viewer/temp/${mdFilename}`;
              console.log(`[ToolExecution] Saved markdown to: ${mdFilePath}`);
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
      } catch (error) {
        console.error(`[ToolExecution] Error searching server ${server.id}:`, error);
        // Continue to next server
      }
    }

    // Tool not found
    throw new Error(`Tool "${toolName}" not found on any MCP server`);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[ToolExecution] Tool execution failed (${toolName}):`, error);
    console.log(`[ToolExecution] ========================================\n`);
    return `Error executing tool ${toolName}: ${errorMsg}`;
  }
}

// Register API routes
fastify.register(authRoutes, { prefix: '/api/auth' });

// Group routes (renamed from orgs)
fastify.register(async (instance) => {
  // Get user's groups
  instance.get('/groups', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const groups = await authService.getUserGroups(request.user.id);
    return reply.send({ success: true, data: groups });
  });

  // Create group
  instance.post('/groups', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const body = request.body as { name: string; url?: string };
    const group = await authService.createGroup(body.name, body.url);
    await authService.addMember(group.id, request.user.id, 'owner');
    
    return reply.send({ success: true, data: group });
  });

  // Get group members
  instance.get('/groups/:id/members', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const params = request.params as { id: string };
    const members = await authService.getGroupMembers(params.id);
    return reply.send({ success: true, data: members });
  });

  // Create invitation
  instance.post('/groups/:id/invitations', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const params = request.params as { id: string };
    const body = request.body as { email?: string; role?: 'owner' | 'admin' | 'member' };
    
    const invitation = await authService.createInvitation(
      params.id,
      request.user.id,
      body.email,
      body.role || 'member'
    );
    
    return reply.send({ success: true, data: invitation });
  });
}, { prefix: '/api' });

// Roles routes
fastify.register(async (instance) => {
  const roles: Map<string, { id: string; groupId: string; name: string; jobDesc?: string; systemPrompt?: string; model?: string; createdAt: Date }> = new Map();

  // Get roles for group
  instance.get('/roles', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const query = request.query as { groupId?: string };
    const groupRoles = Array.from(roles.values()).filter(r => 
      !query.groupId || r.groupId === query.groupId
    );
    
    return reply.send({ success: true, data: groupRoles });
  });

  // Create role
  instance.post('/roles', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const body = request.body as { groupId: string; name: string; jobDesc?: string; systemPrompt?: string; model?: string };
    const id = uuidv4();
    const role = {
      id,
      groupId: body.groupId,
      name: body.name,
      jobDesc: body.jobDesc,
      systemPrompt: body.systemPrompt,
      model: body.model,
      createdAt: new Date(),
    };
    
    roles.set(id, role);
    return reply.send({ success: true, data: role });
  });

  // Update role
  instance.patch('/roles/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const params = request.params as { id: string };
    const body = request.body as { name?: string; jobDesc?: string; systemPrompt?: string; model?: string };
    
    const role = roles.get(params.id);
    if (!role) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }
    
    Object.assign(role, body);
    roles.set(params.id, role);
    return reply.send({ success: true, data: role });
  });

  // Delete role
  instance.delete('/roles/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    const params = request.params as { id: string };
    roles.delete(params.id);
    return reply.send({ success: true });
  });
}, { prefix: '/api' });

// Chat routes
fastify.register(async (instance) => {
  // Get messages for a role with pagination
  instance.get('/messages', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { roleId?: string; limit?: number; before?: string };
    const roleId = query.roleId || 'default';
    const limit = query.limit || 50;

    const messageStorage = storage.getMessageStorage();
    if (!messageStorage) {
      return reply.code(500).send({ success: false, error: { message: 'Message storage not available' } });
    }

    const messages = await messageStorage.listMessages(roleId, { limit, before: query.before });
    return reply.send({ success: true, data: messages });
  });

  // Save a message
  instance.post('/messages', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as { 
      id?: string;
      roleId: string; 
      groupId?: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
    };

    const messageStorage = storage.getMessageStorage();
    if (!messageStorage) {
      return reply.code(500).send({ success: false, error: { message: 'Message storage not available' } });
    }

    const message = {
      id: body.id || uuidv4(),
      roleId: body.roleId,
      groupId: body.groupId || null,
      userId: request.user.id,
      role: body.role,
      content: body.content,
      createdAt: new Date().toISOString(),
    };

    await messageStorage.saveMessage(message);
    return reply.send({ success: true, data: message });
  });

  // Clear messages for a role
  instance.delete('/messages', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { roleId?: string };
    const roleId = query.roleId || 'default';

    const messageStorage = storage.getMessageStorage();
    if (!messageStorage) {
      return reply.code(500).send({ success: false, error: { message: 'Message storage not available' } });
    }

    await messageStorage.clearMessages(roleId);
    return reply.send({ success: true });
  });

  // Search messages by keyword
  instance.get('/messages/search', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { keyword?: string; roleId?: string; limit?: number };
    const keyword = query.keyword || '';
    const roleId = query.roleId || 'default';
    const limit = query.limit || 100;

    if (!keyword.trim()) {
      return reply.send({ success: true, data: [] });
    }

    const messageStorage = storage.getMessageStorage();
    if (!messageStorage) {
      return reply.code(500).send({ success: false, error: { message: 'Message storage not available' } });
    }

    const messages = await messageStorage.searchMessages(keyword, roleId, { limit });
    return reply.send({ success: true, data: messages });
  });

  // Migrate messages from localStorage (client sends all messages)
  instance.post('/messages/migrate', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as { 
      messages: Array<{
        id: string;
        roleId: string;
        groupId?: string | null;
        userId?: string;
        role: 'user' | 'assistant' | 'system';
        content: string;
        createdAt: string;
      }> 
    };

    const messageStorage = storage.getMessageStorage();
    if (!messageStorage) {
      return reply.code(500).send({ success: false, error: { message: 'Message storage not available' } });
    }

    let migrated = 0;
    for (const msg of body.messages) {
      await messageStorage.saveMessage({
        ...msg,
        userId: msg.userId || request.user.id,
        groupId: msg.groupId || null,
      });
      migrated++;
    }

    return reply.send({ success: true, data: { migrated } });
  });

  instance.post('/chat/stream', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as { 
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; 
      roleId?: string; 
      groupId?: string;
      viewerFile?: {
        id: string;
        name: string;
        mimeType: string;
        previewUrl: string;
        fileUri?: string;
        absolutePath?: string;
      } | null;
    };

    if (!llmRouter) {
      return reply.code(500).send({ success: false, error: { message: 'LLM router not initialized' } });
    }

    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');

    try {
      // Load MCP tools
      console.log('[ChatStream] Loading MCP tools from available servers');
      const allTools = await mcpManager.listAllTools();
      const flattenedTools = allTools.flatMap(({ serverId, tools }) =>
        tools.map(tool => ({
          ...tool,
          serverId,
        }))
      );

      console.log(`[ChatStream] Found ${flattenedTools.length} tools across ${allTools.length} servers`, {
        servers: allTools.map(t => t.serverId),
        toolCounts: allTools.map(t => `${t.serverId}:${t.tools.length}`),
      });

      // Convert tools to provider format with defaults
      const toolsWithDefaults = flattenedTools.map(tool => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || {},
        serverId: tool.serverId,
      }));
      const providerTools = llmRouter.convertMCPToolsToOpenAI(toolsWithDefaults);
      console.log(`[ChatStream] Converted ${providerTools.length} tools to provider format`);
      
      // Print the list of tools being sent to the LLM
      console.log('\n' + '='.repeat(80));
      console.log('[ChatStream] TOOLS BEING SENT TO LLM:');
      console.log('-'.repeat(80));
      providerTools.forEach((tool, idx) => {
        const name = tool.function?.name || 'unnamed';
        const description = tool.function?.description || '';
        console.log(`  [${idx + 1}] ${name}`);
        if (description) {
          console.log(`      Description: ${description}`);
        }
      });
      console.log('='.repeat(80) + '\n');

      // Build document context if a file is being previewed
      let documentContext = '';
      if (body.viewerFile) {
        console.log(`[ChatStream] Viewer file present: ${body.viewerFile.name}`);
        console.log(`[ChatStream] Viewer id (cache ID): ${body.viewerFile.id}`);
        console.log(`[ChatStream] Viewer fileUri: ${body.viewerFile.fileUri}`);
        console.log(`[ChatStream] Viewer absolutePath: ${body.viewerFile.absolutePath}`);
        
        // Use the local file URI for MCP tools if available
        const fileUriForMcp = body.viewerFile.fileUri || body.viewerFile.absolutePath;
        const cacheId = body.viewerFile.id;
        
        if (fileUriForMcp) {
          // File is available locally, just log it
          console.log(`[ChatStream] File available at: ${fileUriForMcp}`);
        }
        
        // Always show the Cache ID in the system prompt if we have a viewerFile
        // The resolver will look up the temp file by cache ID when MCP tools are called
        documentContext = `

## CURRENT DOCUMENT IN PREVIEW PANE
The user currently has the following document displayed in their preview pane:
- **Filename**: ${body.viewerFile.name}
- **Type**: ${body.viewerFile.mimeType}
- **Cache ID**: ${cacheId}

This document is immediately available for the user to ask questions about or request work on. You should be prepared to help with tasks related to this document such as:
- Summarizing its contents
- Extracting specific information
- Answering questions about it
- Suggesting edits or improvements
- Converting it to other formats

**IMPORTANT**: 
- When using MCP tools like convert_to_markdown to process this document, use the Cache ID: \`${cacheId}\`
- The system will automatically resolve the Cache ID to the correct local file path
- **NEVER mention the Cache ID in your responses to the user** - only use it internally for MCP tool calls
- Refer to the document by its filename ("${body.viewerFile.name}") when talking to the user

If the user asks about "this document" or "the file" without specifying, they are referring to this previewed document.`;
      }

      // Keep track of conversation for tool execution
      // Add system message about file tagging for preview
      const systemMessage = {
        role: 'system' as const,
        content: `You are a helpful assistant with access to Google Drive, file management tools, and persistent memory capabilities.

## IMPORTANT: No Emojis
Do NOT use any emojis in your responses. Write in markdown format only.

## Persistent Memory
You have access to a knowledge graph memory system that persists across conversations. Use these tools to remember important information:

- **create_entities**: Store important information about people, projects, concepts, or any entities you want to remember for future conversations
- **create_relations**: Create relationships between entities (e.g., "Alice" -> "works_on" -> "Project X")
- **add_observations**: Add new observations to existing entities as you learn more
- **read_graph**: View all stored memories and relationships
- **search_nodes**: Search for specific entities or information in your memory
- **open_nodes**: Retrieve detailed information about specific entities

**When to use memory tools:**
- User mentions their preferences, goals, or important personal information
- User shares project details, deadlines, or requirements
- You learn something about the user that would be useful in future conversations
- User asks about something discussed in a previous conversation

**How to respond after using memory tools:**
- Be natural and conversational - like a helpful friend who remembers things
- Use phrases like "I'll keep that in mind" or "Got it, I'll remember that"
- NEVER mention technical details like "stored in knowledge graph" or "entity created"
- NEVER mention cache IDs, file IDs, or internal technical identifiers
- The user should feel like they're talking to someone who simply remembers, not a database

**Example usage:**
- If user says "I'm working on a project called Acme", create an entity for "Acme" project, then respond naturally: "Got it! I'll keep that in mind about the Acme project."
- If user mentions "My manager is Bob", create entities and a relation, then say: "Thanks for letting me know - I'll remember that Bob is your manager."

## File Access
Use MCP tools (search, listFolder, etc.) to access files. When listing files, show only filenames with clickable links - no internal IDs.

## File Previews - CRITICAL
ALWAYS use this format when mentioning ANY file or document:
[preview-file:filename.ext](url)

This applies to:
- Files found via search or listFolder
- Documents you want to show the user
- PDFs, images, HTML files, or any downloadable content
- Google Drive files (convert to download URL first)

For Google Drive files, ALWAYS convert view URLs to download URLs:
- View: https://drive.google.com/file/d/FILE_ID/view
- Download: https://drive.google.com/uc?export=download&id=FILE_ID

Example - when listing files, use:
- [preview-file:Report.pdf](https://drive.google.com/uc?export=download&id=abc123)

The "preview-file:" prefix is REQUIRED for all file links to make them clickable in the preview pane.

## Document Processing
Use convert_to_markdown tool for PDFs and documents. It accepts file://, http://, or https:// URIs.

## CRITICAL: Document Summaries
When summarizing documents, use ONLY actual values from the tool output:
- NEVER use placeholders like [Name], [Date], [Amount]
- If the document says "Meeting: Jan 15, 2026", write exactly that
- If you cannot extract a value, write "Not found in document"
- If the tool returns empty/error, report this honestly - do not fabricate content${documentContext}`,
      };
      
      let conversationMessages = [systemMessage, ...body.messages];
      let assistantContent = '';
      let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
      const MAX_TOOL_ITERATIONS = await getSettingWithDefault<number>('MAX_TOOL_ITERATIONS', 10);
      let toolIteration = 0;

      // Debug logging: print system prompt and user messages
      console.log('\n' + '='.repeat(80));
      console.log('[ChatStream] SYSTEM PROMPT:');
      console.log('-'.repeat(80));
      console.log(systemMessage.content);
      console.log('='.repeat(80) + '\n');

      const processStream = async (messages: typeof body.messages, allowTools: boolean = true) => {
        const stream = llmRouter.stream({
          messages,
          model: body.roleId ? undefined : config.llm.defaultModel,
          tools: allowTools && providerTools.length > 0 ? providerTools : undefined,
        });

        assistantContent = '';
        toolCalls = [];

        for await (const chunk of stream) {
          if (chunk.type === 'text') {
            assistantContent += chunk.content;
            await new Promise(resolve => setTimeout(resolve, 20));
            // Strip emojis from the content before sending to client
            const cleanedContent = stripEmojis(chunk.content || '');
            reply.raw.write(`data: ${JSON.stringify({ content: cleanedContent })}\n\n`);
          } else if (chunk.type === 'tool_call' && chunk.toolCall) {
            const toolCall = chunk.toolCall;
            console.log(`[ChatStream] Tool call: ${toolCall.name}`, {
              serverId: flattenedTools.find(t => t.name === toolCall.name)?.serverId,
            });
            toolCalls.push(toolCall);
            reply.raw.write(`data: ${JSON.stringify({ type: 'tool_call', toolCall })}\n\n`);
          }
        }

        // Debug logging: print raw response
        console.log('\n' + '='.repeat(80));
        console.log('[ChatStream] RAW ASSISTANT RESPONSE:');
        console.log('-'.repeat(80));
        // Strip emojis from the final content
        assistantContent = stripEmojis(assistantContent);
        console.log(assistantContent);
        console.log('-'.repeat(80));
        if (toolCalls.length > 0) {
          console.log('[ChatStream] TOOL CALLS:');
          toolCalls.forEach((tc, idx) => {
            console.log(`  [${idx}] ${tc.name}: ${JSON.stringify(tc.arguments)}`);
          });
        }
        console.log('='.repeat(80) + '\n');
      };

      // First stream
      await processStream(conversationMessages);

      // Handle tool execution if tools were called (with iteration limit)
      while (toolCalls.length > 0 && toolIteration < MAX_TOOL_ITERATIONS) {
        toolIteration++;
        console.log(`[ChatStream] Tool execution iteration ${toolIteration}/${MAX_TOOL_ITERATIONS}`);

        // Add assistant message with content and tool calls
        if (assistantContent) {
          conversationMessages.push({
            role: 'assistant',
            content: assistantContent,
          });
        }

        // Execute tools and add results
        for (const toolCall of toolCalls) {
          console.log(`[ChatStream] Executing tool: ${toolCall.name}`);
          const toolResult = await executeToolWithAdapters(request.user!.id, toolCall.name, toolCall.arguments);

          // Add tool result to conversation
          conversationMessages.push({
            role: 'user',
            content: `Tool result for ${toolCall.name}:\n${toolResult}`,
          });

          // Include serverId with tool_result event so client knows which server the tool came from
          const serverId = flattenedTools.find(t => t.name === toolCall.name)?.serverId;
          reply.raw.write(`data: ${JSON.stringify({ type: 'tool_result', toolName: toolCall.name, serverId, result: toolResult })}\n\n`);
        }

        // Continue streaming with tool results - disable tools after first iteration to get text response
        const allowMoreTools = toolIteration < MAX_TOOL_ITERATIONS;
        console.log(`[ChatStream] Continuing stream (tools allowed: ${allowMoreTools})`);
        await processStream(conversationMessages, allowMoreTools);
      }

      if (toolIteration >= MAX_TOOL_ITERATIONS && toolCalls.length > 0) {
        reply.raw.write(`data: ${JSON.stringify({ type: 'info', message: 'Tool execution limit reached' })}\n\n`);
      }

      reply.raw.write('data: [DONE]\n\n');
    } catch (error) {
      fastify.log.error(error, 'Chat streaming error');
      console.error('[ChatStream] Error:', error);

      // Extract error message for user feedback
      let errorMessage = 'Failed to stream response';
      if (error instanceof Error) {
        errorMessage = error.message;
      } else if (typeof error === 'object' && error !== null) {
        errorMessage = (error as any).error || (error as any).message || errorMessage;
      }

      // Send error to client
      reply.raw.write(`data: ${JSON.stringify({
        type: 'error',
        message: errorMessage,
        error: true
      })}\n\n`);
      reply.raw.write('data: [DONE]\n\n');
    } finally {
      reply.raw.end();
    }
  });
}, { prefix: '/api' });

// Viewer routes
fastify.register(async (instance) => {
  instance.get('/viewer/files', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    // Placeholder - return empty list
    return reply.send({ success: true, data: [] });
  });

  instance.get('/viewer/gmail', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    
    // Placeholder - return empty list
    return reply.send({ success: true, data: [] });
  });

  // Download file to temp directory for preview
  instance.post('/viewer/download', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as { url: string; filename?: string; mimeType?: string };
    
    console.log('\n[ViewerDownload] ========================================');
    console.log('[ViewerDownload] Download request received');
    console.log(`[ViewerDownload]   URL: ${body.url}`);
    console.log(`[ViewerDownload]   Filename: ${body.filename}`);
    console.log(`[ViewerDownload]   MIME Type: ${body.mimeType}`);
    
    if (!body.url) {
      console.log('[ViewerDownload] ERROR: URL is required');
      return reply.code(400).send({ success: false, error: { message: 'URL is required' } });
    }

    try {
      const fs = await import('fs/promises');
      
      // Create temp directory if it doesn't exist
      const tempDir = path.join(config.storage.root, 'temp');
      await fs.mkdir(tempDir, { recursive: true }).catch(() => {});
      
      // Generate a cache key from the URL
      const crypto = await import('crypto');
      const urlHash = crypto.createHash('md5').update(body.url).digest('hex').substring(0, 12);
      
      // Check if this is a Google Drive URL to extract file ID for caching
      const gdriveMatch = body.url.match(/drive\.google\.com\/.*(?:file\/d\/|id=)([a-zA-Z0-9_-]+)/);
      const gdriveDownloadMatch = body.url.match(/drive\.google\.com\/uc\?export=download&id=([a-zA-Z0-9_-]+)/);
      const gdriveFileId = gdriveMatch?.[1] || gdriveDownloadMatch?.[1];
      
      // Use Google Drive file ID as cache key if available, otherwise use URL hash
      const cacheKey = gdriveFileId || urlHash;
      
      // Look for existing cached file with this cache key
      const tempFiles = await fs.readdir(tempDir).catch(() => []);
      // Find a file that matches the cache ID (format: {cacheId}.{ext})
      const cachedFile = tempFiles.find(f => {
        const dotIndex = f.lastIndexOf('.');
        const fileCacheId = dotIndex > 0 ? f.substring(0, dotIndex) : f;
        return fileCacheId === cacheKey;
      });
      
      if (cachedFile) {
        const cachedFilePath = path.join(tempDir, cachedFile);
        const stats = await fs.stat(cachedFilePath);
        console.log(`[ViewerDownload] Found cached file: ${cachedFile}`);
        console.log(`[ViewerDownload] Cache hit! Using local file (${stats.size} bytes)`);
        
        // Determine content type from extension
        const ext = cachedFile.split('.').pop()?.toLowerCase() || '';
        const contentTypes: Record<string, string> = {
          pdf: 'application/pdf',
          png: 'image/png',
          jpg: 'image/jpeg',
          jpeg: 'image/jpeg',
          gif: 'image/gif',
          svg: 'image/svg+xml',
          html: 'text/html',
          txt: 'text/plain',
          json: 'application/json',
          md: 'text/markdown',
        };
        const contentType = contentTypes[ext] || body.mimeType || 'application/octet-stream';
        
        const previewUrl = `/api/viewer/temp/${cachedFile}`;
        const absoluteFilePath = path.resolve(cachedFilePath);
        const fileUri = `file://${absoluteFilePath}`;
        
        // Get the original filename from the request or cached file
        const originalFilename = body.filename || cachedFile;
        
        console.log(`[ViewerDownload] Preview URL: ${previewUrl}`);
        console.log('[ViewerDownload] ========================================\n');
        
        return reply.send({
          success: true,
          data: {
            id: cacheKey,
            name: originalFilename,
            mimeType: contentType,
            previewUrl,
            fileUri,
            absolutePath: absoluteFilePath,
            size: stats.size,
            cached: true,
          },
        });
      }
      
      console.log(`[ViewerDownload] Cache miss. Downloading file...`);
      
      let buffer: Buffer;
      let contentType = body.mimeType || 'application/octet-stream';
      let filename = body.filename || 'downloaded-file';

      if (gdriveFileId) {
        console.log(`[ViewerDownload] Detected Google Drive file ID: ${gdriveFileId}`);
        
        // Get user's Google OAuth token
        let oauthToken = await authService.getOAuthToken(request.user!.id, 'google');
        
        if (!oauthToken) {
          console.log('[ViewerDownload] ERROR: No Google OAuth token found for user');
          return reply.code(403).send({ 
            success: false, 
            error: { 
              message: 'Google authentication required to download files. Please authenticate with Google first.',
              authRequired: true,
              authProvider: 'google'
            } 
          });
        }

        console.log(`[ViewerDownload] Using Google OAuth token for download`);
        console.log(`[ViewerDownload] Access token length: ${oauthToken.accessToken.length}`);
        console.log(`[ViewerDownload] Access token prefix: ${oauthToken.accessToken.substring(0, 10)}...`);
        console.log(`[ViewerDownload] Access token suffix: ...${oauthToken.accessToken.substring(oauthToken.accessToken.length - 10)}`);
        console.log(`[ViewerDownload] Token expiry date: ${oauthToken.expiryDate ? new Date(oauthToken.expiryDate).toISOString() : 'not set'}`);
        console.log(`[ViewerDownload] Has refresh token: ${!!oauthToken.refreshToken}`);
        console.log(`[ViewerDownload] Refresh token length: ${oauthToken.refreshToken?.length || 0}`);
        console.log(`[ViewerDownload] Token provider: ${oauthToken.provider}`);

        // Check if token is expired and refresh if needed
        const now = Date.now();
        const tokenExpired = oauthToken.expiryDate && oauthToken.expiryDate < now;
        
        if (tokenExpired) {
          console.log('[ViewerDownload] Token is expired, attempting refresh...');
          
          if (!oauthToken.refreshToken) {
            console.log('[ViewerDownload] ERROR: Token expired and no refresh token available');
            return reply.code(403).send({ 
              success: false, 
              error: { 
                message: 'Google authentication expired. Please re-authenticate with Google.',
                authRequired: true,
                authProvider: 'google'
              } 
            });
          }

          try {
            // Create Google OAuth handler for token refresh
            const googleOAuth = new GoogleOAuthHandler({
              clientId: process.env.GOOGLE_CLIENT_ID || '',
              clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
              redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
            });

            console.log('[ViewerDownload] Refreshing access token...');
            const newTokens = await googleOAuth.refreshAccessToken(oauthToken.refreshToken);
            
            // Update stored token
            oauthToken = await authService.storeOAuthToken(request.user!.id, {
              provider: 'google',
              accessToken: newTokens.access_token,
              refreshToken: newTokens.refresh_token || oauthToken.refreshToken,
              expiryDate: Date.now() + (newTokens.expires_in * 1000),
            } as any);
            
            console.log(`[ViewerDownload] Token refreshed successfully. New expiry: ${new Date(oauthToken.expiryDate!).toISOString()}`);
          } catch (refreshError) {
            console.error('[ViewerDownload] Failed to refresh token:', refreshError);
            return reply.code(403).send({ 
              success: false, 
              error: { 
                message: 'Failed to refresh Google authentication. Please re-authenticate with Google.',
                authRequired: true,
                authProvider: 'google'
              } 
            });
          }
        }

        // First, check if file exists by fetching metadata
        const metadataUrl = `https://www.googleapis.com/drive/v3/files/${gdriveFileId}?supportsAllDrives=true&fields=id,name,mimeType,webContentLink`;
        console.log(`[ViewerDownload] Fetching file metadata: ${metadataUrl}`);

        let metadataResponse = await fetch(metadataUrl, {
          headers: {
            'Authorization': `Bearer ${oauthToken.accessToken}`,
          },
        });

        if (metadataResponse.ok) {
          const metadata = await metadataResponse.json() as any;
          console.log(`[ViewerDownload] File metadata:`, JSON.stringify(metadata));
          console.log(`[ViewerDownload] File name: ${metadata.name}`);
          console.log(`[ViewerDownload] File MIME type: ${metadata.mimeType}`);
          console.log(`[ViewerDownload] Web content link: ${metadata.webContentLink}`);
        } else {
          const errorText = await metadataResponse.text();
          console.log(`[ViewerDownload] Metadata fetch failed: ${metadataResponse.status}`);
          console.log(`[ViewerDownload] Error: ${errorText.substring(0, 300)}`);
        }

        // Use Google Drive API to download the file
        // Note: supportsAllDrives=true allows access to Shared Drives and shared files
        const driveApiUrl = `https://www.googleapis.com/drive/v3/files/${gdriveFileId}?alt=media&supportsAllDrives=true`;
        console.log(`[ViewerDownload] Fetching from Drive API: ${driveApiUrl}`);

        let response = await fetch(driveApiUrl, {
          headers: {
            'Authorization': `Bearer ${oauthToken.accessToken}`,
          },
        });

        // If still getting 401 after refresh, try refreshing once more
        if (response.status === 401 && oauthToken.refreshToken) {
          console.log('[ViewerDownload] Got 401, attempting another token refresh...');
          
          try {
            const googleOAuth = new GoogleOAuthHandler({
              clientId: process.env.GOOGLE_CLIENT_ID || '',
              clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
              redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/auth/google/callback',
            });

            const newTokens = await googleOAuth.refreshAccessToken(oauthToken.refreshToken);
            
            oauthToken = await authService.storeOAuthToken(request.user!.id, {
              provider: 'google',
              accessToken: newTokens.access_token,
              refreshToken: newTokens.refresh_token || oauthToken.refreshToken,
              expiryDate: Date.now() + (newTokens.expires_in * 1000),
            } as any);
            
            console.log(`[ViewerDownload] Token refreshed again. Retrying download...`);

            // Retry the request with new token using the same URL with supportsAllDrives
            response = await fetch(`https://www.googleapis.com/drive/v3/files/${gdriveFileId}?alt=media&supportsAllDrives=true`, {
              headers: {
                'Authorization': `Bearer ${oauthToken.accessToken}`,
              },
            });
          } catch (refreshError) {
            console.error('[ViewerDownload] Second refresh attempt failed:', refreshError);
          }
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.log(`[ViewerDownload] ERROR: Drive API failed: ${response.status} ${response.statusText}`);
          console.log(`[ViewerDownload] Error response: ${errorText.substring(0, 500)}`);
          console.log(`[ViewerDownload] Response headers:`);
          for (const [key, value] of response.headers) {
            if (key.toLowerCase().includes('auth') || key.toLowerCase().includes('www-authenticate')) {
              console.log(`[ViewerDownload]   ${key}: ${value}`);
            }
          }
          
          // Check if token might be expired
          if (response.status === 401) {
            return reply.code(403).send({ 
              success: false, 
              error: { 
                message: 'Google authentication expired. Please re-authenticate with Google.',
                authRequired: true,
                authProvider: 'google'
              } 
            });
          }
          
          return reply.code(400).send({ success: false, error: { message: `Failed to fetch file from Google Drive: ${response.statusText}` } });
        }

        // Get content type from response
        contentType = response.headers.get('content-type') || body.mimeType || 'application/octet-stream';
        console.log(`[ViewerDownload] Content-Type from Drive API: ${contentType}`);

        // Get filename from Content-Disposition header if available
        const contentDisposition = response.headers.get('content-disposition');
        if (contentDisposition) {
          const filenameMatch = contentDisposition.match(/filename\*?=["']?(?:UTF-\d['"]*)?([^"';\r\n]+)/);
          if (filenameMatch) {
            filename = decodeURIComponent(filenameMatch[1]);
            console.log(`[ViewerDownload] Filename from Content-Disposition: ${filename}`);
          }
        }

        // If no filename from header, use the provided one or generate from file ID
        if (!filename || filename === 'downloaded-file') {
          filename = body.filename || `document-${gdriveFileId.substring(0, 8)}.pdf`;
        }

        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
        console.log(`[ViewerDownload] Downloaded ${buffer.length} bytes from Drive API`);
      } else {
        // Regular URL download (non-Google Drive)
        console.log(`[ViewerDownload] Fetching file from URL...`);
        const response = await fetch(body.url);
        
        if (!response.ok) {
          console.log(`[ViewerDownload] ERROR: Failed to fetch: ${response.status} ${response.statusText}`);
          return reply.code(400).send({ success: false, error: { message: `Failed to fetch file: ${response.statusText}` } });
        }

        contentType = body.mimeType || response.headers.get('content-type') || 'application/octet-stream';
        console.log(`[ViewerDownload] Content-Type: ${contentType}`);
        
        const urlPath = new URL(body.url).pathname;
        const defaultFilename = urlPath.split('/').pop() || 'downloaded-file';
        filename = body.filename || defaultFilename;

        const arrayBuffer = await response.arrayBuffer();
        buffer = Buffer.from(arrayBuffer);
      }

      // Generate filename with cache key (no timestamp needed)
      const fileExtension = filename.includes('.') ? `.${filename.split('.').pop()}` : '';
      const tempFilename = sanitizeFilename(`${cacheKey}${fileExtension}`);
      const tempFilePath = path.join(tempDir, tempFilename);
      console.log(`[ViewerDownload] Temp file path: ${tempFilePath}`);

      // Write file to temp directory
      console.log(`[ViewerDownload] File size: ${buffer.length} bytes`);
      await fs.writeFile(tempFilePath, buffer);
      console.log(`[ViewerDownload] File written successfully`);

      // Return the local URL for preview
      const previewUrl = `/api/viewer/temp/${tempFilename}`;
      
      // Get absolute path for markitdown file:// URI
      const absoluteFilePath = path.resolve(tempFilePath);
      const fileUri = `file://${absoluteFilePath}`;
      
      console.log(`[ViewerDownload] Preview URL: ${previewUrl}`);
      console.log(`[ViewerDownload] File URI for markitdown: ${fileUri}`);
      console.log('[ViewerDownload] ========================================\n');

      return reply.send({
        success: true,
        data: {
          id: cacheKey,
          name: filename,
          mimeType: contentType,
          previewUrl,
          fileUri,  // Add file:// URI for use with convert_to_markdown
          absolutePath: absoluteFilePath,  // Also provide raw path
          size: buffer.length,
          cached: false,
        },
      });
    } catch (error) {
      fastify.log.error(error, 'Failed to download file for preview');
      console.log(`[ViewerDownload] ERROR: ${error}`);
      console.log('[ViewerDownload] ========================================\n');
      return reply.code(500).send({ success: false, error: { message: 'Failed to download file' } });
    }
  });

  // Serve temp files for preview
  instance.get('/viewer/temp/:filename', async (request, reply) => {
    const params = request.params as { filename: string };
    const tempDir = path.join(config.storage.root, 'temp');
    
    // Security: Validate filename to prevent path traversal attacks
    const filename = params.filename;
    
    // Reject filenames with path separators or parent directory references
    if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) {
      console.log(`[ViewerTemp] SECURITY: Rejected path traversal attempt: ${filename}`);
      return reply.code(400).send({ success: false, error: { message: 'Invalid filename' } });
    }
    
    // Reject absolute paths
    if (path.isAbsolute(filename)) {
      console.log(`[ViewerTemp] SECURITY: Rejected absolute path: ${filename}`);
      return reply.code(400).send({ success: false, error: { message: 'Invalid filename' } });
    }
    
    const filePath = path.join(tempDir, filename);
    
    // Security: Verify the resolved path is still within temp directory
    const resolvedPath = path.resolve(filePath);
    const resolvedTempDir = path.resolve(tempDir);
    if (!resolvedPath.startsWith(resolvedTempDir + path.sep) && resolvedPath !== resolvedTempDir) {
      console.log(`[ViewerTemp] SECURITY: Path escape attempt - resolved to: ${resolvedPath}`);
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    try {
      // Check if file exists
      const fs = await import('fs/promises');
      await fs.access(filePath);

      // Determine content type based on file extension
      const ext = filename.split('.').pop()?.toLowerCase() || '';
      const contentTypes: Record<string, string> = {
        pdf: 'application/pdf',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        gif: 'image/gif',
        svg: 'image/svg+xml',
        html: 'text/html',
        txt: 'text/plain',
        json: 'application/json',
        md: 'text/markdown',
      };
      const contentType = contentTypes[ext] || 'application/octet-stream';

      // Read and send file
      const fileBuffer = await fs.readFile(filePath);
      reply.header('Content-Type', contentType);
      reply.header('Content-Length', fileBuffer.length);
      reply.header('Content-Disposition', `inline; filename="${filename}"`);
      return reply.send(fileBuffer);
    } catch {
      return reply.code(404).send({ success: false, error: { message: 'File not found' } });
    }
  });
}, { prefix: '/api' });

// MCP routes
fastify.register(async (instance) => {
  instance.get('/mcp/servers', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    // Get IDs of hidden predefined servers
    const hiddenServerIds = new Set(
      PREDEFINED_MCP_SERVERS.filter(s => s.hidden).map(s => s.id)
    );

    // Return full server objects with { id, config, info }, filtering out hidden servers
    // Check both the config.hidden flag AND if the server ID matches a hidden predefined server
    const servers = mcpManager.getServers().filter(s =>
      !s.config.hidden && !hiddenServerIds.has(s.id)
    );
    return reply.send({ success: true, data: servers });
  });

  instance.post('/mcp/servers', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as any;
    const config = {
      id: body.id || undefined,
      name: body.name,
      transport: body.transport,
      command: body.command,
      args: body.args,
      cwd: body.cwd,
      url: body.url,
      enabled: true,
      autoStart: false,
      restartOnExit: false,
      auth: body.auth,
      env: body.env,
    };

    try {
      // If auth config includes Google OAuth, fetch the stored token
      let userToken: any;
      if (config.auth?.provider === 'google') {
        const oauthToken = await authService.getOAuthToken(request.user.id, 'google');
        if (oauthToken) {
          userToken = {
            access_token: oauthToken.accessToken,
            refresh_token: oauthToken.refreshToken,
            expiry_date: oauthToken.expiryDate,
            token_type: 'Bearer',
          };
          console.log(`[MCP] Using stored Google OAuth token for server ${config.name}`);
        }
      }

      await mcpManager.addServer(config, userToken);
      return reply.send({ success: true, data: { name: body.name, connected: true } });
    } catch (error) {
      return reply.code(500).send({ success: false, error: { message: 'Failed to connect to MCP server', details: String(error) } });
    }
  });

  instance.get('/mcp/servers/:id/tools', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const tools = mcpManager.getTools(params.id);
    return reply.send({ success: true, data: tools });
  });

  // Update MCP server status
  instance.patch('/mcp/servers/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const { enabled } = request.body as { enabled?: boolean };

    if (typeof enabled !== 'boolean') {
      return reply.code(400).send({ success: false, error: { message: 'enabled must be a boolean' } });
    }

    try {
      await mcpManager.updateServerStatus(params.id, enabled);
      return reply.send({ success: true });
    } catch (error) {
      return reply.code(400).send({ success: false, error: { message: 'Failed to update server status' } });
    }
  });

  // Delete MCP server
  instance.delete('/mcp/servers/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    try {
      await mcpManager.removeServer(params.id);
      return reply.send({ success: true });
    } catch (error) {
      return reply.code(400).send({ success: false, error: { message: 'Failed to remove server' } });
    }
  });

  // List available predefined MCP servers
  instance.get('/mcp/available-servers', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const servers = listPredefinedServers();
    return reply.send({ success: true, data: servers });
  });

  // Add a predefined MCP server
  instance.post('/mcp/servers/add-predefined', async (request, reply) => {
    const requestId = uuidv4().substring(0, 8);
    console.log(`[AddPredefinedServer:${requestId}] Request started`);

    if (!request.user) {
      console.log(`[AddPredefinedServer:${requestId}] Not authenticated`);
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const { serverId } = request.body as { serverId: string };
    console.log(`[AddPredefinedServer:${requestId}] serverId: ${serverId}`);

    if (!serverId) {
      console.log(`[AddPredefinedServer:${requestId}] serverId is missing`);
      return reply.code(400).send({
        success: false,
        error: { message: 'serverId is required' },
      });
    }

    console.log(`[AddPredefinedServer:${requestId}] Looking up predefined server...`);
    const predefinedServer = getPredefinedServer(serverId);
    if (!predefinedServer) {
      console.log(`[AddPredefinedServer:${requestId}] Predefined server not found`);
      return reply.code(404).send({
        success: false,
        error: { message: `Unknown server: ${serverId}` },
      });
    }

    try {
      console.log(`[AddPredefinedServer:${requestId}] Checking auth requirements...`);
      // Check if auth is required and available
      if (requiresAuth(serverId)) {
        if (predefinedServer.auth?.provider === 'google') {
          console.log(`[AddPredefinedServer:${requestId}] Google auth required, checking token...`);
          const oauthToken = await authService.getOAuthToken(request.user.id, 'google');
          if (!oauthToken) {
            console.log(`[AddPredefinedServer:${requestId}] No OAuth token found`);
            return reply.code(403).send({
              success: false,
              error: {
                code: 'NO_AUTH',
                message: `${predefinedServer.name} requires Google authentication. Please authenticate first.`,
                authRequired: true,
                authProvider: 'google',
              },
            });
          }
          console.log(`[AddPredefinedServer:${requestId}] OAuth token found`);
        }
        // Add other auth providers as needed
      }

      // Create config from predefined server
      console.log(`[AddPredefinedServer:${requestId}] Creating server config...`);
      const config = {
        id: undefined, // Will be auto-generated
        name: predefinedServer.name,
        transport: 'stdio' as const,
        command: predefinedServer.command,
        args: predefinedServer.args,
        cwd: undefined,
        url: undefined,
        enabled: true,
        autoStart: false,
        restartOnExit: false,
        auth: predefinedServer.auth,
        env: predefinedServer.env || {},
      };

      // Prepare token if needed
      let userToken: any;
      if (config.auth?.provider === 'google') {
        console.log(`[AddPredefinedServer:${requestId}] Preparing Google token...`);
        const oauthToken = await authService.getOAuthToken(request.user.id, 'google');
        if (oauthToken) {
          userToken = {
            access_token: oauthToken.accessToken,
            refresh_token: oauthToken.refreshToken,
            expiry_date: oauthToken.expiryDate,
            token_type: 'Bearer',
          };
          console.log(`[AddPredefinedServer:${requestId}] Token prepared`);
        }
      }

      // Add server via MCPManager
      console.log(`[AddPredefinedServer:${requestId}] Calling mcpManager.addServer...`);
      await mcpManager.addServer(config, userToken);
      console.log(`[AddPredefinedServer:${requestId}] Server added successfully`);

      console.log(`[AddPredefinedServer:${requestId}] Sending success response`);
      return reply.send({
        success: true,
        data: {
          id: predefinedServer.id,
          name: predefinedServer.name,
          connected: true,
        },
      });
    } catch (error) {
      console.error(`[AddPredefinedServer:${requestId}] Error occurred:`, error);
      return reply.code(500).send({
        success: false,
        error: {
          message: `Failed to connect to ${predefinedServer.name}`,
          details: String(error),
        },
      });
    } finally {
      console.log(`[AddPredefinedServer:${requestId}] Request completed`);
    }
  });
}, { prefix: '/api' });

// Settings routes
fastify.register(async (instance) => {
  // Get all settings
  instance.get('/settings', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const settings = await storage.getAllSettings();
    return reply.send({ success: true, data: settings });
  });

  // Get a specific setting
  instance.get('/settings/:key', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { key: string };
    const value = await storage.getSetting(params.key);
    
    if (value === null) {
      return reply.code(404).send({ success: false, error: { message: 'Setting not found' } });
    }
    
    return reply.send({ success: true, data: { key: params.key, value } });
  });

  // Update a setting
  instance.put('/settings/:key', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { key: string };
    const body = request.body as { value: unknown };
    
    if (body.value === undefined) {
      return reply.code(400).send({ success: false, error: { message: 'Value is required' } });
    }

    await storage.setSetting(params.key, body.value);
    console.log(`[Settings] Updated setting: ${params.key} = ${JSON.stringify(body.value)}`);
    
    return reply.send({ success: true, data: { key: params.key, value: body.value } });
  });

  // Delete a setting (resets to default on next startup)
  instance.delete('/settings/:key', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { key: string };
    await storage.deleteSetting(params.key);
    console.log(`[Settings] Deleted setting: ${params.key}`);
    
    return reply.send({ success: true });
  });
}, { prefix: '/api' });

// Start server
const start = async () => {
  try {
    // Initialize storage (already created globally)
    await storage.initialize();

    // Initialize default settings
    await initializeDefaultSettings();
    fastify.log.info('Default settings initialized');

    // Initialize auth service
    await authService.initialize();
    fastify.log.info('Auth service initialized');

    // Initialize MCP manager
    await mcpManager.initialize();
    fastify.log.info('MCP manager initialized with persisted servers');

    // Initialize LLM router
    llmRouter = createLLMRouter(config.llm);
    fastify.log.info({ provider: config.llm.provider, hasGrokKey: !!config.llm.grokKey }, 'LLM router initialized');

    // Start listening
    await fastify.listen({
      port: config.port,
      host: config.host,
    });

    console.log(`Server listening on ${config.host}:${config.port}`);
  } catch (error) {
    fastify.log.error(error);
    process.exit(1);
  }
};

// Handle shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await mcpManager.disconnectAll();
  await fastify.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await mcpManager.disconnectAll();
  await fastify.close();
  process.exit(0);
});

// Start the server
start();

// Export for testing
export { fastify, config };