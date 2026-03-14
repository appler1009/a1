/**
 * Telegram Bot Integration
 *
 * Extends BaseBot to expose the app's chat system to Telegram users.
 * Each Telegram user maps 1:1 to an app user (linked via web UI).
 * The bot responds to all private messages and group messages where it is mentioned.
 */

import { Telegraf } from 'telegraf';
import { getMainDatabase } from '../storage/index.js';
import { BaseBot } from '../bots/base-bot.js';
import type { BotSegment } from '../bots/types.js';
import { config as appConfig } from '../config/index.js';
import { stripHtml } from '@local-agent/shared';
import type { User } from '@local-agent/shared';

class TelegramBot extends BaseBot {
  private telegraf: Telegraf;

  constructor(token: string, port: number) {
    super(port);
    this.telegraf = new Telegraf(token);
  }

  getName(): string { return 'Telegram'; }
  getMessageChunkSize(): number { return 4096; }

  async getUserByPlatformId(telegramUserId: string): Promise<User | null> {
    const mainDb = await getMainDatabase(appConfig.storage.root);
    return mainDb.getUserByTelegramId(telegramUserId);
  }

  async notifyUserByPlatformId(telegramUserId: string, message: string): Promise<void> {
    await this.telegraf.telegram.sendMessage(telegramUserId, message, { parse_mode: 'Markdown' });
    console.log(`[Telegram] Sent notification to ${telegramUserId}`);
  }

  async start(): Promise<void> {
    this.telegraf.on('message', async (ctx) => {
      await this.handleMessage(ctx);
    });

    // Launch in long-polling mode (no webhook setup required)
    await this.telegraf.launch();
    console.log(`[Telegram] Bot started (${(await this.telegraf.telegram.getMe()).username})`);
  }

  /** Stop the bot gracefully */
  stop(): void {
    this.telegraf.stop();
  }

  private async handleMessage(ctx: any): Promise<void> {
    try {
      // Only handle text messages
      if (!ctx.message?.text) return;

      const from = ctx.message.from;
      if (!from || from.is_bot) return;

      const chatType = ctx.message.chat.type;
      const isPrivate = chatType === 'private';
      const botInfo = await this.telegraf.telegram.getMe();

      // In group chats, only respond when @mentioned
      let text: string = ctx.message.text;
      if (!isPrivate) {
        const mention = `@${botInfo.username}`;
        if (!text.includes(mention)) return;
        text = text.replace(new RegExp(mention, 'g'), '').trim();
      }

      if (!text) {
        await ctx.reply('Please provide a message.');
        return;
      }

      const telegramUserId = String(from.id);
      console.log(`[Telegram] Message from ${from.username || telegramUserId}: ${text.substring(0, 50)}`);

      const appUser = await this.getUserByPlatformId(telegramUserId);
      if (!appUser) {
        await ctx.reply(
          'Your Telegram account is not linked to the app. ' +
          'Please go to the web app Settings → Telegram and enter your Telegram User ID. ' +
          `Your Telegram User ID is: ${telegramUserId}`,
        );
        return;
      }

      // Show typing indicator
      await ctx.sendChatAction('typing');

      const result = await this.processMessage(telegramUserId, text);
      if (!result) {
        await ctx.reply('Error: could not process message.');
        return;
      }

      const { segments } = result;
      console.log(`[Telegram] Got ${segments.length} segment(s)`);

      for (const segment of segments) {
        await this.sendSegment(ctx, segment);
      }
    } catch (error) {
      console.error('[Telegram] Error handling message:', error);
      try {
        await ctx.reply('An unexpected error occurred. Please try again.');
      } catch {
        // ignore reply failure
      }
    }
  }

  private async sendSegment(ctx: any, segment: BotSegment): Promise<void> {
    // Send email data as formatted text
    if (segment.emailData) {
      const emailText = formatEmailAsText(segment.emailData);
      if (emailText) {
        for (const chunk of this.splitMessage(emailText)) {
          await ctx.reply(chunk, { parse_mode: 'HTML' });
        }
      }
    }

    // Send file attachments
    if (segment.fileRefs?.length) {
      for (const ref of segment.fileRefs) {
        try {
          const fullUrl = ref.url.startsWith('http')
            ? ref.url
            : `http://localhost:${this.port}${ref.url}`;
          const res = await fetch(fullUrl);
          if (res.ok) {
            const buf = Buffer.from(await res.arrayBuffer());
            await ctx.replyWithDocument({ source: buf, filename: ref.filename });
          }
        } catch (err) {
          console.error(`[Telegram] Failed to send file ${ref.filename}:`, err);
        }
      }
    }

    // Send text content
    if (segment.text) {
      for (const chunk of this.splitMessage(segment.text)) {
        await ctx.reply(chunk);
      }
    }
  }
}

// Module-level bot instance
let botInstance: TelegramBot | null = null;

export async function startTelegramBot(port: number): Promise<void> {
  const token = appConfig.telegram?.botToken;

  if (!token) {
    console.log('[Telegram] Bot token not set - Telegram bot disabled');
    return;
  }

  console.log('[Telegram] Starting Telegram bot...');
  botInstance = new TelegramBot(token, port);
  try {
    await botInstance.start();
  } catch (error) {
    console.error('[Telegram] Failed to start:', error);
    botInstance = null;
  }
}

export function stopTelegramBot(): void {
  botInstance?.stop();
  botInstance = null;
}

export async function notifyScheduledJobCompletion(
  appUserId: string,
  roleName: string,
  jobDescription: string,
): Promise<void> {
  if (!botInstance) {
    console.log('[Telegram] Bot not initialized, skipping notification');
    return;
  }
  await botInstance.notifyScheduledJobCompletion(appUserId, roleName, jobDescription);
}

// ─── Telegram-specific helpers ────────────────────────────────────────────────

/** Format email data as HTML for Telegram */
function formatEmailAsText(emailData: Record<string, unknown>): string {
  const isThread = Array.isArray((emailData as any).messages);

  if (isThread) {
    const thread = emailData as any;
    const firstMsg = thread.messages?.[0] || {};
    const subject = thread.subject || firstMsg.subject || 'Email Thread';
    const count = thread.messageCount || thread.messages.length;
    const body = firstMsg.isHtml ? stripHtml(firstMsg.body || '') : (firstMsg.body || '');
    const participants = thread.participants?.join(', ') || '';

    let text = `📧 <b>${escapeHtml(subject)}</b> (${count} messages)\n`;
    if (participants) text += `<i>Participants: ${escapeHtml(participants)}</i>\n`;
    if (body) text += `\n${escapeHtml(body.slice(0, 1000))}${body.length > 1000 ? '…' : ''}`;
    return text;
  } else {
    const email = emailData as any;
    const subject = email.subject || '(No subject)';
    const from = email.fromName ? `${email.fromName} <${email.from}>` : (email.from || '');
    const to = Array.isArray(email.to) ? email.to.join(', ') : (email.to || '');
    const body = email.isHtml ? stripHtml(email.body || '') : (email.body || '');

    let text = `📧 <b>${escapeHtml(subject)}</b>\n`;
    if (from) text += `From: ${escapeHtml(from)}\n`;
    if (to) text += `To: ${escapeHtml(to)}\n`;
    if (email.date) text += `Date: ${new Date(email.date).toLocaleString()}\n`;
    if (body) text += `\n${escapeHtml(body.slice(0, 2000))}${body.length > 2000 ? '…' : ''}`;
    return text;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
