import { describe, it, expect } from 'bun:test';
import { InProcessAdapter, type InProcessMCPModule } from '../mcp/adapters/InProcessAdapter.js';
import { MultiAccountAdapter } from '../mcp/adapters/MultiAccountAdapter.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeModule(opts: { summary?: string; prompt?: string } = {}): InProcessMCPModule {
  return {
    getTools: () => [],
    ...(opts.summary !== undefined ? { getSystemPromptSummary: () => opts.summary } : {}),
    ...(opts.prompt !== undefined ? { getSystemPrompt: () => opts.prompt } : {}),
  } as InProcessMCPModule;
}

function makeAdapter(opts: { summary?: string; prompt?: string } = {}): InProcessAdapter {
  return new InProcessAdapter('id', 'user', 'server-key', makeModule(opts));
}

// ─── InProcessAdapter.getSystemPromptSummary ────────────────────────────────

describe('InProcessAdapter.getSystemPromptSummary', () => {
  it('returns the module summary when present', () => {
    const adapter = makeAdapter({ summary: 'Gmail — search and send emails.' });
    expect(adapter.getSystemPromptSummary()).toBe('Gmail — search and send emails.');
  });

  it('returns undefined when module does not implement getSystemPromptSummary', () => {
    const adapter = makeAdapter({ prompt: '## Full\nDetails.' });
    expect(adapter.getSystemPromptSummary()).toBeUndefined();
  });
});

// ─── InProcessAdapter.getSystemPrompt ───────────────────────────────────────

describe('InProcessAdapter.getSystemPrompt', () => {
  it('returns the module full prompt when present', () => {
    const adapter = makeAdapter({ prompt: '## MY TOOL\nDo something useful.' });
    expect(adapter.getSystemPrompt()).toBe('## MY TOOL\nDo something useful.');
  });

  it('returns undefined when module does not implement getSystemPrompt', () => {
    const adapter = makeAdapter({ summary: 'One-liner only.' });
    expect(adapter.getSystemPrompt()).toBeUndefined();
  });
});

// ─── MultiAccountAdapter summaries and prompts ──────────────────────────────

describe('MultiAccountAdapter.getSystemPromptSummary', () => {
  it('returns undefined when no accounts are registered', () => {
    const adapter = new MultiAccountAdapter('id', 'gmail-mcp-lib');
    expect(adapter.getSystemPromptSummary()).toBeUndefined();
  });

  it('returns summary from the first account module', () => {
    const adapter = new MultiAccountAdapter('id', 'gmail-mcp-lib');
    adapter.addAccount('alice@example.com', makeModule({ summary: 'Gmail — emails.' }));
    adapter.addAccount('bob@example.com', makeModule({ summary: 'Gmail — other.' }));
    expect(adapter.getSystemPromptSummary()).toBe('Gmail — emails.');
  });

  it('returns undefined when first account module has no getSystemPromptSummary', () => {
    const adapter = new MultiAccountAdapter('id', 'gmail-mcp-lib');
    adapter.addAccount('alice@example.com', makeModule({ prompt: 'Full only.' }));
    expect(adapter.getSystemPromptSummary()).toBeUndefined();
  });
});

describe('MultiAccountAdapter.getSystemPrompt', () => {
  it('returns undefined when no accounts are registered', () => {
    const adapter = new MultiAccountAdapter('id', 'gmail-mcp-lib');
    expect(adapter.getSystemPrompt()).toBeUndefined();
  });

  it('returns full prompt from the first account module', () => {
    const adapter = new MultiAccountAdapter('id', 'gmail-mcp-lib');
    adapter.addAccount('alice@example.com', makeModule({ prompt: '## GMAIL\nDo email stuff.' }));
    adapter.addAccount('bob@example.com', makeModule({ prompt: '## GMAIL\nOther text.' }));
    expect(adapter.getSystemPrompt()).toBe('## GMAIL\nDo email stuff.');
  });
});

// ─── Deduplication logic (mirrors MCPManager.getSystemPromptSummaries) ──────

describe('getSystemPromptSummaries deduplication and exclusion', () => {
  function collectSummaries(
    entries: Array<[id: string, adapter: InProcessAdapter]>,
    excludeIds: Set<string> = new Set(),
  ): string[] {
    const summaries: string[] = [];
    const seen = new Set<string>();
    for (const [id, adapter] of entries) {
      if (excludeIds.has(id)) continue;
      const summary = adapter.getSystemPromptSummary();
      if (summary && !seen.has(summary)) {
        seen.add(summary);
        summaries.push(summary);
      }
    }
    return summaries;
  }

  it('collects summaries from all adapters', () => {
    const entries: [string, InProcessAdapter][] = [
      ['gmail', makeAdapter({ summary: 'Gmail — emails.' })],
      ['calendar', makeAdapter({ summary: 'Calendar — events.' })],
    ];
    expect(collectSummaries(entries)).toEqual(['Gmail — emails.', 'Calendar — events.']);
  });

  it('excludes specified server IDs', () => {
    const entries: [string, InProcessAdapter][] = [
      ['role-manager', makeAdapter({ summary: 'Role Manager — switch roles.' })],
      ['meta-mcp-search', makeAdapter({ summary: 'search_tool — discover tools.' })],
      ['gmail', makeAdapter({ summary: 'Gmail — emails.' })],
    ];
    const exclude = new Set(['role-manager', 'meta-mcp-search']);
    expect(collectSummaries(entries, exclude)).toEqual(['Gmail — emails.']);
  });

  it('deduplicates identical summaries', () => {
    const entries: [string, InProcessAdapter][] = [
      ['a', makeAdapter({ summary: 'Same summary.' })],
      ['b', makeAdapter({ summary: 'Same summary.' })],
    ];
    expect(collectSummaries(entries)).toEqual(['Same summary.']);
  });

  it('skips adapters without a summary', () => {
    const entries: [string, InProcessAdapter][] = [
      ['a', makeAdapter({ prompt: 'Full only, no summary.' })],
      ['b', makeAdapter({ summary: 'Has summary.' })],
    ];
    expect(collectSummaries(entries)).toEqual(['Has summary.']);
  });
});

// ─── getSystemPromptFor (full prompt lookup by server ID) ───────────────────

describe('getSystemPromptFor server ID regex extraction', () => {
  // Mirrors the regex used in index.ts to extract server IDs from search_tool results
  function extractServerIds(toolResult: string): string[] {
    const matches = toolResult.matchAll(/\d+\.\s+\*\*[a-zA-Z0-9_-]+\*\*\s+\(([^)]+)\)/g);
    const ids: string[] = [];
    for (const match of matches) {
      if (match[1] && match[1] !== 'unknown') ids.push(match[1]);
    }
    return [...new Set(ids)];
  }

  it('extracts server IDs from search_tool formatted output', () => {
    const result = [
      '1. **gmailSearchMessages** (gmail-mcp-lib) - 95% match',
      '   Search Gmail messages...',
      '2. **gmailGetMessage** (gmail-mcp-lib) - 88% match',
      '   Retrieve a message...',
      '3. **googleCalendarListEvents** (google-calendar-mcp-lib) - 72% match',
      '   List calendar events...',
    ].join('\n');

    expect(extractServerIds(result)).toEqual(['gmail-mcp-lib', 'google-calendar-mcp-lib']);
  });

  it('ignores unknown server IDs', () => {
    const result = '1. **some_tool** (unknown) - 80% match\n   Does stuff.';
    expect(extractServerIds(result)).toEqual([]);
  });

  it('returns empty array for non-matching text', () => {
    expect(extractServerIds('No matching tools found.')).toEqual([]);
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
  it('matches the SQLite version', async () => {
    const { SQLiteMemoryInProcess } = await import('../mcp/in-process/sqlite-memory.js');
    const { DynamoDBMemoryInProcess } = await import('../mcp/in-process/dynamodb-memory.js');
    expect(DynamoDBMemoryInProcess.systemPrompt).toBe(SQLiteMemoryInProcess.systemPrompt);
  });
});
