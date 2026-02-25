import { describe, it, expect } from 'vitest';
import {
  UserSchema,
  MessageSchema,
  MCPServerConfigSchema,
  AgentRoleSchema,
} from '../schemas/index.js';

describe('UserSchema', () => {
  it('validates a valid user', () => {
    const result = UserSchema.safeParse({
      id: 'user-1',
      email: 'test@example.com',
      accountType: 'individual',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = UserSchema.safeParse({
      id: 'user-1',
      email: 'not-an-email',
      accountType: 'individual',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('requires id field', () => {
    const result = UserSchema.safeParse({
      email: 'test@example.com',
      accountType: 'individual',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('requires accountType field', () => {
    const result = UserSchema.safeParse({
      id: 'user-1',
      email: 'test@example.com',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid accountType', () => {
    const result = UserSchema.safeParse({
      id: 'user-1',
      email: 'test@example.com',
      accountType: 'enterprise',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('MessageSchema', () => {
  it('validates a valid user message', () => {
    const result = MessageSchema.safeParse({
      id: 'msg-1',
      roleId: 'role-1',
      groupId: null,
      userId: 'user-1',
      role: 'user',
      content: 'Hello',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('validates an assistant message', () => {
    const result = MessageSchema.safeParse({
      id: 'msg-2',
      roleId: 'role-1',
      groupId: null,
      userId: 'user-1',
      role: 'assistant',
      content: 'Hi there',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('validates a system message', () => {
    const result = MessageSchema.safeParse({
      id: 'msg-3',
      roleId: 'role-1',
      groupId: null,
      userId: 'user-1',
      role: 'system',
      content: 'You are helpful.',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid role enum', () => {
    const result = MessageSchema.safeParse({
      id: 'msg-4',
      roleId: 'role-1',
      groupId: null,
      userId: 'user-1',
      role: 'bot',
      content: 'Hello',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('MCPServerConfigSchema', () => {
  it('validates a valid stdio config', () => {
    const result = MCPServerConfigSchema.safeParse({
      name: 'my-mcp',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
    });
    expect(result.success).toBe(true);
  });

  it('validates valid transport values', () => {
    for (const transport of ['stdio', 'websocket', 'http', 'ws']) {
      const result = MCPServerConfigSchema.safeParse({
        name: 'my-mcp',
        transport,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects invalid transport', () => {
    const result = MCPServerConfigSchema.safeParse({
      name: 'my-mcp',
      transport: 'grpc',
    });
    expect(result.success).toBe(false);
  });

  it('defaults autoStart to false', () => {
    const result = MCPServerConfigSchema.safeParse({
      name: 'my-mcp',
      transport: 'stdio',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.autoStart).toBe(false);
    }
  });

  it('defaults enabled to true', () => {
    const result = MCPServerConfigSchema.safeParse({
      name: 'my-mcp',
      transport: 'stdio',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
    }
  });
});

describe('AgentRoleSchema', () => {
  it('validates a valid agent role', () => {
    const result = AgentRoleSchema.safeParse({
      id: 'role-1',
      groupId: 'group-1',
      userId: 'user-1',
      name: 'Assistant',
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('accepts temperature at boundaries (0 and 2)', () => {
    for (const temperature of [0, 2]) {
      const result = AgentRoleSchema.safeParse({
        id: 'role-1',
        groupId: 'group-1',
        userId: 'user-1',
        name: 'Assistant',
        temperature,
        createdAt: '2024-01-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejects temperature outside 0–2 range', () => {
    for (const temperature of [-0.1, 2.1]) {
      const result = AgentRoleSchema.safeParse({
        id: 'role-1',
        groupId: 'group-1',
        userId: 'user-1',
        name: 'Assistant',
        temperature,
        createdAt: '2024-01-01T00:00:00Z',
      });
      expect(result.success).toBe(false);
    }
  });

  it('requires maxTokens to be a positive integer', () => {
    const negativeResult = AgentRoleSchema.safeParse({
      id: 'role-1',
      groupId: 'group-1',
      userId: 'user-1',
      name: 'Assistant',
      maxTokens: -1,
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(negativeResult.success).toBe(false);

    const zeroResult = AgentRoleSchema.safeParse({
      id: 'role-1',
      groupId: 'group-1',
      userId: 'user-1',
      name: 'Assistant',
      maxTokens: 0,
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(zeroResult.success).toBe(false);

    const validResult = AgentRoleSchema.safeParse({
      id: 'role-1',
      groupId: 'group-1',
      userId: 'user-1',
      name: 'Assistant',
      maxTokens: 1024,
      createdAt: '2024-01-01T00:00:00Z',
    });
    expect(validResult.success).toBe(true);
  });
});
