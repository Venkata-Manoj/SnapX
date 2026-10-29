/**
 * Checkout gating, kept pure so Node can test it without Deno or Supabase.
 *
 * The signup trigger gives every new user `plan = 'free', status = 'active'`.
 * That row is not a subscription, so it must not block a first checkout. Only a
 * paid plan, or a real provider subscription in an open state, blocks.
 */

export type CheckoutRow = {
  plan?: string | null;
  status?: string | null;
  current_period_end?: string | null;
  provider_subscription_id?: string | null;
  provider_plan_id?: string | null;
};

export type CheckoutGate =
  | { action: 'block' }
  | { action: 'reuse'; subscriptionId: string }
  | { action: 'create' };

const OPEN_STATUSES = ['active', 'authenticated', 'pending', 'past_due', 'halted', 'paused'];

export function checkoutGate(
  row: CheckoutRow | null | undefined,
  requestedPlanId: string,
  nowMs = Date.now(),
): CheckoutGate {
  if (!row) return { action: 'create' };

  const plan = String(row.plan ?? 'free');
  const status = String(row.status ?? '');
  const providerId = row.provider_subscription_id ? String(row.provider_subscription_id) : '';
  const end = row.current_period_end ? Date.parse(row.current_period_end) : null;
  const paid = plan === 'pro' || plan === 'max';

  // A future end date keeps the paid plan even after a cancel. With no end
  // date, only a live status counts; `cancelled` or `completed` without one is
  // a stale row, not a plan.
  const stillPaid =
    paid && (end ? end > nowMs : status === 'active' || status === 'authenticated');

  // A real provider subscription in an open state must not be duplicated, even
  // if the local plan column has not caught up yet.
  const inFlight = Boolean(providerId) && OPEN_STATUSES.includes(status);

  if (stillPaid || inFlight) return { action: 'block' };

  // An abandoned checkout leaves a `created` subscription. Reopening the same
  // one avoids a second subscription and a second mandate.
  if (providerId && status === 'created' && row.provider_plan_id === requestedPlanId) {
    return { action: 'reuse', subscriptionId: providerId };
  }

  return { action: 'create' };
}
