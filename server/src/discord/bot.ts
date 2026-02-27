/**
 * Discord Bot Integration
 *
 * This bot exposes the app's chat system to Discord users.
 * Each Discord user maps 1:1 to an app user (linked via web UI).
 * The bot responds when @mentioned or in configured channels.
 */

import { AttachmentBuilder, Client, EmbedBuilder, Events, GatewayIntentBits, Partials } from 'discord.js';
import { getMainDatabase } from '../storage/index.js';
import { authService } from '../auth/index.js';
import { pendingRoleChanges } from './pending-role-changes.js';
import { extractEmailDataFromMarker, isDisplayEmailMarker } from '../mcp/in-process/display-email.js';

/**
 * Session tracking for Discord users
 * Maps Discord user ID to app session/role information
 */
interface DiscordSession {
  appUserId: string;
  sessionId: string;
  currentRoleId: string | null;
  locale?: string;
  timezone?: string;
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}

const sessions = new Map<string, DiscordSession>();
let discordClient: Client | null = null;

/**
 * Configuration for Discord bot
 */
interface DiscordBotConfig {
  token: string;
  clientId?: string;
  channelIds: string[];
  port: number;
}

/**
 * Start the Discord bot
 * Called from the main server after Fastify starts
 */
export async function startDiscordBot(port: number): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const channelIdsEnv = process.env.DISCORD_CHANNEL_IDS || '';
  const channelIds = channelIdsEnv.split(',').map(id => id.trim()).filter(id => id.length > 0);

  if (!token) {
    console.log('[Discord] Bot token not set - Discord bot disabled');
    return;
  }

  const config: DiscordBotConfig = {
    token,
    clientId,
    channelIds,
    port,
  };

  console.log('[Discord] Starting Discord bot...');
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  });

  client.on(Events.ClientReady, (readyClient) => {
    console.log(`[Discord] Logged in as ${readyClient.user.tag}`);
  });

  client.on(Events.MessageCreate, async (message) => {
    await handleMessage(message, config);
  });

  try {
    await client.login(token);
    discordClient = client;
  } catch (error) {
    console.error('[Discord] Failed to log in:', error);
  }
}

/**
 * Send a Discord notification about a scheduled job completion
 */
export async function notifyScheduledJobCompletion(
  appUserId: string,
  roleName: string,
  jobDescription: string,
): Promise<void> {
  if (!discordClient) {
    console.log('[Discord] Discord bot not initialized, skipping notification');
    return;
  }

  try {
    // Find Discord user(s) associated with this app user
    const discordUserIds = Array.from(sessions.entries())
      .filter(([, session]) => session.appUserId === appUserId)
      .map(([discordUserId]) => discordUserId);

    if (discordUserIds.length === 0) {
      console.log(`[Discord] No active Discord sessions for app user ${appUserId}`);
      return;
    }

    const message = `✅ Scheduled job completed in role **${roleName}**:\n\n${jobDescription.slice(0, 100)}${jobDescription.length > 100 ? '…' : ''}`;

    for (const discordUserId of discordUserIds) {
      try {
        const user = await discordClient.users.fetch(discordUserId);
        await user.send(message);
        console.log(`[Discord] Sent job notification to ${user.tag}`);
      } catch (err) {
        console.error(`[Discord] Failed to send notification to user ${discordUserId}:`, err);
      }
    }
  } catch (err) {
    console.error('[Discord] Failed to send scheduled job notification:', err);
  }
}

/**
 * Handle incoming Discord messages
 */
async function handleMessage(message: any, config: DiscordBotConfig): Promise<void> {
  try {
    // Skip bot messages
    if (message.author.bot) return;

    // Check if message triggers the bot
    const isDM = !message.guild;
    const isMentioned = message.mentions.has(message.client.user.id);
    const isAllowedChannel = config.channelIds.includes(message.channelId);

    if (!isDM && !isMentioned && !isAllowedChannel) {
      return;
    }

    console.log(`[Discord] Message from ${message.author.username}: ${message.content.substring(0, 50)}`);

    // Look up app user
    const mainDb = getMainDatabase(process.env.STORAGE_ROOT || './data');
    const appUser = mainDb.getUserByDiscordId(message.author.id);

    if (!appUser) {
      console.log(`[Discord] User ${message.author.id} not linked to app`);
      await message.reply(
        'Your Discord account is not linked to the app. ' +
        'Please go to the web app settings and link your Discord User ID. ' +
        'To find your ID, enable Developer Mode in Discord settings and right-click your username.'
      );
      return;
    }

    console.log(`[Discord] Linked to app user: ${appUser.id}`);

    // Get or create session
    let session = sessions.get(message.author.id);

    if (!session) {
      console.log(`[Discord] Creating new session for ${appUser.id}`);

      // Create auth session
      const authSession = await authService.createSession(appUser.id);

      // Ensure role-manager is in user's MCP servers
      const mcpServerKey = 'role-manager';
      let mcpConfig = mainDb.getMCPServerConfig(mcpServerKey);

      if (!mcpConfig) {
        console.log(`[Discord] Adding ${mcpServerKey} to user's MCP servers`);
        mainDb.saveMCPServerConfig(mcpServerKey, {
          name: 'Role Manager',
          transport: 'in-process',
          enabled: true,
          hidden: true,
        });
      }

      // Get first role as default
      const roles = mainDb.getUserRoles(appUser.id);
      const defaultRoleId = roles.length > 0 ? roles[0].id : null;

      session = {
        appUserId: appUser.id,
        sessionId: authSession.id,
        currentRoleId: defaultRoleId,
        locale: appUser.locale,
        timezone: appUser.timezone,
        conversationHistory: [],
      };

      sessions.set(message.author.id, session);
    } else {
      // Refresh locale/timezone from DB in case user updated via web UI
      session.locale = appUser.locale;
      session.timezone = appUser.timezone;
    }

    console.log(`[Discord] Session current role: ${session.currentRoleId || 'none'}`);

    // Strip @mentions from message content
    let content = message.content;
    const botUser = message.client.user;
    content = content.replace(new RegExp(`<@!?${botUser.id}>`, 'g'), '').trim();

    if (!content) {
      console.log(`[Discord] Empty message after stripping mentions`);
      await message.reply('Please provide a message.');
      return;
    }

    console.log(`[Discord] User message: ${content.substring(0, 100)}`);

    // Add to conversation history
    session.conversationHistory.push({
      role: 'user',
      content,
    });

    // Show typing indicator
    await message.channel.sendTyping();

    // Call the chat endpoint
    try {
      const segments = await callChatEndpoint(session, config.port);

      if (!segments) {
        await message.reply('Error: No response from the chat service');
        return;
      }

      // Build full text for conversation history (all segments joined)
      const fullText = segments.map(s => s.text).filter(Boolean).join('\n');
      console.log(`[Discord] Got ${segments.length} segment(s), first: ${segments[0]?.text.substring(0, 80)}`);

      // Add combined assistant response to history
      session.conversationHistory.push({ role: 'assistant', content: fullText });

      // Check for pending role changes
      const pendingChange = pendingRoleChanges.get(session.appUserId);
      if (pendingChange) {
        console.log(`[Discord] Applying pending role change: ${pendingChange.roleName}`);
        session.currentRoleId = pendingChange.roleId;
        pendingRoleChanges.delete(session.appUserId);
      }

      // Send each segment as its own message (with text chunks + embeds/files on first chunk)
      for (const segment of segments) {
        const chunks = segment.text ? splitMessage(segment.text, 2000) : [''];
        for (let i = 0; i < chunks.length; i++) {
          const isFirst = i === 0;
          const payload: { content?: string; embeds: EmbedBuilder[]; files: AttachmentBuilder[] } = {
            content: chunks[i] || undefined,
            embeds: isFirst ? segment.embeds.slice(0, 10) : [],
            files: isFirst ? segment.files.slice(0, 10) : [],
          };
          // Skip empty messages with no embeds/files
          if (!payload.content && !payload.embeds?.length && !payload.files?.length) continue;
          await message.reply(payload);
        }
      }

      // Keep conversation history at reasonable size
      if (session.conversationHistory.length > 20) {
        session.conversationHistory = session.conversationHistory.slice(-20);
      }
    } catch (error) {
      console.error('[Discord] Error calling chat endpoint:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      await message.reply(`Error: ${errorMsg}`);
    }
  } catch (error) {
    console.error('[Discord] Error handling message:', error);
    try {
      await message.reply('An unexpected error occurred. Please try again.');
    } catch (replyError) {
      console.error('[Discord] Failed to send error reply:', replyError);
    }
  }
}

interface MessageSegment {
  text: string;
  embeds: EmbedBuilder[];
  files: AttachmentBuilder[];
}

/** Remove web-only preview-file tags that mean nothing in Discord */
function stripPreviewFileTags(text: string): string {
  return text
    .replace(/\[preview-file:[^\]]+\]\([^)]+\)/g, '')
    .replace(/<preview-file[^>]*\/>/gi, '')
    .trim();
}

/**
 * Strip HTML tags and decode common HTML entities for plain text output.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/**
 * Build a Discord embed from email data extracted from a display_email marker.
 */
function buildEmailEmbed(emailData: Record<string, unknown>): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(0x4A90D9);

  // Handle thread vs single message
  const isThread = Array.isArray((emailData as any).messages);

  if (isThread) {
    const thread = emailData as any;
    const firstMsg = thread.messages?.[0] || {};
    embed.setTitle(`📧 ${thread.subject || firstMsg.subject || 'Email Thread'}`);
    embed.setDescription(`*${thread.messageCount || thread.messages.length} messages*`);
    if (thread.participants?.length) {
      embed.addFields({ name: 'Participants', value: thread.participants.join(', ').slice(0, 1024) });
    }
    // Show snippet from first message
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
    if (body) {
      embed.setDescription(body.slice(0, 4000) + (body.length > 4000 ? '…' : ''));
    }
    if (email.attachments?.length) {
      const names = email.attachments.map((a: any) => a.filename || a.name).filter(Boolean).join(', ');
      embed.setFooter({ text: `📎 ${email.attachments.length} attachment(s): ${names}`.slice(0, 2048) });
    }
  }

  return embed;
}

/**
 * Fetch a file from the local server and return as a Discord AttachmentBuilder.
 */
async function fetchFileAsAttachment(
  url: string,
  filename: string,
  sessionId: string,
  port: number,
): Promise<AttachmentBuilder | null> {
  try {
    const fullUrl = url.startsWith('http') ? url : `http://localhost:${port}${url}`;
    const res = await fetch(fullUrl, { headers: { Cookie: `session_id=${sessionId}` } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return new AttachmentBuilder(buf, { name: filename });
  } catch (err) {
    console.error('[Discord:Attachment] Failed to fetch file:', err);
    return null;
  }
}

/**
 * Parse a Google Drive PDF reference from a tool result string.
 * Format: "filename (ID: abc123, application/pdf)"
 */
function parseGoogleDrivePdf(result: string): { id: string; name: string } | null {
  const lines = result.split('\n');
  for (const line of lines) {
    const match = line.match(/^(.+?)\s+\(ID:\s*(\S+?),\s*application\/pdf\)$/);
    if (match) return { name: match[1].trim(), id: match[2] };
  }
  return null;
}

/**
 * Call the chat API endpoint via HTTP.
 * Returns an array of message segments split at tool-call boundaries so each
 * pre-tool thinking block and the final answer are sent as separate messages.
 */
async function callChatEndpoint(session: DiscordSession, port: number): Promise<MessageSegment[] | null> {
  const requestBody: Record<string, unknown> = {
    messages: session.conversationHistory,
    roleId: session.currentRoleId,
    stream: true,
  };
  if (session.locale) requestBody.locale = session.locale;
  if (session.timezone) requestBody.timezone = session.timezone;

  console.log(`[Discord:ChatAPI] Calling endpoint with roleId: ${session.currentRoleId}`);

  try {
    const response = await fetch(`http://localhost:${port}/api/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `session_id=${session.sessionId}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error(`[Discord:ChatAPI] HTTP ${response.status}: ${response.statusText}`);
      return [{ text: `Error: HTTP ${response.status}`, embeds: [], files: [] }];
    }

    const reader = response.body?.getReader();
    if (!reader) return null;

    const segments: MessageSegment[] = [];
    // Current in-progress segment
    let currentText = '';
    // Embeds/files accumulate across tool results and attach to the next segment
    const pendingEmbeds: EmbedBuilder[] = [];
    const pendingFiles: AttachmentBuilder[] = [];

    const flushSegment = () => {
      const text = stripPreviewFileTags(currentText).trim();
      if (text || pendingEmbeds.length || pendingFiles.length) {
        segments.push({ text, embeds: [...pendingEmbeds], files: [...pendingFiles] });
        pendingEmbeds.length = 0;
        pendingFiles.length = 0;
      }
      currentText = '';
    };

    const decoder = new TextDecoder();
    let done = false;

    try {
      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;

        const text = decoder.decode(value, { stream: true });
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.substring(6);

          if (data === '[DONE]') { done = true; break; }

          try {
            const json = JSON.parse(data);

            // Accumulate text content
            if (json.content) currentText += json.content;

            // Tool call boundary → flush current text as its own message
            if (json.type === 'tool_call') {
              flushSegment();
            }

            // Tool result → collect embeds/files for the next message
            if (json.type === 'tool_result' && json.result) {
              const result: string = json.result;

              if (isDisplayEmailMarker(result)) {
                const emailData = extractEmailDataFromMarker(result);
                if (emailData) {
                  console.log('[Discord:ChatAPI] Building email embed');
                  pendingEmbeds.push(buildEmailEmbed(emailData));
                }
              }

              const pdfRef = parseGoogleDrivePdf(result);
              if (pdfRef) {
                console.log('[Discord:ChatAPI] Fetching PDF attachment:', pdfRef.name);
                const url = `/api/viewer/temp/${encodeURIComponent(pdfRef.name)}`;
                const att = await fetchFileAsAttachment(url, pdfRef.name, session.sessionId, port);
                if (att) pendingFiles.push(att);
              }

              const previewMatch = result.match(/\[preview-file:([^\]]+)\]\(([^)]+)\)/);
              if (previewMatch) {
                const [, fname, url] = previewMatch;
                if (!url.includes('drive.google.com')) {
                  const att = await fetchFileAsAttachment(url, fname, session.sessionId, port);
                  if (att) pendingFiles.push(att);
                }
              }
            }
          } catch {
            // ignore malformed lines
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Flush whatever remains as the final segment
    flushSegment();

    return segments.length > 0 ? segments : [{ text: 'No response', embeds: [], files: [] }];
  } catch (error) {
    console.error('[Discord:ChatAPI] Error:', error);
    throw error;
  }
}

/**
 * Split a message into chunks of max length
 * Respects Discord's 2000 character limit
 */
function splitMessage(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let currentChunk = '';

  const lines = text.split('\n');

  for (const line of lines) {
    if ((currentChunk + line + '\n').length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
      }
      currentChunk = line + '\n';
    } else {
      currentChunk += line + '\n';
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}
