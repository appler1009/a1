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
import { createStorage, autoMigrate, getMainDatabase } from './storage/index.js';
import type { RoleDefinition } from './storage/index.js';
import { createLLMRouter } from './ai/router.js';
import { mcpManager, getMcpAdapter, closeUserAdapters, listPredefinedServers, getPredefinedServer, requiresAuth, PREDEFINED_MCP_SERVERS } from './mcp/index.js';
import { authRoutes } from './api/auth.js';
import { authService } from './auth/index.js';
import { GoogleOAuthHandler } from './auth/google-oauth.js';
import fs from 'fs';

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

// Global storage instance - initialized before routes (deprecated, kept for backward compatibility)
const storage = createStorage({
  type: (process.env.STORAGE_TYPE as 'fs' | 'sqlite' | 's3') || 'fs',
  root: process.env.STORAGE_ROOT || './data',
  bucket: process.env.STORAGE_BUCKET || '',
  endpoint: process.env.STORAGE_ENDPOINT,
  region: process.env.STORAGE_REGION,
});

// Module-level current role tracking (replaces roleStorage.currentRoleId)
let serverCurrentRoleId: string | null = null;

// Default settings
const DEFAULT_SETTINGS: Record<string, unknown> = {
  MAX_TOOL_ITERATIONS: 10,
};

/**
 * Initialize default settings in the database
 * Only sets values that don't already exist
 */
async function initializeDefaultSettings(): Promise<void> {
  const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    const existing = mainDb.getSetting(key);
    if (existing === null) {
      console.log(`[Settings] Initializing default setting: ${key} = ${value}`);
      mainDb.setSetting(key, value);
    }
  }
}

/**
 * Get a setting value with fallback to default
 */
function getSettingWithDefault<T>(key: string, defaultValue: T): T {
  const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');
  const value = mainDb.getSetting<T>(key);
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
  
  // Extract role ID from request headers and set it as the current role
  // This allows the client to specify the role context for each request
  const headerRoleId = request.headers['x-role-id'] as string | undefined;
  if (headerRoleId && request.user) {
    // Verify the user owns this role before setting it
    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');
    const role = mainDb.getRole(headerRoleId);
    if (role && role.userId === request.user.id) {
      // Set the current role for this request
      serverCurrentRoleId = headerRoleId;
      console.log(`[Request] Setting role from header: ${headerRoleId} (${role.name})`);
    } else {
      console.log(`[Request] WARNING: Invalid role ID in header: ${headerRoleId} (role not found or not owned by user)`);
    }
  }
});

/**
 * New Adapter-Based Tool Execution Flow
 *
 * This function bridges the current MCPManager-based server lifecycle management
 * with the new adapter pattern for runtime tool execution.
 *
 * Flow:
 * 1. Check tool cache to find which server has the tool
 * 2. If found in cache, connect only to that server
 * 3. If not in cache, search all servers (and update cache)
 * 4. Use uniform adapter interface to call tools
 *
 * Benefits:
 * - Fast tool lookups via cache (no need to connect to all servers)
 * - Uniform interface regardless of MCP server type
 * - Auth file preparation on-demand during adapter creation
 * - Transparent connection caching and pooling
 */
async function executeToolWithAdapters(
  userId: string,
  toolName: string,
  args: Record<string, unknown>,
  roleId?: string
): Promise<string> {
  try {
    console.log(`\n[ToolExecution] ========================================`);
    console.log(`[ToolExecution] Tool Request: ${toolName}`);
    console.log(`[ToolExecution] Arguments: ${JSON.stringify(args, null, 2)}`);
    console.log(`[ToolExecution] User: ${userId}, Role: ${roleId || 'global'}`);

    // Import tool cache
    const { toolCache } = await import('./mcp/tool-cache.js');

    // First, check the tool cache to find which server has this tool
    const cachedTool = toolCache.findToolServer(toolName);
    
    if (cachedTool) {
      console.log(`[ToolExecution] Cache HIT: Tool "${toolName}" found on server: ${cachedTool.serverId}`);

      try {
        // Connect only to the specific server that has the tool
        const adapter = await getMcpAdapter(userId, cachedTool.serverId, roleId);
        
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
        console.log(`[ToolExecution] Tool execution successful (from cache)`);
        console.log(`[ToolExecution] Result length: ${resultText.length} chars`);
        
        // Handle convert_to_markdown special case
        return await handleToolResult(toolName, args, resultText, userId);
      } catch (error) {
        console.error(`[ToolExecution] Error executing cached tool on ${cachedTool.serverId}:`, error);
        // Fall through to full search below
      }
    }

    // Cache miss or error - search all servers
    console.log(`[ToolExecution] Cache MISS: Searching all servers for tool: ${toolName}`);
    
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
        const adapter = await getMcpAdapter(userId, server.id, roleId);
        const tools = await adapter.listTools();
        console.log(`[ToolExecution] Server ${server.id} has ${tools.length} tools available`);
        
        // Update the tool cache with this server's tools
        toolCache.updateServerTools(server.id, tools);

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
          
          // Handle convert_to_markdown special case
          return await handleToolResult(toolName, args, resultText, userId);
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

/**
 * Handle tool result with special processing for certain tools
 */
async function handleToolResult(
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

// Roles routes - using main database
fastify.register(async (instance) => {
  // Get roles for user or group
  instance.get('/roles', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    console.log(`[/api/roles] 🔍 FETCHING ROLES`);
    console.log(`[/api/roles] User ID: ${request.user.id}`);
    console.log(`[/api/roles] User email: ${request.user.email}`);

    const query = request.query as { groupId?: string };
    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    let roles: RoleDefinition[];
    if (query.groupId) {
      console.log(`[/api/roles] Query type: GROUP (${query.groupId})`);
      roles = mainDb.getGroupRoles(query.groupId);
    } else {
      console.log(`[/api/roles] Query type: USER`);
      roles = mainDb.getUserRoles(request.user.id);
    }

    // Include the currently active role ID
    const currentRoleId = serverCurrentRoleId;

    console.log(`[/api/roles] ✓ Found ${roles.length} roles`);
    if (roles.length > 0) {
      console.log(`[/api/roles] Role IDs: ${roles.map(r => `${r.id}(${r.name})`).join(', ')}`);
    } else {
      console.log(`[/api/roles] ⚠️  NO ROLES FOUND FOR THIS USER!`);
    }
    console.log(`[/api/roles] Current role ID from server: ${currentRoleId}`);

    return reply.send({
      success: true,
      data: {
        roles,
        currentRoleId,
      }
    });
  });

  // Get the currently active role
  instance.get('/roles/current', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const currentRoleId = serverCurrentRoleId;

    if (!currentRoleId) {
      return reply.send({
        success: true,
        data: {
          currentRole: null,
          message: 'No role is currently active'
        }
      });
    }

    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');
    const role = mainDb.getRole(currentRoleId);

    // Verify ownership
    if (!role || role.userId !== request.user.id) {
      // Clear the invalid role
      serverCurrentRoleId = null;
      return reply.send({
        success: true,
        data: {
          currentRole: null,
          message: 'No role is currently active'
        }
      });
    }

    return reply.send({
      success: true,
      data: {
        currentRole: role,
      }
    });
  });

  // Create role - creates a record in main.db
  instance.post('/roles', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as { groupId?: string; name: string; jobDesc?: string; systemPrompt?: string; model?: string };

    try {
      const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');
      const role = mainDb.createRole(
        request.user.id,
        body.name,
        body.groupId,
        body.jobDesc,
        body.systemPrompt,
        body.model
      );

      console.log(`[Roles] Created role ${role.id} "${role.name}" for user ${request.user.id}`);
      return reply.send({ success: true, data: role });
    } catch (error) {
      console.error('[Roles] Failed to create role:', error);
      return reply.code(500).send({ success: false, error: { message: 'Failed to create role' } });
    }
  });

  // Get a specific role
  instance.get('/roles/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');
    const role = mainDb.getRole(params.id);

    if (!role) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    // Verify ownership
    if (role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    return reply.send({ success: true, data: role });
  });

  // Update role
  instance.patch('/roles/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const body = request.body as { name?: string; jobDesc?: string; systemPrompt?: string; model?: string };
    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify ownership
    const existingRole = mainDb.getRole(params.id);
    if (!existingRole) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    if (existingRole.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    const role = mainDb.updateRole(params.id, body);
    return reply.send({ success: true, data: role });
  });

  // Delete role - removes the role from main.db and its memory DB file
  instance.delete('/roles/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify ownership
    const existingRole = mainDb.getRole(params.id);
    if (!existingRole) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    if (existingRole.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    // If this is the current role, clear it
    if (serverCurrentRoleId === params.id) {
      serverCurrentRoleId = null;
    }

    // Delete memory DB file if it exists
    const dataDir = process.env.STORAGE_ROOT || './data';
    mainDb.deleteMemoryDb(dataDir, params.id);

    // Delete role messages from main.db
    mainDb.clearMessages(existingRole.userId, params.id);

    // Delete the role from main.db
    mainDb.deleteRole(params.id);
    console.log(`[Roles] Deleted role ${params.id}`);

    return reply.send({ success: true });
  });

  // Switch to a role - sets the active role for the session
  instance.post('/roles/:id/switch', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { id: string };
    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify ownership
    const role = mainDb.getRole(params.id);
    if (!role) {
      return reply.code(404).send({ success: false, error: { message: 'Role not found' } });
    }

    if (role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied' } });
    }

    // Set the current role
    serverCurrentRoleId = params.id;
    
    // Switch MCP servers to the new role
    // This will disconnect auth-required servers and load role-specific MCP configs
    await mcpManager.switchRole(params.id, request.user.id);
    
    console.log(`[Roles] User ${request.user.id} switched to role ${params.id} "${role.name}"`);
    
    return reply.send({ 
      success: true, 
      data: { 
        roleId: params.id, 
        role,
        message: `Switched to role "${role.name}"` 
      } 
    });
  });
}, { prefix: '/api' });

// Chat routes - using main database
fastify.register(async (instance) => {
  // Get messages for a role with pagination
  instance.get('/messages', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { roleId?: string; limit?: number; before?: string };
    const roleId = query.roleId;

    console.log(`[/api/messages GET] User: ${request.user.id}, Requested RoleId: ${roleId}, Server Current: ${serverCurrentRoleId}`);

    if (!roleId) {
      console.log(`[/api/messages GET] ERROR: roleId is required`);
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify role ownership
    const role = mainDb.getRole(roleId);
    if (!role || role.userId !== request.user.id) {
      console.log(`[/api/messages GET] ERROR: Access denied to role ${roleId} (role not found or wrong user)`);
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    const limit = query.limit || 50;

    // Check if role is changing
    const previousRoleId = serverCurrentRoleId;
    const roleChanged = previousRoleId !== roleId;

    // Set current role and get messages
    console.log(`[/api/messages GET] Setting current role to: ${roleId}, Role name: ${role.name}`);
    console.log(`[/api/messages GET] Previous role: ${previousRoleId || 'none'}, Role changed: ${roleChanged}`);
    serverCurrentRoleId = roleId;

    // Switch MCP servers if role changed
    if (roleChanged) {
      console.log(`[/api/messages GET] Role changed, switching MCP servers...`);
      await mcpManager.switchRole(roleId, request.user.id);
    }

    console.log(`[/api/messages GET] Fetching messages from main.db (limit: ${limit}, before: ${query.before || 'none'})`);
    const messages = mainDb.listMessages(request.user.id, roleId, { limit, before: query.before });
    console.log(`[/api/messages GET] Found ${messages.length} messages for role ${roleId}`);

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

    console.log(`[/api/messages POST] User: ${request.user.id}, RoleId: ${body.roleId}, Message role: ${body.role}`);

    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify role ownership
    const role = mainDb.getRole(body.roleId);
    if (!role || role.userId !== request.user.id) {
      console.log(`[/api/messages POST] ERROR: Access denied to role ${body.roleId}`);
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
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

    serverCurrentRoleId = body.roleId;
    mainDb.saveMessage(message);
    const contentPreview = body.content.substring(0, 50) + (body.content.length > 50 ? '...' : '');
    console.log(`[/api/messages POST] Message saved for role ${body.roleId}: "${contentPreview}"`);
    return reply.send({ success: true, data: message });
  });

  // Clear messages for a role
  instance.delete('/messages', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { roleId?: string };
    const roleId = query.roleId;

    if (!roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify role ownership
    const role = mainDb.getRole(roleId);
    if (!role || role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    mainDb.clearMessages(request.user.id, roleId);
    return reply.send({ success: true });
  });

  // Search messages by keyword
  instance.get('/messages/search', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { keyword?: string; roleId?: string; limit?: number };
    const roleId = query.roleId;

    if (!roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify role ownership
    const role = mainDb.getRole(roleId);
    if (!role || role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    const keyword = query.keyword || '';
    const limit = query.limit || 100;

    if (!keyword.trim()) {
      return reply.send({ success: true, data: [] });
    }

    const messages = mainDb.searchMessages(request.user.id, roleId, keyword, { limit });
    return reply.send({ success: true, data: messages });
  });

  // Migrate messages from localStorage (client sends all messages)
  instance.post('/messages/migrate', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as {
      roleId: string;
      messages: Array<{
        id: string;
        roleId: string;
        groupId?: string | null;
        userId?: string;
        role: 'user' | 'assistant' | 'system';
        content: string;
        createdAt: string;
      }>;
    };

    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify role ownership
    const role = mainDb.getRole(body.roleId);
    if (!role || role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    let migrated = 0;
    for (const msg of body.messages) {
      mainDb.saveMessage({
        ...msg,
        userId: msg.userId || request.user.id,
        groupId: msg.groupId || null,
      });
      migrated++;
    }

    return reply.send({ success: true, data: { migrated } });
  });

  /**
   * Enhance tool definition with detailed parameter descriptions
   * Adds context and examples to help LLM understand how to use the tool
   */
  function enrichToolDefinition(tool: {
    name: string;
    description?: string;
    inputSchema?: Record<string, any>;
    serverId?: string;
  }): typeof tool {
    if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
      return tool;
    }

    const enriched = { ...tool };
    const schema = { ...tool.inputSchema };

    // Enhance parameter descriptions with context
    if (schema.properties && typeof schema.properties === 'object') {
      const enhancedProps: Record<string, any> = {};

      for (const [key, prop] of Object.entries(schema.properties)) {
        if (typeof prop === 'object' && prop !== null) {
          enhancedProps[key] = { ...prop };

          // Add helpful hints based on parameter name and type
          if (!enhancedProps[key].description) {
            enhancedProps[key].description = `${key} parameter`;
          }

          // Add examples for common parameter types
          if (enhancedProps[key].type === 'string' && !enhancedProps[key].examples) {
            if (key.includes('id') || key.includes('Id')) {
              enhancedProps[key].description += ' (unique identifier)';
            } else if (key.includes('query') || key.includes('search')) {
              enhancedProps[key].description += ' (natural language query or search term)';
            } else if (key.includes('email')) {
              enhancedProps[key].description += ' (email address)';
            } else if (key.includes('url') || key.includes('uri')) {
              enhancedProps[key].description += ' (full URL or URI)';
            }
          }

          // Add constraints information
          if (enhancedProps[key].minLength) {
            enhancedProps[key].description += ` (min: ${enhancedProps[key].minLength} chars)`;
          }
          if (enhancedProps[key].maxLength) {
            enhancedProps[key].description += ` (max: ${enhancedProps[key].maxLength} chars)`;
          }
          if (enhancedProps[key].enum) {
            enhancedProps[key].description += ` (valid values: ${enhancedProps[key].enum.join(', ')})`;
          }
          if (enhancedProps[key].default !== undefined) {
            enhancedProps[key].description += ` [default: ${enhancedProps[key].default}]`;
          }
        }
      }

      schema.properties = enhancedProps;
    }

    // Add description about required fields if not present
    if (schema.required && Array.isArray(schema.required) && schema.required.length > 0) {
      const existingDesc = enriched.description || '';
      const requiredFields = schema.required.join(', ');
      if (!existingDesc.includes('Required') && !existingDesc.includes('required')) {
        enriched.description = `${existingDesc}${existingDesc ? '\n' : ''}Required parameters: ${requiredFields}`;
      }
    }

    enriched.inputSchema = schema;
    return enriched;
  }

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
      // TWO-PHASE MCP TOOL LOADING
      // Phase 1: Start with only search_tool from meta-mcp-search
      // Phase 2: After search_tool is called, dynamically load relevant tools

      // Ensure role-specific MCP servers (incl. multi-account Gmail/Drive) are loaded
      // for this user. switchRole is idempotent — it only reloads when the role changes
      // or when the adapter is empty.
      const chatRoleId = body.roleId;
      if (chatRoleId && chatRoleId !== mcpManager.getCurrentRoleId()) {
        console.log(`[ChatStream] Role mismatch (current=${mcpManager.getCurrentRoleId()}, request=${chatRoleId}), switching role...`);
        await mcpManager.switchRole(chatRoleId, request.user.id);
      } else if (chatRoleId) {
        // Same role but ensure user-specific adapters (e.g. Gmail) are populated
        await mcpManager.ensureUserServers(chatRoleId, request.user.id);
      }

      // Import the meta-mcp-search module for tool discovery
      const { updateToolManifest } = await import('./mcp/in-process/meta-mcp-search.js');

      // Load ALL available MCP tools for the search manifest
      console.log('[ChatStream] Loading MCP tools from available servers for search manifest');
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

      // Update the meta-mcp-search tool manifest with all available tools
      // This enables semantic search over all tools
      await updateToolManifest(allTools);
      console.log(`[ChatStream] Updated meta-mcp-search manifest with ${flattenedTools.length} tools`);

      // Proactively build tool-to-server mapping for fast lookups
      // This ensures we know which server has which tool BEFORE the LLM makes a tool call
      const { toolCache } = await import('./mcp/tool-cache.js');
      for (const { serverId, tools } of allTools) {
        toolCache.updateServerTools(serverId, tools);
      }
      console.log(`[ChatStream] Tool cache built with ${toolCache.getToolCount()} tool-to-server mappings`);

      // PHASE 1: Start with search_tool (if enabled) + memory retrieval tools
      // The search_tool allows the LLM to discover what tools are available
      // When search is disabled, ALL available MCP tools are included directly
      const enableMetaMcpSearch = process.env.ENABLE_META_MCP_SEARCH !== 'false';

      const phase1Tools = [];

      // When meta-mcp-search is disabled, include all available MCP tools directly in Phase 1
      if (!enableMetaMcpSearch) {
        const hiddenServerIds = new Set(['meta-mcp-search', 'memory', 'sqlite-memory', 'process-each']);
        for (const { serverId, tools } of allTools) {
          if (hiddenServerIds.has(serverId)) continue; // memory tools added separately below
          for (const tool of tools) {
            phase1Tools.push({ ...tool, serverId });
          }
        }
        if (phase1Tools.length > 0) {
          console.log(`[ChatStream] meta-mcp-search disabled: injected ${phase1Tools.length} tools directly into Phase 1`);
        }
      }

      // Add search_tool if enabled
      if (enableMetaMcpSearch) {
        phase1Tools.push({
          name: 'search_tool',
          description: `Search for MCP tools using natural language. Use this tool to discover what tools are available for your task.

IMPORTANT: This is your starting point for tool discovery. Describe what you want to accomplish in plain English, and this tool will return the most relevant MCP tools that can help you.

Examples:
- "list files in google drive" → returns google_drive_list tool
- "send a message to slack" → returns slack_send_message tool
- "create a github issue" → returns github_create_issue tool
- "read a pdf document" → returns convert_to_markdown tool

After calling this tool, you'll receive tool names and their server information. The system will then make those tools available for you to use.`,
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Natural language query describing what you want to accomplish'
              },
              limit: {
                type: 'number',
                default: 5,
                description: 'Maximum number of results to return (default: 5)'
              }
            },
            required: ['query']
          },
          serverId: 'meta-mcp-search',
        });
      }

      // Memory retrieval tools - always available for context
      phase1Tools.push(
        {
          name: 'memory_search_nodes',
          description: 'Search the knowledge graph for relevant entities, relationships, and observations. Use this to find existing context about topics discussed before.',
          inputSchema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query to find relevant entities and observations in memory'
              }
            },
            required: ['query']
          },
          serverId: 'sqlite-memory',
        },
        {
          name: 'memory_read_graph',
          description: 'Read the entire knowledge graph including all entities, relations, and observations. Use this to get a complete overview of what has been learned.',
          inputSchema: {
            type: 'object',
            properties: {}
          },
          serverId: 'sqlite-memory',
        },
        {
          name: 'memory_open_nodes',
          description: 'Retrieve specific entities by name from the knowledge graph. Use this to access detailed information about known topics.',
          inputSchema: {
            type: 'object',
            properties: {
              names: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of entity names to retrieve from memory'
              }
            },
            required: ['names']
          },
          serverId: 'sqlite-memory',
        }
      );

      // Convert tools to provider format
      const providerTools = llmRouter.convertMCPToolsToOpenAI(phase1Tools);
      const toolList = enableMetaMcpSearch ? 'search_tool + memory retrieval tools' : 'memory retrieval tools (search_tool disabled)';
      console.log(`[ChatStream] Phase 1: Providing ${toolList} (${providerTools.length} tools)`);
      
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

      // Load role and available Google accounts for dynamic system prompt injection
      let roleSection = '';
      let accountsSection = '';

      if (body.roleId) {
        const mainDb = getMainDatabase();
        const role = mainDb.getRole(body.roleId);
        if (role) {
          // Build role context section
          roleSection = `## Current Role: ${role.name}`;
          if (role.jobDesc) {
            roleSection += `\n${role.jobDesc}`;
          }
          if (role.systemPrompt) {
            roleSection += `\n${role.systemPrompt}`;
          }
          roleSection += '\n';
        }
      }

      // Load user's Google accounts
      const mainDb = getMainDatabase();
      const googleAccounts = mainDb.getAllUserOAuthTokens(request.user.id, 'google');
      if (googleAccounts.length > 0) {
        const accountList = googleAccounts.map((acc: typeof googleAccounts[0]) => `- ${acc.accountEmail}`).join('\n');
        accountsSection = `## Available Google Accounts
${accountList}

`;
      }

      // Keep track of conversation for tool execution
      // Add system message about file tagging for preview
      const now = new Date();
      const currentDateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
      const currentDateTimeStr = now.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

      const systemMessage = {
        role: 'system' as const,
        content: `You are a helpful assistant.

**Current date and time**: ${currentDateTimeStr} (${currentDateStr})

- No emojis. Use markdown.
- Use human-readable filenames and email subjects, never mention cache IDs or internal identifiers.
- For all cached files (PDFs, Google Drive files, emails): Use [preview-file:Filename](cache-id) format for preview pane display. Never mention cache IDs in plain text.
- For Google Drive files: Format as [preview-file:Filename](cache-id) where cache-id is from the downloaded/cached file, not the Google Drive ID.
- When retrieving emails with gmailGetMessage or gmailGetThread: NEVER include email bodies in your response text. The email will be displayed in the preview pane automatically. Format cached emails as: [preview-file:Email Subject.json](cache-id-from-response). Include .json extension so preview pane correctly detects it as email. Just acknowledge that you retrieved it and provide a brief summary (subject, sender, key details).

## PROCESSING MULTIPLE ITEMS
**IMPORTANT**: When the user asks you to process multiple items (emails, files, documents, etc.):
- Process **ONE item at a time**, not all at once
- For each item: retrieve it, analyze it, show the result to the user
- Move to the next item only after completing the current one
- This prevents hitting token limits and ensures each item receives proper attention
- Example: If user asks "summarize 10 emails", handle them sequentially—retrieve email 1, summarize it, then email 2, etc.

## GMAIL EMAIL SEARCH RESULTS
When showing email search results from gmailSearchMessages:
- **NEVER** just list message IDs - they are useless to the user
- **ALWAYS** fetch each message using gmailGetMessage() to get human-readable details
- **MUST SHOW** for each email at minimum:
  - Subject (as a [preview-file:...] link for direct viewing)
  - Sender (From address and display name)
  - Date (human-readable format)
  - Brief preview/snippet if available
- Format as a numbered list that users can understand:
  - 1. [preview-file:Email Subject](cache-id) | From: sender@example.com (Sender Name) | Feb 22, 2026
  - 2. [preview-file:Another Subject](cache-id) | From: other@example.com | Feb 21, 2026
- This makes it easy for users to scan results and click on emails they want to view
- **IMPORTANT**: Any emails shown as links in your response MUST be downloaded using gmailGetMessage - never show raw email data or message IDs as links. Always use the cache-id from gmailGetMessage responses.

${roleSection}${accountsSection}## MEMORY SYSTEM
You have access to a knowledge graph memory system with the following tools:
- **memory_search_nodes**: Search for relevant entities, relationships, and observations by query (e.g., "customer preferences", "project decisions")
- **memory_read_graph**: Read the entire knowledge graph to get a complete overview of all learned information
- **memory_open_nodes**: Retrieve specific entities by name to access their detailed observations and relationships

**When to use memory:**
- At the beginning of conversations, search memory for relevant context about the topic
- Before making recommendations, check if related information exists in memory
- When the user mentions a previous context or topic, look it up in memory first
- Use memory to maintain continuity and personalization across conversations

**Memory write tools** (create, add, delete entities/relations) are available via the search_tool if you need to save new learning.${documentContext}`,
      };
      
      let conversationMessages = [systemMessage, ...body.messages];
      let assistantContent = '';
      let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
      const MAX_TOOL_ITERATIONS = getSettingWithDefault<number>('MAX_TOOL_ITERATIONS', 10);
      let toolIteration = 0;

      // Track consecutive identical tool calls to prevent infinite loops
      let lastToolCall: { name: string; args: string } | null = null;
      let consecutiveIdenticalCallCount = 0;
      const MAX_CONSECUTIVE_IDENTICAL_CALLS = 3;

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

      // Track if we're in Phase 2 (tools have been loaded after search)
      let phase2Tools: Array<{ name: string; description: string; inputSchema: any; serverId: string }> = [];
      let hasLoadedPhase2Tools = false;

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

          // Check for consecutive identical tool calls (prevent infinite loops)
          const currentCallKey = `${toolCall.name}:${JSON.stringify(toolCall.arguments)}`;
          if (lastToolCall && lastToolCall.args === currentCallKey) {
            consecutiveIdenticalCallCount++;
            console.warn(`[ChatStream] ⚠️  Consecutive identical call #${consecutiveIdenticalCallCount}: ${toolCall.name}`);

            if (consecutiveIdenticalCallCount >= MAX_CONSECUTIVE_IDENTICAL_CALLS) {
              console.error(`[ChatStream] ❌ BLOCKED: Same tool called ${MAX_CONSECUTIVE_IDENTICAL_CALLS}x with same params`);
              const blockedMessage = `⚠️ Tool call blocked: The same tool (${toolCall.name}) has been called ${MAX_CONSECUTIVE_IDENTICAL_CALLS} consecutive times with the same parameters. This usually indicates the tool is not working as expected or you need a different approach. Please try a different tool or modify your parameters.`;
              conversationMessages.push({
                role: 'user',
                content: `Tool result for ${toolCall.name} (BLOCKED - repeated call):\n${blockedMessage}`,
              });
              reply.raw.write(`data: ${JSON.stringify({ type: 'tool_result', toolName: toolCall.name, result: blockedMessage, blocked: true })}\n\n`);
              continue; // Skip execution, move to next tool call
            }
          } else {
            // Reset counter if it's a different tool call
            lastToolCall = { name: toolCall.name, args: currentCallKey };
            consecutiveIdenticalCallCount = 1;
          }

          const toolResult = await executeToolWithAdapters(request.user!.id, toolCall.name, toolCall.arguments, body.roleId);

          // PHASE 2: After search_tool returns, dynamically load the relevant tools
          if (toolCall.name === 'search_tool' && !hasLoadedPhase2Tools) {
            console.log('[ChatStream] Phase 2: Loading tools based on search results');
            
            // Parse the search results to find which tools were recommended
            // The search result format is: "1. **tool_name** (server_id) - match_score"
            try {
              // Extract tool names from the search result
              // Format: "1. **tool_name** (server_id)"
              const toolNameMatches = toolResult.matchAll(/\d+\.\s+\*\*([a-zA-Z0-9_]+)\*\*/g);
              const recommendedToolNames = new Set<string>();
              
              for (const match of toolNameMatches) {
                const toolName = match[1];
                recommendedToolNames.add(toolName);
                console.log(`[ChatStream] Search recommended tool: ${toolName}`);
              }
              
              // Find the full tool definitions from flattenedTools
              for (const toolName of recommendedToolNames) {
                const fullTool = flattenedTools.find(t => t.name === toolName);
                if (fullTool) {
                  const enrichedTool = enrichToolDefinition({
                    name: fullTool.name,
                    description: fullTool.description || '',
                    inputSchema: fullTool.inputSchema || {},
                    serverId: fullTool.serverId || 'unknown',
                  }) as any;
                  phase2Tools.push(enrichedTool);
                  console.log(`[ChatStream] Added Phase 2 tool: ${toolName} from server ${fullTool.serverId}`);
                }
              }
              
              // Also add search_tool back so the LLM can search again if needed
              const searchToolEnriched = enrichToolDefinition({
                name: 'search_tool',
                description: `Search for more MCP tools using natural language. Use this if you need additional tools beyond what was already found.`,
                inputSchema: {
                  type: 'object',
                  properties: {
                    query: {
                      type: 'string',
                      description: 'Natural language query describing what you want to accomplish'
                    },
                    limit: {
                      type: 'number',
                      default: 8,
                      description: 'Maximum number of results to return'
                    }
                  },
                  required: ['query']
                },
                serverId: 'meta-mcp-search',
              }) as any;
              phase2Tools.push(searchToolEnriched);
              
              if (phase2Tools.length > 0) {
                hasLoadedPhase2Tools = true;
                // Update providerTools with the new tools
                const newProviderTools = llmRouter.convertMCPToolsToOpenAI(phase2Tools);
                providerTools.length = 0; // Clear existing
                providerTools.push(...newProviderTools);
                
                console.log(`[ChatStream] Phase 2: Now providing ${providerTools.length} tools`);
                console.log('[ChatStream] Phase 2 tools:', phase2Tools.map(t => t.name).join(', '));
                
                // Log the updated tool list with detailed parameters
                console.log('\n' + '='.repeat(80));
                console.log('[ChatStream] PHASE 2 TOOLS NOW AVAILABLE (WITH DETAILED PARAMETERS):');
                console.log('-'.repeat(80));
                phase2Tools.forEach((tool, idx) => {
                  console.log(`\n[${idx + 1}] ${tool.name}`);
                  if (tool.description) {
                    console.log(`    Description: ${tool.description.split('\n')[0]}`);
                  }
                  if (tool.inputSchema?.properties) {
                    const propNames = Object.keys(tool.inputSchema.properties);
                    if (propNames.length > 0) {
                      console.log(`    Parameters: ${propNames.join(', ')}`);
                      for (const propName of propNames.slice(0, 3)) {
                        const prop = tool.inputSchema.properties[propName] as any;
                        if (prop?.description) {
                          console.log(`      - ${propName}: ${prop.description.substring(0, 80)}`);
                        }
                      }
                      if (propNames.length > 3) {
                        console.log(`      ... and ${propNames.length - 3} more parameters`);
                      }
                    }
                  }
                });
                console.log('='.repeat(80) + '\n');
              }
            } catch (parseError) {
              console.error('[ChatStream] Failed to parse search results:', parseError);
            }
          }

          // Add tool result to conversation
          conversationMessages.push({
            role: 'user',
            content: `Tool result for ${toolCall.name}:\n${toolResult}`,
          });

          // Include serverId with tool_result event so client knows which server the tool came from
          const serverId = flattenedTools.find(t => t.name === toolCall.name)?.serverId;
          reply.raw.write(`data: ${JSON.stringify({ type: 'tool_result', toolName: toolCall.name, serverId, result: toolResult })}\n\n`);
        }

        // Continue streaming with tool results
        // Always allow tools in Phase 2 (we have the relevant tools loaded now)
        const allowMoreTools = toolIteration < MAX_TOOL_ITERATIONS;
        console.log(`[ChatStream] Continuing stream (tools allowed: ${allowMoreTools}, phase2: ${hasLoadedPhase2Tools})`);
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

      // Check if body.url is a cache ID (not a real URL)
      // Cache IDs look like: gmail_xxx_yyyy, gmail_thread_xxx_yyyy, or file-id
      const isCacheId = !body.url.includes('://') && !body.url.includes('/');

      let cacheKey: string;
      let gdriveFileId: string | undefined;

      if (isCacheId) {
        // This is already a cache ID, use it directly
        console.log(`[ViewerDownload] Detected cache ID: ${body.url}`);
        cacheKey = body.url;
      } else {
        // Generate a cache key from the URL
        const crypto = await import('crypto');
        const urlHash = crypto.createHash('md5').update(body.url).digest('hex').substring(0, 12);

        // Check if this is a Google Drive URL to extract file ID for caching
        const gdriveMatch = body.url.match(/drive\.google\.com\/.*(?:file\/d\/|id=)([a-zA-Z0-9_-]+)/);
        const gdriveDownloadMatch = body.url.match(/drive\.google\.com\/uc\?export=download&id=([a-zA-Z0-9_-]+)/);
        gdriveFileId = gdriveMatch?.[1] || gdriveDownloadMatch?.[1];

        // Use Google Drive file ID as cache key if available, otherwise use URL hash
        cacheKey = gdriveFileId || urlHash;
      }

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
        let originalFilename = body.filename || cachedFile;

        // For cached email files, ensure filename includes .json extension for adapter detection
        if (cachedFile.includes('email') && !originalFilename.endsWith('.json')) {
          originalFilename = `${originalFilename}.json`;
        }

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

      // If this was a cache ID but we couldn't find the file, try with common extensions
      if (isCacheId) {
        console.log(`[ViewerDownload] Cache miss for cache ID. Trying with common extensions...`);
        const commonExtensions = ['json', 'pdf', 'txt', 'html', 'md'];

        for (const ext of commonExtensions) {
          const filename = `${cacheKey}.${ext}`;
          const filepath = path.join(tempDir, filename);
          try {
            const stats = await fs.stat(filepath);
            console.log(`[ViewerDownload] Found file with extension .${ext}: ${filename}`);

            const contentTypes: Record<string, string> = {
              pdf: 'application/pdf',
              json: 'application/json',
              txt: 'text/plain',
              html: 'text/html',
              md: 'text/markdown',
            };

            const contentType = contentTypes[ext] || 'application/octet-stream';
            const previewUrl = `/api/viewer/temp/${filename}`;
            const absoluteFilePath = path.resolve(filepath);
            const fileUri = `file://${absoluteFilePath}`;

            let originalFilename = body.filename || filename;
            if (ext === 'json' && originalFilename.includes('email')) {
              originalFilename = originalFilename.endsWith('.json') ? originalFilename : `${originalFilename}.json`;
            }

            console.log(`[ViewerDownload] Cache recovery successful with .${ext} extension`);
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
          } catch {
            // File doesn't exist with this extension, try next one
          }
        }

        // Cache ID not found with any extension
        console.error(`[ViewerDownload] ERROR: Cache ID not found in temp directory: ${cacheKey}`);
        return reply.code(404).send({
          success: false,
          error: {
            message: `Cached file not found: ${cacheKey}. The file may have been deleted or expired.`,
            cacheId: cacheKey
          }
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

// MCP routes - role-specific
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
    let servers = mcpManager.getServers().filter(s =>
      !s.config.hidden && !hiddenServerIds.has(s.id)
    );

    // Note: accountEmail is already in server.config for multi-account support
    // No need to fetch it separately - the config contains it
    const enhancedServers = servers;

    // Include current role ID in response
    const currentRoleId = mcpManager.getCurrentRoleId();

    return reply.send({ success: true, data: { servers: enhancedServers, currentRoleId } });
  });

  instance.post('/mcp/servers', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as any;
    
    // Get the current role ID
    const currentRoleId = mcpManager.getCurrentRoleId() || serverCurrentRoleId;

    if (!currentRoleId) {
      return reply.code(400).send({
        success: false,
        error: { message: 'No role is currently active. Please switch to a role first.' },
      });
    }

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
      // If auth config includes Google OAuth, fetch the user-level token
      let userToken: any;
      if (config.auth?.provider === 'google') {
        // Always use user-level OAuth token (role-specific tokens have been migrated)
        const oauthToken = await authService.getOAuthToken(request.user.id, 'google');
        if (oauthToken) {
          userToken = {
            access_token: oauthToken.accessToken,
            refresh_token: oauthToken.refreshToken,
            expiry_date: oauthToken.expiryDate,
            token_type: 'Bearer',
          };
          console.log(`[MCP] Using user-level Google OAuth token for server ${config.name} (account: ${oauthToken.accountEmail})`);
        }
      }

      // Add server (MCP servers are user-level, not role-specific)
      await mcpManager.addServer(config, userToken);
      return reply.send({ success: true, data: { name: body.name, connected: true, roleId: currentRoleId } });
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

    const { serverId, accountEmail } = request.body as { serverId: string; accountEmail?: string };
    console.log(`[AddPredefinedServer:${requestId}] serverId: ${serverId}, accountEmail: ${accountEmail || 'auto'}`);

    if (!serverId) {
      console.log(`[AddPredefinedServer:${requestId}] serverId is missing`);
      return reply.code(400).send({
        success: false,
        error: { message: 'serverId is required' },
      });
    }

    // Get the current role ID
    const currentRoleId = mcpManager.getCurrentRoleId() || serverCurrentRoleId;
    if (!currentRoleId) {
      return reply.code(400).send({
        success: false,
        error: { message: 'No role is currently active. Please switch to a role first.' },
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
          console.log(`[AddPredefinedServer:${requestId}] Google auth required, checking token for account: ${accountEmail || 'any'}...`);

          // Always use user-level OAuth token (role-specific tokens have been migrated)
          // If accountEmail is specified, use that specific account; otherwise get the first one
          const oauthToken = await authService.getOAuthToken(request.user.id, 'google', accountEmail);
          if (!oauthToken) {
            console.log(`[AddPredefinedServer:${requestId}] No OAuth token found for account: ${accountEmail || 'any'}`);
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
          console.log(`[AddPredefinedServer:${requestId}] OAuth token found (account: ${oauthToken.accountEmail})`);
        }
        // Add other auth providers as needed
      }

      // Create config from predefined server
      console.log(`[AddPredefinedServer:${requestId}] Creating server config...`);
      // Generate unique instance ID for multi-account support (e.g., gmail-mcp-lib~user@gmail.com)
      const instanceId = accountEmail ? `${predefinedServer.id}~${accountEmail}` : predefinedServer.id;
      const config = {
        id: instanceId,
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
        userId: request.user.id, // Store the user who owns this server (needed for auth-required servers at startup)
        accountEmail, // Store the selected account email for multi-account support
        env: predefinedServer.env || {},
      };

      // Prepare token if needed
      let userToken: any;
      if (config.auth?.provider === 'google') {
        console.log(`[AddPredefinedServer:${requestId}] Preparing Google token for account: ${accountEmail || 'auto'}...`);

        // Always use user-level OAuth token (role-specific tokens have been migrated)
        // If accountEmail is specified, use that specific account; otherwise get the first one
        const oauthToken = await authService.getOAuthToken(request.user.id, 'google', accountEmail);
        if (oauthToken) {
          userToken = {
            access_token: oauthToken.accessToken,
            refresh_token: oauthToken.refreshToken,
            expiry_date: oauthToken.expiryDate,
            token_type: 'Bearer',
          };
          console.log(`[AddPredefinedServer:${requestId}] Using user-level token (account: ${oauthToken.accountEmail})`);
        }
      }

      // Add server via MCPManager
      // Note: MCP servers are user-level (stored in main.db, shared across roles)
      // No need to call switchRole() - servers work regardless of current role context
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
          roleId: currentRoleId,
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

  // Store user-level OAuth token for MCP servers
  // Note: OAuth tokens are now stored at the user level, not per-role
  instance.post('/mcp/oauth/token', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const body = request.body as {
      roleId?: string; // Kept for backward compatibility but not used
      provider: string;
      accessToken: string;
      refreshToken?: string;
      expiryDate?: number;
      accountEmail?: string;
    };

    if (!body.provider || !body.accessToken) {
      return reply.code(400).send({
        success: false,
        error: { message: 'provider and accessToken are required' },
      });
    }

    try {
      // Store at user-level (tokens are now shared across all roles)
      await authService.storeOAuthToken(request.user.id, {
        provider: body.provider,
        accessToken: body.accessToken,
        refreshToken: body.refreshToken,
        expiryDate: body.expiryDate,
        accountEmail: body.accountEmail || '',
      });

      console.log(`[MCP] Stored ${body.provider} OAuth token for user ${request.user.id}`);

      return reply.send({
        success: true,
        data: {
          provider: body.provider,
          message: `OAuth token stored for user`,
        },
      });
    } catch (error) {
      console.error('[MCP] Failed to store OAuth token:', error);
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to store OAuth token' },
      });
    }
  });

  // Get user-level OAuth token status
  // Note: OAuth tokens are now stored at the user level, not per-role
  instance.get('/mcp/oauth/token', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { roleId?: string; provider?: string };

    if (!query.provider) {
      return reply.code(400).send({
        success: false,
        error: { message: 'provider is required' },
      });
    }

    try {
      // Get user-level token (no longer role-specific)
      const token = await authService.getOAuthToken(request.user.id, query.provider);

      return reply.send({
        success: true,
        data: {
          provider: query.provider,
          hasToken: !!token,
          accountEmail: token?.accountEmail,
          expiryDate: token?.expiryDate,
        },
      });
    } catch (error) {
      console.error('[MCP] Failed to get OAuth token:', error);
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to get OAuth token status' },
      });
    }
  });

  // Get all user-level OAuth connections (shared across all roles)
  instance.get('/mcp/oauth/connections', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    try {
      const mainDb = getMainDatabase();

      // Get all OAuth tokens for this user
      const googleAccounts = mainDb.getAllUserOAuthTokens(request.user.id, 'google');
      const githubTokens = mainDb.getAllUserOAuthTokens(request.user.id, 'github');

      return reply.send({
        success: true,
        data: {
          google: googleAccounts.map(token => ({
            accountEmail: token.accountEmail,
            expiryDate: token.expiryDate,
            createdAt: token.createdAt,
            updatedAt: token.updatedAt,
          })),
          github: githubTokens.map(token => ({
            accountEmail: token.accountEmail,
            expiryDate: token.expiryDate,
            createdAt: token.createdAt,
            updatedAt: token.updatedAt,
          })),
        },
      });
    } catch (error) {
      console.error('[MCP] Failed to get OAuth connections:', error);
      return reply.code(500).send({
        success: false,
        error: { message: 'Failed to get OAuth connections' },
      });
    }
  });
}, { prefix: '/api' });

// Settings routes - using main database (global settings)
fastify.register(async (instance) => {
  // Get all settings (verify role ownership but settings are global)
  instance.get('/settings', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { roleId?: string };
    const roleId = query.roleId;

    if (!roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify role ownership
    const role = mainDb.getRole(roleId);
    if (!role || role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    const settings = mainDb.getAllSettings();
    return reply.send({ success: true, data: settings });
  });

  // Get a specific setting
  instance.get('/settings/:key', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { key: string };
    const query = request.query as { roleId?: string };
    const roleId = query.roleId;

    if (!roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify role ownership
    const role = mainDb.getRole(roleId);
    if (!role || role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    const value = mainDb.getSetting(params.key);

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
    const body = request.body as { value: unknown; roleId?: string };
    const roleId = body.roleId;

    if (!roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    if (body.value === undefined) {
      return reply.code(400).send({ success: false, error: { message: 'Value is required' } });
    }

    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify role ownership
    const role = mainDb.getRole(roleId);
    if (!role || role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    mainDb.setSetting(params.key, body.value);
    console.log(`[Settings] Updated setting: ${params.key} = ${JSON.stringify(body.value)}`);

    return reply.send({ success: true, data: { key: params.key, value: body.value } });
  });

  // Delete a setting
  instance.delete('/settings/:key', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const params = request.params as { key: string };
    const query = request.query as { roleId?: string };
    const roleId = query.roleId;

    if (!roleId) {
      return reply.code(400).send({ success: false, error: { message: 'roleId is required' } });
    }

    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');

    // Verify role ownership
    const role = mainDb.getRole(roleId);
    if (!role || role.userId !== request.user.id) {
      return reply.code(403).send({ success: false, error: { message: 'Access denied to this role' } });
    }

    mainDb.deleteSetting(params.key);
    console.log(`[Settings] Deleted setting: ${params.key}`);

    return reply.send({ success: true });
  });
}, { prefix: '/api' });

// Start server
const start = async () => {
  try {
    // Run auto-migration if needed (converts old metadata.db to new schema)
    const migrationResult = await autoMigrate(config.storage.root);
    if (migrationResult.migrated) {
      console.log('══════════════════════════════════════════════════════════════');
      console.log('  DATABASE MIGRATION COMPLETED');
      console.log('  Migrated from LEGACY schema to ROLE-BASED schema');
      console.log('══════════════════════════════════════════════════════════════\n');
    }

    // Initialize main database
    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');
    await mainDb.initialize();
    console.log(`[Storage] Using ${migrationResult.schema.toUpperCase()} schema`);
    fastify.log.info('Main database initialized');


    // Initialize legacy storage (for backward compatibility) - only if metadata.db exists
    const legacyDbPath = path.join(config.storage.root, 'metadata.db');
    if (fs.existsSync(legacyDbPath)) {
      await storage.initialize();
    } else {
      console.log('[Storage] Skipping legacy storage initialization (no metadata.db)');
    }

    // Initialize default settings
    await initializeDefaultSettings();
    fastify.log.info('Default settings initialized');

    // Initialize auth service
    await authService.initialize();
    fastify.log.info('Auth service initialized');

    // Initialize MCP manager
    await mcpManager.initialize();
    fastify.log.info('MCP manager initialized with persisted servers');

    // Register in-process adapters for better performance
    // These adapters run directly in the Node.js process without spawning child processes
    const { adapterRegistry } = await import('./mcp/adapters/registry.js');
    const { SQLiteMemoryInProcess } = await import('./mcp/in-process/sqlite-memory.js');
    
    // Register SQLite memory as in-process adapter (no auth required)
    // Use a shared memory database path within the data directory
    const memoryDbPath = path.join(config.storage.root, 'memory.db');
    adapterRegistry.registerInProcess('memory', (userId: string) => {
      return new SQLiteMemoryInProcess(memoryDbPath);
    });
    console.log('[MCP] Registered in-process adapter for memory server');

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
  // (no role storage to close - using main database)
  await fastify.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Shutting down...');
  await mcpManager.disconnectAll();
  // (no role storage to close - using main database)
  await fastify.close();
  process.exit(0);
});

// Start the server
start();

// Export for testing
export { fastify, config };