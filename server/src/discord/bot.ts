/**
 * Discord Bot Integration
 *
 * Extends BaseBot to expose the app's chat system to Discord users.
 * Each Discord user maps 1:1 to an app user (linked via web UI).
 * The bot responds when @mentioned, in DMs, or in configured channels.
 */

import { AttachmentBuilder, Client, EmbedBuilder, Events, GatewayIntentBits, Partials } from 'discord.js';
import { getMainDatabase } from '../storage/index.js';
import { BaseBot } from '../bots/base-bot.js';
import type { BotSegment } from '../bots/types.js';
import { config as appConfig } from '../config/index.js';
import { stripHtml } from '@local-agent/shared';
import type { User } from '@local-agent/shared';

class DiscordBot extends BaseBot {
  private client: Client | null = null;
  private channelIds: string[];
  private token: string;

  constructor(token: string, channelIds: string[], port: number) {
    super(port);
    this.token = token;
    this.channelIds = channelIds;
  }

  getName(): string { return 'Discord'; }
  getMessageChunkSize(): number { return 2000; }

  async getUserByPlatformId(discordUserId: string): Promise<User | null> {
    const mainDb = await getMainDatabase(appConfig.storage.root);
    return mainDb.getUserByDiscordId(discordUserId);
  }

  async notifyUserByPlatformId(discordUserId: string, message: string): Promise<void> {
    if (!this.client) throw new Error('Discord client not initialized');
    const user = await this.client.users.fetch(discordUserId);
    await user.send(message);
    console.log(`[Discord] Sent notification to ${user.tag}`);
  }

  async start(): Promise<void> {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });

    this.client.on(Events.ClientReady, (readyClient) => {
      console.log(`[Discord] Logged in as ${readyClient.user.tag}`);
    });

    this.client.on(Events.MessageCreate, async (message) => {
      await this.handleMessage(message);
    });

    await this.client.login(this.token);
  }

  private async handleMessage(message: any): Promise<void> {
    try {
      if (message.author.bot) return;

      const isDM = !message.guild;
      const isMentioned = message.mentions.has(message.client.user.id);
      const isAllowedChannel = this.channelIds.includes(message.channelId);
      if (!isDM && !isMentioned && !isAllowedChannel) return;

      console.log(`[Discord] Message from ${message.author.username}: ${message.content.substring(0, 50)}`);

      // Strip @mentions from content
      const botUser = message.client.user;
      let content = message.content.replace(new RegExp(`<@!?${botUser.id}>`, 'g'), '').trim();

      if (!content) {
        await message.reply('Please provide a message.');
        return;
      }

      const appUser = await this.getUserByPlatformId(message.author.id);
      if (!appUser) {
        await message.reply(
          'Your Discord account is not linked to the app. ' +
          'Please go to the web app settings and link your Discord User ID. ' +
          'To find your ID, enable Developer Mode in Discord settings and right-click your username.',
        );
        return;
      }

      await message.channel.sendTyping();

      const result = await this.processMessage(message.author.id, content);
      if (!result) {
        await message.reply('Error: could not process message');
        return;
      }

      const { segments } = result;
      const fullText = segments.map((s) => s.text).filter(Boolean).join('\n');
      console.log(`[Discord] Got ${segments.length} segment(s), first: ${segments[0]?.text.substring(0, 80)}`);

      // Render and send each segment
      for (const segment of segments) {
        const embeds = await this.buildEmbeds(segment);
        const files = await this.fetchAttachments(segment);

        const chunks = segment.text ? this.splitMessage(segment.text) : [''];
        for (let i = 0; i < chunks.length; i++) {
          const payload: { content?: string; embeds: EmbedBuilder[]; files: AttachmentBuilder[] } = {
            content: chunks[i] || undefined,
            embeds: i === 0 ? embeds.slice(0, 10) : [],
            files: i === 0 ? files.slice(0, 10) : [],
          };
          if (!payload.content && !payload.embeds.length && !payload.files.length) continue;
          await message.reply(payload);
        }
      }

      void fullText;
    } catch (error) {
      console.error('[Discord] Error handling message:', error);
      try {
        await message.reply('An unexpected error occurred. Please try again.');
      } catch {
        // ignore reply failure
      }
    }
  }

  private async buildEmbeds(segment: BotSegment): Promise<EmbedBuilder[]> {
    if (!segment.emailData) return [];
    return [buildEmailEmbed(segment.emailData)];
  }

  private async fetchAttachments(segment: BotSegment): Promise<AttachmentBuilder[]> {
    if (!segment.fileRefs?.length) return [];
    const results = await Promise.all(
      segment.fileRefs.map((ref) => fetchFileAsAttachment(ref.url, ref.filename, this.port)),
    );
    return results.filter((a): a is AttachmentBuilder => a !== null);
  }
}

// Module-level bot instance for notifications
let botInstance: DiscordBot | null = null;

export async function startDiscordBot(port: number): Promise<void> {
  const token = appConfig.discord.botToken;
  const channelIds = appConfig.discord.channelIds;

  if (!token) {
    console.log('[Discord] Bot token not set - Discord bot disabled');
    return;
  }

  console.log('[Discord] Starting Discord bot...');
  botInstance = new DiscordBot(token, channelIds, port);
  try {
    await botInstance.start();
  } catch (error) {
    console.error('[Discord] Failed to log in:', error);
    botInstance = null;
  }
}

export async function notifyScheduledJobCompletion(
  appUserId: string,
  roleName: string,
  jobDescription: string,
): Promise<void> {
  if (!botInstance) {
    console.log('[Discord] Bot not initialized, skipping notification');
    return;
  }
  await botInstance.notifyScheduledJobCompletion(appUserId, roleName, jobDescription);
}

// ─── Discord-specific helpers ────────────────────────────────────────────────

function buildEmailEmbed(emailData: Record<string, unknown>): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0x4A90D9);
  const isThread = Array.isArray((emailData as any).messages);

  if (isThread) {
    const thread = emailData as any;
    const firstMsg = thread.messages?.[0] || {};
    embed.setTitle(`📧 ${thread.subject || firstMsg.subject || 'Email Thread'}`);
    embed.setDescription(`*${thread.messageCount || thread.messages.length} messages*`);
    if (thread.participants?.length) {
      embed.addFields({ name: 'Participants', value: thread.participants.join(', ').slice(0, 1024) });
    }
    const body = firstMsg.isHtml ? stripHtml(firstMsg.body || '') : (firstMsg.body || '');
    if (body) {
      embed.addFields({ name: 'Latest message', value: body.slice(0, 512) + (body.length > 512 ? '…' : '') });
    }
  } else {
    const email = emailData as any;
    embed.setTitle(`📧 ${email.subject || '(No subject)'}`);
    const from = email.fromName ? `${email.fromName} <${email.from}>` : (email.from || '');
    if (from) embed.setAuthor({ name: from });
    if (email.to?.length) {
      embed.addFields({ name: 'To', value: (Array.isArray(email.to) ? email.to : [email.to]).join(', ').slice(0, 1024), inline: true });
    }
    if (email.date) {
      embed.addFields({ name: 'Date', value: new Date(email.date).toLocaleString(), inline: true });
    }
    if (email.cc?.length) {
      embed.addFields({ name: 'CC', value: (Array.isArray(email.cc) ? email.cc : [email.cc]).join(', ').slice(0, 1024) });
    }
    const body = email.isHtml ? stripHtml(email.body || '') : (email.body || '');
    if (body) embed.setDescription(body.slice(0, 4000) + (body.length > 4000 ? '…' : ''));
    if (email.attachments?.length) {
      const names = email.attachments.map((a: any) => a.filename || a.name).filter(Boolean).join(', ');
      embed.setFooter({ text: `📎 ${email.attachments.length} attachment(s): ${names}`.slice(0, 2048) });
    }
  }

  return embed;
}

async function fetchFileAsAttachment(
  url: string,
  filename: string,
  port: number,
): Promise<AttachmentBuilder | null> {
  try {
    const fullUrl = url.startsWith('http') ? url : `http://localhost:${port}${url}`;
    const res = await fetch(fullUrl);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return new AttachmentBuilder(buf, { name: filename });
  } catch (err) {
    console.error('[Discord:Attachment] Failed to fetch file:', err);
    return null;
  }
}
