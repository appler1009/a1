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
import { mcpManager, getMcpAdapter, closeUserAdapters, listPredefinedServers, getPredefinedServer, requiresAuth } from './mcp/index.js';
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
      const codeFilename = `${baseName}-${blockIndex}.${ext}`;
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

// Google OAuth handler for token refresh
let googleOAuthHandler: GoogleOAuthHandler | null = null;

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

          const result = await adapter.callTool(toolName, args);

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
                  const codeFilename = `${baseName}-code-${blockIndex}.${ext}`;
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
              const mdFilename = `${baseName}-markdown-${Date.now()}.md`;
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

    const body = request.body as { messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>; roleId?: string; groupId?: string };

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

      // Keep track of conversation for tool execution
      // Add system message about file tagging for preview
      const systemMessage = {
        role: 'system' as const,
        content: `You are a helpful assistant with access to Google Drive and file management tools.

IMPORTANT: When users ask about files or want to access/download them, you MUST use the available MCP tools (search, listFolder, etc.) rather than just describing them. Use the tools proactively to interact with Google Drive and the file system.

When presenting search results or file lists to users:
- DO NOT show internal IDs (like Google Drive file IDs) - these are not useful to humans
- Show only the file name and a clickable link
- Format file lists cleanly with bullet points
- Example good format:
  📄 **Report.pdf** - [Open](https://drive.google.com/file/d/xxx/view)
  📄 **Budget.xlsx** - [Open](https://drive.google.com/file/d/yyy/view)

When you find or reference a file (PDF, image, document) that can be displayed, you MUST use the preview-file tag format to automatically display it in the preview pane:

[preview-file:filename.ext](https://url-to-file)

Examples:
- For a Google Drive PDF: [preview-file:document.pdf](https://drive.google.com/uc?export=download&id=FILE_ID)
- For any PDF URL: [preview-file:report.pdf](https://example.com/report.pdf)
- For images: [preview-file:image.png](https://example.com/image.png)

DO NOT use regular markdown links like [Open PDF](url) - these require manual clicking.
ALWAYS use [preview-file:filename.ext](url) for files - this automatically downloads and displays them.

For Google Drive files, convert the view URL to download URL:
- View URL: https://drive.google.com/file/d/FILE_ID/view
- Download URL for preview: https://drive.google.com/uc?export=download&id=FILE_ID

Supported file types: PDF, PNG, JPG, GIF, SVG, HTML.

PDF AND DOCUMENT PROCESSING:
When users want to read or extract text from PDFs or other documents, use the convert_to_markdown tool:
- The tool accepts URIs: file://, http://, https://, or data: schemes
- For local files downloaded to temp: use file:///absolute/path/to/file
- Example: convert_to_markdown(uri="file:///path/to/document.pdf")
- This converts PDFs, DOCX, XLSX, PPTX, images, and more to readable markdown text

CRITICAL ACCURACY REQUIREMENTS FOR DOCUMENT SUMMARIES:
When summarizing or extracting information from documents, you MUST:

1. **Use ACTUAL values from the document** - NEVER use placeholders like [Name], [Amount], [X], [Y], [Date], etc.
   - WRONG: "Balance: [Amount]" or "Attendees: [Name]"
   - RIGHT: "Balance: $15,234.56" or "Attendees: John Smith, Jane Doe"

2. **Extract real dates, names, and numbers** - If the document says "Meeting on March 15, 2025", use that exact date.
   - WRONG: "Next meeting: [Date]" or "Deadline: Feb 15, 2025" (if that's not what the document says)
   - RIGHT: "Next meeting: March 15, 2025" (the actual date from the document)

3. **If you cannot read the document or extract specific information**, you MUST explicitly state:
   - "I was unable to read the document through the MCP server tools. The document may not have been successfully converted to text."
   - OR "The document was read, but the following information was not found or was unclear: [specific fields]"

4. **Do NOT fabricate or guess information** - Only report what is actually present in the converted document text.
   - If a field is blank or missing in the source, report it as "Not specified in document" rather than making up a value.

5. **Verify tool results before summarizing** - Check that the convert_to_markdown tool actually returned readable content.
   - If the tool returns an error, empty content, or garbled text, report this to the user honestly.

6. **Preserve document fidelity** - When extracting names, amounts, dates, or other specific data:
   - Copy them exactly as they appear in the document
   - Do not round, approximate, or reformat unless explicitly asked`,
      };
      
      let conversationMessages = [systemMessage, ...body.messages];
      let assistantContent = '';
      let toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
      const MAX_TOOL_ITERATIONS = 3;
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
            reply.raw.write(`data: ${JSON.stringify({ content: chunk.content })}\n\n`);
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
      let buffer: Buffer;
      let contentType = body.mimeType || 'application/octet-stream';
      let filename = body.filename || 'downloaded-file';

      // Check if this is a Google Drive URL
      const gdriveMatch = body.url.match(/drive\.google\.com\/.*(?:file\/d\/|id=)([a-zA-Z0-9_-]+)/);
      const gdriveDownloadMatch = body.url.match(/drive\.google\.com\/uc\?export=download&id=([a-zA-Z0-9_-]+)/);
      const gdriveFileId = gdriveMatch?.[1] || gdriveDownloadMatch?.[1];

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

      // Create temp directory if it doesn't exist
      const tempDir = path.join(config.storage.root, 'temp');
      console.log(`[ViewerDownload] Temp directory: ${tempDir}`);
      await import('fs/promises').then(fs => fs.mkdir(tempDir, { recursive: true }).catch(() => {}));

      // Generate unique ID for this file
      const fileId = uuidv4();
      const fileExtension = filename.includes('.') ? `.${filename.split('.').pop()}` : '';
      const tempFilename = `${fileId}${fileExtension}`;
      const tempFilePath = path.join(tempDir, tempFilename);
      console.log(`[ViewerDownload] Temp file path: ${tempFilePath}`);

      // Write file to temp directory
      console.log(`[ViewerDownload] File size: ${buffer.length} bytes`);
      await import('fs/promises').then(fs => fs.writeFile(tempFilePath, buffer));
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
          id: fileId,
          name: filename,
          mimeType: contentType,
          previewUrl,
          fileUri,  // Add file:// URI for use with convert_to_markdown
          absolutePath: absoluteFilePath,  // Also provide raw path
          size: buffer.length,
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
    const filePath = path.join(tempDir, params.filename);

    try {
      // Check if file exists
      const fs = await import('fs/promises');
      await fs.access(filePath);

      // Determine content type based on file extension
      const ext = params.filename.split('.').pop()?.toLowerCase() || '';
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
      reply.header('Content-Disposition', `inline; filename="${params.filename}"`);
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

    // Return full server objects with { id, config, info }
    const servers = mcpManager.getServers();
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

// Start server
const start = async () => {
  try {
    // Initialize storage (already created globally)
    await storage.initialize();

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