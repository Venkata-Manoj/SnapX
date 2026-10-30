import { json, methodNotAllowed, preflight, unauthorized } from '../_shared/http.ts';
import { serviceClient, userFromRequest } from '../_shared/clients.ts';
import { requireEnv } from '../_shared/env.ts';
import { signEntitlement } from '../_shared/token.ts';
import { entitlementFor } from '../_shared/webhook.ts';

/**
 * Issues the signed plan pass the extension verifies.
 *
 * Contract: docs/PLAN_PASS_CONTRACT.md §2 and §3.
 * - the plan comes from the server-side row, never from the request;
 * - the only client input is the install id, and it is echoed into the pass so
 *   a pass minted for one browser cannot be replayed in another;
 * - paid, active and safe to renew -> exp = min(now + 35 days,
 *   current_period_end + 3 days); every other paid case -> exp =
 *   min(now + 35 days, current_period_end); Free -> now + 35 days.
 */

const INSTALL_ID = /^[0-9a-f]{32}$/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return methodNotAllowed(req);

  try {
    const { user } = await userFromRequest(req);
    if (!user) return unauthorized(req);

    const body = await req.json().catch(() => ({}));
    const iid = typeof body?.iid === 'string' ? body.iid : '';
    if (!INSTALL_ID.test(iid)) {
      return json(
        req,
        { error: 'bad_iid', message: 'A 32-character install id is required.' },
        400,
      );
    }

    const db = serviceClient();
    const { data: row, error } = await db
      .from('subscriptions')
      .select(
        'plan,status,current_period_end,cancel_at_period_end,pending_plan,pending_plan_at,provider_subscription_id,pending_subscription_id,last_payment_id,last_payment_reversed_at',
      )
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[entitlement] read failed', error.code ?? 'error');
      return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
    }

    const now = Math.floor(Date.now() / 1000);
    const { plan, exp } = entitlementFor(row, now);

    const payload = { v: 1, aud: 'snapx-ext', sub: user.id, plan, iid, iat: now, exp };

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

    return json(req, { token, plan, exp });
  } catch (error) {
    console.error('[entitlement] failed', (error as Error)?.message ?? 'Error');
    return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
  }
});
