import {
  authUnavailable,
  json,
  methodNotAllowed,
  preflight,
  sessionInvalid,
  unauthorized,
} from '../_shared/http.ts';
import { serviceClient, userFromRequest } from '../_shared/clients.ts';
import { checkoutGate } from '../_shared/checkout.ts';
import { planIdFor, razorpayKeyId, razorpayRequest } from '../_shared/razorpay.ts';

const TOTAL_COUNT = 120; // ten years of monthly billing

const isPlan = (value: unknown): value is 'pro' | 'max' => value === 'pro' || value === 'max';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return methodNotAllowed(req);

  try {
    const { user, reason } = await userFromRequest(req);
    if (!user) {
      if (reason === 'missing_token') return unauthorized(req);
      if (reason === 'unavailable') return authUnavailable(req);
      return sessionInvalid(req);
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return json(req, { error: 'invalid_json', message: 'Send a JSON body.' }, 400);
    }

    const plan = (body as { plan?: unknown } | null)?.plan;
    if (!isPlan(plan)) {
      return json(req, { error: 'invalid_plan', message: 'Choose Pro or Max.' }, 400);
    }

    const db = serviceClient();
    const { data: row, error: readError } = await db
      .from('subscriptions')
      .select('plan,status,current_period_end,provider_subscription_id,provider_plan_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (readError) {
      console.error('[create-subscription] read failed', readError.code ?? 'error');
      return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
    }

    const planId = planIdFor(plan);
    const gate = checkoutGate(row, planId);

    if (gate.action === 'block') {
      return json(
        req,
        {
          error: 'already_subscribed',
          message: 'You already have a plan. Manage or cancel it from your account page.',
        },
        409,
      );
    }

    // An abandoned checkout already has a subscription id; reopen it instead
    // of creating a second one.
    if (gate.action === 'reuse') {
      return json(req, {
        subscription_id: gate.subscriptionId,
        key_id: razorpayKeyId(),
      });
    }

    const result = await razorpayRequest('POST', '/subscriptions', {
      plan_id: planId,
      total_count: TOTAL_COUNT,
      customer_notify: 1,
      notes: { user_id: user.id, plan },
    });

    if (!result.ok || !result.data?.id) {
      return json(
        req,
        { error: 'provider_error', message: "Checkout couldn't start. Try again in a moment." },
        502,
      );
    }

    const subscriptionId = String(result.data.id);

    const { error: saveError } = await db.from('subscriptions').upsert(
      {
        user_id: user.id,
        plan: 'free',
        status: 'created',
        current_period_end: null,
        cancel_at_period_end: false,
        provider_subscription_id: subscriptionId,
        provider_plan_id: planId,
        started_at: null,
        pending_plan: null,
        pending_plan_at: null,
        pending_subscription_id: null,
      },
      { onConflict: 'user_id' },
    );

    if (saveError) {
      console.error('[create-subscription] save failed', saveError.code ?? 'error');
      return json(
        req,
        { error: 'server_error', message: "Checkout couldn't start. Try again in a moment." },
        500,
      );
    }

    return json(req, {
      subscription_id: subscriptionId,
      key_id: razorpayKeyId(),
    });
  } catch (error) {
    console.error('[create-subscription] failed', (error as Error)?.message ?? 'Error');
    return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
  }
});
