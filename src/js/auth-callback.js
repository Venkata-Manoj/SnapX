import { supabase } from '../lib/supabase.js';
import {
  appUrl,
  authLinkError,
  cleanAuthUrl,
  EXPIRED_LINK_MESSAGE,
  finishAuthLink,
  readAuthLink,
  safeNext,
} from '../lib/auth.js';

const link = readAuthLink();

const title = document.querySelector('[data-callback-title]');
const message = document.querySelector('[data-callback-message]');
const loading = document.querySelector('[data-callback-loading]');
const statusEl = document.querySelector('[data-callback-status]');
const retry = document.querySelector('[data-callback-retry]');

const next = safeNext(
  link.query.get('next') || link.fragment.get('next'),
  appUrl('account.html'),
);

function showError(text) {
  cleanAuthUrl();

  if (loading) loading.hidden = true;
  if (title) title.textContent = 'That didn’t work.';
  if (message) message.hidden = true;
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.classList.add('is-error');
  }
  if (retry) {
    retry.hidden = false;
    const anchor = retry.querySelector('a');
    if (anchor) {
      anchor.href = `${appUrl('login.html')}?next=${encodeURIComponent(next)}`;
      anchor.textContent = 'Sign in with your code';
    }
  }
}

async function init() {
  if (link.error) {
    showError(authLinkError(link));
    return;
  }

  if (!supabase) {
    showError('Sign-in is not configured on this site yet.');
    return;
  }

  const { session } = await finishAuthLink(supabase, link);

  if (!session) {
    // A code link opened in a different browser has no PKCE verifier. That is
    // the common expired-link case: say exactly what to do instead.
    showError(EXPIRED_LINK_MESSAGE);
    return;
  }

  cleanAuthUrl();

  if (title) title.textContent = 'You’re in.';
  if (message) message.textContent = 'Taking you to your account…';
  if (statusEl) {
    statusEl.textContent = 'Signed in successfully.';
    statusEl.classList.add('is-ok');
  }

  window.location.replace(next);
}

init();
