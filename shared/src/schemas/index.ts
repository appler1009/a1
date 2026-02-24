import { z } from 'zod';

// User schemas
export const UserSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().optional(),
  accountType: z.enum(['individual', 'group']),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()).optional(),
});

export const SessionSchema = z.object({
  id: z.string(),
  userId: z.string(),
  expiresAt: z.string().or(z.date()),
  createdAt: z.string().or(z.date()).optional(),
});

// Group schemas (formerly Organization)
export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string().optional(),
  createdAt: z.string().or(z.date()),
});

export const GroupMemberSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  userId: z.string(),
  role: z.enum(['owner', 'admin', 'member']),
  createdAt: z.string().or(z.date()),
});

export const InvitationSchema = z.object({
  id: z.string(),
  code: z.string(),
  groupId: z.string(),
  createdBy: z.string(),
  email: z.string().email().optional(),
  role: z.enum(['owner', 'admin', 'member']).optional(),
  expiresAt: z.string().or(z.date()).optional(),
  usedAt: z.string().or(z.date()).optional(),
  acceptedAt: z.string().or(z.date()).optional(),
  createdAt: z.string().or(z.date()),
});

// Role schemas
export const RoleSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  name: z.string(),
  jobDesc: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
  createdAt: z.string().or(z.date()),
});

// Message schemas
export const MessageSchema = z.object({
  id: z.string(),
  roleId: z.string(),
  groupId: z.string().nullable(),
  userId: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  model: z.string().optional(),
  tokens: z.number().optional(),
  createdAt: z.string().or(z.date()),
});

// Memory schemas
export const MemorySchema = z.object({
  id: z.string(),
  roleId: z.string(),
  content: z.string(),
  embedding: z.array(z.number()).optional(),
  createdAt: z.string().or(z.date()),
});

// Memory entry for storage
export const MemoryEntrySchema = z.object({
  id: z.string(),
  roleId: z.string(),
  userId: z.string(),
  orgId: z.string(),
  content: z.string(),
  embedding: z.array(z.number()).optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().or(z.date()),
});

// Config schemas
export const ConfigSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  key: z.string(),
  value: z.record(z.unknown()),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()),
});

// Storage config
export const StorageConfigSchema = z.object({
  type: z.enum(['fs', 'sqlite', 's3']),
  root: z.string().optional(),
  bucket: z.string().optional(),
  endpoint: z.string().optional(),
  region: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
});

// Storage adapter config
export const StorageAdapterConfigSchema = z.object({
  type: z.enum(['fs', 'sqlite', 's3']),
  root: z.string().optional(),
  bucket: z.string().optional(),
  endpoint: z.string().optional(),
  region: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
});

// MCP config
export const MCPConfigSchema = z.object({
  name: z.string(),
  transport: z.enum(['stdio', 'websocket', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  env: z.record(z.string()).optional(),
});

// MCP Server config (for server configuration)
export const MCPServerConfigSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  transport: z.enum(['stdio', 'websocket', 'http', 'ws']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  cwd: z.string().nullable().optional(),
  url: z.string().optional(),
  env: z.record(z.string()).optional(),
  autoStart: z.boolean().optional().default(false),
  restartOnExit: z.boolean().optional().default(false),
  enabled: z.boolean().optional().default(true),
  hidden: z.boolean().optional(), // If true, won't show in UI but can still be used
  accountEmail: z.string().optional(), // For multi-account OAuth services (Gmail, Google Drive, etc.)
  auth: z.object({
    provider: z.string().optional(),
    tokenFilename: z.string().optional(),
    credentialsFilename: z.string().optional(),
  }).optional(),
});

// MCP Tool info
export const MCPToolInfoSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  inputSchema: z.record(z.unknown()).optional(),
  requiresDetailedSchema: z.boolean().optional(),
});

// MCP Resource
export const MCPResourceSchema = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().optional(),
});

// MCP Server info
export const MCPServerInfoSchema = z.object({
  name: z.string(),
  version: z.string().optional(),
  protocolVersion: z.string().optional(),
  connected: z.boolean().optional(),
  tools: z.array(MCPToolInfoSchema).optional(),
  resources: z.array(MCPResourceSchema).optional(),
  capabilities: z.object({
    tools: z.boolean().optional(),
    resources: z.boolean().optional(),
    prompts: z.boolean().optional(),
  }).optional(),
});

// LLM config
export const LLMConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'local']),
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
});

// LLM Message
export const LLMMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});

// Chat message
export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});

// Auth request schemas
export const LoginRequestSchema = z.object({
  email: z.string().email(),
});

export const SignupRequestSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  accountType: z.enum(['individual', 'group']),
});

export const CreateGroupRequestSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  groupName: z.string(),
  groupUrl: z.string().optional(),
});

export const JoinGroupRequestSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  inviteCode: z.string(),
});

export const CheckEmailRequestSchema = z.object({
  email: z.string().email(),
});

// Individual signup
export const IndividualSignupSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
});

// Create org signup
export const CreateOrgSignupSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  groupName: z.string(),
  groupUrl: z.string().optional(),
});

// Join org
export const JoinOrgSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  inviteCode: z.string(),
});

// Agent role schemas
export const AgentRoleSchema = z.object({
  id: z.string(),
  groupId: z.string(),
  userId: z.string(),
  name: z.string(),
  jobDesc: z.string().optional(),
  jobDescription: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.string().default('gpt-4').optional(),
  temperature: z.number().min(0).max(2).default(0.7).optional(),
  maxTokens: z.number().int().positive().default(4096).optional(),
  createdAt: z.string().or(z.date()),
  updatedAt: z.string().or(z.date()).optional(),
});

export const CreateAgentRoleSchema = z.object({
  groupId: z.string(),
  name: z.string(),
  jobDesc: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
});

export const UpdateAgentRoleSchema = z.object({
  name: z.string().optional(),
  jobDesc: z.string().optional(),
  systemPrompt: z.string().optional(),
  model: z.string().optional(),
});

// Chat request schema
export const ChatRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string(),
  })),
  roleId: z.string().optional(),
  groupId: z.string().optional(),
  stream: z.boolean().optional().default(true),
});

// Types
export type User = z.infer<typeof UserSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type GroupMember = z.infer<typeof GroupMemberSchema>;
export type Invitation = z.infer<typeof InvitationSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Memory = z.infer<typeof MemorySchema>;
export type MemoryEntry = z.infer<typeof MemoryEntrySchema>;
export type Config = z.infer<typeof ConfigSchema>;
export type StorageConfig = z.infer<typeof StorageConfigSchema>;
export type StorageAdapterConfig = z.infer<typeof StorageAdapterConfigSchema>;
export type MCPConfig = z.infer<typeof MCPConfigSchema>;
export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>;
export type MCPToolInfo = z.infer<typeof MCPToolInfoSchema>;
export type MCPResource = z.infer<typeof MCPResourceSchema>;
export type MCPServerInfo = z.infer<typeof MCPServerInfoSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type LLMMessage = z.infer<typeof LLMMessageSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type SignupRequest = z.infer<typeof SignupRequestSchema>;
export type CreateGroupRequest = z.infer<typeof CreateGroupRequestSchema>;
export type JoinGroupRequest = z.infer<typeof JoinGroupRequestSchema>;
export type CheckEmailRequest = z.infer<typeof CheckEmailRequestSchema>;
export type IndividualSignup = z.infer<typeof IndividualSignupSchema>;
export type CreateOrgSignup = z.infer<typeof CreateOrgSignupSchema>;
export type JoinOrg = z.infer<typeof JoinOrgSchema>;
export type AgentRole = z.infer<typeof AgentRoleSchema>;
export type CreateAgentRole = z.infer<typeof CreateAgentRoleSchema>;
export type UpdateAgentRole = z.infer<typeof UpdateAgentRoleSchema>;
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// Legacy type aliases for backward compatibility
export type Organization = Group;
export type OrgMembership = GroupMember;