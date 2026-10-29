/** Ed25519 compact token signing for the entitlement endpoint. */

const encoder = new TextEncoder();

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlJson(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  // Secrets set from a shell often contain literal \n rather than newlines.
  const normalised = pem.replace(/\\n/g, '\n').trim();
  const body = normalised
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');

  if (!body) throw new Error('ENTITLEMENT_PRIVATE_KEY is empty');

  const der = Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
  return await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
}

/** Sign { sub, plan, status, exp, iat } as header.payload.signature. */
export async function signEntitlement(
  payload: Record<string, unknown>,
  privateKeyPem: string,
): Promise<string> {
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const key = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    key,
    encoder.encode(signingInput),
  );

  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}
