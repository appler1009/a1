// ============================================
// Storage Interface
// ============================================

export interface IStorage {
  // File operations
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  append(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir: string): Promise<string[]>;

  // Memory operations
  saveMemory(entry: MemoryEntry): Promise<void>;
  getMemory(id: string): Promise<MemoryEntry | null>;
  listMemory(roleId: string): Promise<MemoryEntry[]>;
  searchMemory(query: string, roleId: string, limit?: number): Promise<MemoryEntry[]>;
  searchMemoryByEmbedding(embedding: number[], roleId: string, limit?: number): Promise<MemoryEntry[]>;
  deleteMemory(id: string): Promise<void>;

  // Metadata operations (for SQLite)
  getMetadata(table: string, id: string): Promise<Record<string, unknown> | null>;
  setMetadata(table: string, id: string, data: Record<string, unknown>): Promise<void>;
  deleteMetadata(table: string, id: string): Promise<void>;
  queryMetadata(table: string, filter: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

// ============================================
// Memory Entry Type
// ============================================

export interface MemoryEntry {
  id: string;
  roleId: string;
  orgId: string;
  userId: string;
  content: string;
  embedding?: number[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
}

// ============================================
// Storage Adapter Types
// ============================================

export interface FSStorageConfig {
  type: 'fs';
  root: string;
}

export interface SQLiteStorageConfig {
  type: 'sqlite';
  root: string;
  database?: string;
}

export interface S3StorageConfig {
  type: 's3';
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

export type StorageAdapterConfig = FSStorageConfig | SQLiteStorageConfig | S3StorageConfig;

// ============================================
// LLM Types
// ============================================

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  tools?: MCPToolDefinition[];
}

export interface LLMResponse {
  content: string;
  model: string;
  tokens: {
    prompt: number;
    completion: number;
    total: number;
  };
  toolCalls?: ToolCall[];
}

export interface LLMStreamChunk {
  type: 'text' | 'tool_call' | 'done' | 'error';
  content?: string;
  toolCall?: ToolCall;
  error?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolDefinition {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

// ============================================
// MCP Types
// ============================================

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface MCPToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MCPServerInfo {
  name: string;
  version?: string;
  protocolVersion?: string;
  tools?: MCPToolInfo[];
  resources?: MCPResource[];
  capabilities?: {
    tools?: boolean;
    resources?: boolean;
    prompts?: boolean;
  };
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ============================================
// App Config Types
// ============================================

export interface AppConfig {
  port: number;
  host: string;
  database: {
    type: 'sqlite' | 'postgres';
    path?: string;
    url?: string;
  };
  storage: StorageAdapterConfig;
  auth: {
    secret: string;
    sessionTTL: number;
  };
  gmail: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  };
  llm: {
    openaiKey: string;
    defaultModel: string;
    routerEnabled: boolean;
  };
}