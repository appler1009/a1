/**
 * WhatsApp Bot Integration (Meta WhatsApp Business Cloud API)
 *
 * Extends BaseBot to expose the app's chat system to WhatsApp users.
 * Each WhatsApp user maps 1:1 to an app user (linked via web UI).
 * Uses the Meta Cloud API for sending messages and a webhook for receiving them.
 */

import { getMainDatabase } from '../storage/index.js';
import { BaseBot } from '../bots/base-bot.js';
import type { BotSegment } from '../bots/types.js';
import { config as appConfig } from '../config/index.js';
import { stripHtml } from '@local-agent/shared';
import type { User } from '@local-agent/shared';

const GRAPH_API_URL = 'https://graph.facebook.com/v20.0';

class WhatsAppBot extends BaseBot {
  private readonly accessToken: string;
  private readonly phoneNumberId: string;

  constructor(accessToken: string, phoneNumberId: string, port: number) {
    super(port);
    this.accessToken = accessToken;
    this.phoneNumberId = phoneNumberId;
  }

  getName(): string { return 'WhatsApp'; }
  getMessageChunkSize(): number { return 4096; }

  async getUserByPlatformId(whatsappUserId: string): Promise<User | null> {
    const mainDb = await getMainDatabase(appConfig.storage.root);
    return mainDb.getUserByWhatsAppId(whatsappUserId);
  }

  async notifyUserByPlatformId(whatsappUserId: string, message: string): Promise<void> {
    await this.sendText(whatsappUserId, message);
    console.log(`[WhatsApp] Sent notification to ${whatsappUserId}`);
  }

  async start(): Promise<void> {
    console.log(`[WhatsApp] Bot ready (phone number ID: ${this.phoneNumberId})`);
  }

  /**
   * Handle an incoming webhook payload from Meta.
   * Called by the POST /whatsapp/webhook route.
   */
  async handleUpdate(body: unknown): Promise<void> {
    const payload = body as any;
    const entry = payload?.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;

    // Mark messages as read and process them
    const messages: any[] = value?.messages ?? [];
    for (const msg of messages) {
      if (msg.type !== 'text') continue;

      const from: string = msg.from; // phone number e.g. "15551234567"
      const text: string = msg.text?.body ?? '';

      if (!text) continue;

      console.log(`[WhatsApp] Message from ${from}: ${text.substring(0, 50)}`);

      // Mark as read
      this.markRead(msg.id).catch(() => {});

      const appUser = await this.getUserByPlatformId(from);
      if (!appUser) {
        await this.sendText(
          from,
          'Your WhatsApp number is not linked to the app. ' +
          'Please go to web app Settings → WhatsApp and enter your WhatsApp phone number. ' +
          `Your number is: ${from}`,
        );
        continue;
      }

      // Send "typing" indicator (mark as read serves as acknowledgement)
      const result = await this.processMessage(from, text);
      if (!result) {
        await this.sendText(from, 'Error: could not process message.');
        continue;
      }

      for (const segment of result.segments) {
        await this.sendSegment(from, segment);
      }
    }
  }

  private async sendSegment(to: string, segment: BotSegment): Promise<void> {
    // Send email data as formatted text
    if (segment.emailData) {
      const emailText = formatEmailAsText(segment.emailData);
      if (emailText) {
        for (const chunk of this.splitMessage(emailText)) {
          await this.sendText(to, chunk);
        }
      }
    }

    // Send file attachments as documents
    if (segment.fileRefs?.length) {
      for (const ref of segment.fileRefs) {
        try {
          const fullUrl = ref.url.startsWith('http')
            ? ref.url
            : `http://localhost:${this.port}${ref.url}`;
          await this.sendDocument(to, fullUrl, ref.filename);
        } catch (err) {
          console.error(`[WhatsApp] Failed to send file ${ref.filename}:`, err);
        }
      }
    }

    // Send text content
    if (segment.text) {
      for (const chunk of this.splitMessage(segment.text)) {
        await this.sendText(to, chunk);
      }
    }
  }

  private async sendText(to: string, text: string): Promise<void> {
    const res = await fetch(`${GRAPH_API_URL}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text, preview_url: false },
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      console.error(`[WhatsApp] sendText failed (${res.status}): ${err}`);
    }
  }

  private async sendDocument(to: string, url: string, filename: string): Promise<void> {
    const res = await fetch(`${GRAPH_API_URL}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: { link: url, filename },
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      console.error(`[WhatsApp] sendDocument failed (${res.status}): ${err}`);
    }
  }

  private async markRead(messageId: string): Promise<void> {
    await fetch(`${GRAPH_API_URL}/${this.phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }),
    });
  }
}

// Module-level bot instance
let botInstance: WhatsAppBot | null = null;

export function getWhatsAppBot(): WhatsAppBot | null {
  return botInstance;
}

export async function startWhatsAppBot(port: number): Promise<void> {
  const { accessToken, phoneNumberId } = appConfig.whatsapp ?? {};

  if (!accessToken || !phoneNumberId) {
    console.log('[WhatsApp] Access token or phone number ID not set - WhatsApp bot disabled');
    return;
  }

  console.log('[WhatsApp] Starting WhatsApp bot...');
  botInstance = new WhatsAppBot(accessToken, phoneNumberId, port);
  try {
    await botInstance.start();
  } catch (error) {
    console.error('[WhatsApp] Failed to start:', error);
    botInstance = null;
  }
}

export async function notifyScheduledJobCompletion(
  appUserId: string,
  roleName: string,
  jobDescription: string,
): Promise<void> {
  if (!botInstance) {
    console.log('[WhatsApp] Bot not initialized, skipping notification');
    return;
  }
  await botInstance.notifyScheduledJobCompletion(appUserId, roleName, jobDescription);
}

// ─── WhatsApp-specific helpers ────────────────────────────────────────────────

function formatEmailAsText(emailData: Record<string, unknown>): string {
  const isThread = Array.isArray((emailData as any).messages);

  if (isThread) {
    const thread = emailData as any;
    const firstMsg = thread.messages?.[0] || {};
    const subject = thread.subject || firstMsg.subject || 'Email Thread';
    const count = thread.messageCount || thread.messages.length;
    const body = firstMsg.isHtml ? stripHtml(firstMsg.body || '') : (firstMsg.body || '');
    const participants = thread.participants?.join(', ') || '';

    let text = `📧 *${subject}* (${count} messages)\n`;
    if (participants) text += `_Participants: ${participants}_\n`;
    if (body) text += `\n${body.slice(0, 1000)}${body.length > 1000 ? '…' : ''}`;
    return text;
  } else {
    const email = emailData as any;
    const subject = email.subject || '(No subject)';
    const from = email.fromName ? `${email.fromName} <${email.from}>` : (email.from || '');
    const to = Array.isArray(email.to) ? email.to.join(', ') : (email.to || '');
    const body = email.isHtml ? stripHtml(email.body || '') : (email.body || '');

    let text = `📧 *${subject}*\n`;
    if (from) text += `From: ${from}\n`;
    if (to) text += `To: ${to}\n`;
    if (email.date) text += `Date: ${new Date(email.date).toLocaleString()}\n`;
    if (body) text += `\n${body.slice(0, 2000)}${body.length > 2000 ? '…' : ''}`;
    return text;
  }
}
