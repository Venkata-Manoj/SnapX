/** CORS and JSON responses shared by every browser-facing function. */

const DEFAULT_ORIGINS = [
  'https://snap-x-beta.vercel.app',
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
 * Reflect only a known origin (or a Vercel preview). No wildcard: the functions
 * are called with an Authorization header and should not answer arbitrary sites.
 */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed =
    allowedOrigins().includes(origin) ||
    /^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(origin);

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
