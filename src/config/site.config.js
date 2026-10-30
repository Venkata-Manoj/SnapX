/**
 * Every brand string, URL, flag and business detail lives here.
 *
 * The Vite plugin (see vite.config.js) turns {{TOKEN}} in HTML into these values
 * at build time, so a rename is a one-file change. Flags are read by
 * <!-- @if FLAG --> â€¦ <!-- @endif --> blocks in the HTML.
 *
 * Optional links and addresses are omitted when empty. `npm run build` prints a
 * warning only for required values that still look like placeholders.
 */

export const SITE = {
  /* ---------- Brand ---------- */
  BRAND_NAME: 'SnapX',
  TAGLINE: 'Snap to vanish. Snap to return.',
  SITE_URL: 'https://snap-x-beta.vercel.app', // final origin, no trailing slash
  SITE_DESCRIPTION:
    'Snap your fingers on a Meet, Teams, Zoom or X call and vanish: dust, embers, glitch, a portal or a fade. Your mic mutes. Dust is free forever.',

  /* ---------- Contact ---------- */
  CONTACT_EMAIL: 'call.snapx@gmail.com',
  SUPPORT_EMAIL: 'call.snapx@gmail.com',
  BILLING_EMAIL: 'call.snapx@gmail.com',
  PRIVACY_EMAIL: 'call.snapx@gmail.com',

  /* ---------- Business details (Razorpay / DPDP / Chrome Web Store) ---------- */
  OPERATOR_NAME: 'B V Manoj',
  OPERATOR_TYPE: 'an individual (sole proprietor)',
  CITY: 'Chennai, Tamil Nadu, India',
  OPERATOR_POSTAL_ADDRESS: '', // required before launch; the build warns until set
  PHONE: '', // optional; rendered only when set
  GRIEVANCE_OFFICER_NAME: 'B V Manoj',
  GRIEVANCE_EMAIL: 'call.snapx@gmail.com',
  SUPPORT_RESPONSE_TIME: '2 working days',

  /* ---------- Links ---------- */
  GITHUB_PROFILE_URL: 'https://github.com/Venkata-Manoj/', // maker link in the footer
  PRESS_KIT_URL: '', // add after release
  CHROME_WEB_STORE_URL: '', // add when the Chrome Web Store listing is live
  REPO_NAME: 'snapx-web',

  /* ---------- Feature flags ---------- */
  SHOW_PRESS_KIT: false,
  AUTH_ENABLED: true,
  ENABLED_SIGNIN: ['google', 'email'], // add 'microsoft' or 'apple' when wired
  PAYMENTS_ENABLED: true, // Razorpay test mode; live keys are Supabase secrets

  /* ---------- Product facts ---------- */
  VERSION: '1.5.0',
  CHROME_MIN_VERSION: '116',
  PAYMENT_PROVIDER: 'Razorpay',
  EMAIL_PROVIDER_NAME: 'Google (Gmail SMTP)',
  REFUND_WINDOW_DAYS: '7',
  COPYRIGHT_YEAR: '2026',

  /* ---------- Dates and disclosures ---------- */
  PRIVACY_EFFECTIVE_DATE: '28 October 2026',
  LEGAL_EFFECTIVE_DATE: '28 October 2026',
  ANALYTICS_SENTENCE: 'This website uses no analytics and sets no cookies.',
};

/** Values that still look like placeholders. Used for the build warning only. */
export const UNFILLED = [
  ['SITE_URL', SITE.SITE_URL],
  ['CONTACT_EMAIL', SITE.CONTACT_EMAIL],
  ['SUPPORT_EMAIL', SITE.SUPPORT_EMAIL],
  ['BILLING_EMAIL', SITE.BILLING_EMAIL],
  ['PRIVACY_EMAIL', SITE.PRIVACY_EMAIL],
  ['GRIEVANCE_EMAIL', SITE.GRIEVANCE_EMAIL],
  ['OPERATOR_POSTAL_ADDRESS', SITE.OPERATOR_POSTAL_ADDRESS],
]
  .filter(([, value]) => !value || /example\.com|to be added/i.test(String(value)))
  .map(([key]) => key);
