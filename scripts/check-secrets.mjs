/**
 * Fail the build if a credential or a provider key reaches the browser bundle.
 *
 *   node scripts/check-secrets.mjs
 *
 * Scans every file in dist/ (text files only) for the patterns that must never
 * ship: Razorpay key ids, Supabase secret keys, private keys and the names of
 * the server-side secrets. It prints the file and the pattern, never the match.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

const PATTERNS = [
  ['Razorpay live key', /rzp_live_[A-Za-z0-9]{8,}/],
  ['Razorpay test key', /rzp_test_[A-Za-z0-9]{8,}/],
  // A real secret key has a long body. The Supabase SDK ships the literal
  // "sb_secret_" in its own format-detection warning, with no key after it.
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{16,}/],
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['entitlement private key name', /ENTITLEMENT_PRIVATE_KEY/],
  ['Razorpay key secret name', /RAZORPAY_KEY_SECRET/],
  ['Razorpay webhook secret name', /RAZORPAY_WEBHOOK_SECRET/],
  ['service-role key name', /SUPABASE_SERVICE_ROLE_KEY|SUPABASE_SECRET_KEY/],
  ['secret assignment', /\b(?:RAZORPAY|SUPABASE|ENTITLEMENT)_[A-Z0-9_]*(?:SECRET|PRIVATE_KEY)\s*[:=]\s*\S+/],
];

const isText = (buffer) => !buffer.subarray(0, 8192).includes(0);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    if (!entry.isFile()) return [];
    return [path];
  });
}

let failures = 0;
let scanned = 0;

for (const path of walk(dist)) {
  if (statSync(path).size === 0) continue;

  const buffer = readFileSync(path);
  if (!isText(buffer)) continue;

  scanned += 1;
  const text = buffer.toString('utf8');

  for (const [name, pattern] of PATTERNS) {
    if (!pattern.test(text)) continue;
    failures += 1;
    console.error(`FAIL ${relative(dist, path)} contains a ${name}`);
  }
}

if (failures) {
  console.error(`\n${failures} secret pattern(s) found in dist/. Nothing was deployed.`);
  process.exit(1);
}

console.log(`Secret check passed: ${scanned} text files in dist/, 0 secret patterns.`);
