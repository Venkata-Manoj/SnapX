import {
  authUnavailable,
  json,
  methodNotAllowed,
  preflight,
  sessionInvalid,
  unauthorized,
} from '../_shared/http.ts';
import { serviceClient, userFromRequest } from '../_shared/clients.ts';
import { razorpayRequest } from '../_shared/razorpay.ts';

const ACTIVE_STATES = ['active', 'authenticated', 'pending', 'past_due', 'halted', 'paused'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return preflight(req);
  if (req.method !== 'POST') return methodNotAllowed(req);

  try {
    const { user, reason } = await userFromRequest(req);
    if (!user) {
      if (reason === 'missing_token') return unauthorized(req);
      if (reason === 'unavailable') return authUnavailable(req);
      return sessionInvalid(req);
    }

    const db = serviceClient();
    const { data: row, error } = await db
      .from('subscriptions')
      .select('plan,status,provider_subscription_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) {
      console.error('[delete-account] read failed', error.code ?? 'error');
      return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
    }

    // Stop any future charge before deleting the rows that let us find the
    // subscription. Cancelling at cycle end keeps what the customer paid for.
    if (row?.provider_subscription_id && ACTIVE_STATES.includes(String(row.status ?? ''))) {
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
              error: 'cancel_failed',
              message:
                "We couldn't cancel your plan, so your account was not deleted. Email billing and we will sort it out.",
            },
            502,
          );
        }
      }
    }

    // Profiles and subscriptions cascade. payment_events.user_id is set to null
    // by its foreign key, keeping the anonymised billing record for tax.
    const { error: deleteError } = await db.auth.admin.deleteUser(user.id);

    if (deleteError) {
      console.error('[delete-account] delete failed', deleteError.status ?? 'error');
      return json(
        req,
        { error: 'delete_failed', message: "We couldn't delete the account. Try again in a moment." },
        500,
      );
    }

    return json(req, { ok: true });
  } catch (error) {
    console.error('[delete-account] failed', (error as Error)?.message ?? 'Error');
    return json(req, { error: 'server_error', message: 'Try again in a moment.' }, 500);
  }
});
