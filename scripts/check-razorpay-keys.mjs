/**
 * Proves the Razorpay key pair is consistent in the three places it lives:
 * the local env file, the Razorpay account, and the deployed Edge Functions.
 *
 *   npm run check:razorpay
 *
 * Secrets are never printed. Set OLD_RAZORPAY_KEY_ID and OLD_RAZORPAY_KEY_SECRET
 * to also prove a retired pair is dead.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ENV_FILE = new URL('../supabase/.env.secrets', import.meta.url);
const CLI = join('node_modules', '.bin', process.platform === 'win32' ? 'supabase.cmd' : 'supabase');
const API = 'https://api.razorpay.com/v1';

let failed = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const auth = (id, secret) => 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64');

function readEnv() {
  let raw = '';
  try {
    raw = readFileSync(ENV_FILE, 'utf8');
  } catch {
    console.log('FAIL supabase/.env.secrets is missing');
    process.exit(1);
  }

  return Object.fromEntries(
    raw
      .split(/\r?\n/)
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^"|"$/g, '')];
      }),
  );
}

const env = readEnv();
const keyId = env.RAZORPAY_KEY_ID ?? '';
const keySecret = env.RAZORPAY_KEY_SECRET ?? '';

check('RAZORPAY_KEY_ID is set', Boolean(keyId));
check('RAZORPAY_KEY_SECRET is set', Boolean(keySecret));
if (!keyId || !keySecret) process.exit(1);

// 1. Razorpay accepts the pair, and both monthly plans are still reachable.
const plans = await fetch(`${API}/plans?count=100`, {
  headers: { authorization: auth(keyId, keySecret) },
});
check('Razorpay accepts the key pair', plans.status === 200, `HTTP ${plans.status}`);

if (plans.status === 200) {
  const { items = [] } = await plans.json();
  const ids = new Set(items.map((plan) => plan.id));
  const missing = [
    ['RAZORPAY_PLAN_PRO', env.RAZORPAY_PLAN_PRO],
    ['RAZORPAY_PLAN_MAX', env.RAZORPAY_PLAN_MAX],
  ].filter(([, id]) => id && !ids.has(id));
  check('both plan ids belong to this account', missing.length === 0, missing.map(([name]) => name).join(', '));
}

// 2. Supabase holds exactly these values. `secrets list` prints sha256(value),
//    so the comparison needs no secret to leave this process.
let stored = [];
try {
  const raw = execFileSync(CLI, ['secrets', 'list'], {
    encoding: 'utf8',
    shell: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  stored = JSON.parse(raw.slice(raw.indexOf('{'))).secrets ?? [];
} catch {
  console.log('FAIL could not read Supabase secrets — run `supabase login` first');
  process.exit(1);
}

const remote = new Map(stored.map((secret) => [secret.name, secret.value]));
for (const name of [
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_PLAN_PRO',
  'RAZORPAY_PLAN_MAX',
  'RAZORPAY_WEBHOOK_SECRET',
]) {
  const local = env[name] ?? '';
  check(`Supabase ${name} matches the local file`, Boolean(local) && remote.get(name) === sha256(local));
}

// 3. Optional: a retired pair must no longer authenticate.
const oldId = process.env.OLD_RAZORPAY_KEY_ID;
const oldSecret = process.env.OLD_RAZORPAY_KEY_SECRET;
if (oldId && oldSecret) {
  const retired = await fetch(`${API}/plans?count=1`, {
    headers: { authorization: auth(oldId, oldSecret) },
  });
  check('the retired key pair is rejected', retired.status === 401, `HTTP ${retired.status}`);
} else {
  console.log('skip retired-key check — set OLD_RAZORPAY_KEY_ID and OLD_RAZORPAY_KEY_SECRET');
}

console.log(`\nkey id in use: ${keyId}`);
if (failed) {
  console.log(`${failed} check(s) failed.`);
  process.exit(1);
}
console.log('All checks passed.');
