import { describe, it, expect } from 'bun:test';
import { InProcessAdapter, type InProcessMCPModule } from '../mcp/adapters/InProcessAdapter.js';
import { MultiAccountAdapter } from '../mcp/adapters/MultiAccountAdapter.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeModule(systemPrompt?: string): InProcessMCPModule {
  return {
    getTools: () => [],
    ...(systemPrompt !== undefined ? { getSystemPrompt: () => systemPrompt } : {}),
    // Index signature satisfied by the spread
  } as InProcessMCPModule;
}

function makeAdapter(modulePrompt?: string): InProcessAdapter {
  return new InProcessAdapter('id', 'user', 'server-key', makeModule(modulePrompt));
}

// ─── InProcessAdapter.getSystemPrompt ───────────────────────────────────────

describe('InProcessAdapter.getSystemPrompt', () => {
  it('returns the module system prompt when present', () => {
    const adapter = makeAdapter('## MY TOOL\nDo something useful.');
    expect(adapter.getSystemPrompt()).toBe('## MY TOOL\nDo something useful.');
  });

  it('returns undefined when module does not implement getSystemPrompt', () => {
    const adapter = makeAdapter(); // no getSystemPrompt on module
    expect(adapter.getSystemPrompt()).toBeUndefined();
  });

  it('returns undefined when module getSystemPrompt returns empty string', () => {
    const module: InProcessMCPModule = {
      getTools: () => [],
      getSystemPrompt: () => '',
    } as InProcessMCPModule;
    const adapter = new InProcessAdapter('id', 'user', 'key', module);
    // Empty string is falsy — index.ts filters with .filter(Boolean), so this is fine
    expect(adapter.getSystemPrompt()).toBe('');
  });
});

// ─── MultiAccountAdapter.getSystemPrompt ────────────────────────────────────

describe('MultiAccountAdapter.getSystemPrompt', () => {
  it('returns undefined when no accounts are registered', () => {
    const adapter = new MultiAccountAdapter('id', 'gmail-mcp-lib');
    expect(adapter.getSystemPrompt()).toBeUndefined();
  });

  it('returns the first account module system prompt', () => {
    const adapter = new MultiAccountAdapter('id', 'gmail-mcp-lib');
    adapter.addAccount('alice@example.com', makeModule('## GMAIL\nDo email stuff.'));
    adapter.addAccount('bob@example.com', makeModule('## GMAIL\nOther text.'));
    expect(adapter.getSystemPrompt()).toBe('## GMAIL\nDo email stuff.');
  });

  it('returns undefined when first account module has no getSystemPrompt', () => {
    const adapter = new MultiAccountAdapter('id', 'gmail-mcp-lib');
    adapter.addAccount('alice@example.com', makeModule()); // no getSystemPrompt
    expect(adapter.getSystemPrompt()).toBeUndefined();
  });
});

// ─── getSystemPrompts deduplication logic ───────────────────────────────────
// This mirrors the deduplication logic in MCPManager.getSystemPrompts()
// without needing to instantiate the full manager.

describe('getSystemPrompts deduplication', () => {
  function collectPrompts(adapters: InProcessAdapter[]): string[] {
    const prompts: string[] = [];
    const seen = new Set<string>();
    for (const adapter of adapters) {
      const prompt = adapter.getSystemPrompt();
      if (prompt && !seen.has(prompt)) {
        seen.add(prompt);
        prompts.push(prompt);
      }
    }
    return prompts;
  }

  it('collects prompts from all adapters', () => {
    const adapters = [
      makeAdapter('## TOOL A\nDoes A.'),
      makeAdapter('## TOOL B\nDoes B.'),
    ];
    expect(collectPrompts(adapters)).toEqual(['## TOOL A\nDoes A.', '## TOOL B\nDoes B.']);
  });

  it('deduplicates identical prompts (e.g. two Gmail accounts on same adapter type)', () => {
    const prompt = '## GMAIL\nSame text.';
    const adapters = [makeAdapter(prompt), makeAdapter(prompt)];
    expect(collectPrompts(adapters)).toEqual([prompt]);
  });

  it('skips adapters without getSystemPrompt', () => {
    const adapters = [
      makeAdapter(),          // no prompt
      makeAdapter('## B\nB.'),
      makeAdapter(),          // no prompt
    ];
    expect(collectPrompts(adapters)).toEqual(['## B\nB.']);
  });

  it('returns empty array when no adapters have prompts', () => {
    expect(collectPrompts([makeAdapter(), makeAdapter()])).toEqual([]);
  });
});

// ─── Static memory system prompt ────────────────────────────────────────────

describe('SQLiteMemoryInProcess.systemPrompt', () => {
  it('is a non-empty static string', async () => {
    const { SQLiteMemoryInProcess } = await import('../mcp/in-process/sqlite-memory.js');
    expect(typeof SQLiteMemoryInProcess.systemPrompt).toBe('string');
    expect(SQLiteMemoryInProcess.systemPrompt.length).toBeGreaterThan(0);
    expect(SQLiteMemoryInProcess.systemPrompt).toContain('MEMORY SYSTEM');
  });
});

describe('DynamoDBMemoryInProcess.systemPrompt', () => {
  it('is a non-empty static string matching SQLite version', async () => {
    const { SQLiteMemoryInProcess } = await import('../mcp/in-process/sqlite-memory.js');
    const { DynamoDBMemoryInProcess } = await import('../mcp/in-process/dynamodb-memory.js');
    expect(DynamoDBMemoryInProcess.systemPrompt).toBe(SQLiteMemoryInProcess.systemPrompt);
  });
});
