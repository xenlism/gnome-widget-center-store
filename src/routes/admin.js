import {
  getPendingPackages, getPackageById, setPackageKeys, setPackageStatus,
  listUsers, setUserBanned, updateUserProfile, softRemoveUser, getUserByEmail, createUser, getUserById,
  deleteReviewById,
} from '../db.js';
import { getSessionUser } from '../middleware/auth.js';
import { json, error } from '../utils/response.js';
import { regenerateCatalog } from '../catalog.js';
import { hashPassword } from '../utils/password.js';

async function requireAdmin(request, env) {
  const session = await getSessionUser(request, env);
  if (!session) return { err: error('login required', 401) };
  if (!session.isAdmin) return { err: error('admin only', 403) };
  return { session };
}

// ---------------------------------------------------------------------
// review queue
// ---------------------------------------------------------------------
export async function handlePending(request, env) {
  const { err } = await requireAdmin(request, env);
  if (err) return err;
  return json(await getPendingPackages(env.DB));
}

// Lets an admin inspect a submission before approving it. Deliberately
// gated behind admin auth and reading from the PRIVATE pending bucket —
// unreviewed widget code must never be reachable from the public R2
// custom domain, since a .gwcw's widget.js runs unsandboxed inside the
// user's GNOME Shell process once installed.
export async function handleAdminDownload(request, env, type, id) {
  const { err } = await requireAdmin(request, env);
  if (err) return err;
  if (type !== 'widget' && type !== 'themepack') return error('unknown type', 404);

  const pkg = await getPackageById(env.DB, type, id);
  if (!pkg) return error('not found', 404);

  const object = await env.PENDING_BUCKET.get(pkg.r2_key);
  if (!object) return error('file missing from storage', 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${pkg.id}"`,
    },
  });
}

export async function handleApprove(request, env, ctx, type, id) {
  const { session, err } = await requireAdmin(request, env);
  if (err) return err;
  if (type !== 'widget' && type !== 'themepack') return error('unknown type', 404);

  const pkg = await getPackageById(env.DB, type, id);
  if (!pkg) return error('not found', 404);
  if (pkg.status === 'approved') return json({ id, status: 'approved' });

  const source = await env.PENDING_BUCKET.get(pkg.r2_key);
  if (!source) return error('source file missing from storage', 500);
  await env.PUBLIC_BUCKET.put(pkg.r2_key, source.body, { httpMetadata: source.httpMetadata });
  await env.PENDING_BUCKET.delete(pkg.r2_key);

  let publicScreenshotKey = null;
  if (pkg.screenshot_r2_key) {
    const shot = await env.PENDING_BUCKET.get(pkg.screenshot_r2_key);
    if (shot) {
      publicScreenshotKey = pkg.screenshot_r2_key;
      await env.PUBLIC_BUCKET.put(publicScreenshotKey, shot.body, { httpMetadata: shot.httpMetadata });
      await env.PENDING_BUCKET.delete(pkg.screenshot_r2_key);
    }
  }

  await setPackageKeys(env.DB, type, id, { r2Key: pkg.r2_key, screenshotR2Key: publicScreenshotKey });
  await setPackageStatus(env.DB, type, id, 'approved', session.id);

  ctx.waitUntil(regenerateCatalog(env));

  return json({ id, status: 'approved' });
}

export async function handleReject(request, env, type, id) {
  const { session, err } = await requireAdmin(request, env);
  if (err) return err;
  if (type !== 'widget' && type !== 'themepack') return error('unknown type', 404);

  const pkg = await getPackageById(env.DB, type, id);
  if (!pkg) return error('not found', 404);

  let reason = '';
  try {
    const body = await request.json();
    reason = (body.reason || '').toString().slice(0, 500);
  } catch {
    // reason is optional
  }

  await env.PENDING_BUCKET.delete(pkg.r2_key);
  if (pkg.screenshot_r2_key) await env.PENDING_BUCKET.delete(pkg.screenshot_r2_key);
  await setPackageStatus(env.DB, type, id, 'rejected', session.id, reason);

  return json({ id, status: 'rejected' });
}

// ---------------------------------------------------------------------
// user management
// ---------------------------------------------------------------------
export async function handleListUsers(request, env) {
  const { err } = await requireAdmin(request, env);
  if (err) return err;
  return json({ users: await listUsers(env.DB) });
}

export async function handleCreateUser(request, env) {
  const { err } = await requireAdmin(request, env);
  if (err) return err;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('expected JSON body', 400);
  }

  const email = (body.email || '').toString().trim().toLowerCase();
  const password = (body.password || '').toString();
  const displayName = (body.displayName || email.split('@')[0] || 'user').toString().slice(0, 60);
  const isAdmin = !!body.isAdmin;

  if (!email || password.length < 8) return error('email and an 8+ character password are required', 400);
  if (await getUserByEmail(env.DB, email)) return error('a user with this email already exists', 409);

  const passwordHash = await hashPassword(password);
  // Admin-created accounts are pre-verified — they were vetted by a human,
  // not a self-serve signup, so there's no phishing/spam reason to gate
  // them behind email confirmation.
  const userId = await createUser(env.DB, { email, passwordHash, displayName, isAdmin, isEmailVerified: true });

  return json({ id: userId, email, displayName, isAdmin }, 201);
}

export async function handleUpdateUser(request, env, userId) {
  const { err } = await requireAdmin(request, env);
  if (err) return err;

  let body;
  try {
    body = await request.json();
  } catch {
    return error('expected JSON body', 400);
  }

  if (typeof body.isBanned === 'boolean') {
    await setUserBanned(env.DB, userId, body.isBanned);
  }
  if (typeof body.displayName === 'string' || typeof body.isAdmin === 'boolean') {
    // Fetch current values first — updateUserProfile writes both columns
    // unconditionally, so a partial patch (e.g. { isAdmin: true } alone)
    // must not blank out the other field.
    const current = await getUserById(env.DB, userId);
    if (!current) return error('user not found', 404);
    await updateUserProfile(env.DB, userId, {
      displayName: typeof body.displayName === 'string' ? body.displayName.slice(0, 60) : current.display_name,
      isAdmin: typeof body.isAdmin === 'boolean' ? body.isAdmin : !!current.is_admin,
    });
  }

  return json({ ok: true });
}

export async function handleRemoveUser(request, env, userId) {
  const { err } = await requireAdmin(request, env);
  if (err) return err;
  await softRemoveUser(env.DB, userId);
  return json({ ok: true });
}

// ---------------------------------------------------------------------
// review moderation
// ---------------------------------------------------------------------
export async function handleDeleteReview(request, env, reviewId) {
  const { err } = await requireAdmin(request, env);
  if (err) return err;
  const removed = await deleteReviewById(env.DB, reviewId);
  if (!removed) return error('review not found', 404);
  return json({ ok: true });
}
