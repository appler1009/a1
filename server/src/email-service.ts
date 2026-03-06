import { SESClient, SendEmailCommand, SendEmailCommandInput } from '@aws-sdk/client-ses';
import { config } from './config/index.js';

/**
 * Email service using AWS SES
 */
export class EmailService {
  private client: SESClient;
  private senderEmail: string;

  constructor() {
    this.client = new SESClient({
      region: config.ses.region,
    });
    this.senderEmail = config.ses.senderEmail;
  }

  /**
   * Send a magic link email
   */
  async sendMagicLinkEmail(email: string, magicLink: string): Promise<void> {
    const subject = 'Sign in to a1';
    const htmlBody = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 500px; margin: 0 auto; padding: 20px; }
            .button { display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 6px; margin: 20px 0; }
            .footer { font-size: 12px; color: #666; margin-top: 30px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>Sign in to a1</h1>
            <p>Click the button below to sign in to your a1 account:</p>
            <p>
              <a href="${magicLink}" class="button">Sign in</a>
            </p>
            <p>Or copy and paste this link into your browser:</p>
            <p style="word-break: break-all; color: #666;">${magicLink}</p>
            <p>This link will expire in 5 minutes.</p>
            <div class="footer">
              <p>If you didn't request this email, you can safely ignore it.</p>
            </div>
          </div>
        </body>
      </html>
    `;

    const textBody = `Sign in to a1\n\nClick the link below to sign in to your a1 account:\n${magicLink}\n\nOr copy and paste this link into your browser:\n${magicLink}\n\nThis link will expire in 5 minutes.\n\nIf you didn't request this email, you can safely ignore it.`;

    await this.sendEmail({
      toAddresses: [email],
      subject,
      htmlBody,
      textBody,
    });
  }

  /**
   * Send an email
   */
  private async sendEmail(params: {
    toAddresses: string[];
    subject: string;
    htmlBody: string;
    textBody: string;
  }): Promise<void> {
    const sesParams: SendEmailCommandInput = {
      Source: this.senderEmail,
      Destination: {
        ToAddresses: params.toAddresses,
      },
      Message: {
        Subject: {
          Data: params.subject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: params.htmlBody,
            Charset: 'UTF-8',
          },
          Text: {
            Data: params.textBody,
            Charset: 'UTF-8',
          },
        },
      },
    };

    try {
      const command = new SendEmailCommand(sesParams);
      await this.client.send(command);
      console.log(`[EmailService] Sent email to ${params.toAddresses.join(', ')}: ${params.subject}`);
    } catch (error) {
      console.error('[EmailService] Failed to send email:', error);
      throw new Error('Failed to send email');
    }
  }
}

// Singleton instance
let emailService: EmailService | null = null;

export function getEmailService(): EmailService {
  if (!emailService) {
    emailService = new EmailService();
  }
  return emailService;
}
