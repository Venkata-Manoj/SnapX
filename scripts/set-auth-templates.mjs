#!/usr/bin/env node
/**
 * Set the hosted Supabase email templates and OTP length/expiry.
 *
 *   SUPABASE_ACCESS_TOKEN=... node scripts/set-auth-templates.mjs --apply
 *   node scripts/set-auth-templates.mjs --dry-run
 *
 * The token is read from the environment and never printed. `--dry-run` needs
 * no token and prints the exact PATCH body. Without `--apply` the script only
 * reads and reports the current values.
 */

import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const config = readFileSync(new URL('supabase/config.toml', ROOT), 'utf8');
const projectRef =
  process.env.SUPABASE_PROJECT_REF ||
  config.match(/^\s*project_id\s*=\s*"([^"]+)"/m)?.[1] ||
  '';
const token = process.env.SUPABASE_ACCESS_TOKEN || '';
const apply = process.argv.includes('--apply');
const dryRun = process.argv.includes('--dry-run');

if (!projectRef) {
  console.error('Project ref not found in supabase/config.toml or SUPABASE_PROJECT_REF.');
  process.exit(1);
}

const template = (name) =>
  readFileSync(new URL(`supabase/templates/${name}`, ROOT), 'utf8');

const payload = {
  mailer_subjects_confirmation: 'Your SnapX sign-in code',
  mailer_templates_confirmation_content: template('confirm-signup.html'),
  mailer_subjects_magic_link: 'Your SnapX sign-in code',
  mailer_templates_magic_link_content: template('magic-link.html'),
  mailer_subjects_reauthentication: 'Your SnapX sign-in code',
  mailer_templates_reauthentication_content: template('reauthentication.html'),
  mailer_otp_length: 8,
  mailer_otp_exp: 600,
};

const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
};

const relevant = (config) => ({
  mailer_otp_length: config.mailer_otp_length,
  mailer_otp_exp: config.mailer_otp_exp,
  mailer_subjects_confirmation: config.mailer_subjects_confirmation,
  mailer_subjects_magic_link: config.mailer_subjects_magic_link,
  mailer_subjects_reauthentication: config.mailer_subjects_reauthentication,
  templates: {
    confirmation: summarize(config.mailer_templates_confirmation_content),
    magic_link: summarize(config.mailer_templates_magic_link_content),
    reauthentication: summarize(config.mailer_templates_reauthentication_content),
  },
});

function summarize(content) {
  const text = String(content || '');
  return {
    length: text.length,
    has_token: text.includes('{{ .Token }}'),
    has_confirmation_url: text.includes('{{ .ConfirmationURL }}'),
    has_link: /<a\s/i.test(text),
  };
}

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

if (!token) {
  console.error('SUPABASE_ACCESS_TOKEN is not set. Export it, then run again with --apply.');
  process.exit(1);
}

const current = await fetch(endpoint, { headers });
if (!current.ok) {
  console.error(`GET config failed: HTTP ${current.status}`);
  process.exit(1);
}
const before = relevant(await current.json());
console.log('Before:');
console.log(JSON.stringify(before, null, 2));

if (!apply) {
  console.log('\nRead-only. Re-run with --apply to write the templates and OTP settings.');
  process.exit(0);
}

const patch = await fetch(endpoint, {
  method: 'PATCH',
  headers,
  body: JSON.stringify(payload),
});
if (!patch.ok) {
  console.error(`PATCH config failed: HTTP ${patch.status}`);
  process.exit(1);
}

const afterResponse = await fetch(endpoint, { headers });
if (!afterResponse.ok) {
  console.error(`GET after PATCH failed: HTTP ${afterResponse.status}`);
  process.exit(1);
}
const after = relevant(await afterResponse.json());
console.log('\nAfter:');
console.log(JSON.stringify(after, null, 2));

const ok =
  after.mailer_otp_length === 8 &&
  after.mailer_otp_exp === 600 &&
  after.templates.confirmation.has_token &&
  !after.templates.confirmation.has_confirmation_url &&
  !after.templates.confirmation.has_link &&
  after.templates.magic_link.has_token &&
  !after.templates.magic_link.has_confirmation_url &&
  !after.templates.magic_link.has_link &&
  after.templates.reauthentication.has_token &&
  !after.templates.reauthentication.has_confirmation_url &&
  !after.templates.reauthentication.has_link;

console.log(ok ? '\nHosted auth config verified.' : '\nHosted auth config does not match the repo templates.');
process.exit(ok ? 0 : 1);
