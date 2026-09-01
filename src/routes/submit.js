import { insertPackage, getUserById } from '../db.js';
import { getSessionUser } from '../middleware/auth.js';
import { json, error } from '../utils/response.js';
import { slugify, sha256Hex } from '../utils/slug.js';

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB — generous for a widget/theme package

export async function handleSubmit(request, env, type) {
  if (type !== 'widget' && type !== 'themepack') return error('unknown package type', 404);

  const session = await getSessionUser(request, env);
  if (!session) return error('login required', 401);

  // JWTs are stateless, so re-check ban status here (not just at login) —
  // this is the one place a freshly-banned user could otherwise still act
  // on an old, still-valid token.
  const user = await getUserById(env.DB, session.id);
  if (!user || user.is_banned) return error('this account cannot submit packages', 403);
  if (!user.is_email_verified) return error('please verify your email first', 403);

  let form;
  try {
    form = await request.formData();
  } catch {
    return error('expected multipart/form-data', 400);
  }

  const name = (form.get('name') || '').toString().trim();
  const description = (form.get('description') || '').toString().trim().slice(0, 2000);
  const file = form.get('file');

  if (!name) return error('name is required', 400);
  if (!(file instanceof File)) return error('file is required', 400);

  const expectedExt = type === 'widget' ? '.gwcw' : '.gwct';
  if (!file.name.toLowerCase().endsWith(expectedExt)) {
    return error(`file must have a ${expectedExt} extension`, 400);
  }
  if (file.size === 0 || file.size > MAX_FILE_BYTES) {
    return error(`file must be between 1 byte and ${MAX_FILE_BYTES} bytes`, 400);
  }

  const buffer = await file.arrayBuffer();

  let screenshotBase64 = null;
  if (type === 'themepack') {
    let parsed;
    try {
      parsed = JSON.parse(new TextDecoder().decode(buffer));
    } catch {
      return error('.gwct file is not valid JSON', 400);
    }
    if (parsed.format !== 'gwct') return error('not a recognized .gwct theme pack file', 400);
    screenshotBase64 = parsed.screenshot?.base64 ?? null;
  } else {
    // Cheap, dependency-free sanity check that this is at least a zip
    // archive (local file header signature "PK\x03\x04" or empty-archive
    // variants "PK\x05\x06" / "PK\x07\x08").
    const head = new Uint8Array(buffer.slice(0, 4));
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    if (!isZip) return error('.gwcw file must be a zip archive', 400);
  }

  const hash = await sha256Hex(buffer);
  const id = `${slugify(name)}-${crypto.randomUUID().slice(0, 8)}`;
  if (slugify(name).length === 0) return error('name must contain at least one letter or number', 400);

  const r2Key = `${type}s/${id}${expectedExt}`;
  await env.PENDING_BUCKET.put(r2Key, buffer, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });

  let screenshotR2Key = null;
  if (screenshotBase64) {
    try {
      const bin = atob(screenshotBase64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      screenshotR2Key = `screenshots/${id}.png`;
      await env.PENDING_BUCKET.put(screenshotR2Key, bytes, { httpMetadata: { contentType: 'image/png' } });
    } catch {
      screenshotR2Key = null; // a bad embedded screenshot shouldn't fail the whole submission
    }
  }

  try {
    await insertPackage(env.DB, type, {
      id,
      submittedBy: user.id,
      name,
      description,
      version: (form.get('version') || '1.0.0').toString().slice(0, 20),
      shellVersions: safeJsonArrayString(form.get('shellVersions')),
      r2Key,
      screenshotR2Key,
      fileSizeBytes: buffer.byteLength,
      sha256: hash,
      requiredWidgetIds: '[]',
    });
  } catch (e) {
    // Roll back the R2 writes if the D1 insert failed, so we never leak
    // orphaned pending files with no matching database row.
    await env.PENDING_BUCKET.delete(r2Key);
    if (screenshotR2Key) await env.PENDING_BUCKET.delete(screenshotR2Key);
    return error('could not save submission', 500);
  }

  return json({ id, status: 'pending' }, 201);
}

function safeJsonArrayString(value) {
  if (!value) return '[]';
  try {
    const parsed = JSON.parse(value.toString());
    return Array.isArray(parsed) ? JSON.stringify(parsed) : '[]';
  } catch {
    return '[]';
  }
}
