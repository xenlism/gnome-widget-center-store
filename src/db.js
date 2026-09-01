// All D1 queries live in this file. `type` arguments below are always
// pre-validated by the caller (route layer) against the literal set
// ['widget', 'themepack'] before reaching here, so the string
// interpolation used for table names is not attacker-controlled.

function tableFor(type) {
  return type === 'widget' ? 'widgets' : 'themepacks';
}

// ---------------------------------------------------------------------
// users
// ---------------------------------------------------------------------
export async function getUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

export async function getUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function createUser(db, { email, passwordHash, displayName, isAdmin = false, isEmailVerified = false }) {
  const result = await db
    .prepare(
      `INSERT INTO users (email, password_hash, display_name, is_admin, is_email_verified)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(email, passwordHash, displayName, isAdmin ? 1 : 0, isEmailVerified ? 1 : 0)
    .run();
  return result.meta.last_row_id;
}

export async function markEmailVerified(db, userId) {
  await db
    .prepare('UPDATE users SET is_email_verified = 1 WHERE id = ?')
    .bind(userId)
    .run();
}

export async function listUsers(db, { limit = 100, offset = 0 } = {}) {
  const result = await db
    .prepare(
      `SELECT id, email, display_name, is_admin, is_banned, is_email_verified, created_at
       FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .bind(limit, offset)
    .all();
  return result.results;
}

export async function setUserBanned(db, userId, banned) {
  await db.prepare('UPDATE users SET is_banned = ? WHERE id = ?').bind(banned ? 1 : 0, userId).run();
}

export async function updateUserProfile(db, userId, { displayName, isAdmin }) {
  await db
    .prepare('UPDATE users SET display_name = ?, is_admin = ? WHERE id = ?')
    .bind(displayName, isAdmin ? 1 : 0, userId)
    .run();
}

// "Remove" a user without breaking foreign-key references from their past
// submissions/reviews: scrub personal data and ban the login, rather than
// DELETE (which would fail — SQLite raises a foreign key error since
// widgets/themepacks/reviews all reference users.id, and hard-deleting
// would also silently erase authorship history other users may rely on,
// e.g. "submitted by ..." on an approved widget).
export async function softRemoveUser(db, userId) {
  await db
    .prepare(
      `UPDATE users
       SET email = 'removed-' || id || '@deleted.invalid',
           password_hash = 'removed',
           display_name = '(removed user)',
           is_banned = 1
       WHERE id = ?`
    )
    .bind(userId)
    .run();
}

// ---------------------------------------------------------------------
// email verification tokens
// ---------------------------------------------------------------------
export async function createEmailVerification(db, userId, token, expiresAt) {
  await db
    .prepare('INSERT INTO email_verifications (user_id, token, expires_at) VALUES (?, ?, ?)')
    .bind(userId, token, expiresAt)
    .run();
}

export async function getEmailVerification(db, token) {
  return db.prepare('SELECT * FROM email_verifications WHERE token = ?').bind(token).first();
}

export async function deleteEmailVerification(db, token) {
  await db.prepare('DELETE FROM email_verifications WHERE token = ?').bind(token).run();
}

// ---------------------------------------------------------------------
// widgets / themepacks (packages)
// ---------------------------------------------------------------------
export async function insertPackage(db, type, row) {
  if (type === 'widget') {
    await db
      .prepare(
        `INSERT INTO widgets
           (id, submitted_by, name, description, version, shell_versions, r2_key, screenshot_r2_key, file_size_bytes, sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        row.id, row.submittedBy, row.name, row.description, row.version,
        row.shellVersions, row.r2Key, row.screenshotR2Key, row.fileSizeBytes, row.sha256
      )
      .run();
  } else {
    await db
      .prepare(
        `INSERT INTO themepacks
           (id, submitted_by, name, description, r2_key, screenshot_r2_key, file_size_bytes, sha256, required_widget_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        row.id, row.submittedBy, row.name, row.description,
        row.r2Key, row.screenshotR2Key, row.fileSizeBytes, row.sha256, row.requiredWidgetIds
      )
      .run();
  }
}

export async function getPackageById(db, type, id) {
  return db.prepare(`SELECT * FROM ${tableFor(type)} WHERE id = ?`).bind(id).first();
}

export async function getPendingPackages(db) {
  const widgets = await db
    .prepare(`SELECT * FROM widgets WHERE status = 'pending' ORDER BY created_at`)
    .all();
  const themepacks = await db
    .prepare(`SELECT * FROM themepacks WHERE status = 'pending' ORDER BY created_at`)
    .all();
  return { widgets: widgets.results, themepacks: themepacks.results };
}

export async function getApprovedPackages(db) {
  const widgets = await db
    .prepare(
      `SELECT id, name, description, version, shell_versions, r2_key, screenshot_r2_key,
              avg_rating, rating_count, download_count, updated_at
       FROM widgets WHERE status = 'approved' ORDER BY updated_at DESC`
    )
    .all();
  const themepacks = await db
    .prepare(
      `SELECT id, name, description, r2_key, screenshot_r2_key, required_widget_ids,
              avg_rating, rating_count, download_count, updated_at
       FROM themepacks WHERE status = 'approved' ORDER BY updated_at DESC`
    )
    .all();
  return { widgets: widgets.results, themepacks: themepacks.results };
}

export async function setPackageKeys(db, type, id, { r2Key, screenshotR2Key }) {
  await db
    .prepare(`UPDATE ${tableFor(type)} SET r2_key = ?, screenshot_r2_key = ? WHERE id = ?`)
    .bind(r2Key, screenshotR2Key, id)
    .run();
}

export async function setPackageStatus(db, type, id, status, adminId, rejectionReason = null) {
  await db
    .prepare(
      `UPDATE ${tableFor(type)}
       SET status = ?, reviewed_by = ?, rejection_reason = ?,
           reviewed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
           updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
       WHERE id = ?`
    )
    .bind(status, adminId, rejectionReason, id)
    .run();
}

// ---------------------------------------------------------------------
// reviews
// ---------------------------------------------------------------------
export async function upsertReview(db, { packageType, packageId, userId, stars, comment }) {
  const existing = await db
    .prepare('SELECT id FROM reviews WHERE package_type = ? AND package_id = ? AND user_id = ?')
    .bind(packageType, packageId, userId)
    .first();

  if (existing) {
    await db
      .prepare(
        `UPDATE reviews SET stars = ?, comment = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?`
      )
      .bind(stars, comment, existing.id)
      .run();
  } else {
    await db
      .prepare('INSERT INTO reviews (package_type, package_id, user_id, stars, comment) VALUES (?, ?, ?, ?, ?)')
      .bind(packageType, packageId, userId, stars, comment)
      .run();
  }
}

export async function getReviews(db, packageType, packageId, limit = 50) {
  const result = await db
    .prepare(
      `SELECT r.id, r.stars, r.comment, r.created_at, u.display_name, u.id AS user_id
       FROM reviews r JOIN users u ON u.id = r.user_id
       WHERE r.package_type = ? AND r.package_id = ?
       ORDER BY r.created_at DESC LIMIT ?`
    )
    .bind(packageType, packageId, limit)
    .all();
  return result.results;
}

export async function deleteReviewById(db, reviewId) {
  const review = await db.prepare('SELECT * FROM reviews WHERE id = ?').bind(reviewId).first();
  if (!review) return null;
  await db.prepare('DELETE FROM reviews WHERE id = ?').bind(reviewId).run();
  return review;
}
