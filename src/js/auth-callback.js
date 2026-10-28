import { supabase } from '../lib/supabase.js';
import { appUrl, authErrorMessage, safeNext } from '../lib/auth.js';

const params = new URLSearchParams(window.location.search);
const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));

const title = document.querySelector('[data-callback-title]');
const message = document.querySelector('[data-callback-message]');
const loading = document.querySelector('[data-callback-loading]');
const statusEl = document.querySelector('[data-callback-status]');
const retry = document.querySelector('[data-callback-retry]');

const next = safeNext(params.get('next') || hash.get('next'), appUrl('account.html'));

const friendly = (raw) => {
  if (/access_denied|cancelled|canceled/i.test(raw)) return 'Sign-in was cancelled.';
  if (/expired|invalid/i.test(raw)) {
    return 'That sign-in link has expired or was already used. Try again.';
  }
  return raw;
};

function showError(text) {
  if (loading) loading.hidden = true;
  if (title) title.textContent = 'That didn’t work.';
  if (message) message.hidden = true;
  if (statusEl) {
    statusEl.textContent = text;
    statusEl.classList.add('is-error');
  }
  if (retry) {
    retry.hidden = false;
    const link = retry.querySelector('a');
    if (link) link.href = `${appUrl('login.html')}?next=${encodeURIComponent(next)}`;
  }
}

async function init() {
  const urlError =
    params.get('error_description') ||
    hash.get('error_description') ||
    params.get('error') ||
    hash.get('error');

  if (urlError) {
    showError(friendly(urlError));
    return;
  }

  if (!supabase) {
    showError('Sign-in is not configured on this site yet.');
    return;
  }

  const { data, error } = await supabase.auth.getSession();

  if (error) {
    showError(authErrorMessage(error));
    return;
  }

  if (!data.session) {
    showError('We could not finish signing you in. The link may have expired.');
    return;
  }

  if (title) title.textContent = 'You’re in.';
  if (message) message.textContent = 'Taking you to your account…';
  if (statusEl) {
    statusEl.textContent = 'Signed in successfully.';
    statusEl.classList.add('is-ok');
  }

  window.location.replace(next);
}

init();
