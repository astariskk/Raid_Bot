import { EMBED_COLOR } from '../../config/constants.js';
import { resolveAssetUrl } from '../assetUrls.js';

const GIFT_FILE_PATH = 'files/gif_commands.json';
const CHART_FILE_PATH = 'files/charts.json';

const cache = {
  loadedAtMs: 0,
  gifCommands: {},
  textGifCommands: {},
  charts: {},
  byCategoryKey: {},
  triggerToTypeKey: {},
};

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function getSupabaseConfig() {
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  const bucket = env('SUPABASE_GIF_BUCKET');

  if (!url) throw new Error('SUPABASE_URL is not defined.');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not defined.');
  if (!bucket) throw new Error('SUPABASE_GIF_BUCKET is not defined.');

  return { url, key, bucket };
}

function buildObjectUrl(bucket, objectPath) {
  const encodedPath = String(objectPath)
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');

  return `${getSupabaseConfig().url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

async function readJsonObject(objectPath, fallbackValue) {
  const { key, bucket } = getSupabaseConfig();
  const response = await fetch(buildObjectUrl(bucket, objectPath), {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (response.status === 404) return fallbackValue;
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Failed to read Supabase file ${objectPath}: ${response.status} ${detail.slice(0, 200)}`);
  }

  const raw = await response.text();
  if (!String(raw ?? '').trim()) return fallbackValue;

  try {
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

async function writeJsonObject(objectPath, value) {
  const { key, bucket } = getSupabaseConfig();
  const response = await fetch(buildObjectUrl(bucket, objectPath), {
    method: 'PUT',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'x-upsert': 'true',
    },
    body: JSON.stringify(value, null, 2),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Failed to write Supabase file ${objectPath}: ${response.status} ${detail.slice(0, 200)}`);
  }
}

function unwrapRows(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.rows)) return value.rows;
  if (Array.isArray(value?.data)) return value.data;
  return fallback;
}

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
        name: String(v?.name ?? v?.title ?? v?.key ?? 'Variant').trim() || 'Variant',
        embed_title: String(v?.embed_title ?? v?.embedTitle ?? '').trim() || null,
        pages: Array.isArray(v?.pages) ? v.pages : [],
      }))
      .filter((v) => v.key)
      .slice(0, 25);
  }

  const legacyPages = Array.isArray(row?.pages) ? row.pages : (row?.pages ? JSON.parse(row.pages) : []);
  const legacyTitle = String(row?.title ?? row?.key ?? 'Chart').trim() || 'Chart';
  return [{ key: 'main', name: legacyTitle, embed_title: null, pages: Array.isArray(legacyPages) ? legacyPages : [] }];
}

async function readCollection(objectPath) {
  return unwrapRows(await readJsonObject(objectPath, []), []);
}

async function writeCollection(objectPath, rows) {
  await writeJsonObject(objectPath, { rows, updated_at: new Date().toISOString() });
}

async function loadGifRows() {
  return readCollection(GIFT_FILE_PATH);
}

async function loadChartRows() {
  return readCollection(CHART_FILE_PATH);
}

function buildGifCaches(rows) {
  const gifCommands = {};
  const textGifCommands = {};

  for (const row of rows ?? []) {
    const cmd = String(row.command ?? '').trim().toLowerCase();
    if (!cmd) continue;

    if (row.kind === 'text') {
      const maybePath = row.asset_path || row.image_path;
      const url = resolveAssetUrl(maybePath);

      const pingIds = Array.isArray(row.ping_user_ids) ? row.ping_user_ids.filter(Boolean).map(String) : [];
      const mentions = pingIds.length ? pingIds.map((id) => `<@${id}>`).join(' ') : '';
      const description = String(row.text_description ?? '').trim();
      const label = String(row.text_label ?? '').trim();

      if (url && label) {
        const prefix = mentions ? `${mentions} ` : '';
        const mid = description ? `${description} ` : '';
        textGifCommands[cmd] = `${prefix}${mid}[**${label}**](${url})`.trim();
      } else if (row.text_content) {
        textGifCommands[cmd] = String(row.text_content);
      }
      continue;
    }

    if (row.kind === 'gif') {
      let image = null;
      const maybePath = row.asset_path || row.image_path;
      if (maybePath) image = resolveAssetUrl(maybePath);

      gifCommands[cmd] = {
        title: row.title ?? cmd,
        image,
        footer: row.footer ?? '',
        color: row.color ?? EMBED_COLOR,
      };
    }
  }

  return { gifCommands, textGifCommands };
}

function buildChartCaches(rows) {
  const byTypeKey = {};
  const byCategoryKey = {};
  const triggerToTypeKey = {};

  for (const row of rows ?? []) {
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

  return { byTypeKey, byCategoryKey, triggerToTypeKey };
}

async function loadGifState() {
  const rows = await loadGifRows();
  return buildGifCaches(rows);
}

async function loadChartState() {
  const rows = await loadChartRows();
  return buildChartCaches(rows);
}

function cloneRow(row) {
  if (row == null) return null;
  return JSON.parse(JSON.stringify(row));
}

function normalizeGifCommandRow(row) {
  return {
    command: String(row.command ?? '').trim().toLowerCase(),
    kind: row.kind ?? 'gif',
    title: row.title ?? null,
    footer: row.footer ?? null,
    image_path: row.image_path ?? null,
    asset_path: row.asset_path ?? null,
    ping_user_ids: Array.isArray(row.ping_user_ids) ? row.ping_user_ids.filter(Boolean).map(String) : [],
    text_label: row.text_label ?? null,
    text_description: row.text_description ?? '',
    text_content: row.text_content ?? null,
    color: row.color ?? null,
    enabled: row.enabled !== false,
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function normalizeChartRow(row) {
  return {
    key: normalizeTypeKey(row.key),
    category: String(row.category ?? 'general').trim() || 'general',
    title: String(row.title ?? row.key),
    triggers: Array.isArray(row.triggers) ? row.triggers.map(normalizeTrigger).filter(Boolean) : [],
    variants: Array.isArray(row.variants) ? row.variants : [],
    enabled: row.enabled !== false,
    created_at: row.created_at ?? new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function findGifIndex(rows, command) {
  const cmd = String(command ?? '').trim().toLowerCase();
  return rows.findIndex((row) => String(row.command ?? '').trim().toLowerCase() === cmd);
}

function findChartIndex(rows, key) {
  const k = normalizeTypeKey(key);
  return rows.findIndex((row) => normalizeTypeKey(row.key) === k);
}

export async function loadGifCommandsCache() {
  const state = await loadGifState();
  cache.loadedAtMs = Date.now();
  cache.gifCommands = state.gifCommands;
  cache.textGifCommands = state.textGifCommands;
  return { gifCommands: cache.gifCommands, textGifCommands: cache.textGifCommands };
}

export function getGifCommandsCache() {
  return {
    loadedAtMs: cache.loadedAtMs,
    gifCommands: cache.gifCommands,
    textGifCommands: cache.textGifCommands,
  };
}

export async function getGifCommand(command) {
  const rows = await loadGifRows();
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');
  return cloneRow(rows.find((row) => String(row.command ?? '').trim().toLowerCase() === cmd) ?? null);
}

export async function upsertGifCommand({
  command,
  kind,
  title,
  footer,
  textContent,
  imagePath,
  assetPath,
  pingUserIds,
  textLabel,
  textDescription,
  color,
  enabled = true,
}) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  const rows = await loadGifRows();
  const nextRow = normalizeGifCommandRow({
    command: cmd,
    kind: kind ?? 'gif',
    title,
    footer,
    text_content: textContent,
    image_path: imagePath,
    asset_path: assetPath,
    ping_user_ids: pingUserIds,
    text_label: textLabel,
    text_description: textDescription,
    color,
    enabled,
    created_at: rows.find((row) => String(row.command ?? '').trim().toLowerCase() === cmd)?.created_at ?? new Date().toISOString(),
  });

  const index = findGifIndex(rows, cmd);
  if (index >= 0) rows[index] = { ...rows[index], ...nextRow, created_at: rows[index].created_at ?? nextRow.created_at };
  else rows.push(nextRow);

  await writeCollection(GIFT_FILE_PATH, rows);
  await loadGifCommandsCache();
}

export async function updateGifCommand(command, patch = {}) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  const rows = await loadGifRows();
  const index = findGifIndex(rows, cmd);
  if (index < 0) return;

  const current = rows[index];
  rows[index] = {
    ...current,
    ...patch,
    command: cmd,
    updated_at: new Date().toISOString(),
  };

  await writeCollection(GIFT_FILE_PATH, rows);
  await loadGifCommandsCache();
}

export async function deleteGifCommand(command) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  const rows = await loadGifRows();
  const nextRows = rows.filter((row) => String(row.command ?? '').trim().toLowerCase() !== cmd);
  await writeCollection(GIFT_FILE_PATH, nextRows);
  await loadGifCommandsCache();
}

export async function updateGifCommandImage(command, imagePath) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  const rows = await loadGifRows();
  const index = findGifIndex(rows, cmd);
  if (index < 0) return;

  rows[index] = {
    ...rows[index],
    asset_path: imagePath,
    image_path: imagePath,
    updated_at: new Date().toISOString(),
  };

  await writeCollection(GIFT_FILE_PATH, rows);
  await loadGifCommandsCache();
}

export async function loadChartsCache() {
  const state = await loadChartState();
  cache.loadedAtMs = Date.now();
  cache.charts = state.byTypeKey;
  cache.byCategoryKey = state.byCategoryKey;
  cache.triggerToTypeKey = state.triggerToTypeKey;
  return cache.charts;
}

export function getChartsCache() {
  return { loadedAtMs: cache.loadedAtMs, charts: cache.charts || {} };
}

export async function listChartsKeys() {
  const rows = await loadChartRows();
  return rows.map((row) => normalizeTypeKey(row.key)).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

export async function listChartCategories() {
  if (!cache.loadedAtMs) await loadChartsCache().catch(() => {});
  const cats = Object.values(cache.byCategoryKey || {}).map((c) => c.category);

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
  if (!cache.loadedAtMs) await loadChartsCache().catch(() => {});
  const catKey = normalizeCategoryKey(category);
  const entry = cache.byCategoryKey?.[catKey];
  if (!entry) return [];
  return entry.keys.map((k) => cache.charts[k]).filter(Boolean);
}

export async function getChart(key) {
  const rows = await loadChartRows();
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');
  const row = rows.find((entry) => normalizeTypeKey(entry.key) === k);
  if (!row) return null;

  return {
    key: k,
    category: String(row.category ?? 'general').trim() || 'general',
    title: String(row.title ?? k),
    triggers: Array.isArray(row.triggers) ? row.triggers.map(normalizeTrigger).filter(Boolean) : [],
    variants: normalizeVariantsRow(row),
    enabled: Boolean(row.enabled),
  };
}

export async function upsertChart({ key, category = 'general', title, triggers = [], variants, enabled = true }) {
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');

  const rows = await loadChartRows();
  const index = findChartIndex(rows, k);
  const nextRow = normalizeChartRow({
    key: k,
    category,
    title,
    triggers,
    variants,
    enabled,
    created_at: index >= 0 ? rows[index].created_at : new Date().toISOString(),
  });

  if (index >= 0) rows[index] = { ...rows[index], ...nextRow, created_at: rows[index].created_at ?? nextRow.created_at };
  else rows.push(nextRow);

  await writeCollection(CHART_FILE_PATH, rows);
  await loadChartsCache();
}

export async function updateChart(key, patch = {}) {
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');

  const rows = await loadChartRows();
  const index = findChartIndex(rows, k);
  if (index < 0) return;

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

  rows[index] = {
    ...rows[index],
    ...normalizedPatch,
    key: k,
    updated_at: new Date().toISOString(),
  };

  await writeCollection(CHART_FILE_PATH, rows);
  await loadChartsCache();
}

export async function deleteChart(key) {
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');

  const rows = await loadChartRows();
  const nextRows = rows.filter((row) => normalizeTypeKey(row.key) !== k);
  await writeCollection(CHART_FILE_PATH, nextRows);
  await loadChartsCache();
}

export async function findChartKeyByTrigger(trigger) {
  if (!cache.loadedAtMs) await loadChartsCache().catch(() => {});
  const trig = normalizeTrigger(trigger);
  if (!trig) return null;
  return cache.triggerToTypeKey?.[trig] || null;
}

export function normalizeChartVariantKey(key) {
  return normalizeVariantKey(key);
}

export function _chartsNormalizeTriggerForTest(trigger) {
  return normalizeTrigger(trigger);
}
