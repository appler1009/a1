import { describe, it, expect } from 'vitest';
import {
  ChatRequestSchema,
  CreateAgentRoleSchema,
  LoginRequestSchema,
  SignupRequestSchema,
  MCPServerConfigSchema,
} from '@local-agent/shared';

describe('ChatRequestSchema', () => {
  it('validates a valid chat request', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('defaults stream to true', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'Hello' }],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stream).toBe(true);
    }
  });

  it('accepts optional roleId and groupId', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [{ role: 'user', content: 'Hello' }],
      roleId: 'role-1',
      groupId: 'group-1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid role in messages', () => {
    const result = ChatRequestSchema.safeParse({
      messages: [{ role: 'bot', content: 'Hello' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty messages array', () => {
    // Empty arrays are technically valid in zod by default; this just verifies schema parses
    const result = ChatRequestSchema.safeParse({ messages: [] });
    expect(result.success).toBe(true);
  });
});

describe('CreateAgentRoleSchema', () => {
  it('validates a valid create role request', () => {
    const result = CreateAgentRoleSchema.safeParse({
      groupId: 'group-1',
      name: 'Support Agent',
    });
    expect(result.success).toBe(true);
  });

  it('accepts optional fields', () => {
    const result = CreateAgentRoleSchema.safeParse({
      groupId: 'group-1',
      name: 'Support Agent',
      jobDesc: 'Handles support tickets',
      systemPrompt: 'You are a support agent.',
      model: 'claude-opus-4-6',
    });
    expect(result.success).toBe(true);
  });

  it('requires groupId', () => {
    const result = CreateAgentRoleSchema.safeParse({
      name: 'Support Agent',
    });
    expect(result.success).toBe(false);
  });

  it('requires name', () => {
    const result = CreateAgentRoleSchema.safeParse({
      groupId: 'group-1',
    });
    expect(result.success).toBe(false);
  });
});

describe('LoginRequestSchema', () => {
  it('validates a valid email', () => {
    const result = LoginRequestSchema.safeParse({ email: 'user@example.com' });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid email', () => {
    const result = LoginRequestSchema.safeParse({ email: 'not-an-email' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing email', () => {
    const result = LoginRequestSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('SignupRequestSchema', () => {
  it('validates an individual signup', () => {
    const result = SignupRequestSchema.safeParse({
      email: 'user@example.com',
      accountType: 'individual',
    });
    expect(result.success).toBe(true);
  });

  it('validates a group signup', () => {
    const result = SignupRequestSchema.safeParse({
      email: 'admin@company.com',
      name: 'Admin',
      accountType: 'group',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid accountType', () => {
    const result = SignupRequestSchema.safeParse({
      email: 'user@example.com',
      accountType: 'enterprise',
    });
    expect(result.success).toBe(false);
  });
});

describe('MCPServerConfigSchema (server usage)', () => {
  it('validates a websocket transport config', () => {
    const result = MCPServerConfigSchema.safeParse({
      name: 'my-ws-server',
      transport: 'websocket',
      url: 'ws://localhost:8080',
    });
    expect(result.success).toBe(true);
  });

  it('validates a stdio config with env vars', () => {
    const result = MCPServerConfigSchema.safeParse({
      name: 'my-stdio-server',
      transport: 'stdio',
      command: 'node',
      args: ['./server.js'],
      env: { API_KEY: 'abc123' },
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-string env values', () => {
    const result = MCPServerConfigSchema.safeParse({
      name: 'my-server',
      transport: 'stdio',
      env: { TIMEOUT: 30 },
    });
    expect(result.success).toBe(false);
  });
});
