import Stripe from 'stripe';
import { config } from '../config/index.js';

export type StripeMode = 'live' | 'test';

let liveInstance: Stripe | null = null;
let testInstance: Stripe | null = null;

export function getStripe(mode: StripeMode = 'live'): Stripe {
  if (mode === 'test') {
    if (!testInstance) {
      if (!config.stripeTest.secretKey) {
        throw new Error('STRIPE_TEST_SECRET_KEY is not configured');
      }
      testInstance = new Stripe(config.stripeTest.secretKey, {
        apiVersion: '2026-02-25.clover',
      });
    }
    return testInstance;
  }

  if (!liveInstance) {
    if (!config.stripe.secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    liveInstance = new Stripe(config.stripe.secretKey, {
      apiVersion: '2026-02-25.clover',
    });
  }
  return liveInstance;
}

export function getStripeConfig(mode: StripeMode = 'live') {
  return mode === 'test' ? config.stripeTest : config.stripe;
}

/** Allowed top-up amounts in cents */
export const TOPUP_AMOUNTS_CENTS = [500, 1000, 2000, 5000] as const;
export type TopUpAmountCents = (typeof TOPUP_AMOUNTS_CENTS)[number];

export function centsToUsd(cents: number): number {
  return cents / 100;
}

export async function createTopUpPaymentIntent(
  userId: string,
  amountCents: TopUpAmountCents,
  mode: StripeMode = 'live'
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe(mode);
  return stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: { userId, amountCents: String(amountCents) },
  });
}

export async function constructWebhookEvent(
  rawBody: Buffer,
  signature: string,
  mode: StripeMode = 'live'
): Promise<Stripe.Event> {
  const stripe = getStripe(mode);
  const stripeConfig = getStripeConfig(mode);
  if (!stripeConfig.webhookSecret) {
    throw new Error(
      mode === 'test' ? 'STRIPE_TEST_WEBHOOK_SECRET is not configured' : 'STRIPE_WEBHOOK_SECRET is not configured'
    );
  }
  return stripe.webhooks.constructEventAsync(rawBody, signature, stripeConfig.webhookSecret);
}
