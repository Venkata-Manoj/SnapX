/** CORS and JSON responses shared by every browser-facing function. */

const DEFAULT_ORIGINS = [
  'https://snap-x-beta.vercel.app',
  // The dev server and preview server. These cannot be claimed by a remote
  // site: a browser sets Origin from the page it actually loaded.
  'http://localhost:5173',
  'http://localhost:4173',
];

function allowedOrigins(): string[] {
  const configured = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return configured.length ? configured : DEFAULT_ORIGINS;
}

/**
 * Reflect only a known origin. No wildcard and no `*.vercel.app` pattern: any
 * attacker can deploy to a vercel.app subdomain, so the pattern would let an
 * arbitrary site call these functions with the visitor's credentials.
 * Preview deployments must be listed in ALLOWED_ORIGINS.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = allowedOrigins().includes(origin);

  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };

  if (allowed) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function preflight(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

export function methodNotAllowed(req: Request): Response {
  return json(req, { error: 'method_not_allowed' }, 405);
}

export function unauthorized(req: Request): Response {
  return json(req, { error: 'unauthorized', message: 'Sign in to continue.' }, 401);
}

/**
 * A token was sent, but the Auth server no longer knows the user. This is the
 * deleted-account case: the browser must clear its stored session.
 */
export function sessionInvalid(req: Request): Response {
  return json(req, { error: 'session_invalid' }, 401);
}

/** Auth could not be reached. Do not tell the browser its session is dead. */
export function authUnavailable(req: Request): Response {
  return json(
    req,
    { error: 'auth_unavailable', message: 'Try again in a moment.' },
    503,
  );
}
