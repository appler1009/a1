/**
 * SMTP/IMAP account management routes
 *
 * Allows users to add, list, and remove email accounts that use standard
 * SMTP/IMAP protocols.  Passwords are KMS-encrypted at rest via the generic
 * service_credentials table.
 *
 * Endpoints (all require authentication):
 *   GET    /api/smtp-imap/accounts              — list accounts (passwords omitted)
 *   POST   /api/smtp-imap/accounts              — add or update an account
 *   DELETE /api/smtp-imap/accounts/:accountEmail — remove an account
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getMainDatabase } from '../storage/main-db.js';
import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';

const CredentialsSchema = z.object({
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).max(65535),
  smtpSecure: z.boolean(),
  imapHost: z.string().min(1),
  imapPort: z.number().int().min(1).max(65535),
  imapSecure: z.boolean(),
  username: z.string().min(1),
  password: z.string().min(1),
});

const SaveAccountSchema = CredentialsSchema.extend({
  accountEmail: z.string().email(),
});

export async function smtpImapRoutes(fastify: FastifyInstance): Promise<void> {
  // Test SMTP and IMAP connectivity with the provided credentials (nothing is saved)
  fastify.post('/test', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const parsed = CredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: parsed.error.message } });
    }

    const c = parsed.data;

    const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) =>
          setTimeout(() => reject(new Error(`${label} connection timed out after ${ms / 1000}s`)), ms)
        ),
      ]);

    const [smtpResult, imapResult] = await Promise.allSettled([
      withTimeout((async () => {
        const transporter = nodemailer.createTransport({
          host: c.smtpHost,
          port: c.smtpPort,
          secure: c.smtpSecure,
          auth: { user: c.username, pass: c.password },
          connectionTimeout: 10_000,
          greetingTimeout: 10_000,
          socketTimeout: 10_000,
        });
        try {
          await transporter.verify();
          return { ok: true, message: 'Connected successfully' };
        } finally {
          transporter.close();
        }
      })(), 15_000, 'SMTP'),
      withTimeout((async () => {
        const client = new ImapFlow({
          host: c.imapHost,
          port: c.imapPort,
          secure: c.imapSecure,
          auth: { user: c.username, pass: c.password },
          logger: false,
        });
        await client.connect();
        await client.logout().catch(() => {});
        return { ok: true, message: 'Connected successfully' };
      })(), 15_000, 'IMAP'),
    ]);

    const smtpOk = smtpResult.status === 'fulfilled';
    const imapOk = imapResult.status === 'fulfilled';
    const smtpMessage = smtpOk ? smtpResult.value.message : String((smtpResult as PromiseRejectedResult).reason?.message ?? smtpResult.reason);
    const imapMessage = imapOk ? imapResult.value.message : String((imapResult as PromiseRejectedResult).reason?.message ?? imapResult.reason);

    console.log(`[smtp-imap/test] smtp ok=${smtpOk} msg=${smtpMessage}`);
    console.log(`[smtp-imap/test] imap ok=${imapOk} msg=${imapMessage}`);

    return reply.send({
      success: true,
      data: {
        smtp: { ok: smtpOk, message: smtpMessage },
        imap: { ok: imapOk, message: imapMessage },
      },
    });
  });

  // List SMTP/IMAP accounts (passwords excluded)
  fastify.get('/accounts', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const mainDb = await getMainDatabase();
    const accounts = await mainDb.listServiceCredentials(request.user.id, 'smtp-imap');

    // Strip passwords before returning
    const safeAccounts = accounts.map(({ accountEmail, credentials }) => ({
      accountEmail,
      smtpHost: credentials.smtpHost,
      smtpPort: credentials.smtpPort,
      smtpSecure: credentials.smtpSecure,
      imapHost: credentials.imapHost,
      imapPort: credentials.imapPort,
      imapSecure: credentials.imapSecure,
      username: credentials.username,
    }));

    return reply.send({ success: true, data: safeAccounts });
  });

  // Add or update an SMTP/IMAP account
  fastify.post('/accounts', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const parsed = SaveAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ success: false, error: { message: parsed.error.message } });
    }

    const { accountEmail, ...credentials } = parsed.data;

    const mainDb = await getMainDatabase();
    await mainDb.storeServiceCredentials(request.user.id, 'smtp-imap', accountEmail, credentials);

    return reply.send({ success: true, data: { accountEmail } });
  });

  // Remove an SMTP/IMAP account
  fastify.delete('/accounts/:accountEmail', async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({ success: false, error: { message: 'Not authenticated' } });
    }

    const { accountEmail } = request.params as { accountEmail: string };

    const mainDb = await getMainDatabase();
    const deleted = await mainDb.deleteServiceCredentials(request.user.id, 'smtp-imap', accountEmail);

    if (!deleted) {
      return reply.code(404).send({ success: false, error: { message: 'Account not found' } });
    }

    return reply.send({ success: true });
  });
}
