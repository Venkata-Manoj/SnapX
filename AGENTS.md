# SnapX marketing site

Static marketing site for SnapX, a Chrome extension. `SNAPX_SITE_MASTER_PROMPT.md` is the build contract, not background reading — it holds the design system, exact copy, motion spec, deploy config and QA checklist.

Section map: §2 product facts · §4 design tokens · §6 copy · §7 motion · §11 SEO · §13 deploy · §14 QA · §15 placeholders.

## Build order

Follow §17 step by step, committing after each. The repo ships only the spec plus `snapx-site-assets/`; if `package.json` is missing, scaffold it per §1/§13 before writing sections.

## Stack and commands

Vite 5 + vanilla HTML, CSS and ES modules. No React/Vue/Tailwind. **No runtime dependencies** — dev deps only (`vite`, optional partials plugin, `sharp`, `linkinator`).

Scripts to keep on `package.json` (per §13):

```bash
npm run dev        # dev server
npm run build      # dist/ — 4 entries: index, privacy, changelog, 404
npm run preview    # serve dist/; run Lighthouse here, not on the dev server
npm run check      # npx linkinator dist --recurse (run after build)
```

- `base` comes from the `BASE_PATH` env var, default `/`. CI passes `/{{REPO_NAME}}/` for a project site. Never hardcode `/` in asset URLs.
- Multi-page Vite build: every new top-level `.html` must be added to `rollupOptions.input` or it silently won't ship.
- No test suite. Verification = `npm run build` + `npm run check` + Lighthouse mobile ≥ 95 in all four categories + axe 0 violations (§14). Canvases and `prefers-reduced-motion` are not covered by those tools — check them by hand.

## Rules agents break

- **Palette is closed.** Only §4.1 tokens. No cyan, teal, purple or blue anywhere — including `::selection`, scrollbars, and default link colour. Vermilion stays an accent; at most two `--ink` sections.
- **No invented copy or claims.** §2 is the only product truth. Ember, Glitch, Portal and Fade are always "Coming soon". Never claim a Web Store listing, user counts, ratings, reviews, testimonials, press mentions, or release dates.
- **Version 1.4.0** appears in exactly four places: hero meta, footer, install button, JSON-LD. Don't "modernise" it.
- **Placeholders stay literal.** Never substitute a guessed `{{SITE_URL}}`, `{{GITHUB_URL}}`, `{{CONTACT_EMAIL}}`, `{{DOWNLOAD_URL}}`. Empty optional tokens (`{{NEWSLETTER_FORM_URL}}`, `{{PLAUSIBLE_DOMAIN}}`) mean omit the feature entirely. Exception: `${{ steps.d.outputs.page_url }}` in the workflow is GitHub's own syntax.
- **Voice:** British-neutral spelling, consistent. Banned: "revolutionary", "seamless", "cutting-edge", "unleash", "supercharge", "AI-powered magic". No emoji in UI.
- **Focus rings are never removed** — use the §4.5 ring. `prefers-reduced-motion` must remove motion, not just shorten it.

## Assets

`snapx-site-assets/` is source material, not a served directory. Copy into `public/` and reference `/fonts/…`, `/img/…`.

- `fonts/fonts.css` uses `./*.woff2` URLs — rewrite to `/fonts/…` when copying; add `public/fonts/OFL.txt`.
- Header logo must be **inline SVG** (`logo/snapx-mark.svg`, `snapx-mark-paper.svg` on ink) so it inherits colour. Exactly one vermilion spark.
- Screenshots are 2× PNG. Ship AVIF → WebP → PNG via `<picture>` with explicit `width`/`height`.
- `logo/SnapX-Logo-Concepts.png` is reference only — never ship it. Never commit the ~51 MB extension zip; link the GitHub Release asset instead.

## Budgets

JS ≤ 35 KB gzip, CSS ≤ 25 KB gzip. LCP is the H1, not the hero canvas — start the canvas on `requestIdleCallback` or 300 ms after load. Reserve `aspect-ratio: 16/10` on the media frame. No horizontal scroll from 360 px to 1920 px.
