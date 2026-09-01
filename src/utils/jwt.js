// Minimal HS256 JWT sign/verify using Web Crypto. No jsonwebtoken
// dependency — keeps the Worker bundle small (Free plan caps Worker size
// at 3 MB) and avoids installing anything at all for the auth path.

function b64urlEncodeString(str) {
  const bytes = new TextEncoder().encode(str);
  return b64urlEncodeBytes(bytes);
}

function b64urlEncodeBytes(bytes) {
  let binary = '';
  bytes.forEach((b) => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecodeToBytes(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function b64urlDecodeToString(str) {
  return new TextDecoder().decode(b64urlDecodeToBytes(str));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signJWT(payload, secret, expiresInSeconds = 60 * 60 * 24 * 7) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now, exp: now + expiresInSeconds };

  const headerB64 = b64urlEncodeString(JSON.stringify(header));
  const payloadB64 = b64urlEncodeString(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;

  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  const sigB64 = b64urlEncodeBytes(new Uint8Array(sig));

  return `${data}.${sigB64}`;
}

export async function verifyJWT(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts;
  const data = `${headerB64}.${payloadB64}`;

  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecodeToBytes(sigB64),
    new TextEncoder().encode(data)
  );
  if (!valid) return null;

  let payload;
  try {
    payload = JSON.parse(b64urlDecodeToString(payloadB64));
  } catch {
    return null;
  }
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
  return payload;
}
