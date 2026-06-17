import { connectMongo, getMongoDb } from './mongoClient.js';

let chartsCache = null; // { byTypeKey, byCategoryKey, triggerToTypeKey }
let chartsLoadedAtMs = 0;
const COLLECTION = 'charts_table';

function normalizeTypeKey(key) {
  return String(key ?? '').trim().toLowerCase().replace(/^\//, '').replace(/[^\w-]/g, '').slice(0, 32);
}

function normalizeCategoryKey(category) {
  return String(category ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 64);
}

function normalizeTrigger(trigger) {
  const t = String(trigger ?? '').trim().toLowerCase();
  if (!t) return '';
  return t.startsWith('!') || t.startsWith('/') ? t : `!${t}`;
}

function normalizeVariantKey(key) {
  return String(key ?? '').trim().toLowerCase().replace(/^\//, '').replace(/[^\w-]/g, '').slice(0, 32);
}

function normalizeVariantsRow(row) {
  const raw = row?.variants;
  const rawVariants = Array.isArray(raw) ? raw : (raw ? JSON.parse(raw) : null);

  if (Array.isArray(rawVariants) && rawVariants.length) {
    return rawVariants
      .map((v) => ({
        key: normalizeVariantKey(v?.key) || normalizeVariantKey(v?.name) || normalizeVariantKey(v?.title) || 'main',
        // `name` is the human label (e.g. "AP LOO"). Old data used `title` for this.
        name: String(v?.name ?? v?.title ?? v?.key ?? 'Variant').trim() || 'Variant',
        // Optional embed title override; default is computed by the UI as "Category + Type".
        embed_title: String(v?.embed_title ?? v?.embedTitle ?? '').trim() || null,
        pages: Array.isArray(v?.pages) ? v.pages : [],
      }))
      .filter((v) => v.key)
      .slice(0, 25);
  }

  // Back-compat: existing tables used (title + pages) for a single chart.
  const legacyPages = Array.isArray(row?.pages) ? row.pages : (row?.pages ? JSON.parse(row.pages) : []);
  const legacyTitle = String(row?.title ?? row?.key ?? 'Chart').trim() || 'Chart';
  return [{ key: 'main', name: legacyTitle, embed_title: null, pages: Array.isArray(legacyPages) ? legacyPages : [] }];
}

export async function loadChartsCache() {
  await connectMongo();
  const db = getMongoDb();
  const data = await db.collection(COLLECTION).find({ enabled: true }).toArray();

  const byTypeKey = {};
  const byCategoryKey = {};
  const triggerToTypeKey = {};

  for (const row of data ?? []) {
    const typeKey = normalizeTypeKey(row.key);
    if (!typeKey) continue;

    const category = String(row.category ?? 'general').trim() || 'general';
    const categoryKey = normalizeCategoryKey(category) || 'general';
    const triggers = Array.isArray(row.triggers) ? row.triggers : [];
    const variants = normalizeVariantsRow(row);

    byTypeKey[typeKey] = {
      key: typeKey,
      category,
      categoryKey,
      title: String(row.title ?? typeKey),
      triggers: triggers.map(normalizeTrigger).filter(Boolean),
      variants,
      enabled: Boolean(row.enabled),
    };

    if (!byCategoryKey[categoryKey]) byCategoryKey[categoryKey] = { category, keys: [] };
    byCategoryKey[categoryKey].keys.push(typeKey);

    for (const rawTrig of triggers ?? []) {
      const trig = normalizeTrigger(rawTrig);
      if (!trig) continue;
      if (!triggerToTypeKey[trig]) triggerToTypeKey[trig] = typeKey;
    }
  }

  for (const cat of Object.values(byCategoryKey)) {
    cat.keys.sort((a, b) => a.localeCompare(b));
  }

  chartsCache = { byTypeKey, byCategoryKey, triggerToTypeKey };
  chartsLoadedAtMs = Date.now();
  return chartsCache.byTypeKey;
}

export function getChartsCache() {
  return { loadedAtMs: chartsLoadedAtMs, charts: chartsCache?.byTypeKey || {} };
}

export async function listChartsKeys() {
  await connectMongo();
  const db = getMongoDb();
  const data = await db.collection(COLLECTION).find({}, { projection: { _id: 0, key: 1 } }).sort({ key: 1 }).toArray();
  return (data ?? []).map((r) => normalizeTypeKey(r.key)).filter(Boolean);
}

export async function listChartCategories() {
  if (!chartsCache) await loadChartsCache().catch(() => {});
  const cats = Object.values(chartsCache?.byCategoryKey || {}).map((c) => c.category);

  const seen = new Set();
  const out = [];
  for (const c of cats) {
    const k = normalizeCategoryKey(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export async function listChartTypesInCategory(category) {
  if (!chartsCache) await loadChartsCache().catch(() => {});
  const catKey = normalizeCategoryKey(category);
  const entry = chartsCache?.byCategoryKey?.[catKey];
  if (!entry) return [];
  return entry.keys.map((k) => chartsCache.byTypeKey[k]).filter(Boolean);
}

export async function getChart(key) {
  await connectMongo();
  const db = getMongoDb();
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');

  const data = await db.collection(COLLECTION).findOne({ key: k });
  if (!data) return null;

  return {
    key: k,
    category: String(data.category ?? 'general').trim() || 'general',
    title: String(data.title ?? k),
    triggers: Array.isArray(data.triggers) ? data.triggers.map(normalizeTrigger).filter(Boolean) : [],
    variants: normalizeVariantsRow(data),
    enabled: Boolean(data.enabled),
  };
}

export async function upsertChart({ key, category = 'general', title, triggers = [], variants, enabled = true }) {
  await connectMongo();
  const db = getMongoDb();
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');

  const row = {
    key: k,
    category: String(category ?? 'general').trim() || 'general',
    title: String(title ?? k),
    triggers: Array.isArray(triggers) ? triggers.map(normalizeTrigger).filter(Boolean) : [],
    variants: Array.isArray(variants) ? variants : [],
    enabled,
    updated_at: new Date(),
  };

  await db.collection(COLLECTION).updateOne(
    { key: k },
    { $set: row, $setOnInsert: { created_at: new Date() } },
    { upsert: true },
  );

  await loadChartsCache();
}

export async function updateChart(key, patch = {}) {
  await connectMongo();
  const db = getMongoDb();
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');

  const normalizedPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'category')) {
    normalizedPatch.category = String(normalizedPatch.category ?? 'general').trim() || 'general';
  }
  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'triggers')) {
    normalizedPatch.triggers = Array.isArray(normalizedPatch.triggers)
      ? normalizedPatch.triggers.map(normalizeTrigger).filter(Boolean)
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'variants')) {
    normalizedPatch.variants = Array.isArray(normalizedPatch.variants) ? normalizedPatch.variants : [];
  }

  normalizedPatch.updated_at = new Date();
  await db.collection(COLLECTION).updateOne({ key: k }, { $set: normalizedPatch });

  await loadChartsCache();
}

export async function deleteChart(key) {
  await connectMongo();
  const db = getMongoDb();
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');

  await db.collection(COLLECTION).deleteOne({ key: k });

  await loadChartsCache();
}

export async function findChartKeyByTrigger(trigger) {
  if (!chartsCache) await loadChartsCache().catch(() => {});
  const trig = normalizeTrigger(trigger);
  if (!trig) return null;
  return chartsCache?.triggerToTypeKey?.[trig] || null;
}

export function normalizeChartVariantKey(key) {
  return normalizeVariantKey(key);
}

export function _chartsNormalizeTriggerForTest(trigger) {
  return normalizeTrigger(trigger);
}
