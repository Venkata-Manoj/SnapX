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
  effectivePlan,
  hmacSha256Hex,
  ledgerRow,
  mapStatus,
  pendingPlanHolds,
  planFrom,
  sha256Hex,
  storedStatus,
  STORED_STATUSES,
  summariseEvent,
  timingSafeEqual,
  unixToIso,
} from '../supabase/functions/_shared/webhook.ts';
import { signEntitlement } from '../supabase/functions/_shared/token.ts';
import { checkoutGate } from '../supabase/functions/_shared/checkout.ts';

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
  assert.equal(effectivePlan({ plan: 'pro', status: 'past_due', current_period_end: future }), 'free');
  assert.equal(effectivePlan({ plan: 'pro', status: 'halted', current_period_end: future }), 'free');
  assert.equal(effectivePlan({ plan: 'pro', status: 'paused', current_period_end: future }), 'free');
  assert.equal(effectivePlan({ plan: 'free', status: 'active', current_period_end: future }), 'free');
  assert.equal(effectivePlan(null), 'free');
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
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
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

  const token = await signEntitlement(payload, pem);
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
    seed,
  );
  const [body, signature] = token.split('.');
  assert.equal(token.split('.').length, 2);
  assert.equal(verifyEd25519(null, Buffer.from(body), publicKey, decodeBase64Url(signature)), true);
});

await test('Ed25519 accepts a secret with literal \\n escapes', async () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const escaped = pem.replace(/\n/g, '\\n');
  const token = await signEntitlement(
    { v: 1, aud: 'snapx-ext', sub: 'x', plan: 'free', iid: 'c'.repeat(32), iat: 1, exp: 2 },
    escaped,
  );
  assert.equal(token.split('.').length, 2);
});

await test('the schema keeps the payment ledger private and nullable', () => {
  const sql = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /create table if not exists public\.payment_events/);
  assert.match(sql, /id text primary key/);
  assert.match(sql, /user_id uuid references auth\.users \(id\) on delete set null/);
  assert.match(sql, /alter table public\.payment_events enable row level security/);
  assert.match(sql, /revoke all on public\.payment_events from anon/);
  assert.match(sql, /revoke all on public\.payment_events from authenticated/);
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
