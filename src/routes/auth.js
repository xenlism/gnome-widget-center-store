import {
  getUserByEmail, createUser, markEmailVerified,
  createEmailVerification, getEmailVerification, deleteEmailVerification,
} from '../db.js';
import { hashPassword, verifyPassword, dummyHash } from '../utils/password.js';
import { signJWT } from '../utils/jwt.js';
import { sendVerificationEmail } from '../utils/email.js';
import { json, error } from '../utils/response.js';
import { getSessionUser, setSessionCookie, clearSessionCookie } from '../middleware/auth.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export async function handleRegister(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error('expected JSON body', 400);
  }

  const email = (body.email || '').toString().trim().toLowerCase();
  const password = (body.password || '').toString();
  const displayName = (body.displayName || email.split('@')[0] || 'user').toString().slice(0, 60);

  if (!EMAIL_RE.test(email)) return error('invalid email address', 400);
  if (password.length < 8) return error('password must be at least 8 characters', 400);

  const existing = await getUserByEmail(env.DB, email);
  if (existing) return error('an account with this email already exists', 409);

  const passwordHash = await hashPassword(password);
  const userId = await createUser(env.DB, { email, passwordHash, displayName });

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();
  await createEmailVerification(env.DB, userId, token, expiresAt);

  // Don't make the caller wait on the email provider's round trip.
  ctx.waitUntil(sendVerificationEmail(env, email, token));

  return json({ ok: true, message: 'สมัครสำเร็จ กรุณาตรวจสอบอีเมลเพื่อยืนยันบัญชีก่อนเข้าสู่ระบบ' }, 201);
}

export async function handleVerifyEmail(request, env) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return error('missing token', 400);

  const record = await getEmailVerification(env.DB, token);
  if (!record) return error('invalid or already-used verification link', 400);
  if (new Date(record.expires_at).getTime() < Date.now()) {
    return error('verification link has expired, please register again', 400);
  }

  await markEmailVerified(env.DB, record.user_id);
  await deleteEmailVerification(env.DB, token);

  return json({ ok: true });
}

export async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error('expected JSON body', 400);
  }

  const email = (body.email || '').toString().trim().toLowerCase();
  const password = (body.password || '').toString();

  const user = await getUserByEmail(env.DB, email);
  // Always run a real PBKDF2 comparison, even for an unknown email, so a
  // missing account doesn't return measurably faster than a wrong password.
  const valid = await verifyPassword(password, user ? user.password_hash : dummyHash());

  if (!user || !valid) return error('invalid email or password', 401);
  if (user.is_banned) return error('this account has been suspended', 403);
  if (!user.is_email_verified) return error('please verify your email before logging in', 403);

  const token = await signJWT({ sub: user.id, email: user.email, isAdmin: !!user.is_admin }, env.JWT_SECRET);

  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  setSessionCookie(headers, token);

  return new Response(
    JSON.stringify({
      ok: true,
      user: { id: user.id, email: user.email, displayName: user.display_name, isAdmin: !!user.is_admin },
    }),
    { status: 200, headers }
  );
}

export function handleLogout() {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8' });
  clearSessionCookie(headers);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

export async function handleMe(request, env) {
  const user = await getSessionUser(request, env);
  return json({ user });
}
