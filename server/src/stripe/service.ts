import Stripe from 'stripe';
import { config } from '../config/index.js';

let stripeInstance: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeInstance) {
    if (!config.stripe.secretKey) {
      throw new Error('STRIPE_SECRET_KEY is not configured');
    }
    stripeInstance = new Stripe(config.stripe.secretKey, {
      apiVersion: '2026-02-25.clover',
    });
  }
  return stripeInstance;
}

/** Allowed top-up amounts in cents */
export const TOPUP_AMOUNTS_CENTS = [500, 1000, 2000, 5000] as const;
export type TopUpAmountCents = (typeof TOPUP_AMOUNTS_CENTS)[number];

export function centsToUsd(cents: number): number {
  return cents / 100;
}

export async function createTopUpPaymentIntent(
  userId: string,
  amountCents: TopUpAmountCents
): Promise<Stripe.PaymentIntent> {
  const stripe = getStripe();
  return stripe.paymentIntents.create({
    amount: amountCents,
    currency: 'usd',
    automatic_payment_methods: { enabled: true },
    metadata: { userId, amountCents: String(amountCents) },
  });
}

export async function constructWebhookEvent(
  rawBody: Buffer,
  signature: string
): Promise<Stripe.Event> {
  const stripe = getStripe();
  if (!config.stripe.webhookSecret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
  }
  return stripe.webhooks.constructEventAsync(rawBody, signature, config.stripe.webhookSecret);
}
