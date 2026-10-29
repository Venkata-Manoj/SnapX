/** Shared billing helpers for the pricing and account pages. */

export const PLAN_NAMES = { free: 'Free', pro: 'Pro', max: 'Max' };

export const planName = (plan) => {
  const key = String(plan || 'free').toLowerCase();
  return PLAN_NAMES[key] || key.charAt(0).toUpperCase() + key.slice(1);
};

/** Razorpay amounts are in paise. */
export function formatMoney(amount, currency = 'INR') {
  const value = Number(amount);
  if (!Number.isFinite(value)) return '';

  const code = /^[A-Z]{3}$/.test(String(currency || '')) ? String(currency) : 'INR';

  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value / 100);
  } catch {
    return `${code} ${value / 100}`;
  }
}

/** Read the JSON body Supabase Functions puts on a failed invoke. */
export async function readFunctionError(error) {
  const response = error?.context;
  if (!response) return { status: 0, code: '', message: '' };

  try {
    const body = await response.clone().json();
    return {
      status: Number(response.status) || 0,
      code: String(body?.error ?? ''),
      message: String(body?.message ?? ''),
    };
  } catch {
    return { status: Number(response.status) || 0, code: '', message: '' };
  }
}
