/**
 * Predefined MCP server definitions
 * These are available for users to add without manual configuration
 * Each has command, args, env, auth, and description baked in
 */

export interface PredefinedMCPServer {
  id: string; // Internal ID: 'google-drive-full', 'markitdown', etc.
  name: string; // Display name
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  auth?: {
    provider: 'google' | 'github' | 'none';
    credentialsFilename?: string;
    tokenFilename?: string;
  };
  icon?: string; // e.g., 'drive', 'book', 'github'
  hidden?: boolean; // If true, won't show in UI feature list but can still be used
}

export const PREDEFINED_MCP_SERVERS: PredefinedMCPServer[] = [
  {
    id: 'google-drive-full',
    name: 'Google Drive',
    description: 'Access files and documents from Google Drive. Requires Google OAuth authentication.',
    command: 'npx',
    args: ['-y', '@piotr-agier/google-drive-mcp'],
    auth: {
      provider: 'google',
      credentialsFilename: 'gcp-oauth.keys.json',
      tokenFilename: 'tokens.json',
    },
    icon: 'drive',
  },

  {
    id: 'google-docs-mcp',
    name: 'Google Docs',
    description: 'Read and analyze Google Docs. Requires Google OAuth authentication.',
    command: 'npx',
    args: ['-y', 'google-docs-mcp'],
    auth: {
      provider: 'google',
      credentialsFilename: 'credentials.json',
      tokenFilename: 'token.json',
    },
    icon: 'docs',
  },

  {
    id: 'github',
    name: 'GitHub',
    description: 'Access GitHub repositories, issues, and pull requests. Requires GitHub token.',
    command: 'npx',
    args: ['-y', 'github-mcp'],
    env: {
      GITHUB_API_TOKEN: '', // User must set via env or secrets
    },
    auth: {
      provider: 'github',
    },
    icon: 'github',
  },

  {
    id: 'brave-search',
    name: 'Brave Search',
    description: 'Search the web using Brave Search API. Requires Brave API key.',
    command: 'npx',
    args: ['-y', 'brave-search-mcp'],
    env: {
      BRAVE_SEARCH_API_KEY: '', // User must set via env or secrets
    },
    auth: {
      provider: 'none',
    },
    icon: 'search',
  },

  {
    id: 'markitdown',
    name: 'MarkItDown',
    description: 'Convert PDF files and other documents to markdown format for AI processing. Supports PDF, DOCX, XLSX, PPTX, images, and more.',
    command: '/Users/appler/.local/bin/uvx',
    args: ['markitdown-mcp'],
    auth: {
      provider: 'none',
    },
    icon: 'file-text',
    hidden: true, // Hidden from UI - automatically available for PDF processing
  },

  {
    id: 'memory',
    name: 'Memory',
    description: 'Persistent knowledge graph memory for storing entities, relations, and observations across conversations. Enables the AI to remember context and user preferences.',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: {
      MEMORY_FILE_PATH: './data/memory.json', // Persistent storage for knowledge graph
    },
    auth: {
      provider: 'none',
    },
    icon: 'brain',
    hidden: true, // Hidden from UI - automatically enabled for all users
  },
];

/**
 * Get a predefined server by ID
 */
export function getPredefinedServer(id: string): PredefinedMCPServer | undefined {
  return PREDEFINED_MCP_SERVERS.find(s => s.id === id);
}

/**
 * Get all predefined servers (for UI listing)
 * By default, filters out hidden servers
 */
export function listPredefinedServers(includeHidden = false): PredefinedMCPServer[] {
  if (includeHidden) {
    return PREDEFINED_MCP_SERVERS;
  }
  return PREDEFINED_MCP_SERVERS.filter(s => !s.hidden);
}

/**
 * Check if server requires authentication
 */
export function requiresAuth(serverId: string): boolean {
  const server = getPredefinedServer(serverId);
  return server?.auth?.provider !== 'none' && server?.auth?.provider !== undefined;
}
