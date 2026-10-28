import { createClient } from '@supabase/supabase-js';

/**
 * The publishable key is designed to be shipped to the browser. A secret or
 * service-role key must never appear here. Row-level security does the real
 * access control on the database.
 */
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const authConfigured = Boolean(url && key);

export const supabase = authConfigured
  ? createClient(url, key, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
