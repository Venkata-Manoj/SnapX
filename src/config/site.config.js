/**
 * Every brand string, URL, flag and business detail lives here.
 *
 * The Vite plugin (see vite.config.js) turns {{TOKEN}} in HTML into these values
 * at build time, so a rename is a one-file change. Flags are read by
 * <!-- @if FLAG --> … <!-- @endif --> blocks in the HTML.
 *
 * Values marked FILL are placeholders: replace them before pointing a real
 * domain at the site. `npm run build` prints a warning for each one.
 */

export const SITE = {
  /* ---------- Brand ---------- */
  BRAND_NAME: 'SnapX',
  TAGLINE: 'Snap to vanish. Snap to return.',
  SITE_URL: 'https://snap-x-beta.vercel.app', // final origin, no trailing slash
  SITE_DESCRIPTION:
    'A Chrome extension for Google Meet, Teams, Zoom and X. Snap your fingers and turn to dust, and your mic mutes. Everything runs on your computer.',

  /* ---------- Contact ---------- */
  CONTACT_EMAIL: 'hello@snapx.example.com', // FILL
  SUPPORT_EMAIL: 'support@snapx.example.com', // FILL
  BILLING_EMAIL: 'billing@snapx.example.com', // FILL
  PRIVACY_EMAIL: 'privacy@snapx.example.com', // FILL

  /* ---------- Business details (Razorpay / DPDP / Chrome Web Store) ---------- */
  OPERATOR_NAME: 'B V Manoj',
  OPERATOR_TYPE: 'an individual (sole proprietor)',
  CITY: 'Chennai, Tamil Nadu, India',
  POSTAL_ADDRESS: '[Postal address to be added before launch]', // FILL: required by Razorpay
  PHONE: '', // optional; rendered only when set
  GRIEVANCE_OFFICER_NAME: 'B V Manoj',
  GRIEVANCE_EMAIL: 'grievance@snapx.example.com', // FILL
  SUPPORT_RESPONSE_TIME: '2 working days',

  /* ---------- Links ---------- */
  GITHUB_URL: '', // FILL once the repository is public
  GITHUB_PROFILE_URL: '', // FILL once public
  DOWNLOAD_URL: '', // FILL: release zip, e.g. .../releases/latest/download/SnapX-v1.4.0.zip
  PRESS_KIT_URL: '', // FILL: zip of logo + screenshots + short description
  CHROME_STORE_URL: '', // FILL when the Chrome Web Store listing is live
  REPO_NAME: 'snapx-web',

  /* ---------- Feature flags ---------- */
  SHOW_GITHUB: false, // repo is not public yet
  SHOW_PRESS_KIT: false,
  SHOW_MANUAL_DOWNLOAD: true, // until the Chrome Web Store listing is live
  AUTH_ENABLED: true,
  AUTH_GOOGLE: true,
  AUTH_EMAIL: true,
  AUTH_MICROSOFT: false, // enable after wiring the Azure provider in Supabase
  AUTH_APPLE: false, // enable after wiring the Apple provider in Supabase
  PAYMENTS_ENABLED: false, // Part B flips this on with Razorpay

  /* ---------- Product facts ---------- */
  VERSION: '1.4.0',
  CHROME_MIN_VERSION: '116',
  PAYMENT_PROVIDER: 'Razorpay',
  EMAIL_PROVIDER_NAME: 'Supabase Auth', // change if you move to Resend/Postmark
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
  ['POSTAL_ADDRESS', SITE.POSTAL_ADDRESS],
  ['DOWNLOAD_URL', SITE.DOWNLOAD_URL],
  ['GITHUB_URL', SITE.GITHUB_URL],
  ['GITHUB_PROFILE_URL', SITE.GITHUB_PROFILE_URL],
  ['PRESS_KIT_URL', SITE.PRESS_KIT_URL],
  ['CHROME_STORE_URL', SITE.CHROME_STORE_URL],
]
  .filter(([, value]) => !value || /example\.com|to be added/i.test(String(value)))
  .map(([key]) => key);

export default SITE;
