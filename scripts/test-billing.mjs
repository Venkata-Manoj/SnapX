/**
 * Billing logic tests. These run with plain Node: the shared webhook and token
 * helpers are deliberately free of Deno globals so the crypto and the plan
 * mapping can be checked without deploying.
 *
 *   npm run test:billing
 */

import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, verify as verifyEd25519 } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  DAY_SECONDS,
  effectivePlan,
  entitlementFor,
  graceApplies,
  GRACE_SECONDS,
  hmacSha256Hex,
  isReversalEvent,
  ledgerRow,
  mapStatus,
  PASS_SECONDS,
  paymentTrackingUpdate,
  pendingPlanHolds,
  pendingSubscriptionOutcome,
  planFrom,
  reversalPaymentId,
  sha256Hex,
  storedStatus,
  STORED_STATUSES,
  summariseEvent,
  timingSafeEqual,
  unixToIso,
} from '../supabase/functions/_shared/webhook.ts';
import { signEntitlement } from '../supabase/functions/_shared/token.ts';
import { checkoutGate, isMandateLocked } from '../supabase/functions/_shared/checkout.ts';

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

const decodeBase64Url = (value) => Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

await test('HMAC-SHA256 is hex and matches the Razorpay recipe', async () => {
  const body = '{"event":"subscription.charged","payload":{"subscription":{"entity":{"id":"sub_1"}}}}';
  const secret = 'whsec_test_only';
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const actual = await hmacSha256Hex(body, secret);

  assert.equal(actual, expected);
  assert.match(actual, /^[0-9a-f]{64}$/);
});

await test('signature comparison is constant time and rejects a tamper', () => {
  const signature = 'a'.repeat(64);
  assert.equal(timingSafeEqual(signature, signature), true);
  assert.equal(timingSafeEqual(signature, `${'a'.repeat(63)}b`), false);
  assert.equal(timingSafeEqual(signature, 'a'.repeat(63)), false);
  assert.equal(timingSafeEqual(signature, ''), false);
});

await test('sha256 fallback event id is stable', async () => {
  const first = await sha256Hex('{"event":"x"}');
  const second = await sha256Hex('{"event":"x"}');
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

await test('subscription status mapping covers every event in the brief', () => {
  assert.equal(mapStatus('subscription.authenticated'), 'authenticated');
  assert.equal(mapStatus('subscription.activated'), 'active');
  assert.equal(mapStatus('subscription.charged'), 'active');
  assert.equal(mapStatus('subscription.pending'), 'past_due');
  assert.equal(mapStatus('subscription.halted'), 'halted');
  assert.equal(mapStatus('subscription.cancelled'), 'cancelled');
  assert.equal(mapStatus('subscription.completed'), 'completed');
  assert.equal(mapStatus('subscription.paused'), 'paused');
  assert.equal(mapStatus('subscription.resumed'), 'active');
  assert.equal(mapStatus('payment.failed'), 'past_due');
  assert.equal(mapStatus('subscription.updated', 'active'), 'active');
  assert.equal(mapStatus('subscription.updated', 'cancelled'), 'cancelled');
});

await test('plan comes from the plan id before the original note', () => {
  const ids = { pro: 'plan_pro', max: 'plan_max' };
  assert.equal(planFrom('plan_max', 'pro', ids), 'max');
  assert.equal(planFrom('plan_pro', 'max', ids), 'pro');
  assert.equal(planFrom('plan_other', 'max', ids), 'max');
  assert.equal(planFrom('plan_other', 'free', ids), null);
  assert.equal(planFrom(null, 'pro', { pro: '', max: '' }), 'pro');
});

await test('entitlement is Free when expired, failed or not active', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();

  assert.equal(effectivePlan({ plan: 'pro', status: 'active', current_period_end: future }), 'pro');
  assert.equal(effectivePlan({ plan: 'max', status: 'authenticated', current_period_end: future }), 'max');
  assert.equal(effectivePlan({ plan: 'pro', status: 'active', current_period_end: past }), 'free');
  assert.equal(effectivePlan({ plan: 'pro', status: 'cancelled', current_period_end: future }), 'pro');
  assert.equal(effectivePlan({ plan: 'max', status: 'completed', current_period_end: future }), 'max');
  assert.equal(effectivePlan({ plan: 'pro', status: 'cancelled', current_period_end: past }), 'free');
  assert.equal(effectivePlan({ plan: 'pro', status: 'cancelled', current_period_end: null }), 'free');
  assert.equal(effectivePlan({ plan: 'pro', status: 'past_due', current_period_end: future }), 'free');
  assert.equal(effectivePlan({ plan: 'pro', status: 'halted', current_period_end: future }), 'free');
  assert.equal(effectivePlan({ plan: 'pro', status: 'paused', current_period_end: future }), 'free');
  assert.equal(effectivePlan({ plan: 'free', status: 'active', current_period_end: future }), 'free');
  assert.equal(effectivePlan(null), 'free');
});

const NOW = 1_800_000_000;
const AT = (seconds) => new Date(seconds * 1000).toISOString();
const RENEWING = {
  plan: 'pro',
  status: 'active',
  current_period_end: AT(NOW + 10 * DAY_SECONDS),
  cancel_at_period_end: false,
  pending_plan: null,
  pending_plan_at: null,
  provider_subscription_id: 'sub_1',
  pending_subscription_id: null,
  last_payment_id: 'pay_1',
  last_payment_reversed_at: null,
};

await test('grace needs an active, auto-renewing paid plan with a clean payment', () => {
  assert.equal(graceApplies(RENEWING, NOW * 1000), true);
  assert.equal(graceApplies({ ...RENEWING, plan: 'max' }, NOW * 1000), true);
  assert.equal(graceApplies({ ...RENEWING, status: 'authenticated' }, NOW * 1000), true);

  assert.equal(graceApplies({ ...RENEWING, cancel_at_period_end: true }, NOW * 1000), false);
  assert.equal(graceApplies({ ...RENEWING, pending_plan: 'max' }, NOW * 1000), false);
  assert.equal(graceApplies({ ...RENEWING, pending_subscription_id: 'sub_2' }, NOW * 1000), false);
  assert.equal(graceApplies({ ...RENEWING, provider_subscription_id: null }, NOW * 1000), false);
  assert.equal(graceApplies({ ...RENEWING, last_payment_id: null }, NOW * 1000), false);
  assert.equal(graceApplies({ ...RENEWING, last_payment_reversed_at: AT(NOW) }, NOW * 1000), false);
  // The grace window stays open for three days after the period ends.
  assert.equal(graceApplies({ ...RENEWING, current_period_end: AT(NOW - 1) }, NOW * 1000), true);
  assert.equal(
    graceApplies({ ...RENEWING, current_period_end: AT(NOW - GRACE_SECONDS - 1) }, NOW * 1000),
    false,
  );

  for (const status of ['cancelled', 'completed', 'halted', 'paused', 'past_due', 'created']) {
    assert.equal(graceApplies({ ...RENEWING, status }, NOW * 1000), false, status);
  }
  assert.equal(graceApplies({ ...RENEWING, plan: 'free' }, NOW * 1000), false);
  assert.equal(graceApplies(null, NOW * 1000), false);
});

await test('entitlement adds the grace only to safe renewals', () => {
  const end = NOW + 10 * DAY_SECONDS;

  const pro = entitlementFor(RENEWING, NOW);
  assert.deepEqual(pro, { plan: 'pro', exp: end + GRACE_SECONDS, grace: true });
  assert.equal(pro.exp - NOW, 13 * DAY_SECONDS);

  const max = entitlementFor({ ...RENEWING, plan: 'max' }, NOW);
  assert.deepEqual(max, { plan: 'max', exp: end + GRACE_SECONDS, grace: true });

  const cancelling = entitlementFor({ ...RENEWING, cancel_at_period_end: true }, NOW);
  assert.deepEqual(cancelling, { plan: 'pro', exp: end, grace: false });

  const cancelled = entitlementFor({ ...RENEWING, status: 'cancelled' }, NOW);
  assert.deepEqual(cancelled, { plan: 'pro', exp: end, grace: false });

  const ended = entitlementFor({ ...RENEWING, status: 'cancelled', current_period_end: AT(NOW - 1) }, NOW);
  assert.deepEqual(ended, { plan: 'free', exp: NOW + PASS_SECONDS, grace: false });

  // Renewal day before the webhook lands: the old period has just ended, the
  // subscription is still active and auto-renewing, so the grace covers it.
  const renewalDay = entitlementFor(
    { ...RENEWING, current_period_end: AT(NOW - DAY_SECONDS) },
    NOW,
  );
  assert.deepEqual(renewalDay, { plan: 'pro', exp: NOW + 2 * DAY_SECONDS, grace: true });

  // Past the three-day window the row is Free again.
  const stale = entitlementFor(
    { ...RENEWING, current_period_end: AT(NOW - GRACE_SECONDS - 1) },
    NOW,
  );
  assert.deepEqual(stale, { plan: 'free', exp: NOW + PASS_SECONDS, grace: false });

  for (const status of ['halted', 'paused', 'past_due']) {
    assert.deepEqual(
      entitlementFor({ ...RENEWING, status }, NOW),
      { plan: 'free', exp: NOW + PASS_SECONDS, grace: false },
      status,
    );
  }

  const refunded = entitlementFor({ ...RENEWING, last_payment_reversed_at: AT(NOW) }, NOW);
  assert.deepEqual(refunded, { plan: 'pro', exp: end, grace: false });

  const pendingUpi = entitlementFor(
    { ...RENEWING, pending_plan: 'max', pending_subscription_id: 'sub_2' },
    NOW,
  );
  assert.deepEqual(pendingUpi, { plan: 'pro', exp: end, grace: false });

  const switched = entitlementFor(
    {
      ...RENEWING,
      plan: 'max',
      current_period_end: AT(NOW + 30 * DAY_SECONDS),
      provider_subscription_id: 'sub_2',
      last_payment_id: 'pay_2',
    },
    NOW,
  );
  assert.deepEqual(switched, {
    plan: 'max',
    exp: NOW + 33 * DAY_SECONDS,
    grace: true,
  });
});

await test('the pass cap wins over a long grace, and a short period stays safe', () => {
  const long = entitlementFor(
    { ...RENEWING, current_period_end: AT(NOW + 60 * DAY_SECONDS) },
    NOW,
  );
  assert.deepEqual(long, { plan: 'pro', exp: NOW + PASS_SECONDS, grace: true });
  assert.equal(long.exp - NOW, 35 * DAY_SECONDS);

  const short = entitlementFor(
    { ...RENEWING, current_period_end: AT(NOW + 3600) },
    NOW,
  );
  assert.equal(short.plan, 'pro');
  assert.equal(short.exp, NOW + 3600 + GRACE_SECONDS);
  assert.equal(short.grace, true);
  assert.ok(short.exp > NOW, 'exp is after iat');
  assert.ok(short.exp - NOW <= 40 * DAY_SECONDS, 'exp - iat is at most 40 days');

  // A paid plan with no usable period end is Free, matching the old gate.
  assert.deepEqual(entitlementFor({ ...RENEWING, current_period_end: null }, NOW), {
    plan: 'free',
    exp: NOW + PASS_SECONDS,
    grace: false,
  });
});

await test('refunds and chargebacks are recognised, other refund events are not', () => {
  assert.equal(isReversalEvent('refund.created'), true);
  assert.equal(isReversalEvent('refund.processed'), true);
  assert.equal(isReversalEvent('payment.dispute.created'), true);
  assert.equal(isReversalEvent('payment.dispute.won'), true);
  assert.equal(isReversalEvent('payment.dispute.lost'), true);
  assert.equal(isReversalEvent('refund.failed'), false);
  assert.equal(isReversalEvent('refund.speed_changed'), false);
  assert.equal(isReversalEvent('subscription.charged'), false);

  assert.equal(
    reversalPaymentId({ payload: { refund: { entity: { id: 'rfnd_1', payment_id: 'pay_1' } } } }),
    'pay_1',
  );
  assert.equal(
    reversalPaymentId({ payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_2' } } } }),
    'pay_2',
  );
  assert.equal(reversalPaymentId({ payload: {} }), null);
});

await test('a successful charge records the payment and clears an old reversal', () => {
  const payment = { id: 'pay_9' };
  assert.deepEqual(paymentTrackingUpdate('subscription.charged', payment), {
    last_payment_id: 'pay_9',
    last_payment_reversed_at: null,
  });
  assert.deepEqual(paymentTrackingUpdate('subscription.activated', payment), {
    last_payment_id: 'pay_9',
    last_payment_reversed_at: null,
  });
  assert.deepEqual(paymentTrackingUpdate('subscription.authenticated', payment), {
    last_payment_id: 'pay_9',
    last_payment_reversed_at: null,
  });
  assert.equal(paymentTrackingUpdate('subscription.charged', null), null);
  assert.equal(paymentTrackingUpdate('subscription.charged', { id: '' }), null);
  assert.equal(paymentTrackingUpdate('subscription.updated', payment), null);
  assert.equal(paymentTrackingUpdate('payment.failed', payment), null);
});

await test('a Free signup row does not block the first checkout', () => {
  // The signup trigger writes plan=free, status=active. That is not a plan.
  assert.deepEqual(checkoutGate({ plan: 'free', status: 'active' }, 'plan_pro'), {
    action: 'create',
  });
  assert.deepEqual(checkoutGate(null, 'plan_pro'), { action: 'create' });
});

await test('an active paid plan blocks a second subscription', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  assert.deepEqual(
    checkoutGate(
      {
        plan: 'pro',
        status: 'active',
        current_period_end: future,
        provider_subscription_id: 'sub_1',
      },
      'plan_pro',
    ),
    { action: 'block' },
  );
  assert.deepEqual(
    checkoutGate(
      { plan: 'max', status: 'authenticated', provider_subscription_id: 'sub_2' },
      'plan_max',
    ),
    { action: 'block' },
  );
});

await test('an unfinished checkout is reused for the same plan', () => {
  const row = {
    plan: 'free',
    status: 'created',
    provider_subscription_id: 'sub_3',
    provider_plan_id: 'plan_pro',
  };

  assert.deepEqual(checkoutGate(row, 'plan_pro'), { action: 'reuse', subscriptionId: 'sub_3' });
  assert.deepEqual(checkoutGate(row, 'plan_max'), { action: 'create' });
});

await test('an ended paid plan allows a new checkout', () => {
  const past = new Date(Date.now() - 86400000).toISOString();
  assert.deepEqual(
    checkoutGate(
      {
        plan: 'pro',
        status: 'cancelled',
        current_period_end: past,
        provider_subscription_id: 'sub_4',
      },
      'plan_pro',
    ),
    { action: 'create' },
  );
});

await test('a scheduled downgrade holds the paid plan until the period ends', () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  const scheduled = { plan: 'max', status: 'active', pending_plan: 'pro', pending_plan_at: future };

  assert.equal(pendingPlanHolds(scheduled, 'pro'), true);
  assert.equal(pendingPlanHolds(scheduled, 'max'), false);
  assert.equal(pendingPlanHolds({ ...scheduled, pending_plan_at: past }, 'pro'), false);
  assert.equal(
    pendingPlanHolds({ plan: 'pro', pending_plan: 'max', pending_plan_at: null }, 'max'),
    false,
  );
  assert.equal(pendingPlanHolds(null, 'pro'), false);
});

await test('a future UPI subscription switches in only when it activates', () => {
  assert.equal(pendingSubscriptionOutcome('subscription.authenticated', 'authenticated'), 'authenticated');
  assert.equal(pendingSubscriptionOutcome('subscription.activated', 'active'), 'switch');
  assert.equal(pendingSubscriptionOutcome('subscription.charged', 'active'), 'switch');
  assert.equal(pendingSubscriptionOutcome('subscription.pending', 'pending'), 'ignore');
  assert.equal(pendingSubscriptionOutcome('payment.failed', 'failed'), 'clear');
  assert.equal(pendingSubscriptionOutcome('subscription.cancelled', 'cancelled'), 'clear');
  assert.equal(pendingSubscriptionOutcome('subscription.expired', 'expired'), 'clear');
  assert.equal(pendingSubscriptionOutcome('subscription.halted', 'halted'), 'clear');
  assert.equal(pendingSubscriptionOutcome('subscription.updated', 'active'), 'switch');
  assert.equal(pendingSubscriptionOutcome('subscription.updated', 'authenticated'), 'authenticated');
  assert.equal(pendingSubscriptionOutcome('subscription.updated', 'cancelled'), 'clear');
  assert.equal(pendingSubscriptionOutcome('subscription.updated', 'pending'), 'ignore');
});

await test('only the exact mandate-locked refusals take the UPI fallback', () => {
  assert.equal(
    isMandateLocked('subscriptions cannot be updated when payment mode is UPI'),
    true,
  );
  assert.equal(isMandateLocked('Subscription cannot be updated when payment mode is Emandate'), true);
  assert.equal(isMandateLocked('subscription not found'), false);
  assert.equal(isMandateLocked('Internal server error'), false);
  assert.equal(isMandateLocked(''), false);
});

await test('unix timestamps convert, and junk becomes null', () => {
  assert.equal(unixToIso(1700000000), new Date(1700000000 * 1000).toISOString());
  assert.equal(unixToIso(0), null);
  assert.equal(unixToIso('nope'), null);
  assert.equal(unixToIso(undefined), null);
});

await test('payment ledger summary contains billing fields and no customer PII', () => {
  const summary = summariseEvent({
    event: 'subscription.charged',
    payload: {
      subscription: {
        entity: {
          id: 'sub_123',
          plan_id: 'plan_pro',
          status: 'active',
          current_end: 1700000000,
          notes: { user_id: 'uuid', plan: 'pro' },
        },
      },
      payment: {
        entity: {
          id: 'pay_123',
          amount: 6900,
          currency: 'INR',
          status: 'captured',
          created_at: 1699999999,
          email: 'person@example.com',
          contact: '+910000000000',
          card: { last4: '1111' },
        },
      },
    },
  });

  assert.equal(summary.subscription_id, 'sub_123');
  assert.equal(summary.payment_id, 'pay_123');
  assert.equal(summary.amount, 6900);
  assert.equal(summary.currency, 'INR');
  assert.equal(summary.plan_id, 'plan_pro');

  const text = JSON.stringify(summary);
  assert.equal(text.includes('person@example.com'), false);
  assert.equal(text.includes('910000000000'), false);
  assert.equal(text.includes('1111'), false);
  assert.equal(text.includes('uuid'), false);
});

await test('a dispute summary records the ids without customer PII', () => {
  const summary = summariseEvent({
    event: 'payment.dispute.created',
    payload: {
      payment: {
        entity: {
          id: 'pay_77',
          subscription_id: 'sub_77',
          amount: 6900,
          currency: 'INR',
          email: 'person@example.com',
        },
      },
      dispute: {
        entity: {
          id: 'disp_77',
          payment_id: 'pay_77',
          amount: 6900,
          currency: 'INR',
          status: 'open',
          created_at: 1700000000,
        },
      },
    },
  });

  assert.equal(summary.event, 'payment.dispute.created');
  assert.equal(summary.dispute_id, 'disp_77');
  assert.equal(summary.payment_id, 'pay_77');
  assert.equal(summary.subscription_id, 'sub_77');
  assert.equal(summary.amount, 6900);
  assert.equal(summary.currency, 'INR');
  assert.equal(JSON.stringify(summary).includes('person@example.com'), false);
});

await test('the ledger insert fills every not-null column', () => {
  // The deployed table has provider and event_type as not-null columns; an
  // insert that omits them fails and Razorpay gets a 500 on every event.
  const row = ledgerRow('evt_1', 'subscription.activated', { subscription_id: 'sub_1' });

  assert.equal(row.id, 'evt_1');
  assert.equal(row.event, 'subscription.activated');
  assert.equal(row.event_type, 'subscription.activated');
  assert.equal(row.provider, 'razorpay');
  assert.equal(row.provider_subscription_id, 'sub_1');
  assert.deepEqual(row.payload, { subscription_id: 'sub_1' });

  assert.equal(ledgerRow('evt_2', 'payment.failed', {}).provider_subscription_id, null);
});

await test('Ed25519 plan pass verifies with the public key', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ type: 'pkcs8', format: 'der' });
  const seed = Buffer.from(der).subarray(-32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    aud: 'snapx-ext',
    sub: '11111111-1111-4111-8111-111111111111',
    plan: 'pro',
    iid: 'a'.repeat(32),
    iat: now,
    exp: now + 33 * 86400,
  };

  const token = await signEntitlement(payload, seed);
  const parts = token.split('.');
  assert.equal(parts.length, 2);

  const decoded = JSON.parse(decodeBase64Url(parts[0]).toString('utf8'));
  assert.deepEqual(decoded, payload);

  const signature = decodeBase64Url(parts[1]);
  assert.equal(signature.length, 64);
  assert.equal(verifyEd25519(null, Buffer.from(parts[0], 'utf8'), publicKey, signature), true);
  assert.equal(
    verifyEd25519(null, Buffer.from(`${parts[0]}x`, 'utf8'), publicKey, signature),
    false,
  );
});

await test('Ed25519 accepts the 64-hex pass-private.hex seed', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const der = privateKey.export({ type: 'pkcs8', format: 'der' });
  const seed = Buffer.from(der).subarray(-32).toString('hex');

  const token = await signEntitlement(
    { v: 1, aud: 'snapx-ext', sub: 'x', plan: 'free', iid: 'b'.repeat(32), iat: 1, exp: 2 },
    seed.toUpperCase(),
  );
  const [body, signature] = token.split('.');
  assert.equal(token.split('.').length, 2);
  assert.equal(verifyEd25519(null, Buffer.from(body), publicKey, decodeBase64Url(signature)), true);
});

await test('Ed25519 rejects PEM, PKCS8 and base64 secrets', async () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const der = privateKey.export({ type: 'pkcs8', format: 'der' });
  const seed = Buffer.from(der).subarray(-32).toString('hex');

  const payload = {
    v: 1,
    aud: 'snapx-ext',
    sub: 'x',
    plan: 'free',
    iid: 'c'.repeat(32),
    iat: 1,
    exp: 2,
  };

  for (const [label, value] of [
    ['PEM', pem],
    ['escaped PEM', pem.replace(/\n/g, '\\n')],
    ['base64 PKCS8', Buffer.from(der).toString('base64')],
    ['short hex', seed.slice(0, 62)],
    ['long hex', `${seed}00`],
    ['non-hex seed', 'z'.repeat(64)],
  ]) {
    await assert.rejects(
      () => signEntitlement(payload, value),
      /64-character hex Ed25519 seed/,
      `${label} must be rejected`,
    );
  }
});

await test('the schema keeps the payment ledger private and nullable', () => {
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.payment_events/);
  assert.match(sql, /id text primary key/);
  assert.match(sql, /user_id uuid references auth\.users \(id\) on delete set null/);
  assert.match(sql, /alter table public\.payment_events enable row level security/);
  assert.match(sql, /revoke all on public\.payment_events from anon/);
  assert.match(sql, /revoke all on public\.payment_events from authenticated/);
  assert.match(sql, /add column if not exists last_payment_id text/);
  assert.match(sql, /add column if not exists last_payment_reversed_at timestamptz/);
  assert.match(sql, /subscriptions_last_payment_id_idx/);
});

await test('provider statuses the table rejects are folded before writing', () => {
  // The deployed check constraint accepts six states only. Writing
  // 'authenticated' failed on a real payment and the event was lost.
  assert.equal(storedStatus('authenticated'), 'active');
  assert.equal(storedStatus('paused'), 'halted');
  assert.equal(storedStatus('pending'), 'past_due');
  assert.equal(storedStatus('expired'), 'cancelled');
  assert.equal(storedStatus('active'), 'active');
  assert.equal(storedStatus('created'), 'created');

  for (const status of ['created', 'active', 'past_due', 'halted', 'cancelled', 'completed']) {
    assert.equal(storedStatus(status), status);
  }

  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  const constraint = sql.match(/subscriptions_status_check\s+check \(status in \(([^)]+)\)\)/);
  assert.ok(constraint, 'schema declares the status constraint');
  const allowed = constraint[1].split(',').map((value) => value.trim().replace(/'/g, ''));
  assert.deepEqual(allowed.sort(), [...STORED_STATUSES].sort());
});

console.log(`\n${passed} billing tests passed.`);
