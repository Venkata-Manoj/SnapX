# Payments (Razorpay Subscriptions, test mode)

Paid plans run on Razorpay Subscriptions. The site never sees a card, UPI ID or
bank detail: Razorpay Checkout collects them, and a signed webhook tells the
Edge Functions what happened. The browser only ever holds the Supabase
publishable key and the Razorpay **key id**, both of which are public.

```
pricing.html ──create-subscription──▶ Edge Function ──POST /v1/subscriptions──▶ Razorpay
     │                                      │                                      │
     │◀──── { subscription_id, key_id } ────┘                                      │
     │                                                                             │
     └── Razorpay Checkout (card / UPI) ──────────────────────────────────────────▶┘
                                                                                   │
account.html ◀── subscriptions row ◀── razorpay-webhook ◀── signed event ──────────┘
```

## 1. What is in the repo

| Path | Purpose |
|---|---|
| `supabase/schema.sql` | `profiles`, `subscriptions`, `payment_events`, trigger, RLS. Idempotent. |
| `supabase/config.toml` | `verify_jwt = false` for `razorpay-webhook`; true for every other function. |
| `supabase/functions/create-subscription/` | Signed-in. Starts a Razorpay subscription for Pro or Max. |
| `supabase/functions/razorpay-webhook/` | Public. Verifies the HMAC, records the event once, updates the plan. |
| `supabase/functions/cancel-subscription/` | Signed-in. Cancels at the end of the paid period. |
| `supabase/functions/change-subscription/` | Signed-in. Pro → Max now, Max → Pro at cycle end. |
| `supabase/functions/delete-account/` | Signed-in. Cancels, then deletes the auth user. |
| `supabase/functions/entitlement/` | Signed-in. Returns a seven-day Ed25519 token for the extension. |
| `src/js/checkout.js` | Pricing page: starts checkout, opens Razorpay, polls the row. |
| `src/js/account.js` | Account page: plan, last payment, manage, cancel, delete. |
| `src/lib/billing.js` | Shared plan names, paise formatting and function-error reader. |
| `scripts/test-billing.mjs` | Node tests for HMAC, Ed25519 and the plan/status mapping. |
| `scripts/check-secrets.mjs` | Fails the build if a key or secret name reaches `dist/`. |

The functions use only `jsr:@supabase/supabase-js@2` and the built-in `fetch`,
`crypto.subtle` and `Deno.serve`. There is no npm install step for them.

## 2. Manual setup (owner)

Everything in this section happens outside the repo. The site is coded for it
but cannot take a real test payment until it is done.

### 2.1 Razorpay test account and plans

1. Create or open a Razorpay account and switch the dashboard to **Test mode**.
2. **Subscriptions → Plans → Create plan**, twice:

   | Plan | Amount | Billing period | Interval |
   |---|---|---|---|
   | Pro | ₹69 | Monthly | 1 |
   | Max | ₹149 | Monthly | 1 |

3. Copy each `plan_…` id. They are the `RAZORPAY_PLAN_PRO` and
   `RAZORPAY_PLAN_MAX` secrets below.
4. **Account & Settings → API Keys → Generate key** in test mode. Copy the
   `rzp_test_…` key id and its secret.
5. **Account & Settings → Webhooks → Add webhook**:
   - URL: `https://pioepofmuuzftnpnwqhe.supabase.co/functions/v1/razorpay-webhook`
   - Secret: generate a long random string. This is
     `RAZORPAY_WEBHOOK_SECRET`.
   - Active events:
     `subscription.authenticated`, `subscription.activated`,
     `subscription.charged`, `subscription.pending`,
     `subscription.halted`, `subscription.cancelled`,
     `subscription.completed`, `subscription.paused`,
     `subscription.resumed`, `subscription.updated`,
     `payment.failed`, `refund.processed`.

Razorpay also expects the business details, the Terms, Privacy and Refund pages
and a postal address before it activates live payments. `OPERATOR_POSTAL_ADDRESS`
in `src/config/site.config.js` is still empty; fill it before going live.

### 2.2 Ed25519 keypair for the entitlement token

Run once, outside the repo:

```bash
openssl genpkey -algorithm ED25519 -out entitlement-private.pem
openssl pkey -in entitlement-private.pem -pubout -out entitlement-public.pem
```

`entitlement-private.pem` is a PKCS#8 PEM. Keep it out of git; `.gitignore`
already excludes `*.pem`. Give `entitlement-public.pem` to the extension. The
extension verifies the token signature with it and checks `exp`, `sub` and
`plan`; it never asks the site for a plan without a token.

### 2.3 Supabase secrets

```bash
supabase link --project-ref pioepofmuuzftnpnwqhe
supabase secrets set \
  RAZORPAY_KEY_ID=rzp_test_… \
  RAZORPAY_KEY_SECRET=… \
  RAZORPAY_WEBHOOK_SECRET=… \
  RAZORPAY_PLAN_PRO=plan_… \
  RAZORPAY_PLAN_MAX=plan_…
```

For the private key, an env file avoids shell newline problems:

```dotenv
# supabase/.env.secrets — git-ignored, never committed
ENTITLEMENT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"
```

```bash
supabase secrets set --env-file supabase/.env.secrets
```

The functions accept a real newline or a literal `\n` in the PEM.

Optional: `ALLOWED_ORIGINS=https://snap-x-beta.vercel.app` restricts CORS to
that origin. Without it, the functions reflect the configured production origin,
localhost and any `https://*.vercel.app` preview.

Never put any of these in `.env`, Vercel environment variables or a `src/` file.
`.env` is for the two `VITE_SUPABASE_*` browser values only.

### 2.4 Database

Run the current [`supabase/schema.sql`](../supabase/schema.sql) in the Supabase
SQL editor. It adds the billing columns, the unique index on
`provider_subscription_id`, and `payment_events`, and revokes all browser
access to the ledger. It is safe to run again.

### 2.5 Deploy the functions

```bash
supabase functions deploy create-subscription
supabase functions deploy razorpay-webhook --no-verify-jwt
supabase functions deploy cancel-subscription
supabase functions deploy change-subscription
supabase functions deploy delete-account
supabase functions deploy entitlement
```

`supabase/config.toml` already sets `verify_jwt = false` for the webhook. The
flag on the command is a second guarantee, not a substitute for the signature
check.

## 3. Function contracts

All browser-facing functions answer `OPTIONS` with CORS headers, reject other
methods with `405`, and return `{ error, message }` on failure. They verify the
caller's JWT with `auth.getUser(token)` even when the gateway already did.

### `create-subscription`

`POST { "plan": "pro" | "max" }`, `Authorization: Bearer <access token>`.

- `400 invalid_plan` — anything other than `pro` or `max`.
- `409 already_subscribed` — a paid plan is live (a future period end, or
  `active`/`authenticated` with no end), or a real provider subscription is in
  an open state (`active`, `authenticated`, `pending`, `past_due`, `halted`,
  `paused`). The `free/active` row the signup trigger creates does not block.
- `502 provider_error` — Razorpay refused or was unreachable.
- `200 { subscription_id, key_id }` — nothing else. The key secret never leaves
  the server. If an abandoned checkout already has a `created` subscription for
  the same plan, that id is returned instead of creating a second one.

It creates the subscription with `total_count: 120` (ten years of monthly
billing), `customer_notify: 1` and `notes: { user_id, plan }`, then stores
`provider_subscription_id`, `provider_plan_id` and `status = 'created'`.

### `razorpay-webhook`

Public, `verify_jwt = false`.

1. Reads the raw body once (the signature is over bytes, not parsed JSON).
2. Computes hex HMAC-SHA256 with `RAZORPAY_WEBHOOK_SECRET` and compares it to
   `X-Razorpay-Signature` in constant time. A mismatch is `400`; a missing
   secret is `500`.
3. Uses `X-Razorpay-Event-Id` as `payment_events.id`. A duplicate key
   (`23505`) returns `200 duplicate` and changes nothing. If the header is
   missing, a SHA-256 of the body is the id.
4. Applies the event, records `processed_at`, and always returns `200` after the
   event is stored. Handler failures are written to `payment_events.error` and
   logged without secrets.

Status mapping:

| Event | Stored status |
|---|---|
| `subscription.authenticated` | `authenticated` |
| `subscription.activated`, `subscription.charged`, `subscription.resumed` | `active` |
| `subscription.pending`, `payment.failed` | `past_due` |
| `subscription.halted` | `halted` |
| `subscription.cancelled` | `cancelled` |
| `subscription.completed` | `completed` |
| `subscription.paused` | `paused` |
| `subscription.updated` | the entity's status |

The plan comes from `subscription.plan_id` first, because it survives a plan
change; `notes.plan` is the fallback. `current_period_end` comes from
`current_end`. `cancel_at_period_end` comes from `cancel_at_cycle_end`.
`subscription.charged` also records `last_payment_at`,
`last_payment_amount` (paise) and `last_payment_currency`.

`halted`, `cancelled` and `completed` set `plan = 'free'` only when the paid
period has ended (or there is no end date). Until then the customer keeps the
plan they paid for. `refund.processed` is recorded in the ledger and does not
change the plan; refunds stay a human decision under the refund policy.

The ledger stores only `event`, subscription/payment/refund ids, `plan_id`,
`status`, `amount`, `currency`, `current_end` and `created_at`. No name, email,
phone, card or UPI data.

### `cancel-subscription`

`POST` with no body. Calls `POST /v1/subscriptions/{id}/cancel` with
`cancel_at_cycle_end: 1` and sets `cancel_at_period_end = true`. The customer
keeps the plan until `current_period_end`; no further charge is taken. If
Razorpay says it is already cancelled or completed, the local row is still
updated and the call succeeds.

### `change-subscription` (B4)

`POST { "plan": "pro" | "max" }`.

- **Pro → Max**: `PATCH /v1/subscriptions/{id}` with `plan_id = Max`,
  `schedule_change_at: "now"`. Razorpay prorates the difference for the rest of
  the period and charges or credits it automatically.
- **Max → Pro**: the same call with `plan_id = Pro`,
  `schedule_change_at: "cycle_end"`. The change lands when the Max period ends;
  `pending_plan` and `pending_plan_at` show it on the account page until the
  webhook confirms it.

`pending_plan` is written before the Razorpay call so a fast webhook cannot
race the row. It is cleared if the call fails. Razorpay reports the new plan id
on the subscription straight away, even for a cycle-end change; the webhook
therefore keeps the current plan while `pending_plan_at` is in the future, and
only lets the new plan take effect (and clears `pending_plan`) once the period
has ended and the next event arrives.

**Limitation:** Razorpay only allows a plan change on a card-authorised
mandate. UPI and e-mandate subscriptions cannot be changed. The function maps
that provider error to `409 plan_change_unsupported` and the account page tells
the customer to cancel and subscribe again. This is the simplest correct
approach that keeps one subscription and Razorpay's own proration; it is
documented rather than hidden.

### `delete-account`

`POST` with no body. Cancels an active subscription at cycle end (aborting if
Razorpay refuses), then deletes the auth user with the admin client. Profiles
and subscriptions cascade. `payment_events.user_id` becomes `null` through the
foreign key, so the billing record survives without identifying the person.
The account page replaces the `mailto:` request with this call.

Deletion is immediate: a paid customer loses the rest of the period they paid
for. The danger-zone copy says so before the confirmation.

### `entitlement`

`POST` with no body. Reads the caller's own `subscriptions` row server-side and
signs:

```json
{ "sub": "<user id>", "plan": "pro", "status": "active", "exp": 1790000000, "iat": 1789395200 }
```

`exp` is seven days after `iat`. The token is `header.payload.signature`,
`alg: EdDSA`. A paid plan is returned only when the stored status is `active`
or `authenticated` and `current_period_end` is null or in the future. Every
other state — halted, past due, paused, cancelled, completed, expired — returns
`plan: "free"`. If signing fails the function returns `500`; the extension
treats that as Free.

## 4. Test-mode acceptance (B5)

Use Razorpay test mode only. Test credentials:

- Card: `4111 1111 1111 1111`, any future expiry, CVV `123`, any name.
- OTP, if asked: `754081`.
- UPI success: `success@razorpay`; failure: `failure@razorpay`.

Checklist:

1. Signed out, **Get Pro** goes to `/login.html?next=/pricing.html#pro`; after
   sign-in the checkout opens once.
2. Signed in, **Get Pro** opens Razorpay Checkout with the Pro plan, the brand
   name, the signed-in email and the vermilion theme.
3. Pay with the test card. The `handler` shows "Confirming your payment…" and
   polls the `subscriptions` row every two seconds for up to 30 seconds. The
   webhook flips the row to Pro; the pricing page shows the active state and
   the account page shows Pro, the next charge date and the last payment.
4. Replay the same event with the same `X-Razorpay-Event-Id`:
   `200 duplicate`, no second change.
5. Send the same body with a tampered `X-Razorpay-Signature`: `400`.
6. **Manage plan → Cancel plan**: the account page says the plan ends on the
   current period end and Razorpay stops future charges. The plan stays Pro
   until that date; the entitlement endpoint returns Free afterwards.
7. Upgrade Pro → Max: the row switches now (Razorpay prorates). Downgrade
   Max → Pro: the account page shows "Switches to Pro on …" until the period
   ends.
8. Delete an account with an active plan: Razorpay cancellation succeeds, the
   auth user is gone, `profiles` and `subscriptions` are empty for that user,
   and `payment_events.user_id` is `null`.
9. `npm run build` passes `check:secrets`; `dist/` has no `rzp_live_`,
   `rzp_test_`, `sb_secret_` key, private key or server secret name.

Local checks that do not need Razorpay:

```bash
npm run test:billing   # HMAC, constant-time compare, status/plan mapping, Ed25519
npm run build          # placeholder gate + secret gate
npm run check          # linkinator
```

## 5. Entitlement check by hand

```bash
SUPABASE_URL=https://pioepofmuuzftnpnwqhe.supabase.co
PUBLISHABLE_KEY=sb_publishable_…

curl -sS -X POST "$SUPABASE_URL/functions/v1/entitlement" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "apikey: $PUBLISHABLE_KEY"
```

Verify a returned token with the public key:

```bash
node -e "
const { verify } = require('node:crypto');
const fs = require('node:fs');
const [h, p, s] = process.argv[1].split('.');
const sig = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
console.log(verify(null, Buffer.from(h + '.' + p), fs.readFileSync('entitlement-public.pem'), sig));
" "$TOKEN"
```

## 6. Operations

- **Rotating keys**: update the Supabase secret, redeploy nothing (functions read
  secrets at invocation), and update the key id returned by
  `create-subscription` automatically. The webhook secret must be changed in
  Razorpay and Supabase together; Razorpay retries old events with the old
  secret, so keep the old value until retries stop.
- **Failed handler**: inspect `select id, event, error, received_at from
  public.payment_events where error is not null order by received_at desc`.
  Fix the function and replay the event from the Razorpay dashboard; the
  ledger row already exists, so delete that row first if you need the handler
  to run again.
- **No secrets in the bundle**: `scripts/check-secrets.mjs` runs as part of
  `npm run build`, and `.github/workflows/ci.yml` greps `dist/` as a second
  gate. The Supabase SDK contains the literal `sb_secret_` in a key-format
  warning; the pattern requires a 16-character key body, so that string does
  not match.
- **CSP**: `vercel.json` allows `https://*.razorpay.com` in `script-src`,
  `connect-src`, `font-src` and `frame-src`, and `'unsafe-inline'` in
  `style-src` for Checkout's injected styles. The dev server does not apply
  these headers, so a CSP failure appears only on Vercel.
