# Placeholders

Every `{{TOKEN}}` below is deliberately left literal in the source and in `dist/`, as required by the build contract. Nothing is guessed. Replace them before pointing a domain at the site, then rebuild.

`npm run check` skips links that begin with `{{` so the placeholder build still passes link checking. Once the tokens are replaced, the full link check runs too.

> `${{ steps.d.outputs.page_url }}` in `.github/workflows/deploy.yml` is GitHub Actions syntax, not a site placeholder. Do not replace it.

## Required

| Token | Where it is used | Replace with |
|---|---|---|
| `{{SITE_URL}}` | Canonical, Open Graph and Twitter URLs, JSON-LD `url`, `robots.txt`, `sitemap.xml` (home, privacy, changelog) | Final origin, no trailing slash, e.g. `https://snapx.example.com` |
| `{{GITHUB_URL}}` | Header (desktop + mobile), footer Project column, "Read the source on GitHub", "Vote on GitHub", "Open an issue", "Watch on GitHub" | Repository URL, e.g. `https://github.com/<user>/snapx` |
| `{{GITHUB_PROFILE_URL}}` | Footer maker link (B V Manoj) | Maker's GitHub profile |
| `{{DOWNLOAD_URL}}` | Install button and JSON-LD `downloadUrl` | Release asset, e.g. `{{GITHUB_URL}}/releases/latest/download/SnapX-v1.4.0.zip` |
| `{{CONTACT_EMAIL}}` | Footer Contact, help "Email", privacy Contact | Real contact address |
| `{{PRESS_KIT_URL}}` | Footer Project → Press kit | Zip of `/logo` + `/screenshots` + a short description |
| `{{PRIVACY_EFFECTIVE_DATE}}` | Privacy page, under the H1 | Date the policy takes effect |
| `{{ANALYTICS_SENTENCE}}` | Privacy page → "This website" | See below |
| `{{BASE_PATH}}` | `.github/workflows/deploy.yml`, `BASE_PATH` env for the build | `/` for a custom domain, `/repo-name/` for a project site |

### `{{ANALYTICS_SENTENCE}}`

The paragraph currently renders the token literally so it cannot be missed. Replace it with one of the two sentences from the contract (§9.7):

- No analytics (default, and correct for this build): `This website uses no analytics and sets no cookies.`
- Plausible enabled: `This website uses Plausible, a cookieless analytics tool that counts page views without collecting personal data.`

No analytics script is included. If you enable Plausible, add its script and set `{{PLAUSIBLE_DOMAIN}}` at the same time.

## Optional or intentionally unused

| Token | Status | Why |
|---|---|---|
| `{{DOMAIN}}` | Not used | No custom domain was supplied, so `public/CNAME` was not created. Add `public/CNAME` containing the domain if you use one. |
| `{{REPO_NAME}}` | Not used | Folded into `{{BASE_PATH}}`, which the workflow reads once. |
| `{{NEWSLETTER_FORM_URL}}` | Not used | Empty optional token means the newsletter form is omitted. "Watch on GitHub" remains the only updates action. |
| `{{PLAUSIBLE_DOMAIN}}` | Not used | No analytics, per the privacy page and the no-tracker rule. |
| `{{RELEASE_DATES}}` | Not used | Release dates were not supplied, and inventing them is forbidden. The changelog omits dates; add them per version when known. |
| `{{HERO_VIDEO_ENABLED}}` | Not used | The code-built canvas is the default hero. No video files were generated or shipped. |

## Note on Lighthouse SEO

With `{{SITE_URL}}` still literal, Lighthouse reports SEO 85: the canonical URL and the `Sitemap:` line in `robots.txt` are not valid URLs yet. A verification build with the tokens substituted scored SEO 100. Replace `{{SITE_URL}}` (and the other required tokens) before judging SEO.
