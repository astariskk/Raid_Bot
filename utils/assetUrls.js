export function resolveAssetUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  return null;
}

export function getStoredAssetValueFromAttachment(attachment) {
  return String(attachment?.url ?? '').trim() || null;
}
