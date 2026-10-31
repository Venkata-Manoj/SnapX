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

/* ---------- Session truth and sign-out ---------- */

/**
 * The pages that exist only for a signed-in user. Matched by clean path, so
 * `/account` and `/account.html` are the same page, with or without a deploy
 * base.
 */
const PRIVATE_PAGES = new Set(['account']);

/** Page name without the deploy base, a trailing slash or `.html`. */
function pageName(pathname = window.location.pathname) {
  let path = String(pathname || '/');
  if (path.startsWith(base)) path = path.slice(base.length);
  path = path.replace(/\/+$/, '').replace(/\.html$/i, '');
  return (path.split('/').filter(Boolean).pop() || 'index').toLowerCase();
}

export const isPrivatePage = (pathname) => PRIVATE_PAGES.has(pageName(pathname));

const ENDED_GUARD_KEY = 'snapx:signed-out-at';
const ENDED_GUARD_MS = 5000;

function markSignedOutNavigation() {
  try {
    window.sessionStorage.setItem(ENDED_GUARD_KEY, String(Date.now()));
  } catch {
    // Storage can be blocked; navigation still happens once per page.
  }
}

function recentlySignedOut() {
  try {
    const last = Number(window.sessionStorage.getItem(ENDED_GUARD_KEY) || 0);
    return Number.isFinite(last) && Date.now() - last < ENDED_GUARD_MS;
  } catch {
    return false;
  }
}

/** Where a sign-out lands, shared by this tab and every other open tab. */
function navigateAfterSignOut(reason) {
  if (typeof window === 'undefined') return;

  if (reason === 'ended') {
    window.location.replace(`${appUrl('login.html')}?ended=1`);
    return;
  }

  if (isPrivatePage()) {
    window.location.replace(appUrl(''));
    return;
  }

  window.location.reload();
}

/**
 * Errors that mean the account itself is gone or the session is unusable.
 * A network failure, a 5xx or a rate limit is never in this set: those keep
 * the stored session, because Wi-Fi dropping is not a sign-out.
 */
const FATAL_AUTH_CODES = new Set([
  'user_not_found',
  'session_not_found',
  'bad_jwt',
  'refresh_token_not_found',
  'invalid_jwt',
]);

function isFatalAuthError(error) {
  const status = Number(error?.status || 0);
  if (status === 401 || status === 403) return true;

  const code = String(error?.code || '');
  if (FATAL_AUTH_CODES.has(code)) return true;

  return false;
}

let signingOut = false;

/** Remove cached plan and account state; never touch the auth token itself. */
function clearCachedAccount() {
  try {
    const keys = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (key?.startsWith('snapx:')) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    // Storage can be blocked; nothing to clear then.
  }
}

/**
 * The one sign-out path. Order matters: the extension is told while the page
 * still has a session, the local session is cleared even if the server call
 * fails (a deleted user cannot complete a normal signOut), and only then does
 * the page navigate.
 */
export async function hardSignOut(reason = 'user') {
  if (signingOut) return;
  signingOut = true;

  try {
    const { signOutExtension } = await import('../extension-bridge.js');
    await signOutExtension(1500);
  } catch {
    // No bridge on this page; the rest of the sign-out still has to happen.
  }

  try {
    const { supabase } = await import('./supabase.js');
    if (supabase) {
      try {
        await supabase.auth.signOut();
      } catch {
        // The user may already be deleted, or the network may be down.
      }
      try {
        await supabase.auth.signOut({ scope: 'local' });
      } catch {
        // The local token is already gone.
      }
    }
  } catch {
    // Supabase is not configured on this deploy.
  }

  clearCachedAccount();

  try {
    const { clearBridgeState } = await import('../extension-bridge.js');
    clearBridgeState();
  } catch {
    // The bridge was never loaded.
  }

  navigateAfterSignOut(reason);
}

/**
 * Prove the stored session against the Auth server before showing account
 * data. `getSession()` only reads localStorage, so a deleted user keeps a
 * locally valid JWT until something round-trips. Anything short of an explicit
 * auth error keeps the session: offline is not signed out.
 */
export async function validateSession() {
  let supabase = null;
  try {
    ({ supabase } = await import('./supabase.js'));
  } catch {
    return { status: 'offline', session: null, user: null };
  }
  if (!supabase) return { status: 'unconfigured', session: null, user: null };

  const { data: stored, error: storageError } = await supabase.auth.getSession();
  if (storageError) {
    // An expired refresh token is fatal: the Auth server will never accept this
    // session again. A network error is not, and must keep the stored session.
    if (isFatalAuthError(storageError)) {
      await hardSignOut('ended');
      return { status: 'ended', session: null, user: null };
    }
    return { status: 'offline', session: null, user: null };
  }

  const session = stored?.session ?? null;
  if (!session) return { status: 'signed_out', session: null, user: null };

  let result;
  try {
    result = await supabase.auth.getUser();
  } catch {
    return { status: 'offline', session, user: session.user };
  }

  if (result?.data?.user) {
    return { status: 'valid', session, user: result.data.user };
  }

  if (isFatalAuthError(result?.error)) {
    await hardSignOut('ended');
    return { status: 'ended', session: null, user: null };
  }

  return { status: 'offline', session, user: session.user };
}

let watchBound = false;

/**
 * One watcher for every page: another tab's sign-out follows the same
 * navigation rule, and a tab that comes back from the background or bfcache
 * re-checks the session. `validateSession` itself is idempotent, so calling
 * this from more than one module is safe.
 */
export function watchAuth() {
  if (watchBound || typeof window === 'undefined') return;
  watchBound = true;

  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    void validateSession();
  };

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) void validateSession();
  });

  import('./supabase.js')
    .then(({ supabase }) => {
      if (!supabase) return;

      let hadSession = null;

      supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          hadSession = Boolean(session);
          return;
        }

        if (event !== 'SIGNED_OUT' || signingOut || hadSession === false) return;
        if (recentlySignedOut()) return;

        markSignedOutNavigation();
        navigateAfterSignOut('user');
      });
    })
    .catch(() => {
      // No client on this page: the header stays signed out.
    });
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
