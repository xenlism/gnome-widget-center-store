import { verifyJWT } from '../utils/jwt.js';

export const SESSION_COOKIE = 'gwc_session';

function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const cookies = {};
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
}

// Returns { id, email, isAdmin } from a valid session cookie, or null.
// This does NOT hit D1 — the JWT itself carries the claims needed for
// routing decisions, so an authenticated read-only request costs zero
// extra database rows. Routes that need fresh state (e.g. "is this user
// still banned?") look the user up explicitly instead of relying on this.
export async function getSessionUser(request, env) {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  const payload = await verifyJWT(token, env.JWT_SECRET);
  if (!payload) return null;
  return { id: payload.sub, email: payload.email, isAdmin: !!payload.isAdmin };
}

export function setSessionCookie(headers, token) {
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
  );
}

export function clearSessionCookie(headers) {
  headers.append(
    'Set-Cookie',
    `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  );
}
