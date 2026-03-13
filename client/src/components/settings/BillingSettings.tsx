import React from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { apiFetch } from '../../lib/api';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BalanceData {
  creditBalanceUsd: number;
  publishableKey: string;
}

interface Payment {
  id: string;
  amountUsd: number;
  status: 'pending' | 'succeeded' | 'failed';
  createdAt: string;
}

const PRESET_AMOUNTS: { cents: number; label: string }[] = [
  { cents: 500,  label: '$5' },
  { cents: 1000, label: '$10' },
  { cents: 2000, label: '$20' },
  { cents: 5000, label: '$50' },
];

// ─── Inner payment form (mounted inside <Elements>) ───────────────────────────

interface PaymentFormProps {
  amountCents: number;
  onSuccess: () => void;
  onCancel: () => void;
}

function PaymentForm({ amountCents, onSuccess, onCancel }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setErrorMsg(null);

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        // No redirect needed for card payments when redirect: 'if_required'
        return_url: window.location.href,
      },
      redirect: 'if_required',
    });

    if (error) {
      setErrorMsg(error.message ?? 'Payment failed. Please try again.');
      setSubmitting(false);
    } else {
      // Payment succeeded (no redirect occurred)
      onSuccess();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="p-3 bg-muted/30 rounded-lg">
        <PaymentElement />
      </div>

      {errorMsg && (
        <p className="text-xs text-red-600 bg-red-500/10 px-3 py-2 rounded-lg">{errorMsg}</p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="flex-1 px-4 py-2 text-sm border border-border rounded-lg hover:bg-muted/50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={submitting || !stripe || !elements}
          className="flex-1 px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-wait font-medium"
        >
          {submitting ? 'Processing…' : `Pay $${(amountCents / 100).toFixed(2)}`}
        </button>
      </div>
    </form>
  );
}

// ─── Main BillingSettings component ──────────────────────────────────────────

export function BillingSettings() {
  const [balance, setBalance] = React.useState<BalanceData | null>(null);
  const [payments, setPayments] = React.useState<Payment[]>([]);
  const [loadingBalance, setLoadingBalance] = React.useState(true);

  // Checkout state
  const [selectedCents, setSelectedCents] = React.useState<number | null>(null);
  const [clientSecret, setClientSecret] = React.useState<string | null>(null);
  const [stripePromise, setStripePromise] = React.useState<ReturnType<typeof loadStripe> | null>(null);
  const [creatingIntent, setCreatingIntent] = React.useState(false);
  const [checkoutError, setCheckoutError] = React.useState<string | null>(null);
  const [successMsg, setSuccessMsg] = React.useState<string | null>(null);

  // ── Fetch balance + payments ────────────────────────────────────────────────
  const fetchBalance = React.useCallback(async () => {
    setLoadingBalance(true);
    try {
      const [balRes, payRes] = await Promise.all([
        apiFetch('/api/billing/balance', { excludeRoleId: true }),
        apiFetch('/api/billing/payments', { excludeRoleId: true }),
      ]);
      if (balRes.ok) {
        const d = await balRes.json();
        if (d.success) setBalance(d.data);
      }
      if (payRes.ok) {
        const d = await payRes.json();
        if (d.success) setPayments(d.data);
      }
    } catch {
      // silently ignore; balance stays null
    } finally {
      setLoadingBalance(false);
    }
  }, []);

  React.useEffect(() => {
    fetchBalance();
  }, [fetchBalance]);

  // ── Start checkout ──────────────────────────────────────────────────────────
  const handleSelectAmount = async (cents: number) => {
    setCheckoutError(null);
    setSelectedCents(cents);
    setCreatingIntent(true);
    setClientSecret(null);

    try {
      const res = await apiFetch('/api/billing/create-payment-intent', {
        method: 'POST',
        body: JSON.stringify({ amountCents: cents }),
        excludeRoleId: true,
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        setCheckoutError(data.error?.message ?? 'Failed to start checkout. Please try again.');
        setSelectedCents(null);
        return;
      }

      // Lazily load Stripe only when the user is actually about to pay
      if (balance?.publishableKey && !stripePromise) {
        setStripePromise(loadStripe(balance.publishableKey));
      }

      setClientSecret(data.data.clientSecret);
    } catch {
      setCheckoutError('Network error. Please try again.');
      setSelectedCents(null);
    } finally {
      setCreatingIntent(false);
    }
  };

  const handleCancel = () => {
    setSelectedCents(null);
    setClientSecret(null);
    setCheckoutError(null);
  };

  const handleSuccess = async () => {
    setClientSecret(null);
    setSelectedCents(null);
    setSuccessMsg('Payment successful! Your credits have been added.');
    setTimeout(() => setSuccessMsg(null), 6000);
    // Small delay so the webhook has a moment to fire before we refresh
    await new Promise(r => setTimeout(r, 1500));
    fetchBalance();
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loadingBalance) {
    return <p className="text-xs text-muted-foreground">Loading…</p>;
  }

  if (!balance) {
    return (
      <p className="text-xs text-muted-foreground">
        Billing is not available. Please contact support.
      </p>
    );
  }

  const isCheckingOut = clientSecret && stripePromise && selectedCents !== null;

  return (
    <div className="space-y-5">
      {/* Success banner */}
      {successMsg && (
        <div className="px-3 py-2 bg-green-500/15 text-green-700 text-sm rounded-lg">
          {successMsg}
        </div>
      )}

      {/* Balance card */}
      <div className="p-4 border border-border rounded-lg bg-muted/20">
        <p className="text-xs font-medium text-muted-foreground mb-1">Available Credits</p>
        <p className="text-3xl font-bold tabular-nums">
          ${balance.creditBalanceUsd.toFixed(2)}
        </p>
        {balance.creditBalanceUsd < 1 && (
          <p className="mt-1 text-xs text-amber-600">
            ⚠️ Low balance — top up to keep chatting
          </p>
        )}
      </div>

      {/* Checkout flow */}
      {isCheckingOut ? (
        <div className="p-4 border border-border rounded-lg bg-muted/20 space-y-3">
          <p className="text-sm font-medium">
            Adding ${(selectedCents / 100).toFixed(2)} of credits
          </p>
          <Elements
            stripe={stripePromise}
            options={{
              clientSecret,
              appearance: { theme: 'stripe' },
            }}
          >
            <PaymentForm
              amountCents={selectedCents}
              onSuccess={handleSuccess}
              onCancel={handleCancel}
            />
          </Elements>
        </div>
      ) : (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Add Credits</p>
          {checkoutError && (
            <p className="mb-2 text-xs text-red-600 bg-red-500/10 px-3 py-2 rounded-lg">
              {checkoutError}
            </p>
          )}
          <div className="grid grid-cols-4 gap-2">
            {PRESET_AMOUNTS.map(({ cents, label }) => (
              <button
                key={cents}
                onClick={() => handleSelectAmount(cents)}
                disabled={creatingIntent}
                className="py-3 border border-border rounded-lg text-sm font-semibold hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors disabled:opacity-50 disabled:cursor-wait"
              >
                {creatingIntent && selectedCents === cents ? '…' : label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Credits are consumed as you chat. Unused credits never expire.
          </p>
        </div>
      )}

      {/* Payment history */}
      {payments.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-2">Payment History</p>
          <div className="space-y-1">
            {payments.map(p => (
              <div
                key={p.id}
                className="flex items-center justify-between px-3 py-2 rounded-lg bg-muted/20 text-sm"
              >
                <span className="font-medium">${p.amountUsd.toFixed(2)}</span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    p.status === 'succeeded'
                      ? 'bg-green-500/15 text-green-700'
                      : p.status === 'failed'
                      ? 'bg-red-500/15 text-red-700'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {p.status}
                </span>
                <span className="text-xs text-muted-foreground">
                  {new Date(p.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
