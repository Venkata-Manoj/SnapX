/**
 * Open-redirect guard tests for safeNext(). Pure Node: the browser globals the
 * module reads at load are stubbed before the import.
 *
 *   npm run test:redirect
 */

import assert from 'node:assert/strict';

const ORIGIN = 'https://snap-x-beta.vercel.app';
globalThis.document = { body: { dataset: { base: '/' } } };
globalThis.window = { location: { origin: ORIGIN } };

const { safeNext } = await import('../src/lib/auth.js');

const fallback = '/account.html';
let passed = 0;

const test = (name, input, expected) => {
  assert.equal(safeNext(input, fallback), expected, `${name}: ${JSON.stringify(input)}`);
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
};

// Rejected forms.
test('protocol-relative //evil.com', '//evil.com', fallback);
test('absolute https://evil.com', 'https://evil.com', fallback);
test('backslash /\\evil.com', '/\\evil.com', fallback);
test('javascript: scheme', 'javascript:alert(1)', fallback);
test('data: scheme', 'data:text/html,hi', fallback);
test('same-origin absolute URL is still rejected', `${ORIGIN}/account.html`, fallback);
test('relative path without a leading slash', 'account.html', fallback);
test('control character', '/account\u0000.html', fallback);
test('login page is not a destination', '/login.html', fallback);
test('auth callback is not a destination', '/auth/callback.html', fallback);
test('empty value', '', fallback);

// Accepted forms.
test('account path', '/account.html', '/account.html');
test('path with query and hash', '/account.html?tab=plan#top', '/account.html?tab=plan#top');
test('site root', '/', '/');
test('nested path', '/pricing.html#pro', '/pricing.html#pro');

console.log(`\n${passed} redirect tests passed.`);
