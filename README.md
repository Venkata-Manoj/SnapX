# SnapX marketing site

Static marketing site for SnapX, a Chrome extension that turns you to dust on a
video call and mutes your mic. Vite 5, vanilla HTML, CSS and ES modules, plus
Supabase for optional accounts. No framework and no third-party scripts.

The build contract lives in `SNAPX_SITE_MASTER_PROMPT.md`; the phase 2
additions (accounts, plans, legal, fixes) are specified in
`SITE_PHASE2_PROMPT.md`, Part A. Product claims come only from the contract.

## Run it

```bash
npm install
cp .env.example .env    # fill VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
npm run dev             # http://localhost:5173
npm run build           # dist/ + placeholder gate
npm run preview         # serve dist/ (use this for Lighthouse)
npm run check           # linkinator over dist/, after a build
npm run check:placeholders
npm run images          # regenerate public/img + icons from snapx-site-assets/
```

Node 20+.

`snapx-site-assets/` is the source pack and is not committed. `public/` is
generated once and committed, so CI does not need the pack. Run `npm run images`
only when the pack changes.

## Configure

All brand strings, URLs, emails, business details and feature flags live in
[`src/config/site.config.js`](src/config/site.config.js). Plans and prices live
in [`src/config/plans.config.js`](src/config/plans.config.js). HTML uses
`{{TOKEN}}` placeholders and `<!-- @if FLAG -->` blocks; the Vite plugin resolves
them at build time and fails on an unknown token or flag.

- [`docs/CONFIG.md`](docs/CONFIG.md) — every value, flag and the list still to fill.
- [`docs/SUPABASE.md`](docs/SUPABASE.md) — providers, redirect allowlist, email
  code template, schema, RLS and manual checks.
- [`supabase/schema.sql`](supabase/schema.sql) — idempotent tables, trigger and
  policies.

`npm run build` prints a warning for each value that still looks like a
placeholder. `npm run check:placeholders` fails the build if any `{{TOKEN}}` or
`@@BASE@@` survives into `dist/`.

## Structure

```
index.html                 home
pricing.html               plans and billing FAQ
privacy.html               policy for the extension, website and accounts
terms.html                 Terms of Service
refund.html                Cancellation & Refund Policy
contact.html               support, grievance officer, postal address
changelog.html             releases + roadmap
login.html                 Google / email-code sign-in
account.html               plan, extension connection, danger zone
auth/callback.html         OAuth return
404.html                   not found (no SPA rewrite)
src/config/                brand, plans, build-time pricing renderer
src/lib/                   Supabase client, safe-next and formatting helpers
src/js/                    main, nav, reveal, copy, faq, dissolve, effects,
                           header-auth, login, account, auth-callback
src/partials/              header + footer, inlined at build time
src/styles/                tokens, base, layout, components, sections, pricing,
                           forms, account, fonts
public/                    fonts, screenshots, icons
supabase/schema.sql        tables, trigger, RLS
scripts/images.mjs         sharp pipeline for screenshots and icons
scripts/check-placeholders.mjs  build gate
vite.config.js             BASE_PATH, page inputs, config plugin, generated files
vercel.json                clean URLs, security headers, CSP
```

`<!-- @include header.html -->` is expanded by a local Vite plugin, followed by
conditionals and token replacement. `@@BASE@@` is replaced with the resolved
base path so internal links work on `/` and on a project sub-path.

`robots.txt`, `sitemap.xml` and `site.webmanifest` are generated from the
config; do not recreate them in `public/`.

## Deploy

**Vercel (primary).** Import the repo, framework Vite, build `npm run build`,
output `dist`. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` to
Production and Preview. `vercel.json` supplies `cleanUrls`, the security
headers and the CSP. There is deliberately no rewrite to `index.html`, so
unknown paths get the real `404.html`.

**GitHub Pages (legacy).** `.github/workflows/deploy.yml` still deploys to
Pages. It carries a `{{BASE_PATH}}` placeholder the owner must replace with `/`
or `/<repo>/`; the build gate will fail until then. Vercel does not use it.

## Verification

Run `npm run build && npm run check` before judging a change. Lighthouse and
axe are run on `npm run preview`, not the dev server. Canvases and
`prefers-reduced-motion` need a manual look.

The phase 2 acceptance checks and their current results are recorded in
[`BUILD_TODO.md`](BUILD_TODO.md).
