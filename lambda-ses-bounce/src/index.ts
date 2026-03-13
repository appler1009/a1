/**
 * Lambda handler: SES bounce & complaint suppression
 *
 * Wiring:
 *   SES → SNS topic (ses-bounce-events) → Lambda (this function) → DynamoDB users table
 *
 * Required environment variables:
 *   AWS_REGION              — AWS region (default: us-east-1)
 *   DYNAMODB_TABLE_PREFIX   — optional table name prefix (e.g. "a1_prod_")
 *
 * The Lambda execution role needs:
 *   dynamodb:Query  on users/email-index
 *   dynamodb:UpdateItem on users
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

// ── AWS clients ───────────────────────────────────────────────────────────────

const REGION = process.env.AWS_REGION ?? 'us-east-1';
const PREFIX = process.env.DYNAMODB_TABLE_PREFIX ?? '';
const USERS_TABLE = `${PREFIX}users`;

const ddbClient = new DynamoDBClient({ region: REGION });
const ddb = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

// ── Types ─────────────────────────────────────────────────────────────────────

interface SnsRecord {
  Sns: {
    Message: string; // JSON-encoded SES notification
    MessageId: string;
    Timestamp: string;
  };
}

interface LambdaEvent {
  Records: SnsRecord[];
}

interface SesBounceNotification {
  notificationType: 'Bounce';
  bounce: {
    bounceType: 'Permanent' | 'Transient' | 'Undetermined';
    bounceSubType: string;
    bouncedRecipients: Array<{ emailAddress: string }>;
    timestamp: string;
  };
}

interface SesComplaintNotification {
  notificationType: 'Complaint';
  complaint: {
    complainedRecipients: Array<{ emailAddress: string }>;
    complaintFeedbackType?: string;
    timestamp: string;
  };
}

type SesNotification = SesBounceNotification | SesComplaintNotification;

// ── Helpers ───────────────────────────────────────────────────────────────────

async function disableEmail(email: string, reason: 'bounce' | 'complaint'): Promise<void> {
  const normalised = email.toLowerCase();

  // 1. Look up the user id via the email GSI
  const { Items } = await ddb.send(new QueryCommand({
    TableName: USERS_TABLE,
    IndexName: 'email-index',
    KeyConditionExpression: 'email = :email',
    ExpressionAttributeValues: { ':email': normalised },
    Limit: 1,
  }));

  if (!Items || Items.length === 0) {
    console.log(`[ses-bounce] No user found for ${normalised} — skipping`);
    return;
  }

  const userId = Items[0].userId as string;

  // 2. Write emailDisabled — idempotent; complaint can never be downgraded to bounce
  await ddb.send(new UpdateCommand({
    TableName: USERS_TABLE,
    Key: { userId },
    UpdateExpression: 'SET emailDisabled = :reason, updatedAt = :now',
    ConditionExpression: 'attribute_not_exists(emailDisabled)',
    ExpressionAttributeValues: {
      ':reason': reason,
      ':now': new Date().toISOString(),
    },
  })).catch(err => {
    if (err.name !== 'ConditionalCheckFailedException') throw err;
    console.log(`[ses-bounce] ${normalised} already disabled — skipping`);
  });

  console.log(`[ses-bounce] emailDisabled=${reason} for ${normalised} (userId=${userId})`);
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function handler(event: LambdaEvent): Promise<void> {
  for (const record of event.Records) {
    let notification: SesNotification;
    try {
      notification = JSON.parse(record.Sns.Message) as SesNotification;
    } catch (err) {
      console.error('[ses-bounce] Failed to parse SNS message:', err);
      continue;
    }

    if (notification.notificationType === 'Bounce') {
      const { bounceType, bouncedRecipients } = notification.bounce;

      // Only suppress permanent (hard) bounces — transient bounces are temporary
      // delivery failures (mailbox full, greylisting) and should not suppress the address.
      if (bounceType !== 'Permanent') {
        console.log(`[ses-bounce] Skipping ${bounceType} bounce (not permanent)`);
        continue;
      }

      for (const recipient of bouncedRecipients) {
        await disableEmail(recipient.emailAddress, 'bounce');
      }
    } else if (notification.notificationType === 'Complaint') {
      for (const recipient of notification.complaint.complainedRecipients) {
        await disableEmail(recipient.emailAddress, 'complaint');
      }
    } else {
      console.log(`[ses-bounce] Ignoring notification type: ${(notification as { notificationType: string }).notificationType}`);
    }
  }
}
