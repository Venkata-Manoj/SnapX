/**
 * Pure webhook helpers. No Deno globals and no network calls, so the crypto
 * and the plan/status mapping can be tested with Node as well as run in the
 * Edge Function.
 */

export type PaidPlan = 'pro' | 'max';
export type EffectivePlan = PaidPlan | 'free';

export type SubscriptionRow = {
  plan?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  pending_plan?: string | null;
  pending_plan_at?: string | null;
  provider_subscription_id?: string | null;
  pending_subscription_id?: string | null;
};

const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** HMAC-SHA256 of the raw request body, hex encoded, as Razorpay sends it. */
export async function hmacSha256Hex(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return toHex(new Uint8Array(signature));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(new Uint8Array(digest));
}

/**
 * Constant-time string comparison. The loop always walks the longer input, so
 * a wrong length does not return early and leak it.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = String(a);
  const right = String(b);
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;

  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return difference === 0;
}

const ENTITY_STATUS: Record<string, string> = {
  created: 'created',
  authenticated: 'authenticated',
  active: 'active',
  pending: 'past_due',
  halted: 'halted',
  cancelled: 'cancelled',
  completed: 'completed',
  expired: 'cancelled',
  paused: 'paused',
};

const EVENT_STATUS: Record<string, string> = {
  'subscription.authenticated': 'authenticated',
  'subscription.activated': 'active',
  'subscription.charged': 'active',
  'subscription.pending': 'past_due',
  'subscription.halted': 'halted',
  'subscription.cancelled': 'cancelled',
  'subscription.completed': 'completed',
  'subscription.paused': 'paused',
  'subscription.resumed': 'active',
  'payment.failed': 'past_due',
};

/** Map a Razorpay event (and, where useful, its entity status) to our status. */
export function mapStatus(event: string, entityStatus?: string | null): string {
  if (event === 'subscription.updated') {
    const mapped = entityStatus ? ENTITY_STATUS[entityStatus] : undefined;
    if (mapped) return mapped;
  }

  return (
    EVENT_STATUS[event] ??
    (entityStatus ? ENTITY_STATUS[entityStatus] : undefined) ??
    'active'
  );
}

/** The statuses the deployed table's check constraint accepts. */
export const STORED_STATUSES = [
  'created',
  'active',
  'past_due',
  'halted',
  'cancelled',
  'completed',
] as const;

const STATUS_FALLBACK: Record<string, string> = {
  authenticated: 'active',
  pending: 'past_due',
  paused: 'halted',
  expired: 'cancelled',
};

/**
 * Fold a provider status into one the table stores. Razorpay reports
 * `authenticated` (mandate authorised, first charge pending), `paused` and
 * `expired`; writing those fails the check constraint and the whole event is
 * lost, so each maps to the nearest stored state. An authenticated mandate is
 * live, so it stores as `active`.
 */
export function storedStatus(status: string): string {
  if ((STORED_STATUSES as readonly string[]).includes(status)) return status;
  return STATUS_FALLBACK[status] ?? 'active';
}

/** Prefer the plan id (survives plan changes), fall back to the original note. */
export function planFrom(
  planId: string | null | undefined,
  notesPlan: string | null | undefined,
  ids: { pro?: string | null; max?: string | null },
): PaidPlan | null {
  if (planId && ids.pro && planId === ids.pro) return 'pro';
  if (planId && ids.max && planId === ids.max) return 'max';
  if (notesPlan === 'pro' || notesPlan === 'max') return notesPlan;
  return null;
}

/**
 * A scheduled downgrade is reported by Razorpay with the new plan id before the
 * current period ends. While `pending_plan_at` is still in the future, the
 * customer keeps the plan they paid for.
 */
export function pendingPlanHolds(
  row: SubscriptionRow | null | undefined,
  proposedPlan: EffectivePlan,
  nowMs = Date.now(),
): boolean {
  if (!row?.pending_plan || proposedPlan !== row.pending_plan) return false;
  if (!row.pending_plan_at) return false;

  const at = Date.parse(row.pending_plan_at);
  return Number.isFinite(at) && at > nowMs;
}

/**
 * What to do with an event that belongs to the future subscription created for
 * a UPI upgrade.
 *
 * - `authenticated`: the customer authorised the new mandate. The old plan
 *   keeps running and must be stopped at the period end.
 * - `switch`: the new subscription started; move the row onto it.
 * - `clear`: the future subscription died before it started. The old plan is
 *   untouched; only the pending fields go.
 * - `ignore`: nothing has changed yet (for example `subscription.pending`).
 */
export type PendingOutcome = 'authenticated' | 'switch' | 'clear' | 'ignore';

export function pendingSubscriptionOutcome(
  event: string,
  entityStatus?: string | null,
): PendingOutcome {
  if (event === 'subscription.activated' || event === 'subscription.charged') return 'switch';
  if (event === 'subscription.authenticated') return 'authenticated';
  if (event === 'payment.failed') return 'clear';
  if (
    event === 'subscription.cancelled' ||
    event === 'subscription.completed' ||
    event === 'subscription.expired' ||
    event === 'subscription.halted'
  ) {
    return 'clear';
  }
  if (event === 'subscription.updated') {
    if (entityStatus === 'active') return 'switch';
    if (entityStatus === 'authenticated') return 'authenticated';
    if (entityStatus === 'cancelled' || entityStatus === 'expired' || entityStatus === 'halted') {
      return 'clear';
    }
  }
  return 'ignore';
}

/** Unix seconds (Razorpay) to an ISO timestamp, or null. */
export function unixToIso(value: unknown): string | null {
  const seconds = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString();
}

/**
 * What the extension may use right now. A paid plan is entitled while it is
 * active (or authorised and waiting for the first charge) and its period has
 * not ended. A cancelled or completed plan keeps the time already paid for
 * until current_period_end. Halted, failed and paused plans are Free at once.
 */
export function effectivePlan(
  row: SubscriptionRow | null | undefined,
  nowMs = Date.now(),
): EffectivePlan {
  if (!row || !row.plan || row.plan === 'free') return 'free';

  const status = String(row.status ?? 'active');
  if (!['active', 'authenticated', 'cancelled', 'completed'].includes(status)) return 'free';

  if (row.current_period_end) {
    const end = Date.parse(row.current_period_end);
    if (Number.isFinite(end) && end <= nowMs) return 'free';
  } else if (status === 'cancelled' || status === 'completed') {
    return 'free';
  }

  return row.plan === 'max' ? 'max' : 'pro';
}

/**
 * The minimum billing record kept for reconciliation. Deliberately excludes
 * customer name, email, phone, card, UPI and bank data.
 */
export function summariseEvent(body: unknown): Record<string, unknown> {
  const payload = (body ?? {}) as Record<string, any>;
  const subscription = payload?.payload?.subscription?.entity ?? {};
  const payment = payload?.payload?.payment?.entity ?? {};
  const refund = payload?.payload?.refund?.entity ?? {};

  return {
    event: String(payload?.event ?? ''),
    subscription_id: subscription.id ?? payment.subscription_id ?? refund.subscription_id ?? null,
    payment_id: payment.id ?? refund.payment_id ?? null,
    refund_id: refund.id ?? null,
    plan_id: subscription.plan_id ?? null,
    status: subscription.status ?? payment.status ?? refund.status ?? null,
    amount: payment.amount ?? refund.amount ?? null,
    currency: payment.currency ?? refund.currency ?? null,
    current_end: subscription.current_end ?? null,
    created_at: payment.created_at ?? refund.created_at ?? subscription.created_at ?? null,
  };
}

/**
 * The row written to `payment_events` before an event is applied. `provider`
 * and `event_type` are not nullable in the deployed table, so they are always
 * filled; `event` is kept because the ledger and the schema both read it.
 */
export function ledgerRow(
  id: string,
  event: string,
  summary: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    event,
    event_type: event,
    provider: 'razorpay',
    provider_subscription_id: summary.subscription_id ?? null,
    payload: summary,
  };
}
