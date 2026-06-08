export function resolveAssetUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;

  // Prefer Discord CDN / attachment URLs (post-migration).
  if (/^https?:\/\//i.test(raw)) return raw;

  // If DB stored a Discord message URL (not an attachment URL), we can't always resolve it here.
  // Keep old behavior for Supabase bucket paths.
  const supabaseUrl = String(process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
  const bucket = String(process.env.SUPABASE_GIF_BUCKET ?? process.env.SUPABASE_CHARTS_BUCKET ?? 'images-storage').trim();
  if (!supabaseUrl || !bucket) return null;

  const encodedPath = raw
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  if (!encodedPath) return null;

  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
}


export function getStoredAssetValueFromAttachment(attachment) {
  return String(attachment?.url ?? '').trim() || null;
}
