# Placeholders and unfilled values

The site no longer ships literal `{{TOKEN}}` placeholders. Tokens are resolved
at build time from `src/config/site.config.js`, and `npm run check:placeholders`
fails the build if any survive into `dist/`.

Some config values are still deliberately fake or empty. The build prints a
warning naming each one, and the site stays honest while they are unfilled:
empty URLs remove their element or fall back to the install section.

## Still to fill

| Value | Where it appears | Replace with |
|---|---|---|
| `OPERATOR_POSTAL_ADDRESS` | Optional: Terms, Privacy, Contact | Full postal address (Razorpay wants one before launch) |

`SITE_URL` is `https://snap-x-beta.vercel.app`. All five contact addresses are
`call.snapx@gmail.com`. The build warning no longer names any of them.

## Deliberately empty until release

| Value | Behaviour |
|---|---|
| `PRESS_KIT_URL` | The footer Project column stays hidden while `SHOW_PRESS_KIT` is false |
| `CHROME_WEB_STORE_URL` | Every store CTA is a disabled "Coming soon to Chrome Web Store" button; set it and they become "Add to Chrome" |

`PHONE` is optional: set it and the Contact page shows it; leave it empty and
the line disappears.

## Empty URL flags

- `PRESS_KIT_URL` empty + `SHOW_PRESS_KIT: false` → the footer Project column is
  omitted entirely.
- `CHROME_WEB_STORE_URL` empty → every store CTA renders as a disabled button.
  It is never a link, and never points at `#install`.
- `OPERATOR_POSTAL_ADDRESS` empty → Terms, Privacy and Contact show
  `Chennai, Tamil Nadu, India` and nothing else. No placeholder can render.

## Environment

Only two variables are allowed in the browser bundle:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

`.env` is git-ignored; `.env.example` is committed. A secret or service-role
key never belongs in either. Add the same two values in Vercel for Production
and Preview.

Billing secrets (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`,
`RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_PRO`, `RAZORPAY_PLAN_MAX`,
`ENTITLEMENT_PRIVATE_KEY`) live only in Supabase. They are not placeholders in
this repo and must never be added to `.env` or Vercel. See
[`docs/PAYMENTS.md`](docs/PAYMENTS.md).

## The deploy workflow

`.github/workflows/deploy.yml` is a manual GitHub Pages fallback. It runs only
from **Actions → Deploy site (GitHub Pages, legacy) → Run workflow**, and builds
with `BASE_PATH=/<repository-name>/`, derived from the repository itself. No
literal placeholder remains.

It requires Pages to be enabled first (Settings → Pages → Source: GitHub
Actions). Pages for a private repository needs a paid GitHub plan. Vercel
remains the production target and deploys every push to `main`.
