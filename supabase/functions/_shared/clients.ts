import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2';
import { env } from './env.ts';

const url = (): string => env('SUPABASE_URL');

const anonKey = (): string =>
  env('SUPABASE_ANON_KEY') || env('SUPABASE_PUBLISHABLE_KEY');

const serviceKey = (): string =>
  env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SECRET_KEY');

/** Service-role client. Bypasses RLS; server-side only, never returned. */
export function serviceClient(): SupabaseClient {
  return createClient(url(), serviceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Verify the caller's JWT with Supabase Auth. The gateway already checks it
 * when verify_jwt is true; this also gives us the user object and protects the
 * functions if that setting is ever changed.
 */
export async function userFromRequest(
  req: Request,
): Promise<{ user: User | null; client: SupabaseClient | null; reason?: string }> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { user: null, client: null, reason: 'missing_token' };

  const client = createClient(url(), anonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (data?.user) return { user: data.user, client };

  // A missing/zero status, a 5xx or a rate limit means Auth itself is having a
  // bad moment. Only an explicit 401/403 is proof the account is gone.
  const status = Number((error as { status?: number } | null)?.status ?? 0);
  const reason = status === 0 || status === 429 || status >= 500
    ? 'unavailable'
    : 'invalid_token';

  return { user: null, client: null, reason };
}
