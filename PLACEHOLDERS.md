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
| `POSTAL_ADDRESS` | Privacy, Terms, Contact | Real postal address (Razorpay requires it) |

`SITE_URL` is `https://snap-x-beta.vercel.app`. All five contact addresses are
`call.snapx@gmail.com`. `GITHUB_PROFILE_URL` is the public profile; the build
warning no longer names any of them.

## Deliberately empty until release

| Value | Behaviour |
|---|---|
| `DOWNLOAD_URL` | No zip link; the manual-install disclosure stays |
| `GITHUB_URL` | No repository links; the footer maker link uses `GITHUB_PROFILE_URL` |
| `PRESS_KIT_URL` | The footer Project column stays hidden while `SHOW_PRESS_KIT` is false |
| `CHROME_STORE_URL` | The install button scrolls to the install section and says the listing is coming soon |

`PHONE` is optional: set it and the Contact page shows it; leave it empty and
the line disappears.

## Empty URL flags

- `GITHUB_URL` empty → every repository link is removed, not left dead.
  `GITHUB_PROFILE_URL` still drives the footer maker link because
  `SHOW_GITHUB` is on.
- `PRESS_KIT_URL` empty + `SHOW_PRESS_KIT: false` → the footer Project column is
  omitted entirely.
- `DOWNLOAD_URL` empty → the install section shows the manual-install
  disclosure instead of a zip link.
- `CHROME_STORE_URL` empty → the install button scrolls to the install section.

## Environment

Only two variables are allowed in the browser bundle:

```dotenv
VITE_SUPABASE_URL=
VITE_SUPABASE_PUBLISHABLE_KEY=
```

`.env` is git-ignored; `.env.example` is committed. A secret or service-role
key never belongs in either. Add the same two values in Vercel for Production
and Preview.

## The deploy workflow

`.github/workflows/deploy.yml` is a manual GitHub Pages fallback. It runs only
from **Actions → Deploy site (GitHub Pages, legacy) → Run workflow**, and builds
with `BASE_PATH=/<repository-name>/`, derived from the repository itself. No
literal placeholder remains.

It requires Pages to be enabled first (Settings → Pages → Source: GitHub
Actions). Pages for a private repository needs a paid GitHub plan. Vercel
remains the production target and deploys every push to `main`.
