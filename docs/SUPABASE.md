# Supabase setup

The site uses Supabase for accounts and billing: Google sign-in, eight-digit
email codes, the signed-in user's plan, Razorpay subscription state and the
short-lived entitlement token. Media never goes near it.

The browser bundle gets two values, both safe to expose:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Copy `.env.example` to `.env` for local work. Add the same two variables in
Vercel → Project → Settings → Environment Variables for **Production** and
**Preview**. A secret or service-role key must never be added to this project:
the site is static and has no server to protect it. Billing secrets live only
in Supabase (see [PAYMENTS.md](PAYMENTS.md)).

## 1. Redirect allowlist

Supabase → Authentication → URL Configuration:

- **Site URL**: `https://snap-x-beta.vercel.app`
- **Redirect URLs**, one per origin:
  - `http://localhost:5173/auth/callback.html`
  - `https://snap-x-beta.vercel.app/auth/callback.html`
  - `https://*-<vercel-team-slug>.vercel.app/auth/callback.html` for previews

The OAuth flow returns to `/auth/callback.html?next=…`; `next` must stay a
same-origin path, and `src/lib/auth.js` enforces that. If the callback URL is
not on the allowlist, Supabase sends the user to the Site URL instead and the
sign-in appears to do nothing.

## 2. Providers

**Google** — create an OAuth client in Google Cloud Console. Authorised
redirect URI is Supabase's callback, not the site:

```
https://<project-ref>.supabase.co/auth/v1/callback
```

Then enable Google in Supabase → Authentication → Providers and paste the
client ID and secret.

**Microsoft / Apple** — not offered. `ENABLED_SIGNIN` in
`src/config/site.config.js` lists `['google', 'email']`; add `'microsoft'` or
`'apple'` only after enabling that provider in Supabase. Microsoft uses the
`azure` provider with the `email` scope, as the login code expects.

**Email** — enable the Email provider. Sign-in uses `signInWithOtp` followed by
`verifyOtp({ type: 'email' })`, so the email template must contain the token.
Set **Email OTP Length** to **8** in Authentication → Providers → Email; the
form renders eight boxes and rejects any other length. If you change that
setting, change `CODE_LENGTH` in `src/js/login.js` and the number of inputs in
`login.html` together.

```html
<h2>Your SnapX code</h2>
<p>Enter this eight-digit code: <strong>{{ .Token }}</strong></p>
<p>If you didn't ask for it, ignore this email.</p>
```

Without `{{ .Token }}`, Supabase sends a magic link and the eight-box form has
nothing to verify. Set a sensible OTP expiry in Authentication → Providers →
Email. The site says the code is single-use and expires after a short while,
so keep that wording true.

## 3. Database

Run [`supabase/schema.sql`](../supabase/schema.sql) in the SQL editor. It is
idempotent and:

- creates `public.profiles` and `public.subscriptions` if missing;
- adds a trigger on `auth.users` that inserts a profile and a `free` / `active`
  subscription row for every new user;
- backfills users created before the trigger;
- adds the billing columns (`provider_subscription_id`, `provider_plan_id`,
  `started_at`, `pending_plan`, `pending_plan_at`, `last_payment_at`,
  `last_payment_amount`, `last_payment_currency`) and a unique index on
  `provider_subscription_id`;
- creates `public.payment_events`, the webhook idempotency ledger keyed by the
  Razorpay event id, with `user_id` set to null when an account is deleted;
- enables row-level security with select-own-row policies on profiles and
  subscriptions, and **no** browser access at all to `payment_events`;
- grants no client writes. The Edge Functions use the service-role key on the
  server.

Verify in the SQL editor:

```sql
select count(*) from public.subscriptions;          -- one per user
select * from public.subscriptions limit 1;         -- plan = 'free'
select count(*) from public.payment_events;         -- grows with webhooks
```

Sign in once, then check `/account.html` shows **Free**. If it shows
"unavailable", the table, the trigger or the select policy is missing.

## 4. Edge Functions and billing secrets

The six functions are deployed from `supabase/functions/` and configured in
`supabase/config.toml`. `razorpay-webhook` has `verify_jwt = false` because
Razorpay calls it; every other function requires a Supabase JWT.

```bash
supabase link --project-ref pioepofmuuzftnpnwqhe
supabase functions deploy create-subscription
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy cancel-subscription
supabase functions deploy change-subscription
supabase functions deploy delete-account
supabase functions deploy entitlement
```

Set these Supabase secrets, never Vercel or `.env`:

```
RAZORPAY_KEY_ID
RAZORPAY_KEY_SECRET
RAZORPAY_WEBHOOK_SECRET
RAZORPAY_PLAN_PRO
RAZORPAY_PLAN_MAX
ENTITLEMENT_PRIVATE_KEY
```

The full setup, webhook event list, test cards, upgrade/downgrade behaviour and
acceptance checks are in [PAYMENTS.md](PAYMENTS.md).

## 5. CSP

`vercel.json` allows `connect-src` to the project host over HTTPS and WSS. If
you move to a different Supabase project, update both URLs in the
`Content-Security-Policy` value or sign-in will fail in the browser with a CSP
error while working in `npm run dev` (the dev server does not apply Vercel
headers).

The same policy allows `https://*.razorpay.com` in `script-src`,
`connect-src`, `font-src` and `frame-src`, and `'unsafe-inline'` in `style-src`
for Razorpay Checkout. Do not remove those while payments are enabled.

## 6. Manual checks the owner must do

Verified on the live project on 28 October 2026:

- [x] Google sign-in on the production URL.
- [x] Eight-digit email code arrives, verifies, and Supabase redirects work.
- [x] A brand-new account shows Free on `/account.html`.

Still worth a quick check after any auth or billing change:

- [ ] Header switches to the avatar menu without a reload, and sign-out clears it.
- [ ] Wrong code, expired code and repeated sends show the friendly messages.
- [ ] Deleting an account calls `delete-account`, removes the auth user, and
      leaves the payment ledger with a null `user_id`.
- [ ] Razorpay test payment flips the plan and the account page shows the next
      charge date and last payment.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Redirects to the home page after Google | Callback URL missing from the allowlist. |
| "Sign-in is not configured" | `VITE_SUPABASE_*` missing at build time; rebuild after adding them. |
| Code email has a link, not a code | Email template lacks `{{ .Token }}`. |
| `Email signups are disabled` | Email provider off, or `shouldCreateUser` disabled in Supabase. |
| Works locally, fails on Vercel | CSP host or env vars differ; check the browser console for `connect-src`. |
| Header stays "Sign in" after returning | Session was not created: check the callback page status text, then the redirect allowlist. |
| Checkout opens but the webhook never updates the plan | Webhook URL, secret or event list wrong; inspect `payment_events` and the Razorpay dashboard delivery log. |
| `entitlement` returns `500 signing_failed` | `ENTITLEMENT_PRIVATE_KEY` missing or not a PKCS#8 Ed25519 PEM. |
| A function returns `401` for a signed-in user | `verify_jwt` is on and the `Authorization` header was not sent; the browser client adds it automatically. |
