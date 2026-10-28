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
| `POSTAL_ADDRESS` | Still required by Razorpay and the legal pages. |
| `DOWNLOAD_URL` | Leave empty; there is no zip download. |
| `GITHUB_URL` | Leave empty; repository links stay hidden. |
| `GITHUB_PROFILE_URL` | Set to `https://github.com/Venkata-Manoj/`; footer maker link. |
| `PRESS_KIT_URL` | Empty until a press kit exists after release. |
| `CHROME_STORE_URL` | Empty until the Chrome Web Store listing is live. |

`PHONE` is optional: set it and the Contact page renders it; leave it empty and
the line disappears.

## Flags

| Flag | What it does |
|---|---|
| `SHOW_GITHUB` | Shows the public profile link; repository links appear only when `GITHUB_URL` is also set. |
| `SHOW_PRESS_KIT` | Shows the footer press-kit link only when a URL is also set. |
| `SHOW_MANUAL_DOWNLOAD` | Shows the manual-install disclosure under the install button. |
| `AUTH_ENABLED` | Renders sign-in in the header and the auth pages. |
| `AUTH_GOOGLE` / `AUTH_MICROSOFT` / `AUTH_APPLE` | Each provider button. Microsoft uses the Supabase `azure` provider. |
| `AUTH_EMAIL` | Eight-digit email-code form. |
| `PAYMENTS_ENABLED` | `false`: paid CTAs are disabled with "Payments open soon". Part B turns this on. |

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

`vercel.json` sets the CSP for every route. The current policy allows the
Supabase host over HTTPS and WSS, which is all Part A needs. When Part B turns
on Razorpay Checkout, extend the same policy before shipping:

- `script-src` add `https://checkout.razorpay.com` (Checkout script).
- `connect-src` add `https://api.razorpay.com` (subscription and payment APIs).
- `frame-src` add `https://api.razorpay.com https://checkout.razorpay.com` if
  Checkout renders in an iframe.

JSON has no comments, so this section is the comment slot for those hosts. Do not
add them while `PAYMENTS_ENABLED` is false.

## Deploy base path

`base` comes from `BASE_PATH` (default `/`). Asset and internal URLs use the
resolved base, so a project site under `/repo/` works without edits. The
GitHub Actions workflow is manual-only and derives the base from the repository
name; Vercel is the production target.
