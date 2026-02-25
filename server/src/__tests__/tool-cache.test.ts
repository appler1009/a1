import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import type { MCPToolInfo } from '@local-agent/shared';

// Import the class indirectly via the singleton — we create a fresh instance per test
// by importing the module and resetting the singleton between tests.

function makeTool(name: string): MCPToolInfo {
  return {
    name,
    description: `Tool: ${name}`,
    inputSchema: { type: 'object', properties: {} },
  };
}

// We test the ToolCache class logic directly by importing the module.
// Each describe block gets a fresh instance.
async function freshCache() {
  // Re-import the module to get the singleton; we'll clear it via clearAll()
  const mod = await import('../mcp/tool-cache.js');
  mod.toolCache.clearAll();
  return mod.toolCache;
}

describe('ToolCache.updateServerTools / getServerTools', () => {
  it('stores tools for a server', async () => {
    const cache = await freshCache();
    const tools = [makeTool('search'), makeTool('read')];
    cache.updateServerTools('server-a', tools);

    const stored = cache.getServerTools('server-a');
    expect(stored).toHaveLength(2);
    expect(stored.map(t => t.name).sort()).toEqual(['read', 'search']);
  });

  it('replaces tools when server is updated', async () => {
    const cache = await freshCache();
    cache.updateServerTools('server-a', [makeTool('old-tool')]);
    cache.updateServerTools('server-a', [makeTool('new-tool')]);

    const stored = cache.getServerTools('server-a');
    expect(stored).toHaveLength(1);
    expect(stored[0].name).toBe('new-tool');
  });

  it('returns empty array for unknown server', async () => {
    const cache = await freshCache();
    expect(cache.getServerTools('does-not-exist')).toEqual([]);
  });
});

describe('ToolCache.findToolServer', () => {
  it('returns server and tool for a cached tool', async () => {
    const cache = await freshCache();
    cache.updateServerTools('server-b', [makeTool('my-tool')]);

    const result = cache.findToolServer('my-tool');
    expect(result).not.toBeNull();
    expect(result?.serverId).toBe('server-b');
    expect(result?.tool.name).toBe('my-tool');
  });

  it('returns null for a tool not in cache', async () => {
    const cache = await freshCache();
    expect(cache.findToolServer('missing-tool')).toBeNull();
  });

  it('returns null after TTL expires', async () => {
    const cache = await freshCache();
    cache.updateServerTools('server-c', [makeTool('ttl-tool')]);

    // Advance time past TTL (5 min + 1ms)
    vi.setSystemTime(Date.now() + 5 * 60 * 1000 + 1);

    expect(cache.findToolServer('ttl-tool')).toBeNull();
  });
});

describe('ToolCache.hasTool', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a cached tool', async () => {
    const cache = await freshCache();
    cache.updateServerTools('server-d', [makeTool('exists')]);
    expect(cache.hasTool('exists')).toBe(true);
  });

  it('returns false for a missing tool', async () => {
    const cache = await freshCache();
    expect(cache.hasTool('nope')).toBe(false);
  });
});

describe('ToolCache.clearServerTools', () => {
  it('removes tools for the cleared server only', async () => {
    const cache = await freshCache();
    cache.updateServerTools('server-e', [makeTool('tool-e')]);
    cache.updateServerTools('server-f', [makeTool('tool-f')]);

    cache.clearServerTools('server-e');

    expect(cache.getServerTools('server-e')).toEqual([]);
    expect(cache.getServerTools('server-f')).toHaveLength(1);
  });
});

describe('ToolCache.getAllTools', () => {
  it('returns all tools grouped by server', async () => {
    const cache = await freshCache();
    cache.updateServerTools('s1', [makeTool('a'), makeTool('b')]);
    cache.updateServerTools('s2', [makeTool('c')]);

    const all = cache.getAllTools();
    expect(all).toHaveLength(2);

    const s1 = all.find(r => r.serverId === 's1');
    expect(s1?.tools).toHaveLength(2);

    const s2 = all.find(r => r.serverId === 's2');
    expect(s2?.tools).toHaveLength(1);
  });

  it('returns empty array when cache is empty', async () => {
    const cache = await freshCache();
    expect(cache.getAllTools()).toEqual([]);
  });
});

describe('ToolCache.needsRefresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns true for a server not in cache', async () => {
    const cache = await freshCache();
    expect(cache.needsRefresh('unknown')).toBe(true);
  });

  it('returns false for a freshly cached server', async () => {
    const cache = await freshCache();
    cache.updateServerTools('s', [makeTool('x')]);
    expect(cache.needsRefresh('s')).toBe(false);
  });

  it('returns true after TTL expires', async () => {
    vi.useFakeTimers();
    const cache = await freshCache();
    cache.updateServerTools('s', [makeTool('x')]);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    expect(cache.needsRefresh('s')).toBe(true);
  });
});

describe('ToolCache.getStats / getToolCount', () => {
  it('returns correct counts', async () => {
    const cache = await freshCache();
    cache.updateServerTools('s1', [makeTool('t1'), makeTool('t2')]);
    cache.updateServerTools('s2', [makeTool('t3')]);

    const stats = cache.getStats();
    expect(stats.totalTools).toBe(3);
    expect(stats.serverCount).toBe(2);
    expect(stats.servers).toHaveLength(2);
    expect(cache.getToolCount()).toBe(3);
  });
});

describe('ToolCache.getServersNeedingRefresh', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns servers past TTL', async () => {
    vi.useFakeTimers();
    const cache = await freshCache();
    cache.updateServerTools('stale', [makeTool('x')]);
    cache.updateServerTools('fresh', [makeTool('y')]);

    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    // Update 'fresh' after time advance so it has a current timestamp
    cache.updateServerTools('fresh', [makeTool('y')]);

    const needing = cache.getServersNeedingRefresh();
    expect(needing).toContain('stale');
    expect(needing).not.toContain('fresh');
  });
});
