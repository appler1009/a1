import { describe, it, expect, vi } from 'vitest';
import { isExcludedPath, parseApiResponse } from '../../lib/api';

// Mock the store used by apiFetch
vi.mock('../../store', () => ({
  useRolesStore: {
    getState: () => ({ currentRole: null, currentRoleId: null }),
  },
}));

describe('isExcludedPath', () => {
  it('excludes auth login path', () => {
    expect(isExcludedPath('/api/auth/login')).toBe(true);
  });

  it('excludes check-email path', () => {
    expect(isExcludedPath('/api/auth/check-email')).toBe(true);
  });

  it('excludes signup paths', () => {
    expect(isExcludedPath('/api/auth/signup')).toBe(true);
    expect(isExcludedPath('/api/auth/signup/individual')).toBe(true);
    expect(isExcludedPath('/api/auth/signup/group')).toBe(true);
  });

  it('excludes logout path', () => {
    expect(isExcludedPath('/api/auth/logout')).toBe(true);
  });

  it('excludes oauth paths', () => {
    expect(isExcludedPath('/api/auth/google/start')).toBe(true);
    expect(isExcludedPath('/api/auth/google/callback')).toBe(true);
    expect(isExcludedPath('/api/auth/github/start')).toBe(true);
    expect(isExcludedPath('/api/auth/github/callback')).toBe(true);
    expect(isExcludedPath('/api/auth/oauth/token')).toBe(true);
  });

  it('excludes /api/env', () => {
    expect(isExcludedPath('/api/env')).toBe(true);
  });

  it('does not exclude non-auth API paths', () => {
    expect(isExcludedPath('/api/chat/stream')).toBe(false);
    expect(isExcludedPath('/api/mcp/servers')).toBe(false);
    expect(isExcludedPath('/api/messages')).toBe(false);
    expect(isExcludedPath('/api/roles')).toBe(false);
  });

  it('does not exclude root or unrelated paths', () => {
    expect(isExcludedPath('/')).toBe(false);
    expect(isExcludedPath('/app')).toBe(false);
  });
});

describe('parseApiResponse', () => {
  it('returns success with data for a 200 response', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ data: { id: '1', name: 'Test' } }),
    } as unknown as Response;

    const result = await parseApiResponse<{ id: string; name: string }>(mockResponse);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: '1', name: 'Test' });
  });

  it('returns success with top-level json when no data key', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ id: '1', name: 'Test' }),
    } as unknown as Response;

    const result = await parseApiResponse<{ id: string; name: string }>(mockResponse);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: '1', name: 'Test' });
  });

  it('returns error for a non-ok response with error message', async () => {
    const mockResponse = {
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Unauthorized' } }),
    } as unknown as Response;

    const result = await parseApiResponse(mockResponse);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Unauthorized');
  });

  it('returns error with status code when error message is absent', async () => {
    const mockResponse = {
      ok: false,
      status: 500,
      json: async () => ({}),
    } as unknown as Response;

    const result = await parseApiResponse(mockResponse);
    expect(result.success).toBe(false);
    expect(result.error).toBe('HTTP 500');
  });

  it('returns error when json parsing fails', async () => {
    const mockResponse = {
      ok: true,
      json: async () => { throw new Error('Invalid JSON'); },
    } as unknown as Response;

    const result = await parseApiResponse(mockResponse);
    expect(result.success).toBe(false);
    expect(result.error).toBe('Failed to parse response');
  });
});
