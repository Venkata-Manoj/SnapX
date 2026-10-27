# SnapX marketing site

Static site for SnapX, a Chrome extension that turns you to dust on a video call and mutes your mic. Vite 5, vanilla HTML, CSS and ES modules. No runtime dependencies, no framework, no third-party requests.

The build contract lives in `SNAPX_SITE_MASTER_PROMPT.md` (ignored by git). Product claims come only from §2 of that document.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # dist/ — index, privacy, changelog, 404
npm run preview    # serve dist/ (use this for Lighthouse)
npm run check      # linkinator over dist/, after a build
npm run images     # regenerate public/img + icons from snapx-site-assets/
```

Node 20+ (built and verified on Node 22.22.3, npm 10.9.8).

`snapx-site-assets/` is the source pack and is not committed. `public/` is generated once and committed, so CI does not need the pack. Run `npm run images` only when the pack changes.

## Structure

```
index.html                 home, all 13 sections
privacy.html               policy
changelog.html             releases + roadmap
404.html                   not found
src/styles/                tokens, base, layout, components, sections, fonts
src/js/                    main, nav, reveal, copy, faq, dissolve, effects
src/partials/              header + footer, inlined at build time
public/                    fonts, screenshots, icons, robots, sitemap, manifest
scripts/images.mjs         sharp pipeline for AVIF/WebP screenshots and icons
vite.config.js             BASE_PATH, multi-page inputs, @@BASE@@ rewriting
```

`<!-- @include header.html -->` is expanded by a tiny local Vite plugin. `@@BASE@@` is replaced with the resolved base path so internal links work on both `/` and `/repo/`.

## Deploy (GitHub Pages)

1. Replace the placeholders in [`PLACEHOLDERS.md`](PLACEHOLDERS.md). At minimum `{{SITE_URL}}`, `{{GITHUB_URL}}`, `{{DOWNLOAD_URL}}`, `{{CONTACT_EMAIL}}`, `{{PRIVACY_EFFECTIVE_DATE}}` and `{{ANALYTICS_SENTENCE}}`.
2. Set `BASE_PATH` in `.github/workflows/deploy.yml`: `/` for a custom domain, `/repo-name/` for a project site. The value is currently the literal `{{BASE_PATH}}` token.
3. Custom domain only: add `public/CNAME` with the domain.
4. Host `SnapX-v1.4.0.zip` as a GitHub Release asset; point `{{DOWNLOAD_URL}}` at it. Do not commit the ~51 MB zip.
5. In the repository: Settings → Pages → Source: **GitHub Actions**. Push to `main`.
6. Run `npm run build && npm run check` locally first.

`BASE_PATH=/snapx/ npm run build` was verified: HTML links, icons, manifest and the font URLs in the bundled CSS all move under `/snapx/`.

## Verification

- `npm run build` and `npm run check`: pass (17 internal links, 0 broken).
- 64-check Playwright suite: 64/64. Covers section copy, version count (exactly four `1.4.0` on home), Coming soon badges, hero animation, replay, off-screen pause, popup tabs, help table/accordion, copy button, fonts, touch targets, skip link, mobile menu, reduced motion, and no horizontal scroll from 360 px to 1920 px.
- axe-core 4.10.2: 0 violations on all four pages at 1440 px and 390 px.
- Lighthouse 12.8.2, mobile, on `vite preview`:
  - untouched placeholder build: performance 97, accessibility 100, best practices 100, SEO 85 (invalid placeholder canonical + sitemap URL);
  - with `{{SITE_URL}}` and the other URL tokens substituted in `dist/`: **97 / 100 / 100 / 100**.
- Budgets: CSS 8.6 KB gzip (limit 25), JS 7.1 KB gzip (limit 35). Hero frame time p95 16.9 ms.

## Deliberate deviations

- **Screenshots are 1×, not 2×.** The supplied assets are 340×585; the contract says 2×. They are displayed at 340 CSS px with explicit `width`/`height`, in AVIF → WebP → PNG. No upscaling or invented imagery.
- **No hero video.** `{{HERO_VIDEO_ENABLED}}` is unused; the code-built canvas is the hero, as the contract makes it the default.
- **No newsletter form.** `{{NEWSLETTER_FORM_URL}}` is empty, so the optional form is omitted.
- **No analytics, no CNAME.** `{{PLAUSIBLE_DOMAIN}}` is empty and no domain was supplied.
- **Changelog dates omitted.** No dates were supplied and inventing them is forbidden; `{{RELEASE_DATES}}` is documented instead.
- **`{{ANALYTICS_SENTENCE}}` stays literal** on the privacy page, per the "never substitute placeholders" rule. The exact default sentence is in `PLACEHOLDERS.md`.
- **Reduced motion** shows a static render of the half-dissolved canvas, not a separate SVG poster. It is the same artwork, frozen.
- **Hero pause control** is an addition (top-right, 36 px visual, 44 px hit area). §12 asks for a visible pause control; §6.1 only names Replay.
- **Small structural labels** not quoted in §6: the "PRIVACY" eyebrow, the "FAQ" eyebrow and the FAQ heading "Questions, answered." They add no claims.
