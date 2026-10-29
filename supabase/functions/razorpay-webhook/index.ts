import { serviceClient } from '../_shared/clients.ts';
import { planIds, verifyWebhookSignature } from '../_shared/razorpay.ts';
import {
  ledgerRow,
  mapStatus,
  pendingPlanHolds,
  planFrom,
  sha256Hex,
  storedStatus,
  summariseEvent,
  unixToIso,
} from '../_shared/webhook.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ok = (body = 'ok'): Response => new Response(body, { status: 200 });
const bad = (body: string): Response => new Response(body, { status: 400 });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  // The signature is over the raw bytes, so read text once, before parsing.
  const rawBody = await req.text();
  const signature = req.headers.get('X-Razorpay-Signature');

  let valid = false;
  try {
    valid = await verifyWebhookSignature(rawBody, signature);
  } catch (error) {
    console.error('[razorpay-webhook] signature check failed', (error as Error)?.message ?? 'Error');
    return new Response('Webhook is not configured', { status: 500 });
  }

  if (!valid) return bad('Invalid signature');

  let body: any;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return bad('Invalid payload');
  }

  const event = String(body?.event ?? '');
  const headerId = req.headers.get('X-Razorpay-Event-Id');
  const eventId = headerId?.trim() || (await sha256Hex(rawBody));

  const db = serviceClient();
  const summary = summariseEvent(body);

  // Idempotency: the primary key is the Razorpay event id. A replay is a
  // duplicate-key error and does nothing.
  const { error: insertError } = await db
    .from('payment_events')
    .insert(ledgerRow(eventId, event, summary));

  if (insertError) {
    if (insertError.code === '23505') return ok('duplicate');
    console.error('[razorpay-webhook] could not record event', eventId, insertError.code ?? 'error');
    return new Response('Could not record event', { status: 500 });
  }

  try {
    const userId = await applyEvent(db, body);
    await db
      .from('payment_events')
      .update({ user_id: userId, processed_at: new Date().toISOString(), error: null })
      .eq('id', eventId);
  } catch (error) {
    console.error(
      '[razorpay-webhook] handler failed',
      eventId,
      event,
      (error as Error)?.message ?? 'Error',
    );
    await db.from('payment_events').update({ error: 'handler_failed' }).eq('id', eventId);
  }

  // Always 200 after storing: Razorpay should not retry a handler bug forever.
  return ok();
});

async function applyEvent(db: ReturnType<typeof serviceClient>, body: any): Promise<string | null> {
  const event = String(body?.event ?? '');
  const subscription = body?.payload?.subscription?.entity ?? null;
  const payment = body?.payload?.payment?.entity ?? null;
  const refund = body?.payload?.refund?.entity ?? null;

  const notes = subscription?.notes ?? payment?.notes ?? {};
  const noteUser = typeof notes?.user_id === 'string' && UUID.test(notes.user_id) ? notes.user_id : null;
  const subscriptionId =
    subscription?.id ?? payment?.subscription_id ?? refund?.subscription_id ?? null;

  let row: any = null;
  if (subscriptionId) {
    const { data } = await db
      .from('subscriptions')
      .select('*')
      .eq('provider_subscription_id', subscriptionId)
      .maybeSingle();
    row = data ?? null;
  }

  // Refunds are recorded in payment_events only. They do not change a plan;
  // refund handling stays a human decision under the refund policy.
  if (refund) return row?.user_id ?? noteUser;

  if (!subscription && !payment) return row?.user_id ?? null;
  if (!row) {
    console.warn('[razorpay-webhook] no subscription row for', subscriptionId ?? 'unknown');
    return null;
  }

  const userId = String(row.user_id);
  const status = storedStatus(mapStatus(event, subscription?.status ?? payment?.status));
  let plan =
    planFrom(subscription?.plan_id, notes?.plan, planIds()) ??
    (row.plan === 'max' ? 'max' : row.plan === 'pro' ? 'pro' : 'free');

  // A cycle-end downgrade arrives with the new plan id before the period ends.
  // Keep the paid plan until pending_plan_at, then let the next event apply it.
  if (pendingPlanHolds(row, plan)) {
    plan = row.plan === 'max' ? 'max' : row.plan === 'pro' ? 'pro' : plan;
  }

  const update: Record<string, unknown> = { status, plan };

  if (subscription?.plan_id) update.provider_plan_id = String(subscription.plan_id);

  const periodEnd = unixToIso(subscription?.current_end);
  if (periodEnd) update.current_period_end = periodEnd;

  if (subscription && typeof subscription.cancel_at_cycle_end !== 'undefined') {
    update.cancel_at_period_end = Boolean(Number(subscription.cancel_at_cycle_end));
  }
  if (status === 'cancelled' || status === 'completed') update.cancel_at_period_end = true;

  if (!row.started_at && subscription && (status === 'authenticated' || status === 'active')) {
    update.started_at =
      unixToIso(subscription.start_at) ?? unixToIso(subscription.created_at) ?? new Date().toISOString();
  }

  if (event === 'subscription.charged' && payment) {
    update.last_payment_at = unixToIso(payment.created_at) ?? new Date().toISOString();
    update.last_payment_amount = Number.isFinite(Number(payment.amount))
      ? Number(payment.amount)
      : null;
    update.last_payment_currency = payment.currency ? String(payment.currency) : 'INR';
  }

  // A halted, cancelled or completed plan falls back to Free only once the
  // period the customer paid for has ended.
  const end = (update.current_period_end as string | undefined) ?? row.current_period_end ?? null;
  const ended = end ? Date.parse(end) <= Date.now() : false;
  if (['halted', 'cancelled', 'completed'].includes(status) && (ended || !end)) {
    update.plan = 'free';
  }

  // A scheduled plan change clears once the new plan is the one in force.
  if (row.pending_plan) {
    if (update.plan === row.pending_plan) {
      update.pending_plan = null;
      update.pending_plan_at = null;
    } else if (event === 'payment.failed' && !row.pending_plan_at) {
      // The prorated upgrade charge failed, so the upgrade never applied. The
      // existing plan is untouched.
      update.pending_plan = null;
    }
  }

  const { error: updateError } = await db
    .from('subscriptions')
    .update(update)
    .eq('user_id', userId);

  if (updateError) throw new Error(`subscription update failed: ${updateError.code ?? 'error'}`);

  return userId;
}
