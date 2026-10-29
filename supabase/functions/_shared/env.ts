/** Environment access. Missing secrets are named in server logs, never echoed. */

export function env(name: string): string {
  return (Deno.env.get(name) ?? '').trim();
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`Missing secret: ${name}`);
  return value;
}
