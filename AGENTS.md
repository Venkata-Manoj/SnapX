# SnapX marketing site

Static marketing site for SnapX, a Chrome extension. `SNAPX_SITE_MASTER_PROMPT.md`
is the build contract for the design system, exact copy, motion, SEO and QA.
`SITE_PHASE2_PROMPT.md` Part A covers accounts, plans, legal pages and fixes.

Section map: §2 product facts · §4 design tokens · §6 copy · §7 motion · §11 SEO
· §13 deploy · §14 QA · §15 placeholders.

## Stack and commands

Vite 5 + vanilla HTML, CSS and ES modules. No React/Vue/Tailwind. The only
runtime dependency is `@supabase/supabase-js`; everything else is dev-only
(`vite`, `sharp`, `linkinator`).

```bash
npm run dev              # dev server
npm run build            # dist/ + placeholder gate
npm run preview          # serve dist/; run Lighthouse here
npm run check            # linkinator over dist/, after a build
npm run check:placeholders
```

- `base` comes from `BASE_PATH`, default `/`. Never hardcode `/` in asset URLs;
  use `@@BASE@@`.
- Every top-level `.html` must be added to `rollupOptions.input` in
  `vite.config.js`, or it silently will not ship. Auth pages are `noindex` and
  stay out of the sitemap; everything else goes in the `pages` array in
  `generatedFiles()`.
- Verification = `npm run build` + `npm run check`, Lighthouse mobile
  accessibility ≥ 95 on home, pricing, login and account, axe 0 violations, and
  a manual look at canvases and `prefers-reduced-motion`. There is no test suite.

## Configuration

- **All brand and business strings live in `src/config/site.config.js`.** Never
  hardcode "SnapX", an email, a URL or a date in HTML. Plans and prices live in
  `src/config/plans.config.js`.
- HTML uses `{{TOKEN}}` and `<!-- @if FLAG -->` / `<!-- @ifnot FLAG -->`.
  Unknown tokens and flags fail the build. Full list: `docs/CONFIG.md`.
- `npm run check:placeholders` fails on any surviving `{{TOKEN}}` or `@@BASE@@`
  in `dist/`. Do not weaken it or add a literal token to make a build pass.
- Empty URLs remove their element; they never leave a dead link. `SITE_URL`,
  emails and the postal address default to `example.com` / "to be added" and
  trigger a build warning until the owner fills them.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` belong in the
  browser bundle. Never add a secret or service-role key to `.env`, Vercel or
  any `src/` file. `.env` is git-ignored.

## Rules agents break

- **Palette is closed.** Only §4.1 tokens. No cyan, teal, purple or blue
  anywhere, including `::selection`, scrollbars and default link colour.
  Vermilion is an accent; at most two `--ink` sections.
- **No invented copy or claims.** §2 plus the plan config are the only product
  truth. Ember, Glitch, Portal and Fade are always "Coming soon". Never claim a
  Web Store listing, user counts, ratings, reviews, testimonials, press
  mentions, or release dates. Never imply paid plans are on sale while
  `PAYMENTS_ENABLED` is false.
- **Version 1.4.0** appears in exactly four places on the home page: hero meta,
  footer, install button, JSON-LD. Don't "modernise" it.
- **Voice:** British-neutral spelling, consistent. Banned: "revolutionary",
  "seamless", "cutting-edge", "unleash", "supercharge", "AI-powered magic".
  No emoji in UI.
- **Focus rings are never removed** — use the §4.5 ring. `prefers-reduced-motion`
  removes motion, not just shortens it.
- **Legal pages are drafts, not legal advice.** Their source starts with a
  "NOT LEGAL ADVICE" comment. Do not present them as reviewed.

## Auth and security

- `src/lib/supabase.js` is the only place the client is created (PKCE, persisted
  session, auto-refresh, URL detection). Import it lazily: `header-auth.js` is
  loaded after idle, and `login`/`account`/`auth-callback` import it directly.
  Do not add it to `main.js`.
- `safeNext()` in `src/lib/auth.js` is the open-redirect guard. Any new redirect
  from `?next=` must go through it.
- Auth pages are `noindex`; keep them out of `sitemap.xml`.
- `vercel.json` holds the CSP. `connect-src` must include the Supabase host over
  `https` and `wss`. If the project moves, update it or sign-in breaks only in
  production (the dev server does not apply Vercel headers).
- There is no SPA catch-all. Unknown paths get the real `404.html`; keep it that
  way.

## Assets

`snapx-site-assets/` is source material, not a served directory. Copy into
`public/` and reference `/fonts/…`, `/img/…`.

- `fonts/fonts.css` uses `./*.woff2` URLs — rewrite to `/fonts/…` when copying;
  add `public/fonts/OFL.txt`.
- Header logo must be **inline SVG** so it inherits colour. Exactly one
  vermilion spark.
- Screenshots are 2× PNG. Ship AVIF → WebP → PNG via `<picture>` with explicit
  `width`/`height`.
- `logo/SnapX-Logo-Concepts.png` is reference only. Never commit the ~51 MB
  extension zip; link the release asset instead.

## Budgets

JS ≤ 35 KB gzip for the marketing page's initial code, CSS ≤ 25 KB gzip. The
Supabase client is a separate ~60 KB gzip chunk, loaded after idle on marketing
pages and directly on auth pages; that is deliberate, not a budget failure to
"fix" by importing it eagerly. LCP is the H1, not the hero canvas — start the
canvas on `requestIdleCallback` or 300 ms after load. Reserve
`aspect-ratio: 16/10` on the media frame. No horizontal scroll from 360 px to
1920 px.
