/**
 * Shared helpers for the account pages. Everything here is browser-side and
 * assumes the Supabase publishable key, never a secret.
 */

const rawBase = document.body?.dataset.base || '/';

/** Deploy base path, always with a trailing slash. */
export const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

/** Turn a page name into an absolute-path URL inside the deploy base. */
export const appUrl = (path = '') => `${base}${String(path).replace(/^\/+/, '')}`;

/**
 * Only same-origin, absolute-path destinations are allowed. This is the guard
 * against open redirects in `?next=`.
 */
export function safeNext(value, fallback = appUrl('account.html')) {
  if (!value || typeof value !== 'string') return fallback;
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
  azure: 'Microsoft',
  microsoft: 'Microsoft',
  apple: 'Apple',
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
