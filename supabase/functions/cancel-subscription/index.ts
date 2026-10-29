import { json, methodNotAllowed, preflight, unauthorized } from '../_shared/http.ts';
import { serviceClient, userFromRequest } from '../_shared/clients.ts';
import { razorpayRequest } from '../_shared/razorpay.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return methodNotAllowed(req);

  try {
    const { user } = await userFromRequest(req);
    if (!user) return unauthorized(req);

    const db = serviceClient();
    const { data: row, error } = await db
      .from('subscriptions')
      .select('plan,status,current_period_end,cancel_at_period_end,provider_subscription_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[cancel-subscription] read failed', error.code ?? 'error');
      return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
    }

    if (!row?.provider_subscription_id || row.plan === 'free') {
      return json(
        req,
        { error: 'no_subscription', message: 'You do not have a paid plan to cancel.' },
        409,
      );
    }

    if (row.status === 'cancelled' || row.status === 'completed') {
      return json(req, {
        ok: true,
        cancel_at_period_end: true,
        current_period_end: row.current_period_end,
      });
    }

    const result = await razorpayRequest(
      'POST',
      `/subscriptions/${encodeURIComponent(String(row.provider_subscription_id))}/cancel`,
      { cancel_at_cycle_end: 1 },
    );

    if (!result.ok) {
      const description = String(result.data?.error?.description ?? '');
      const alreadyDone = /already\s+cancelled|already\s+completed|cannot be cancelled/i.test(
        description,
      );

      if (!alreadyDone) {
        return json(
          req,
          {
            error: 'provider_error',
            message: "We couldn't cancel the plan. Try again, or email billing.",
          },
          502,
        );
      }
    }

    const { error: saveError } = await db
      .from('subscriptions')
      .update({ cancel_at_period_end: true })
      .eq('user_id', user.id);

    if (saveError) {
      console.error('[cancel-subscription] save failed', saveError.code ?? 'error');
      return json(
        req,
        { error: 'server_error', message: 'The plan was cancelled, but the page did not update. Refresh.' },
        500,
      );
    }

    return json(req, {
      ok: true,
      cancel_at_period_end: true,
      current_period_end: row.current_period_end,
    });
  } catch (error) {
    console.error('[cancel-subscription] failed', (error as Error)?.message ?? 'Error');
    return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
  }
});
