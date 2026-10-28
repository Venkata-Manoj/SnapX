# Supabase setup

The site uses Supabase only for accounts: Google sign-in, eight-digit email
codes, and reading the signed-in user's plan. Media never goes near it.

The browser bundle gets two values, both safe to expose:

```dotenv
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Copy `.env.example` to `.env` for local work. Add the same two variables in
Vercel → Project → Settings → Environment Variables for **Production** and
**Preview**. A secret or service-role key must never be added to this project:
the site is static and has no server to protect it.

## 1. Redirect allowlist

Supabase → Authentication → URL Configuration:

- **Site URL**: the production origin, e.g. `https://snapx.example.com`
- **Redirect URLs**, one per origin:
  - `http://localhost:5173/auth/callback.html`
  - `https://<production-domain>/auth/callback.html`
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

**Microsoft / Apple** — the buttons stay hidden while `AUTH_MICROSOFT` and
`AUTH_APPLE` are `false`. Enable the provider in Supabase first, then flip the
flag in `src/config/site.config.js`. Microsoft uses the `azure` provider with
the `email` scope, as the login code expects.

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
- enables row-level security with select-own-row policies;
- grants no client writes. The payment webhook and the future delete-account
  function use the service-role key on the server.

Verify in the SQL editor:

```sql
select count(*) from public.subscriptions;          -- one per user
select * from public.subscriptions limit 1;         -- plan = 'free'
```

Sign in once, then check `/account.html` shows **Free**. If it shows
"unavailable", the table, the trigger or the select policy is missing.

## 4. CSP

`vercel.json` allows `connect-src` to the project host over HTTPS and WSS. If
you move to a different Supabase project, update both URLs in the
`Content-Security-Policy` value or sign-in will fail in the browser with a CSP
error while working in `npm run dev` (the dev server does not apply Vercel
headers).

## 5. Manual checks the owner must do

These cannot be verified from the repo, because they need the owner's inbox and
Google account:

- [ ] Google sign-in on `localhost:5173` and on a Vercel preview URL.
- [ ] Email code arrives, verifies, and the resend cooldown works.
- [ ] Header switches to the avatar menu without a reload, and sign-out clears it.
- [ ] A brand-new account shows Free on `/account.html`.
- [ ] Wrong code, expired code and repeated sends show the friendly messages.
- [ ] Deleting an account opens the mailto with the user ID (server-side delete
      arrives with Part B).

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Redirects to the home page after Google | Callback URL missing from the allowlist. |
| "Sign-in is not configured" | `VITE_SUPABASE_*` missing at build time; rebuild after adding them. |
| Code email has a link, not a code | Email template lacks `{{ .Token }}`. |
| `Email signups are disabled` | Email provider off, or `shouldCreateUser` disabled in Supabase. |
| Works locally, fails on Vercel | CSP host or env vars differ; check the browser console for `connect-src`. |
| Header stays "Sign in" after returning | Session was not created: check the callback page status text, then the redirect allowlist. |
