import { supabase, authConfigured } from '../lib/supabase.js';
import { appUrl } from '../lib/auth.js';
import { readFunctionError } from '../lib/billing.js';

/**
 * Razorpay Checkout for the pricing page.
 *
 * The build renders each paid CTA as a link to /login.html?next=/pricing.html#pro
 * (or #max). Signed out, the link does its normal job. Signed in, this script
 * intercepts the click, asks create-subscription for a subscription id, and
 * opens Razorpay Checkout.
 *
 * The checkout handler is not proof of payment. After it fires we poll the
 * user's own subscriptions row until the webhook marks the plan active.
 */

const PLAN_NAMES = { pro: 'Pro', max: 'Max' };
const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 30000;

const statusEl = document.querySelector('[data-checkout-status]');
const buttons = [...document.querySelectorAll('[data-checkout]')];

let session = null;
let busy = false;
let currentButton = null;
let outcome = '';

function setStatus(message, kind = '') {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle('is-error', kind === 'error');
  statusEl.classList.toggle('is-ok', kind === 'ok');
}

function setButtonBusy(button, isBusy, label = 'Opening checkout…') {
  if (!button) return;
  if (isBusy) {
    if (!button.dataset.label) button.dataset.label = button.textContent;
    button.textContent = label;
    button.setAttribute('aria-disabled', 'true');
    button.setAttribute('aria-busy', 'true');
    button.classList.add('is-busy');
    return;
  }

  if (button.dataset.label) {
    button.textContent = button.dataset.label;
    delete button.dataset.label;
  }
  button.removeAttribute('aria-disabled');
  button.removeAttribute('aria-busy');
  button.classList.remove('is-busy');
}

function restoreButtons() {
  buttons.forEach((button) => setButtonBusy(button, false));
}

/**
 * After a payment (or when the user already has a plan), the CTA stops being a
 * checkout trigger and becomes the way to the account page. A second click must
 * not create a second subscription.
 */
function offerManage() {
  if (!currentButton) return;
  currentButton.textContent = 'Manage your plan';
  currentButton.href = appUrl('account.html');
  currentButton.removeAttribute('data-checkout');
  currentButton.removeAttribute('aria-disabled');
  currentButton.removeAttribute('aria-busy');
  currentButton.classList.remove('is-busy', 'btn--primary');
  currentButton.classList.add('btn--secondary');
}

function goToLogin(plan) {
  const next = encodeURIComponent(`${window.location.pathname}#${plan}`);
  window.location.assign(`${appUrl('login.html')}?next=${next}`);
}

let razorpayLoader = null;

function loadRazorpay() {
  if (typeof window.Razorpay === 'function') return Promise.resolve();
  if (razorpayLoader) return razorpayLoader;

  razorpayLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-razorpay-checkout]');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('checkout script failed')));
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://checkout.razorpay.com/v1/checkout.js';
    script.async = true;
    script.dataset.razorpayCheckout = 'true';
    script.referrerPolicy = 'no-referrer';
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('checkout script failed')));
    document.head.append(script);
  }).catch((error) => {
    razorpayLoader = null;
    throw error;
  });

  return razorpayLoader;
}

function themeColour() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ver').trim();
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#c8432a';
}

async function confirmPayment(plan) {
  setStatus('Confirming your payment…');
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const { data, error } = await supabase
      .from('subscriptions')
      .select('plan,status')
      .eq('user_id', session.user.id)
      .maybeSingle();

    const active = data && data.plan === plan && ['active', 'authenticated'].includes(String(data.status));

    if (!error && active) {
      outcome = 'paid';
      busy = false;
      setStatus(`You're on ${PLAN_NAMES[plan]}. Your plan is active.`, 'ok');

      offerManage();
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS));
  }

  outcome = 'pending';
  busy = false;
  setStatus('Payment received, activating shortly. Refresh your account page in a minute.');

  // The handler fired, so treat the payment as taken: point the CTA at the
  // account page instead of allowing a second subscription to be created.
  offerManage();
}

async function startCheckout(plan, button) {
  if (!supabase || busy) return;
  if (!PLAN_NAMES[plan]) return;

  busy = true;
  outcome = '';
  currentButton = button;
  setButtonBusy(button, true);
  setStatus('Opening secure checkout…');

  let response;
  try {
    response = await supabase.functions.invoke('create-subscription', { body: { plan } });
  } catch {
    busy = false;
    restoreButtons();
    setStatus("Checkout couldn't start. Check your connection and try again.", 'error');
    return;
  }

  if (response.error) {
    const info = await readFunctionError(response.error);
    busy = false;
    restoreButtons();

    if (info.status === 401) {
      goToLogin(plan);
      return;
    }

    // A stale or revoked session can fail the token refresh before the function
    // answers, so there is no 401 to read. Send the user to sign in again.
    const { data: current } = await supabase.auth.getSession();
    if (!current.session) {
      goToLogin(plan);
      return;
    }

    if (info.status === 409) {
      setStatus(
        info.message || 'You already have a plan. Manage or cancel it from your account page.',
        'ok',
      );
      offerManage();
      return;
    }

    setStatus(
      info.message || "Checkout couldn't start. Try again in a moment.",
      'error',
    );
    return;
  }

  const key = String(response.data?.key_id ?? '');
  const subscriptionId = String(response.data?.subscription_id ?? '');

  if (!key || !subscriptionId) {
    busy = false;
    restoreButtons();
    setStatus("Checkout couldn't start. Try again in a moment.", 'error');
    return;
  }

  try {
    await loadRazorpay();
  } catch {
    busy = false;
    restoreButtons();
    setStatus('The payment window could not load. Check your connection and try again.', 'error');
    return;
  }

  const checkout = new window.Razorpay({
    key,
    subscription_id: subscriptionId,
    name: document.body.dataset.brand || 'SnapX',
    description: `${PLAN_NAMES[plan]} plan, monthly`,
    prefill: { email: session?.user?.email || '' },
    theme: { color: themeColour() },
    handler: () => {
      outcome = 'confirming';
      confirmPayment(plan);
    },
    modal: {
      ondismiss: () => {
        if (outcome) return;
        busy = false;
        restoreButtons();
        setStatus('Checkout closed. Nothing was charged.');
      },
    },
  });

  checkout.on('payment.failed', () => {
    outcome = 'failed';
    busy = false;
    restoreButtons();
    setStatus('That payment did not go through. Nothing was charged; you can try again.', 'error');
  });

  checkout.open();
}

async function init() {
  if (!buttons.length) return;

  if (!authConfigured || !supabase) {
    setStatus('Payments are not configured on this site yet.', 'error');
    return;
  }

  const { data } = await supabase.auth.getSession();
  session = data.session ?? null;

  buttons.forEach((button) => {
    button.addEventListener('click', (event) => {
      // Signed out, or already subscribed: let the link do its normal job.
      const plan = button.dataset.checkout;
      if (!session || !PLAN_NAMES[plan]) return;
      event.preventDefault();
      startCheckout(plan, button);
    });
  });

  // Returning from sign-in lands on /pricing.html#pro. Start that checkout once;
  // a refresh within 30 seconds does not reopen the modal.
  const plan = window.location.hash.replace('#', '');
  if (!session || !PLAN_NAMES[plan]) return;

  const key = `snapx:checkout:${plan}`;
  let last = 0;
  try {
    last = Number(window.sessionStorage.getItem(key) || 0);
  } catch {
    last = 0;
  }
  if (Date.now() - last < 30000) return;

  try {
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // Storage can be blocked; opening once is still better than not opening.
  }

  const button = document.querySelector(`[data-checkout="${plan}"]`);
  if (button) startCheckout(plan, button);
}

init();
