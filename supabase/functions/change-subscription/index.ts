import { json, methodNotAllowed, preflight, unauthorized } from '../_shared/http.ts';
import { serviceClient, userFromRequest } from '../_shared/clients.ts';
import { isMandateLocked } from '../_shared/checkout.ts';
import { planIdFor, razorpayKeyId, razorpayRequest } from '../_shared/razorpay.ts';

const isPlan = (value: unknown): value is 'pro' | 'max' => value === 'pro' || value === 'max';

/**
 * Pro -> Max: Razorpay's Update Subscription API with schedule_change_at=now.
 * Razorpay prorates the difference automatically and charges or credits the
 * customer. Max -> Pro: the same API with schedule_change_at=cycle_end, so the
 * change lands when the paid Max period ends.
 *
 * Razorpay only allows plan changes on card-authorised subscriptions, not UPI
 * or e-mandate. That limitation is surfaced to the user, who can cancel at the
 * end of the period and subscribe again.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return methodNotAllowed(req);

  try {
    const { user } = await userFromRequest(req);
    if (!user) return unauthorized(req);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: 'invalid_json', message: 'Send a JSON body.' }, 400);
    }

    const target = (body as { plan?: unknown } | null)?.plan;
    if (!isPlan(target)) {
      return json(req, { error: 'invalid_plan', message: 'Choose Pro or Max.' }, 400);
    }
    const abandon = (body as { abandon?: unknown } | null)?.abandon === true;

    const db = serviceClient();
    const { data: row, error } = await db
      .from('subscriptions')
      .select(
        'plan,status,current_period_end,provider_subscription_id,pending_plan,pending_plan_at,pending_subscription_id',
      )
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[change-subscription] read failed', error.code ?? 'error');
      return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
    }

    // The customer closed Razorpay Checkout without authorising the future
    // subscription. Drop it so the account page does not claim a change that
    // was never set up.
    if (abandon) {
      if (row?.pending_subscription_id) {
        await razorpayRequest(
          'POST',
          `/subscriptions/${encodeURIComponent(String(row.pending_subscription_id))}/cancel`,
          { cancel_at_cycle_end: 0 },
        );
      }
      await db
        .from('subscriptions')
        .update({ pending_plan: null, pending_plan_at: null, pending_subscription_id: null })
        .eq('user_id', user.id);

      return json(req, { ok: true, abandoned: true });
    }

    if (!row?.provider_subscription_id || row.plan === 'free') {
      return json(
        req,
        { error: 'no_subscription', message: 'You do not have a paid plan to change.' },
        409,
      );
    }

    if (row.plan === target) {
      return json(req, { error: 'same_plan', message: `You are already on ${target}.` }, 409);
    }

    if (!['active', 'authenticated'].includes(String(row.status ?? ''))) {
      return json(
        req,
        {
          error: 'not_active',
          message: "This plan can't be changed while a payment is pending or failed. Fix the payment first.",
        },
        409,
      );
    }

    const upgrading = target === 'max';
    const schedule = upgrading ? 'now' : 'cycle_end';
    const pendingAt = upgrading ? null : row.current_period_end ?? null;

    // A future subscription left over from an earlier attempt must not start
    // alongside the change being made now.
    if (row.pending_subscription_id) {
      await razorpayRequest(
        'POST',
        `/subscriptions/${encodeURIComponent(String(row.pending_subscription_id))}/cancel`,
        { cancel_at_cycle_end: 0 },
      );
    }

    // Record the intent before calling Razorpay so a fast webhook cannot race
    // ahead of the row update.
    await db
      .from('subscriptions')
      .update({ pending_plan: target, pending_plan_at: pendingAt, pending_subscription_id: null })
      .eq('user_id', user.id);

    const result = await razorpayRequest(
      'PATCH',
      `/subscriptions/${encodeURIComponent(String(row.provider_subscription_id))}`,
      {
        plan_id: planIdFor(target),
        schedule_change_at: schedule,
        customer_notify: 1,
      },
    );

    if (!result.ok) {
      const description = String(result.data?.error?.description ?? '');

      // Razorpay refuses a plan update on a UPI or e-mandate authorisation.
      // The supported route is a second subscription that starts when the
      // current period ends, authorised now through Checkout.
      if (isMandateLocked(description)) {
        return await startFutureSubscription(db, req, user.id, row, target);
      }

      await db
        .from('subscriptions')
        .update({ pending_plan: null, pending_plan_at: null })
        .eq('user_id', user.id);

      return json(
        req,
        { error: 'provider_error', message: "We couldn't change the plan. Try again in a moment." },
        502,
      );
    }

    return json(req, {
      ok: true,
      current_plan: row.plan,
      pending_plan: target,
      effective: upgrading ? 'now' : 'cycle_end',
      current_period_end: row.current_period_end,
    });
  } catch (error) {
    console.error('[change-subscription] failed', (error as Error)?.message ?? 'Error');
    return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
  }
});

/**
 * UPI fallback. Create a second subscription for the target plan that starts
 * when the paid period ends, and hand its id back for Checkout so the customer
 * authorises the new mandate now. The old plan keeps running and renews if the
 * customer never authorises; the webhook switches the row when the new
 * subscription activates.
 */
async function startFutureSubscription(
  db: ReturnType<typeof serviceClient>,
  req: Request,
  userId: string,
  row: any,
  target: 'pro' | 'max',
): Promise<Response> {
  const end = row.current_period_end ? Date.parse(row.current_period_end) : NaN;

  if (!Number.isFinite(end) || end <= Date.now() + 120_000) {
    await db
      .from('subscriptions')
      .update({ pending_plan: null, pending_plan_at: null })
      .eq('user_id', userId);

    return json(
      req,
      {
        error: 'no_period_end',
        message:
          'This change needs a current period end date. Try again after the next payment, or email billing.',
      },
      409,
    );
  }

  const created = await razorpayRequest('POST', '/subscriptions', {
    plan_id: planIdFor(target),
    total_count: 120,
    customer_notify: 1,
    start_at: Math.floor(end / 1000),
    notes: {
      user_id: userId,
      plan: target,
      replaces: String(row.provider_subscription_id ?? ''),
    },
  });

  if (!created.ok || !created.data?.id) {
    await db
      .from('subscriptions')
      .update({ pending_plan: null, pending_plan_at: null })
      .eq('user_id', userId);

    return json(
      req,
      { error: 'provider_error', message: "We couldn't set up the new plan. Try again in a moment." },
      502,
    );
  }

  const futureId = String(created.data.id);
  const { error: saveError } = await db
    .from('subscriptions')
    .update({
      pending_plan: target,
      pending_plan_at: new Date(end).toISOString(),
      pending_subscription_id: futureId,
    })
    .eq('user_id', userId);

  if (saveError) {
    console.error('[change-subscription] pending save failed', saveError.code ?? 'error');
    await razorpayRequest(
      'POST',
      `/subscriptions/${encodeURIComponent(futureId)}/cancel`,
      { cancel_at_cycle_end: 0 },
    );
    return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
  }

  return json(req, {
    ok: true,
    current_plan: row.plan,
    pending_plan: target,
    effective: 'cycle_end',
    requires_checkout: true,
    subscription_id: futureId,
    key_id: razorpayKeyId(),
    current_period_end: row.current_period_end,
  });
}
