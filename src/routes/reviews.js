import { upsertReview, getReviews, getPackageById, getUserById } from '../db.js';
import { getSessionUser } from '../middleware/auth.js';
import { json, error } from '../utils/response.js';

export async function handlePostReview(request, env) {
  const session = await getSessionUser(request, env);
  if (!session) return error('login required', 401);

  const user = await getUserById(env.DB, session.id);
  if (!user || user.is_banned) return error('this account cannot post reviews', 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return error('expected JSON body', 400);
  }

  const { packageType, packageId, stars, comment } = body;
  if (packageType !== 'widget' && packageType !== 'themepack') return error('invalid packageType', 400);

  const starsNum = Number(stars);
  if (!Number.isInteger(starsNum) || starsNum < 1 || starsNum > 5) {
    return error('stars must be an integer from 1 to 5', 400);
  }

  const pkg = await getPackageById(env.DB, packageType, packageId);
  if (!pkg || pkg.status !== 'approved') return error('package not found', 404);

  await upsertReview(env.DB, {
    packageType,
    packageId,
    userId: user.id,
    stars: starsNum,
    comment: (comment || '').toString().slice(0, 2000),
  });

  return json({ ok: true });
}

export async function handleGetReviews(request, env, type, id) {
  if (type !== 'widget' && type !== 'themepack') return error('invalid type', 400);
  return json({ reviews: await getReviews(env.DB, type, id) });
}
