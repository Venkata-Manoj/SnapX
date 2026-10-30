/**
 * Razorpay Checkout loader, shared by the pricing and account pages.
 *
 * The script is only fetched when a checkout is about to open, never at page
 * load, so it stays out of the initial bundle and off the critical path.
 */

let loader = null;

export function loadRazorpay() {
  if (typeof window.Razorpay === 'function') return Promise.resolve();
  if (loader) return loader;

  loader = new Promise((resolve, reject) => {
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
    loader = null;
    throw error;
  });

  return loader;
}

/** The brand vermilion, read from the live theme so it cannot drift. */
export function themeColour() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--ver').trim();
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : '#c8432a';
}
