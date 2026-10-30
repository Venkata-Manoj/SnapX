/**
 * Proves the plan-pass chain end to end:
 *
 *   1. ENTITLEMENT_PRIVATE_KEY parses, and its public key is the one baked into
 *      the extension (keys/pass-public.hex in the SnapX build).
 *   2. Supabase holds exactly the local secret (compared through the sha256
 *      that `secrets list` prints, so no secret is ever output).
 *   3. The deployed function returns 401 without a JWT, 400 for a bad iid, and
 *      a two-part Ed25519 pass for a valid one.
 *   4. The pass verifies with the extension's public key and obeys every rule
 *      the extension enforces: v, aud, iid, iat, exp, 40-day lifetime.
 *   5. The expiry rule: Free is now + 35 days; paid and active is
 *      min(current_period_end, now + 35 days), never past the paid period.
 *
 *   npm run check:entitlement
 *
 * The throwaway user is deleted afterwards. Secrets are never printed.
 */

import { createHash, createPrivateKey, createPublicKey, randomBytes, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENV_FILE = new URL('../supabase/.env.secrets', import.meta.url);
const SITE_ENV = new URL('../.env', import.meta.url);
const CLI = join('node_modules', '.bin', process.platform === 'win32' ? 'supabase.cmd' : 'supabase');

/** keys/pass-public.hex in the SnapX 1.5.0 build. Public by definition. */
const EXTENSION_PUBLIC_KEY =
  'd8451c06b55376d9bd82a3bc1dec21f899be0533102e7972ea50b25922c5126a';

const PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const DAY = 86400;

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

function readEnv(url) {
  const raw = readFileSync(url, 'utf8');
  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [
          line.slice(0, index).trim(),
          line.slice(index + 1).trim().replace(/^"|"$/g, ''),
        ];
      }),
  );
}

function privateKeyFrom(value) {
  const seed = String(value ?? '').trim();
  if (!/^[0-9a-f]{64}$/i.test(seed)) {
    throw new Error('ENTITLEMENT_PRIVATE_KEY must be a 64-character hex Ed25519 seed');
  }
  return createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, Buffer.from(seed, 'hex')]),
    format: 'der',
    type: 'pkcs8',
  });
}

const b64u = (value) =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4), 'base64');

const secrets = readEnv(ENV_FILE);
const privateValue = secrets.ENTITLEMENT_PRIVATE_KEY ?? '';
check('ENTITLEMENT_PRIVATE_KEY is set', Boolean(privateValue));

if (!privateValue) {
  console.log('\nNothing else can be checked without the key.');
  process.exit(1);
}

let derivedHex = '';
try {
  const key = privateKeyFrom(privateValue);
  derivedHex = Buffer.from(createPublicKey(key).export({ type: 'spki', format: 'der' }))
    .subarray(-32)
    .toString('hex');
  check('the private key parses', true);
} catch (error) {
  check('the private key parses', false, error.message);
  process.exit(1);
}

check(
  'the configured key is the extension key',
  derivedHex === EXTENSION_PUBLIC_KEY,
  derivedHex === EXTENSION_PUBLIC_KEY ? '' : `site ${derivedHex.slice(0, 16)}… vs extension ${EXTENSION_PUBLIC_KEY.slice(0, 16)}…`,
);

// Supabase must hold the same value the file holds.
let remote = new Map();
try {
  const raw = execFileSync(CLI, ['secrets', 'list'], {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  remote = new Map((parsed.secrets ?? []).map((secret) => [secret.name, secret.value]));
} catch {
  check('Supabase secrets can be read', false, 'run `supabase login` first');
}

if (remote.size) {
  check(
    'Supabase holds the same ENTITLEMENT_PRIVATE_KEY',
    remote.get('ENTITLEMENT_PRIVATE_KEY') ===
      createHash('sha256').update(privateValue).digest('hex'),
  );
}

// Live function checks. The service key comes from the CLI and is never printed.
const site = readEnv(SITE_ENV);
const BASE = site.VITE_SUPABASE_URL ?? '';
const ANON = site.VITE_SUPABASE_PUBLISHABLE_KEY ?? '';
check('VITE_SUPABASE_URL is set', Boolean(BASE));
check('VITE_SUPABASE_PUBLISHABLE_KEY is set', Boolean(ANON));

if (!BASE || !ANON) {
  console.log('\nThe live checks need the site .env values.');
  process.exit(1);
}

const projectRef = new URL(BASE).hostname.split('.')[0];
let serviceKey = '';
try {
  const raw = execFileSync(CLI, ['projects', 'api-keys', '--project-ref', projectRef], {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const parsed = JSON.parse(raw.slice(raw.indexOf('{')));
  serviceKey = (parsed.keys ?? []).find((key) => key.id === 'service_role')?.api_key ?? '';
} catch {
  serviceKey = '';
}
check('the service role key is available', Boolean(serviceKey));

if (!serviceKey) {
  console.log('\nThe live checks need `supabase projects api-keys`.');
  process.exit(1);
}

const serviceHeaders = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  'content-type': 'application/json',
};

const email = `entcheck+${Date.now()}@example.com`;
const password = `EntCheck!${randomBytes(9).toString('base64url')}`;
let userId = '';

const iso = (seconds) => new Date(seconds * 1000).toISOString();

async function createUser() {
  const response = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (!response.ok) throw new Error(`create user: HTTP ${response.status}`);
  return await response.json();
}

async function signIn() {
  const response = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) throw new Error(`sign in: HTTP ${response.status}`);
  return await response.json();
}

async function callEntitlement(iid, accessToken) {
  const headers = { apikey: ANON, 'content-type': 'application/json' };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${BASE}/functions/v1/entitlement`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ iid }),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

async function patchRow(fields) {
  const response = await fetch(`${BASE}/rest/v1/subscriptions?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: { ...serviceHeaders, prefer: 'return=representation' },
    body: JSON.stringify(fields),
  });
  if (!response.ok) throw new Error(`patch subscription: HTTP ${response.status}`);
  return await response.json();
}

function readPass(label, result) {
  const data = result.body ?? {};
  const token = typeof data.token === 'string' ? data.token : '';
  const parts = token.split('.');
  const now = Math.floor(Date.now() / 1000);

  check(`${label}: HTTP 200`, result.status === 200, `HTTP ${result.status}`);
  check(`${label}: token has two parts`, parts.length === 2);
  if (parts.length !== 2) return data;

  const signature = b64u(parts[1]);
  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(EXTENSION_PUBLIC_KEY, 'hex')]),
    format: 'der',
    type: 'spki',
  });

  check(
    `${label}: signature verifies with the extension key`,
    signature.length === 64 && verify(null, Buffer.from(parts[0]), publicKey, signature),
  );
  check(`${label}: token is under 2048 characters`, token.length <= 2048);

  let payload = null;
  try {
    payload = JSON.parse(b64u(parts[0]).toString('utf8'));
  } catch {
    payload = null;
  }

  check(`${label}: payload is JSON`, Boolean(payload));
  if (!payload) return data;

  check(`${label}: v is 1`, payload.v === 1);
  check(`${label}: aud is snapx-ext`, payload.aud === 'snapx-ext');
  check(`${label}: sub is the signed-in user`, payload.sub === userId);
  check(`${label}: iid echoes the request`, payload.iid === 'a'.repeat(32));
  check(`${label}: iat is not in the future`, payload.iat <= now + 600);
  check(`${label}: exp is in the future`, payload.exp > now);
  check(`${label}: lifetime is at most 40 days`, payload.exp - payload.iat <= 40 * DAY);

  return { ...data, payload };
}

try {
  const user = await createUser();
  userId = user.id;
  const session = await signIn();

  const anonymous = await callEntitlement('a'.repeat(32));
  check('no JWT returns 401', anonymous.status === 401, `HTTP ${anonymous.status}`);

  const badIid = await callEntitlement('not-hex', session.access_token);
  check('a bad iid returns 400', badIid.status === 400, `HTTP ${badIid.status}`);

  const now = Math.floor(Date.now() / 1000);

  const free = readPass('free', await callEntitlement('a'.repeat(32), session.access_token));
  check('free: plan is free', free.plan === 'free', String(free.plan));
  check(
    'free: exp is now + 35 days',
    Boolean(free.payload) && Math.abs(free.payload.exp - (now + 35 * DAY)) <= 15,
  );

  const proEnd = now + 10 * DAY;
  await patchRow({ plan: 'pro', status: 'active', current_period_end: iso(proEnd) });
  const pro = readPass('pro', await callEntitlement('a'.repeat(32), session.access_token));
  check('pro: plan is pro', pro.plan === 'pro', String(pro.plan));
  check(
    'pro: exp is the period end',
    Boolean(pro.payload) && Math.abs(pro.payload.exp - proEnd) <= 15,
  );
  check(
    'pro: exp never passes the paid period end',
    Boolean(pro.payload) && pro.payload.exp <= proEnd,
  );

  const farEnd = now + 60 * DAY;
  await patchRow({ plan: 'pro', status: 'active', current_period_end: iso(farEnd) });
  const capped = readPass('long period', await callEntitlement('a'.repeat(32), session.access_token));
  check(
    'long period: exp is capped at now + 35 days',
    Boolean(capped.payload) && Math.abs(capped.payload.exp - (now + 35 * DAY)) <= 15,
  );

  // The webhook folds Razorpay's `authenticated` into `active` before writing,
  // so `active` is the only paid status the deployed constraint can hold.
  await patchRow({ plan: 'max', status: 'active', current_period_end: iso(proEnd) });
  const max = readPass('max', await callEntitlement('a'.repeat(32), session.access_token));
  check('max: plan is max', max.plan === 'max', String(max.plan));

  await patchRow({ plan: 'pro', status: 'cancelled', current_period_end: iso(farEnd) });
  const cancelled = readPass(
    'cancelled',
    await callEntitlement('a'.repeat(32), session.access_token),
  );
  check('cancelled: plan stays until the paid period ends', cancelled.plan === 'pro', String(cancelled.plan));
  check(
    'cancelled: exp never passes the paid period end',
    Boolean(cancelled.payload) && cancelled.payload.exp <= farEnd,
  );

  await patchRow({ plan: 'pro', status: 'cancelled', current_period_end: iso(now - DAY) });
  const cancelledEnded = readPass(
    'cancelled, period over',
    await callEntitlement('a'.repeat(32), session.access_token),
  );
  check('cancelled after the period: plan is free', cancelledEnded.plan === 'free', String(cancelledEnded.plan));

  await patchRow({ plan: 'pro', status: 'past_due', current_period_end: iso(farEnd) });
  const pastDue = readPass('past_due', await callEntitlement('a'.repeat(32), session.access_token));
  check('past_due: plan is free', pastDue.plan === 'free', String(pastDue.plan));
} catch (error) {
  check('live checks completed', false, error.message);
} finally {
  if (userId) {
    await fetch(`${BASE}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: serviceHeaders,
    }).catch(() => {});
  }
}

if (derivedHex !== EXTENSION_PUBLIC_KEY) {
  console.log(
    '\nThe extension will reject every pass until ENTITLEMENT_PRIVATE_KEY is the key\n' +
      'that matches keys/pass-public.hex in the SnapX build. See docs/PAYMENTS.md §5.',
  );
}

if (failed) {
  console.log(`\n${failed} check(s) failed.`);
  process.exit(1);
}

console.log('\nAll checks passed.');
