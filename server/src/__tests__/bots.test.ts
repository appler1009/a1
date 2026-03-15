/**
 * Tests for the shared bot abstraction (BaseBot) and platform-specific bots.
 *
 * Covers: utility methods (splitMessage, stripPreviewFileTags),
 * session-less rejection, and platform ID lookup.
 */

import { describe, it, expect } from 'bun:test';
import { BaseBot } from '../bots/base-bot.js';
import type { User } from '@local-agent/shared';

// ---------------------------------------------------------------------------
// Minimal concrete subclass for testing protected methods
// ---------------------------------------------------------------------------

class TestBot extends BaseBot {
  private linkedUser: User | null = null;
  private notified: string[] = [];

  constructor() { super(9999); }

  getName() { return 'Test'; }
  getMessageChunkSize() { return 100; }

  async getUserByPlatformId(_id: string): Promise<User | null> {
    return this.linkedUser;
  }

  async notifyUserByPlatformId(platformUserId: string, message: string): Promise<void> {
    this.notified.push(`${platformUserId}:${message}`);
  }

  async start(): Promise<void> { /* no-op */ }

  // Expose protected methods for testing
  split(text: string, max?: number) { return this.splitMessage(text, max); }
  strip(text: string) { return this.stripPreviewFileTags(text); }

  setLinkedUser(u: User | null) { this.linkedUser = u; }
  getNotified() { return this.notified; }
}

// ---------------------------------------------------------------------------
// splitMessage
// ---------------------------------------------------------------------------

describe('BaseBot.splitMessage', () => {
  const bot = new TestBot();

  it('returns single chunk when text fits', () => {
    const result = bot.split('hello world', 100);
    expect(result).toEqual(['hello world']);
  });

  it('splits at newlines when text exceeds limit', () => {
    const lines = ['a'.repeat(60), 'b'.repeat(60), 'c'.repeat(60)];
    const text = lines.join('\n');
    const chunks = bot.split(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
    // Reassembling chunks should contain all original content
    const joined = chunks.join('\n');
    for (const line of lines) {
      expect(joined).toContain(line);
    }
  });

  it('uses platform chunk size by default', () => {
    // TestBot chunk size is 100; text of 50 chars should be a single chunk
    const result = bot.split('x'.repeat(50));
    expect(result).toHaveLength(1);
  });

  it('handles empty string', () => {
    expect(bot.split('')).toEqual(['']);
  });
});

// ---------------------------------------------------------------------------
// stripPreviewFileTags
// ---------------------------------------------------------------------------

describe('BaseBot.stripPreviewFileTags', () => {
  const bot = new TestBot();

  it('removes markdown-style preview-file links', () => {
    const input = 'Here is a file [preview-file:report.pdf](/api/viewer/temp/report.pdf) attached.';
    const result = bot.strip(input);
    expect(result).not.toContain('preview-file');
    expect(result).toContain('Here is a file');
    expect(result).toContain('attached.');
  });

  it('removes HTML-style preview-file tags', () => {
    const input = 'Look at this <preview-file name="doc.pdf" url="/tmp/doc.pdf"/> result.';
    const result = bot.strip(input);
    expect(result).not.toContain('<preview-file');
    expect(result).toContain('Look at this');
  });

  it('leaves normal text unchanged', () => {
    const input = 'No special tags here.';
    expect(bot.strip(input)).toBe(input);
  });

  it('handles multiple tags', () => {
    const input = [
      '[preview-file:a.pdf](/a)',
      'some text',
      '[preview-file:b.pdf](/b)',
    ].join('\n');
    const result = bot.strip(input);
    expect(result).not.toContain('preview-file');
    expect(result).toContain('some text');
  });
});

// ---------------------------------------------------------------------------
// processMessage — unlinked user
// ---------------------------------------------------------------------------

describe('BaseBot.processMessage (unlinked user)', () => {
  it('returns null when no app user is linked', async () => {
    const bot = new TestBot();
    bot.setLinkedUser(null);
    const result = await (bot as any).processMessage('telegram-123', 'hello');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// notifyScheduledJobCompletion
// ---------------------------------------------------------------------------

describe('BaseBot.notifyScheduledJobCompletion', () => {
  it('does nothing when no sessions exist for the user', async () => {
    const bot = new TestBot();
    // No sessions registered, so no notifications sent
    await bot.notifyScheduledJobCompletion('user-xyz', 'TestRole', 'Job done');
    expect(bot.getNotified()).toHaveLength(0);
  });

  it('notifies all platform sessions belonging to the app user', async () => {
    const bot = new TestBot();
    // Manually inject sessions to simulate two active bot users mapped to the same app user
    const sessions: Map<string, any> = (bot as any).sessions;
    sessions.set('tg-111', { appUserId: 'app-user-1', sessionId: 's1', currentRoleId: null });
    sessions.set('tg-222', { appUserId: 'app-user-1', sessionId: 's2', currentRoleId: null });
    sessions.set('tg-333', { appUserId: 'app-user-2', sessionId: 's3', currentRoleId: null });

    await bot.notifyScheduledJobCompletion('app-user-1', 'MyRole', 'Background task complete');

    const notified = bot.getNotified();
    expect(notified).toHaveLength(2);
    const ids = notified.map(n => n.split(':')[0]);
    expect(ids).toContain('tg-111');
    expect(ids).toContain('tg-222');
    expect(ids).not.toContain('tg-333');
  });
});
