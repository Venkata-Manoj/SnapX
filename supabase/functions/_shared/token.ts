/**
 * Ed25519 plan-pass signing.
 *
 * The token format is fixed by docs/PLAN_PASS_CONTRACT.md:
 *
 *   token = b64url(payloadJSON) + "." + b64url(ed25519_sign(ascii(b64url(payloadJSON))))
 *
 * Two parts, no JWT header. The extension verifies exactly this and rejects a
 * three-part token before it even checks the signature.
 *
 * ENTITLEMENT_PRIVATE_KEY is exactly the 64-character hex Ed25519 seed from
 * `pass-private.hex` (32 bytes). No PEM, PKCS8, JWK or base64 form is accepted:
 * a malformed secret must fail loudly rather than be guessed at.
 */

const encoder = new TextEncoder();

/** DER prefix for an Ed25519 PKCS8 private key; the 32-byte seed follows it. */
const PKCS8_ED25519_PREFIX = new Uint8Array([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlJson(value: unknown): string {
  return base64Url(encoder.encode(JSON.stringify(value)));
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function importPrivateKey(value: string): Promise<CryptoKey> {
  const seed = String(value ?? '').trim();
  if (!/^[0-9a-f]{64}$/i.test(seed)) {
    throw new Error('ENTITLEMENT_PRIVATE_KEY must be a 64-character hex Ed25519 seed');
  }

  const der = new Uint8Array(PKCS8_ED25519_PREFIX.length + 32);
  der.set(PKCS8_ED25519_PREFIX);
  der.set(hexToBytes(seed), PKCS8_ED25519_PREFIX.length);

  return await crypto.subtle.importKey('pkcs8', der, { name: 'Ed25519' }, false, ['sign']);
}

/** Sign the contract payload as a two-part compact pass. */
export async function signEntitlement(
  payload: Record<string, unknown>,
  privateKey: string,
): Promise<string> {
  const body = base64UrlJson(payload);
  const key = await importPrivateKey(privateKey);
  const signature = await crypto.subtle.sign({ name: 'Ed25519' }, key, encoder.encode(body));
  return `${body}.${base64Url(new Uint8Array(signature))}`;
}
