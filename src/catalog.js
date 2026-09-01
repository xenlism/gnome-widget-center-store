import { getApprovedPackages } from './db.js';

// Called once per approve/reject action (not per page view). Writes TWO
// independent manifests to the PUBLIC bucket — one per package type —
// rather than a single combined manifest. This mirrors the actual
// client UI (the GNOME extension has a separate "Widgets" tab in the
// overlay and a separate "Theme Packs" tab in prefs, each only ever
// needing its own list) and keeps cache invalidation independent:
// approving a widget doesn't change the themepack manifest's ETag, and
// vice versa.
export async function regenerateCatalog(env) {
  const { widgets, themepacks } = await getApprovedPackages(env.DB);
  const base = env.PUBLIC_FILES_BASE_URL;
  const generatedAt = new Date().toISOString();

  const widgetsManifest = {
    generatedAt,
    widgets: widgets.map((w) => ({
      id: w.id,
      name: w.name,
      description: w.description,
      version: w.version,
      shellVersions: safeParseArray(w.shell_versions),
      downloadUrl: `${base}/${w.r2_key}`,
      screenshotUrl: w.screenshot_r2_key ? `${base}/${w.screenshot_r2_key}` : null,
      avgRating: w.avg_rating,
      ratingCount: w.rating_count,
      downloadCount: w.download_count,
      updatedAt: w.updated_at,
    })),
  };

  const themepacksManifest = {
    generatedAt,
    themepacks: themepacks.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      requiredWidgetIds: safeParseArray(t.required_widget_ids),
      downloadUrl: `${base}/${t.r2_key}`,
      screenshotUrl: t.screenshot_r2_key ? `${base}/${t.screenshot_r2_key}` : null,
      avgRating: t.avg_rating,
      ratingCount: t.rating_count,
      downloadCount: t.download_count,
      updatedAt: t.updated_at,
    })),
  };

  await Promise.all([
    env.PUBLIC_BUCKET.put('repo/widgets.json', JSON.stringify(widgetsManifest), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=300' },
    }),
    env.PUBLIC_BUCKET.put('repo/themepacks.json', JSON.stringify(themepacksManifest), {
      httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=300' },
    }),
  ]);
}

function safeParseArray(jsonText) {
  try {
    const parsed = JSON.parse(jsonText || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
