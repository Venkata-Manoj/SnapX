# Configuration

Everything the site says about the brand, the business, prices and links comes
from two files. HTML contains `{{TOKEN}}` placeholders; the Vite plugin swaps
them at build time, so a rename never means editing pages.

| File | Holds |
|---|---|
| `src/config/site.config.js` | Brand, URLs, emails, business details, flags, dates, product facts |
| `src/config/plans.config.js` | Plans, prices, tax line, launch offer |
| `src/config/pricing.render.js` | Build-time pricing card renderer (no browser JS) |

## Values and current status

`npm run build` prints a warning naming every value that still looks like a
placeholder. The values below are the launch-critical set:

| Value | Notes |
|---|---|
| `SITE_URL` | Set to `https://snap-x-beta.vercel.app`. Drives canonical URLs, Open Graph, JSON-LD, sitemap and robots. |
| `CONTACT_EMAIL` | Set to `call.snapx@gmail.com`; general contact and the footer "Report a bug" link. |
| `SUPPORT_EMAIL` | Set to `call.snapx@gmail.com`; Terms and Contact pages. |
| `BILLING_EMAIL` | Set to `call.snapx@gmail.com`; Refund Policy and account page. |
| `PRIVACY_EMAIL` | Set to `call.snapx@gmail.com`; data-rights requests. |
| `GRIEVANCE_EMAIL` | Set to `call.snapx@gmail.com`; DPDP grievance officer address. |
| `OPERATOR_POSTAL_ADDRESS` | Optional. Empty today, so the legal pages show `CITY` alone and never a placeholder. Set it and Terms, Privacy and Contact render the full address. |
| `EMAIL_PROVIDER_NAME` | `Google (Gmail SMTP)`; the processor that delivers sign-in codes. |
| `PAYMENT_PROVIDER` | `Razorpay`; the processor named on the pricing, legal and privacy pages. |
| `PRESS_KIT_URL` | Empty until a press kit exists after release. |
| `CHROME_WEB_STORE_URL` | Empty until the Chrome Web Store listing is live. Empty renders a disabled "Coming soon to Chrome Web Store" button; set it and every store CTA becomes "Add to Chrome". |

`PHONE` is optional: set it and the Contact page renders it; leave it empty and
the line disappears.

## Flags

| Flag | What it does |
|---|---|
| `SHOW_PRESS_KIT` | Shows the footer press-kit link only when a URL is also set. |
| `AUTH_ENABLED` | Renders sign-in in the header and the auth pages. |
| `ENABLED_SIGNIN` | `['google', 'email']`: which provider buttons render. Add `'microsoft'` or `'apple'` only after wiring that provider in Supabase. |
| `PAYMENTS_ENABLED` | `true`: paid CTAs start Razorpay Checkout. `false` renders disabled "Payments open soon" buttons instead. |

Flags are read by `<!-- @if FLAG --> … <!-- @endif -->` and
`<!-- @ifnot FLAG --> … <!-- @endif -->` blocks in HTML. An unknown flag or
token fails the build, so a typo cannot silently ship an empty element.

## Adding a page

1. Create the `.html` file at the repo root, with the same head, header and
   footer as `pricing.html`.
2. Add it to `rollupOptions.input` in `vite.config.js`. A missing entry means
   the page silently does not ship.
3. Add it to the `pages` array in the `generatedFiles()` sitemap unless it is an
   auth page (those are `noindex` and deliberately excluded).
4. Run `npm run build`. `check:placeholders` fails if any `{{TOKEN}}` or
   `@@BASE@@` survives.

## Security headers and Razorpay

`vercel.json` sets the CSP for every route. The current policy allows:

- `script-src 'self' https://*.razorpay.com` — Razorpay Checkout, loaded on the
  first CTA click.
- `connect-src` — the Supabase host over HTTPS and WSS, plus
  `https://*.razorpay.com` for the payment APIs.
- `frame-src 'self' https://*.razorpay.com` — Checkout renders in an iframe.
- `font-src 'self' https://*.razorpay.com` — Checkout's icon font.
- `style-src 'self' 'unsafe-inline'` — Checkout injects styles at runtime. This
  does not allow inline scripts.

JSON has no comments, so this section is the comment slot for those hosts. Do
not remove them while `PAYMENTS_ENABLED` is true: checkout fails only in
production, because the dev server does not apply Vercel headers.

## Deploy base path

`base` comes from `BASE_PATH` (default `/`). Asset and internal URLs use the
resolved base, so a project site under `/repo/` works without edits. The
GitHub Actions workflow is manual-only and derives the base from the repository
name; Vercel is the production target.
