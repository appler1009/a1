import type { FastifyInstance } from 'fastify';
import { getMainDatabase } from '../storage/index.js';
import { config } from '../config/index.js';

export async function scheduledRoutes(fastify: FastifyInstance): Promise<void> {
  // Gmail attachment download proxy
  // All IDs come as query params to avoid Fastify's 100-char maxParamLength limit
  // on Gmail attachment IDs (which can be 400+ chars).
  fastify.get('/gmail/attachment', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const query = request.query as { messageId?: string; attachmentId?: string; filename?: string; mimeType?: string };

    if (!query.messageId || !query.attachmentId) {
      return reply.code(400).send({ success: false, error: { message: 'messageId and attachmentId are required' } });
    }

    // Basic input validation — reject path traversal
    if (query.messageId.includes('..') || query.attachmentId.includes('..')) {
      return reply.code(400).send({ success: false, error: { message: 'Invalid attachment parameters' } });
    }

    try {
      const { google } = await import('googleapis');
      const { OAuth2Client } = await import('google-auth-library');

      // With multi-account support a user can have several Google Gmail tokens.
      // Try each one in turn — the right account will return 200; others 403.
      const mainDb = await getMainDatabase(config.storage.root);
      const allTokens = await mainDb.getAllUserOAuthTokens(request.user.id, 'google-gmail');
      if (allTokens.length === 0) {
        return reply.code(401).send({ success: false, error: { message: 'Google Gmail OAuth token not found. Please authenticate with Gmail first.' } });
      }

      let lastError: unknown;
      for (const oauthToken of allTokens) {
        try {
          const oauth2Client = new OAuth2Client(
            config.google.clientId,
            config.google.clientSecret,
            config.google.redirectUri,
          );
          oauth2Client.setCredentials({
            access_token: oauthToken.accessToken,
            refresh_token: oauthToken.refreshToken,
            expiry_date: oauthToken.expiryDate,
            token_type: 'Bearer',
          });

          const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
          const response = await gmail.users.messages.attachments.get({
            userId: 'me',
            messageId: query.messageId!,
            id: query.attachmentId!,
          });

          if (!response.data.data) {
            return reply.code(404).send({ success: false, error: { message: 'Attachment data not found' } });
          }

          // Gmail returns base64url-encoded data
          const buffer = Buffer.from(response.data.data, 'base64');
          const mimeType = query.mimeType || 'application/octet-stream';
          const filename = query.filename || 'attachment';

          reply.header('Content-Type', mimeType);
          // Use "inline" so browsers can render in iframes/img for preview;
          // the Download button on the client uses the `download` attribute.
          reply.header('Content-Disposition', `inline; filename="${filename.replace(/"/g, '\\"')}"`);
          reply.header('Content-Length', String(buffer.length));
          return reply.send(buffer);
        } catch (err: any) {
          // 403 = wrong account; try the next token
          if (err?.status === 403 || err?.code === 403) {
            lastError = err;
            continue;
          }
          throw err;
        }
      }

      // All tokens exhausted
      console.error('[GmailAttachment] All tokens returned 403:', lastError);
      return reply.code(403).send({ success: false, error: { message: 'Permission denied for all linked Google accounts' } });
    } catch (error) {
      console.error('[GmailAttachment] Error downloading attachment:', error);
      return reply.code(500).send({ success: false, error: { message: 'Failed to download attachment' } });
    }
  });

  // ============================================
  // Scheduled Jobs API
  // ============================================

  // List scheduled jobs
  fastify.get('/scheduled-jobs', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    const query = request.query as { status?: string; roleId?: string };
    const mainDb = await getMainDatabase(config.storage.root);
    const jobs = await mainDb.listScheduledJobs(request.user.id, {
      status: query.status,
      roleId: query.roleId,
    });
    return reply.send({ success: true, data: jobs.map(j => ({
      id: j.id,
      userId: j.userId,
      roleId: j.roleId,
      description: j.description,
      scheduleType: j.scheduleType,
      status: j.status,
      runAt: j.runAt?.toISOString() ?? null,
      lastRunAt: j.lastRunAt?.toISOString() ?? null,
      lastError: j.lastError,
      runCount: j.runCount,
      createdAt: j.createdAt.toISOString(),
      updatedAt: j.updatedAt.toISOString(),
    })) });
  });

  // Get a single scheduled job
  fastify.get('/scheduled-jobs/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    const { id } = request.params as { id: string };
    const mainDb = await getMainDatabase(config.storage.root);
    const job = await mainDb.getScheduledJob(id);
    if (!job || job.userId !== request.user.id) {
      return reply.code(404).send({ success: false, error: { message: 'Job not found' } });
    }
    return reply.send({ success: true, data: {
      id: job.id,
      userId: job.userId,
      roleId: job.roleId,
      description: job.description,
      scheduleType: job.scheduleType,
      status: job.status,
      runAt: job.runAt?.toISOString() ?? null,
      lastRunAt: job.lastRunAt?.toISOString() ?? null,
      lastError: job.lastError,
      runCount: job.runCount,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
    } });
  });

  // Cancel a scheduled job
  fastify.delete('/scheduled-jobs/:id', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }
    const { id } = request.params as { id: string };
    const mainDb = await getMainDatabase(config.storage.root);
    const cancelled = await mainDb.cancelScheduledJob(id, request.user.id);
    if (!cancelled) {
      return reply.code(404).send({ success: false, error: { message: 'Job not found or cannot be cancelled' } });
    }
    return reply.send({ success: true });
  });
}
