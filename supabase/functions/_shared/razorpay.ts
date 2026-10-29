import { env, requireEnv } from './env.ts';
import { hmacSha256Hex, timingSafeEqual } from './webhook.ts';

const API = 'https://api.razorpay.com/v1';

export type RazorpayResult = {
  ok: boolean;
  status: number;
  data: any;
};

export function razorpayKeyId(): string {
  return requireEnv('RAZORPAY_KEY_ID');
}

export function planIdFor(plan: 'pro' | 'max'): string {
  return requireEnv(plan === 'pro' ? 'RAZORPAY_PLAN_PRO' : 'RAZORPAY_PLAN_MAX');
}

export function planIds(): { pro: string; max: string } {
  return { pro: env('RAZORPAY_PLAN_PRO'), max: env('RAZORPAY_PLAN_MAX') };
}

/**
 * One Razorpay API call with Basic auth. Non-2xx responses are returned, not
 * thrown, so callers can map them to a user-facing message. The key secret is
 * never logged or returned.
 */
export async function razorpayRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<RazorpayResult> {
  const keyId = requireEnv('RAZORPAY_KEY_ID');
  const keySecret = requireEnv('RAZORPAY_KEY_SECRET');
  const authorization = `Basic ${btoa(`${keyId}:${keySecret}`)}`;

  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    console.error('[razorpay] network error', method, path, (error as Error)?.name ?? 'Error');
    return { ok: false, status: 0, data: { error: { description: 'network_error' } } };
  }

  let data: any = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    console.error(
      '[razorpay]',
      method,
      path,
      response.status,
      data?.error?.code ?? 'error',
    );
  }

  return { ok: response.ok, status: response.status, data };
}

/** HMAC-SHA256 of the raw body, compared to X-Razorpay-Signature in constant time. */
export async function verifyWebhookSignature(
  rawBody: string,
  signature: string | null,
): Promise<boolean> {
  const secret = requireEnv('RAZORPAY_WEBHOOK_SECRET');
  if (!signature) return false;

  const expected = await hmacSha256Hex(rawBody, secret);
  return timingSafeEqual(expected, signature.trim().toLowerCase());
}
