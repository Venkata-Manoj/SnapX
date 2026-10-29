import { json, methodNotAllowed, preflight, unauthorized } from '../_shared/http.ts';
import { serviceClient, userFromRequest } from '../_shared/clients.ts';
import { requireEnv } from '../_shared/env.ts';
import { signEntitlement } from '../_shared/token.ts';
import { effectivePlan } from '../_shared/webhook.ts';

const WEEK_SECONDS = 7 * 24 * 60 * 60;

/**
 * Returns a short-lived Ed25519 token the extension can verify with the public
 * key. The plan is resolved from the server-side row, never from the request.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return methodNotAllowed(req);

  try {
    const { user } = await userFromRequest(req);
    if (!user) return unauthorized(req);

    const db = serviceClient();
    const { data: row, error } = await db
      .from('subscriptions')
      .select('plan,status,current_period_end')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[entitlement] read failed', error.code ?? 'error');
      return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const plan = effectivePlan(row, Date.now());
    const status = String(row?.status ?? 'active');
    const payload = {
      sub: user.id,
      plan,
      status,
      exp: now + WEEK_SECONDS,
      iat: now,
    };

    let token: string;
    try {
      token = await signEntitlement(payload, requireEnv('ENTITLEMENT_PRIVATE_KEY'));
    } catch (signError) {
      console.error('[entitlement] signing failed', (signError as Error)?.message ?? 'Error');
      return json(
        req,
        { error: 'signing_failed', message: 'Entitlement is not configured yet.' },
        500,
      );
    }

    return json(req, { token, plan, status, exp: payload.exp });
  } catch (error) {
    console.error('[entitlement] failed', (error as Error)?.message ?? 'Error');
    return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
  }
});
