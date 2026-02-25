import { describe, it, expect } from 'vitest';
import {
  PREDEFINED_MCP_SERVERS,
  getPredefinedServer,
  listPredefinedServers,
  requiresAuth,
} from '../mcp/predefined-servers.js';

describe('getPredefinedServer', () => {
  it('returns the server definition for a known id', () => {
    const server = getPredefinedServer('google-drive-mcp-lib');
    expect(server).toBeDefined();
    expect(server?.id).toBe('google-drive-mcp-lib');
    expect(server?.name).toBe('Google Drive');
  });

  it('returns undefined for an unknown id', () => {
    expect(getPredefinedServer('does-not-exist')).toBeUndefined();
  });

  it('returns gmail server', () => {
    const server = getPredefinedServer('gmail-mcp-lib');
    expect(server).toBeDefined();
    expect(server?.auth?.provider).toBe('google');
  });

  it('returns weather server', () => {
    const server = getPredefinedServer('weather');
    expect(server).toBeDefined();
    expect(server?.inProcess).toBe(true);
  });
});

describe('listPredefinedServers', () => {
  it('excludes hidden servers by default', () => {
    const visible = listPredefinedServers();
    expect(visible.every(s => !s.hidden)).toBe(true);
  });

  it('includes hidden servers when requested', () => {
    const all = listPredefinedServers(true);
    const hidden = all.filter(s => s.hidden);
    expect(hidden.length).toBeGreaterThan(0);
  });

  it('returns a subset of all servers by default', () => {
    const visible = listPredefinedServers();
    const all = listPredefinedServers(true);
    expect(visible.length).toBeLessThan(all.length);
    expect(all.length).toBe(PREDEFINED_MCP_SERVERS.length);
  });

  it('all returned servers have required fields', () => {
    for (const server of listPredefinedServers(true)) {
      expect(server.id).toBeTruthy();
      expect(server.name).toBeTruthy();
      expect(server.description).toBeTruthy();
    }
  });
});

describe('requiresAuth', () => {
  it('returns true for google-drive (google OAuth)', () => {
    expect(requiresAuth('google-drive-mcp-lib')).toBe(true);
  });

  it('returns true for gmail (google OAuth)', () => {
    expect(requiresAuth('gmail-mcp-lib')).toBe(true);
  });

  it('returns true for github (github auth)', () => {
    expect(requiresAuth('github')).toBe(true);
  });

  it('returns false for weather (no auth)', () => {
    expect(requiresAuth('weather')).toBe(false);
  });

  it('returns false for memory (no auth)', () => {
    expect(requiresAuth('memory')).toBe(false);
  });

  it('returns false for brave-search (no auth)', () => {
    expect(requiresAuth('brave-search')).toBe(false);
  });

  it('returns false for an unknown server id', () => {
    expect(requiresAuth('unknown-server')).toBe(false);
  });
});
