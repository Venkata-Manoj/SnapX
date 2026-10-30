/**
 * Shared helpers for the account pages. Everything here is browser-side and
 * assumes the Supabase publishable key, never a secret.
 */

const rawBase = document.body?.dataset.base || '/';

/** Deploy base path, always with a trailing slash. */
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

/** Turn a page name into an absolute-path URL inside the deploy base. */
export const appUrl = (path = '') => `${base}${String(path).replace(/^\/+/, '')}`;

/**
 * Only same-origin, absolute-path destinations are allowed. This is the guard
 * against open redirects in `?next=`.
 */
export function safeNext(value, fallback = appUrl('account.html')) {
  if (!value || typeof value !== 'string') return fallback;

  // Only a same-site absolute path. Reject a scheme, a protocol-relative
  // "//host", a backslash and control characters before the URL parser can
  // normalise them into something else.
  if (!value.startsWith('/') || value.startsWith('//')) return fallback;
  if (/[\u0000-\u001f\\]/.test(value)) return fallback;

  let parsed;
  try {
    parsed = new URL(value, window.location.origin);
  } catch {
    return fallback;
  }

  if (parsed.origin !== window.location.origin) return fallback;
  if (!parsed.pathname.startsWith('/')) return fallback;
  if (/\/(login|auth\/callback)\.html$/.test(parsed.pathname)) return fallback;

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

const PROVIDERS = {
  google: 'Google',
  email: 'Email code',
};

export const providerName = (user) => {
  const provider = user?.app_metadata?.provider || 'email';
  return PROVIDERS[provider] || provider.charAt(0).toUpperCase() + provider.slice(1);
};

export function displayName(user) {
  const meta = user?.user_metadata ?? {};
  const name = meta.full_name || meta.name || meta.preferred_username;
  if (name) return String(name).trim();
  if (user?.email) return user.email.split('@')[0];
  return '';
}

const initials = (value) => {
  const words = String(value).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0].slice(0, 2);
  return `${words[0][0]}${words[words.length - 1][0]}`;
};

/** Avatar image when the provider has one, initials otherwise. */
export function setAvatar(element, user) {
  if (!element) return;
  const meta = user?.user_metadata ?? {};
  const src = meta.avatar_url || meta.picture;

  element.replaceChildren();

  if (src) {
    const image = document.createElement('img');
    image.src = src;
    image.alt = '';
    image.referrerPolicy = 'no-referrer';
    image.decoding = 'async';
    element.append(image);
    return;
  }

  element.textContent = initials(displayName(user) || user?.email || '?');
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/** Plain-English errors from Supabase Auth, including rate limits. */
export function authErrorMessage(error) {
  const message = String(error?.message || '');
  const status = Number(error?.status || 0);

  if (status === 429 || /rate limit|too many|over_email_send_rate_limit/i.test(message)) {
    return 'Too many attempts, try again in a few minutes.';
  }
  if (/expired|invalid.*(token|otp)|(token|otp).*invalid/i.test(message)) {
    return 'That code is wrong or has expired. Check the email and try again.';
  }
  if (/failed to fetch|network|fetch failed/i.test(message)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return 'Something went wrong. Try again in a moment.';
}

/** The one sentence an old or broken sign-in link is allowed to show. */
export const EXPIRED_LINK_MESSAGE = 'This link expired. Sign in with your code instead.';

/**
 * Read the auth parameters Supabase can put in a URL. Old magic-link emails
 * use `?code=` (PKCE) or `#access_token=` (implicit), and failures arrive as
 * `error` / `error_description` in either place.
 */
export function readAuthLink(search = window.location.search, hash = window.location.hash) {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(String(hash).replace(/^#/, ''));
  const get = (key) => query.get(key) || fragment.get(key);
  const error = [get('error'), get('error_code'), get('error_description')]
    .filter(Boolean)
    .join(' ');
  const code = query.get('code');
  const accessToken = fragment.get('access_token');
  const refreshToken = fragment.get('refresh_token');

  return {
    query,
    fragment,
    error,
    code,
    accessToken,
    refreshToken,
    hasAuthParams: Boolean(error || code || accessToken),
  };
}

/** Remove the one-time code, tokens and error text from the address bar. */
export function cleanAuthUrl() {
  window.history.replaceState(null, '', window.location.pathname);
}

/** The message for an error that arrived in the URL, not from verifyOtp. */
export function authLinkError(link) {
  if (!link?.error) return '';
  if (/access_denied|cancelled|canceled/i.test(link.error)) return 'Sign-in was cancelled.';
  return EXPIRED_LINK_MESSAGE;
}

/**
 * Finish a link-based sign-in. `detectSessionInUrl` may already have exchanged
 * a PKCE code by the time this runs, so a failed exchange falls back to the
 * stored session instead of declaring the link dead too early.
 */
export async function finishAuthLink(client, link) {
  if (!client) return { session: null, error: null };

  if (link?.code) {
    const { data } = await client.auth.exchangeCodeForSession(link.code);
    if (data?.session) return { session: data.session, error: null };
  }

  if (link?.accessToken && link?.refreshToken) {
    const { data } = await client.auth.setSession({
      access_token: link.accessToken,
      refresh_token: link.refreshToken,
    });
    if (data?.session) return { session: data.session, error: null };
  }

  // `detectSessionInUrl` runs asynchronously when the client is created. Give
  // it a short window to finish before deciding the link is unusable.
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const { data } = await client.auth.getSession();
    if (data?.session) return { session: data.session, error: null };
    await new Promise((resolve) => window.setTimeout(resolve, 250));
  }

  return { session: null, error: null };
}
