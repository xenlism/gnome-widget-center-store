// Password hashing via Web Crypto PBKDF2-HMAC-SHA256.
// No external dependency (bcrypt/scrypt are not available in the Workers
// Web Crypto implementation) — PBKDF2 is the standard-native option and
// runs in native code, so it costs sub-millisecond CPU time even at a few
// hundred thousand iterations, comfortably inside the Workers Free plan's
// 10ms CPU budget per request. If you raise ITERATIONS, re-check actual
// CPU time in the Cloudflare dashboard after deploying.
const ITERATIONS = 210000; // OWASP-recommended floor for PBKDF2-SHA256 (2023)
const ALGO = 'pbkdf2';

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

async function deriveHash(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await deriveHash(password, salt, ITERATIONS);
  return `${ALGO}$${ITERATIONS}$${bufToHex(salt)}$${bufToHex(hash)}`;
}

// A format-valid but unusable hash, used to keep verifyPassword()'s
// runtime shape identical when the email lookup misses — this avoids an
// obvious early-return timing/behavior tell that would help an attacker
// enumerate which emails have accounts.
const DUMMY_HASH = `${ALGO}$${ITERATIONS}$00000000000000000000000000000000$0000000000000000000000000000000000000000000000000000000000000000`;

export function dummyHash() {
  return DUMMY_HASH;
}

export async function verifyPassword(password, stored) {
  const parts = (stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== ALGO) return false;
  const iterations = parseInt(parts[1], 10);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = hexToBuf(parts[2]);
  const expectedHex = parts[3];
  const hash = await deriveHash(password, salt, iterations);
  return timingSafeEqualHex(bufToHex(hash), expectedHex);
}

function timingSafeEqualHex(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
