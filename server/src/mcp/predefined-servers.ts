/**
 * Predefined MCP server definitions
 * These are available for users to add without manual configuration
 * Each has command, args, env, auth, and description baked in
 */

export interface PredefinedMCPServer {
  id: string; // Internal ID: 'google-drive-mcp-lib', 'gmail-mcp-lib', 'markitdown', etc.
  name: string; // Display name
  description: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
  auth?: {
    provider: 'google' | 'github' | 'none' | 'alphavantage' | 'twelvedata';
    credentialsFilename?: string;
    tokenFilename?: string;
  };
  icon?: string; // e.g., 'drive', 'book', 'github'
  hidden?: boolean; // If true, won't show in UI feature list but can still be used
  inProcess?: boolean; // If true, use InProcessAdapter instead of stdio
}

export const PREDEFINED_MCP_SERVERS: PredefinedMCPServer[] = [
  {
    id: 'google-drive-mcp-lib',
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
    inProcess: true, // Use InProcessAdapter for direct API calls (better performance)
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
    description: 'Persistent knowledge graph memory for storing entities, relations, and observations across conversations. Enables the AI to remember context and user preferences. Uses SQLite for storage in the role database.',
    command: 'npx',
    args: ['-y', 'mcp-memory-sqlite'],
    env: {
      // SQLITE_DB_PATH will be set dynamically by MCP Manager based on current role
    },
    auth: {
      provider: 'none',
    },
    icon: 'brain',
    hidden: true, // Hidden from UI - automatically enabled for all users
    inProcess: true, // Use InProcessAdapter for direct function calls
  },

  {
    id: 'weather',
    name: 'Weather',
    description: 'Global weather data from NOAA and Open-Meteo APIs. Provides forecasts, current conditions, historical data (1940-present), alerts, air quality, marine conditions, and more. No API keys required.',
    command: 'npx',
    args: ['-y', '@dangahagan/weather-mcp'],
    auth: {
      provider: 'none',
    },
    icon: 'cloud',
    hidden: true, // Hidden from UI - automatically available
    inProcess: true, // Use InProcessAdapter for direct function calls
  },

  {
    id: 'meta-mcp-search',
    name: 'Meta MCP Search',
    description: 'Semantic search over all available MCP tools. This is the initial tool exposed to the LLM for tool discovery. Use natural language to find relevant tools.',
    command: 'npx',
    args: ['-y', 'meta-mcp-search'],
    auth: {
      provider: 'none',
    },
    icon: 'search',
    hidden: true, // Hidden from UI - automatically available
    inProcess: true, // Use InProcessAdapter for direct function calls
  },

  {
    id: 'gmail-mcp-lib',
    name: 'Gmail',
    description: 'Access Gmail inbox, search emails, send messages, manage labels and threads. Requires Google OAuth authentication.',
    command: 'npx',
    args: ['-y', 'gmail-mcp-lib'],
    auth: {
      provider: 'google',
    },
    icon: 'mail',
    inProcess: true, // Use InProcessAdapter for direct API calls (better performance)
  },

  {
    id: 'process-each',
    name: 'Process Each',
    description: 'Process a list of items (email IDs, file IDs, etc.) one at a time using a focused AI call per item. Avoids context overflow when handling large numbers of items.',
    command: '', // In-process only
    args: [],
    auth: {
      provider: 'none',
    },
    hidden: true, // Hidden from UI - automatically available
    inProcess: true, // Use InProcessAdapter for direct function calls
  },

  {
    id: 'role-manager',
    name: 'Role Manager',
    description: 'Switch between roles during conversation. Allows the AI to manage active role context.',
    command: '', // In-process only
    args: [],
    auth: {
      provider: 'none',
    },
    hidden: true, // Hidden from UI - system tool for role switching
    inProcess: true, // Use InProcessAdapter for direct function calls
  },

  {
    id: 'alpha-vantage',
    name: 'Alpha Vantage',
    description: 'Real-time and historical financial data: stocks, forex, crypto, commodities, economic indicators, and 50+ technical indicators. Requires a free API key from alphavantage.co.',
    command: '',
    args: [],
    auth: {
      provider: 'alphavantage',
    },
    icon: 'trending-up',
    inProcess: true,
  },

  {
    id: 'twelve-data',
    name: 'Twelve Data',
    description: 'Professional-grade financial market data: real-time quotes, historical OHLCV, fundamentals, earnings, dividends, financial statements. Covers 1M+ stocks, ETFs, crypto, and forex. Free tier with API key from twelvedata.com.',
    command: '',
    args: [],
    auth: {
      provider: 'twelvedata',
    },
    icon: 'trending-up',
    inProcess: true,
  },

  {
    id: 'scheduler',
    name: 'Scheduler',
    description: 'Schedule tasks for future autonomous execution.',
    command: '',
    args: [],
    auth: {
      provider: 'none',
    },
    hidden: true,
    inProcess: true,
  },

  // DISABLED: Testing email preview with cache IDs instead
  // {
  //   id: 'display-email',
  //   name: 'Display Email',
  //   description: 'Display email messages and threads in the preview pane. Called by the AI to show email content to the user.',
  //   command: '', // In-process only
  //   args: [],
  //   auth: {
  //     provider: 'none',
  //   },
  //   hidden: true, // Hidden from UI - automatically available
  //   global: true, // Global: not affected by role switches
  //   inProcess: true, // Use InProcessAdapter for direct function calls
  // },
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
