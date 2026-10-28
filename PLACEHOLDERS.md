# Placeholders and unfilled values

The site no longer ships literal `{{TOKEN}}` placeholders. Tokens are resolved
at build time from `src/config/site.config.js`, and `npm run check:placeholders`
fails the build if any survive into `dist/`.

Some config values are still deliberately fake or empty. The build prints a
warning naming each one, and the site stays honest while they are unfilled:
empty URLs remove their element or fall back to the install section.

## Fill before launch

| Value | Where it appears | Replace with |
|---|---|---|
| `SITE_URL` | Canonical, Open Graph, Twitter, JSON-LD, sitemap, robots | Final origin, no trailing slash |
| `CONTACT_EMAIL` | Footer bug report, Contact, legal pages | Real address |
| `SUPPORT_EMAIL` | Terms, Refund, Contact, account | Real support address |
| `BILLING_EMAIL` | Refund Policy, account page | Real billing address |
| `PRIVACY_EMAIL` | Privacy rights section, Contact | Real privacy address |
| `GRIEVANCE_EMAIL` | Privacy, Terms, Refund, Contact | Grievance officer address |
| `POSTAL_ADDRESS` | Privacy, Terms, Contact | Real postal address (Razorpay requires it) |
| `DOWNLOAD_URL` | Install section, JSON-LD `downloadUrl` | Release zip, or leave empty |
| `GITHUB_URL` | Header, footer, home links, when `SHOW_GITHUB` is on | Repository URL |
| `GITHUB_PROFILE_URL` | Footer maker link, when public | Profile URL |
| `PRESS_KIT_URL` | Footer Project link, when `SHOW_PRESS_KIT` is on | Press-kit zip |
| `CHROME_STORE_URL` | Install button, JSON-LD | Listing URL, when live |

`PHONE` is optional: set it and the Contact page shows it; leave it empty and
the line disappears.

## `.example.com` defaults

`SITE_URL`, the four public email addresses and `GRIEVANCE_EMAIL` default to
`example.com` so a missed value cannot accidentally point at a real domain.
They are not secrets. Replace them all before launch.

## Empty URL flags

- `GITHUB_URL` empty + `SHOW_GITHUB: false` → every GitHub link is removed, not
  left dead. `HAS_GITHUB`/`HAS_PROFILE` are derived, so flipping the flag alone
  does nothing until a URL exists.
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

`.github/workflows/deploy.yml` still contains GitHub Actions' own
`${{ steps.d.outputs.page_url }}` and a literal `{{BASE_PATH}}` build value.
That one is not a site token: replace it with `/` or `/<repo>/`, or delete the
workflow if Vercel is the only deploy target. Site tokens never appear there.
