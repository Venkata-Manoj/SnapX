import { json, methodNotAllowed, preflight, unauthorized } from '../_shared/http.ts';
import { serviceClient, userFromRequest } from '../_shared/clients.ts';
import { planIdFor, razorpayRequest } from '../_shared/razorpay.ts';

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

    const db = serviceClient();
    const { data: row, error } = await db
      .from('subscriptions')
      .select('plan,status,current_period_end,provider_subscription_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[change-subscription] read failed', error.code ?? 'error');
      return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
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

    // Record the intent before calling Razorpay so a fast webhook cannot race
    // ahead of the row update.
    await db
      .from('subscriptions')
      .update({ pending_plan: target, pending_plan_at: pendingAt })
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
      await db
        .from('subscriptions')
        .update({ pending_plan: null, pending_plan_at: null })
        .eq('user_id', user.id);

      const description = String(result.data?.error?.description ?? '');
      if (/card|upi|emandate|e-mandate/i.test(description)) {
        return json(
          req,
          {
            error: 'plan_change_unsupported',
            message:
              'Razorpay can only change the plan on a card mandate. Cancel your plan and subscribe again, or email billing.',
          },
          409,
        );
      }

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
