import { EMBED_COLOR } from '../../config/constants.js';
import { resolveAssetUrl } from '../assetUrls.js';
import {
  supabaseDelete,
  supabaseSelect,
  supabaseUpsert,
} from './client.js';

const cache = {
  loadedAtMs: 0,
  rawGifRows: {},
  rawChartRows: {},
  gifCommands: {},
  textGifCommands: {},
  charts: {},
  byCategoryKey: {},
  triggerToTypeKey: {},
};

let gifCacheLoadPromise = null;
let chartCacheLoadPromise = null;

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

function normalizeGifKind(row) {
  const rawKind = String(row?.kind ?? '').trim().toLowerCase();
  if (rawKind === 'gif' || rawKind === 'text') return rawKind;

  const hasTextFields =
    Boolean(String(row?.text_content ?? '').trim())
    || Boolean(String(row?.text_label ?? '').trim())
    || Boolean(String(row?.text_description ?? '').trim())
    || (Array.isArray(row?.ping_user_ids) && row.ping_user_ids.length > 0);

  return hasTextFields ? 'text' : 'gif';
}

function parsePingUserIds(value) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
    } catch {
      return raw.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
    }
  }
  return [];
}

function normalizeVariantsRow(row) {
  const rawVariants = Array.isArray(row?.variants) ? row.variants : [];
  if (rawVariants.length) {
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

  const legacyPages = Array.isArray(row?.pages) ? row.pages : [];
  const legacyTitle = String(row?.title ?? row?.key ?? 'Chart').trim() || 'Chart';
  return [{ key: 'main', name: legacyTitle, embed_title: null, pages: legacyPages }];
}

function buildGifCaches(rows) {
  const gifCommands = {};
  const textGifCommands = {};

  for (const row of rows ?? []) {
    const cmd = String(row.command ?? '').trim().toLowerCase();
    if (!cmd) continue;
    const kind = normalizeGifKind(row);

    if (kind === 'text') {
      const maybePath = row.attachment_url || row.asset_path || row.image_path;
      const url = resolveAssetUrl(maybePath);
      const linkUrl = url || resolveAssetUrl(row.message_url) || row.message_url || maybePath;

      const pingIds = parsePingUserIds(row.ping_user_ids);
      const mentions = pingIds.length ? pingIds.map((id) => `<@${id}>`).join(' ') : '';
      const description = String(row.text_description ?? '').trim();
      const label = String(row.text_label ?? '').trim();

      if (url && label) {
        const prefix = mentions ? `${mentions} ` : '';
        const mid = description ? `${description} ` : '';
        textGifCommands[cmd] = `${prefix}${mid}[**${label}**](${linkUrl || url})`.trim();
      } else if (label || description || mentions || row.text_content) {
        const prefix = mentions ? `${mentions} ` : '';
        const mid = description ? `${description} ` : '';
        const content = String(row.text_content ?? '').trim();
        const tail = label ? `**${label}**` : content;
        textGifCommands[cmd] = `${prefix}${mid}${tail}`.trim() || content;
      } else if (row.text_content) {
        textGifCommands[cmd] = String(row.text_content);
      }
      continue;
    }

    if (kind === 'gif') {
      let image = null;
      const maybePath = row.attachment_url || row.asset_path || row.image_path;
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

function cloneRow(row) {
  if (row == null) return null;
  return JSON.parse(JSON.stringify(row));
}

function normalizeGifCommandRow(row, createdAt = row?.created_at ?? new Date().toISOString()) {
  return {
    command: String(row.command ?? '').trim().toLowerCase(),
    kind: normalizeGifKind(row),
    title: row.title ?? null,
    footer: row.footer ?? null,
    image_path: row.image_path ?? null,
    asset_path: row.asset_path ?? null,
    attachment_url: row.attachment_url ?? null,
    message_url: row.message_url ?? null,
    channel_id: row.channel_id ?? null,
    message_id: row.message_id ?? null,
    ping_user_ids: Array.isArray(row.ping_user_ids) ? row.ping_user_ids.filter(Boolean).map(String) : [],
    text_label: row.text_label ?? null,
    text_description: row.text_description ?? '',
    text_content: row.text_content ?? null,
    color: row.color ?? null,
    enabled: row.enabled !== false,
    created_at: createdAt,
    updated_at: new Date().toISOString(),
  };
}

function normalizeChartRow(row, createdAt = row?.created_at ?? new Date().toISOString()) {
  return {
    key: normalizeTypeKey(row.key),
    category: String(row.category ?? 'general').trim() || 'general',
    title: String(row.title ?? row.key),
    triggers: Array.isArray(row.triggers) ? row.triggers.map(normalizeTrigger).filter(Boolean) : [],
    variants: Array.isArray(row.variants) ? row.variants : [],
    pages: Array.isArray(row.pages) ? row.pages : [],
    enabled: row.enabled !== false,
    created_at: createdAt,
    updated_at: new Date().toISOString(),
  };
}

async function loadGifRows() {
  return supabaseSelect('gif_commands', {
    order: [{ column: 'command', direction: 'asc' }],
  });
}

async function loadChartRows() {
  return supabaseSelect('charts', {
    order: [{ column: 'key', direction: 'asc' }],
  });
}

async function refreshGifCache() {
  const rows = await loadGifRows();
  const { gifCommands, textGifCommands } = buildGifCaches(rows);
  cache.loadedAtMs = Date.now();
  cache.rawGifRows = Object.fromEntries(rows.map((row) => [String(row.command ?? '').trim().toLowerCase(), row]).filter(([key]) => key));
  cache.gifCommands = gifCommands;
  cache.textGifCommands = textGifCommands;
  return { gifCommands, textGifCommands };
}

async function refreshChartCache() {
  const rows = await loadChartRows();
  const { byTypeKey, byCategoryKey, triggerToTypeKey } = buildChartCaches(rows);
  cache.loadedAtMs = Date.now();
  cache.rawChartRows = Object.fromEntries(rows.map((row) => [normalizeTypeKey(row.key), row]).filter(([key]) => key));
  cache.charts = byTypeKey;
  cache.byCategoryKey = byCategoryKey;
  cache.triggerToTypeKey = triggerToTypeKey;
  return byTypeKey;
}

async function ensureGifCacheLoaded() {
  if (cache.loadedAtMs && (Object.keys(cache.gifCommands || {}).length || Object.keys(cache.textGifCommands || {}).length)) {
    return { gifCommands: cache.gifCommands, textGifCommands: cache.textGifCommands };
  }
  if (!gifCacheLoadPromise) {
    gifCacheLoadPromise = refreshGifCache().finally(() => {
      gifCacheLoadPromise = null;
    });
  }
  return gifCacheLoadPromise;
}

async function ensureChartCacheLoaded() {
  if (cache.loadedAtMs && Object.keys(cache.charts || {}).length) {
    return cache.charts;
  }
  if (!chartCacheLoadPromise) {
    chartCacheLoadPromise = refreshChartCache().finally(() => {
      chartCacheLoadPromise = null;
    });
  }
  return chartCacheLoadPromise;
}

export async function loadGifCommandsCache() {
  return ensureGifCacheLoaded();
}

export async function loadSecretCommandsCache() {
  return ensureGifCacheLoaded();
}

export function getGifCommandsCache() {
  return {
    loadedAtMs: cache.loadedAtMs,
    gifCommands: cache.gifCommands,
    textGifCommands: cache.textGifCommands,
  };
}

export function getSecretCommandsCache() {
  return getGifCommandsCache();
}

export async function getGifCommand(command) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');
  await ensureGifCacheLoaded();
  const row = cache.rawGifRows?.[cmd] || null;
  if (row) return cloneRow(row);
  return null;
}

export async function upsertGifCommand({
  command,
  kind,
  title,
  footer,
  textContent,
  imagePath,
  assetPath,
  attachmentUrl,
  messageUrl,
  channelId,
  messageId,
  pingUserIds,
  textLabel,
  textDescription,
  color,
  enabled = true,
}) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');
  const existing = await getGifCommand(cmd).catch(() => null);
  const row = normalizeGifCommandRow({
    command: cmd,
    kind: kind ?? existing?.kind ?? 'gif',
    title: title ?? existing?.title ?? null,
    footer: footer ?? existing?.footer ?? null,
    text_content: textContent ?? existing?.text_content ?? null,
    image_path: imagePath ?? existing?.image_path ?? null,
    asset_path: assetPath ?? existing?.asset_path ?? null,
    attachment_url: attachmentUrl ?? existing?.attachment_url ?? null,
    message_url: messageUrl ?? existing?.message_url ?? null,
    channel_id: channelId ?? existing?.channel_id ?? null,
    message_id: messageId ?? existing?.message_id ?? null,
    ping_user_ids: pingUserIds ?? existing?.ping_user_ids ?? [],
    text_label: textLabel ?? existing?.text_label ?? null,
    text_description: textDescription ?? existing?.text_description ?? '',
    color: color ?? existing?.color ?? null,
    enabled,
    created_at: existing?.created_at ?? new Date().toISOString(),
  });

  await supabaseUpsert('gif_commands', row, { onConflict: 'command' });
  cache.loadedAtMs = Date.now();
  cache.rawGifRows[row.command] = cloneRow(row);
  if (row.kind === 'text') {
    cache.textGifCommands[row.command] = row.text_content ?? '';
    delete cache.gifCommands[row.command];
  } else {
    cache.gifCommands[row.command] = {
      title: row.title ?? row.command,
      image: resolveAssetUrl(row.attachment_url || row.asset_path || row.image_path),
      footer: row.footer ?? '',
      color: row.color ?? EMBED_COLOR,
    };
    delete cache.textGifCommands[row.command];
  }
}

export async function updateGifCommand(command, patch = {}) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');
  await ensureGifCacheLoaded();
  const existing = await getGifCommand(cmd);
  const next = normalizeGifCommandRow({
    ...(existing || { command: cmd, kind: 'gif', ping_user_ids: [], text_description: '', enabled: true }),
    ...patch,
    command: cmd,
    updated_at: new Date().toISOString(),
  }, existing?.created_at ?? new Date().toISOString());
  await supabaseUpsert('gif_commands', next, { onConflict: 'command' });

  cache.loadedAtMs = Date.now();
  cache.rawGifRows[cmd] = cloneRow(next);
  if (next.kind === 'text') {
    const maybePath = next.attachment_url || next.asset_path || next.image_path;
    const url = resolveAssetUrl(maybePath);
    const linkUrl = url || resolveAssetUrl(next.message_url) || next.message_url || maybePath;
    const pingIds = parsePingUserIds(next.ping_user_ids);
    const mentions = pingIds.length ? pingIds.map((id) => `<@${id}>`).join(' ') : '';
    const description = String(next.text_description ?? '').trim();
    const label = String(next.text_label ?? '').trim();

    if (url && label) {
      const prefix = mentions ? `${mentions} ` : '';
      const mid = description ? `${description} ` : '';
      cache.textGifCommands[cmd] = `${prefix}${mid}[**${label}**](${linkUrl || url})`.trim();
    } else if (label || description || mentions || next.text_content) {
      const prefix = mentions ? `${mentions} ` : '';
      const mid = description ? `${description} ` : '';
      const content = String(next.text_content ?? '').trim();
      const tail = label ? `**${label}**` : content;
      cache.textGifCommands[cmd] = `${prefix}${mid}${tail}`.trim() || content;
    } else if (next.text_content) {
      cache.textGifCommands[cmd] = String(next.text_content);
    } else {
      delete cache.textGifCommands[cmd];
    }
    delete cache.gifCommands[cmd];
  } else {
    cache.gifCommands[cmd] = {
      title: next.title ?? cmd,
      image: resolveAssetUrl(next.attachment_url || next.asset_path || next.image_path),
      footer: next.footer ?? '',
      color: next.color ?? EMBED_COLOR,
    };
    delete cache.textGifCommands[cmd];
  }
}

export async function deleteGifCommand(command) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');
  await supabaseDelete('gif_commands', [{ column: 'command', op: 'eq', value: cmd }]);
  delete cache.rawGifRows[cmd];
  delete cache.gifCommands[cmd];
  delete cache.textGifCommands[cmd];
}

export async function updateGifCommandImage(command, media = {}) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');
  const next = typeof media === 'string'
    ? { asset_path: media, image_path: media, attachment_url: media }
    : {
        asset_path: media.asset_path ?? media.attachment_url ?? null,
        image_path: media.image_path ?? media.attachment_url ?? media.asset_path ?? null,
        attachment_url: media.attachment_url ?? media.asset_path ?? null,
        message_url: media.message_url ?? null,
        channel_id: media.channel_id ?? null,
        message_id: media.message_id ?? null,
      };

  await updateGifCommand(cmd, next);
}

export async function loadChartsCache() {
  return ensureChartCacheLoaded();
}

export function getChartsCache() {
  return { loadedAtMs: cache.loadedAtMs, charts: cache.charts || {} };
}

export function getChartCommandsCache() {
  return getChartsCache();
}

export async function listChartsKeys() {
  const rows = await loadChartRows();
  return rows.map((r) => normalizeTypeKey(r.key)).filter(Boolean);
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
  const entry = cache.byCategoryKey?.[normalizeCategoryKey(category)];
  if (!entry) return [];
  return entry.keys.map((k) => cache.charts[k]).filter(Boolean);
}

export async function getChart(key) {
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');
  await ensureChartCacheLoaded();
  const row = cache.rawChartRows?.[k];
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

export async function upsertChart({ key, category = 'general', title, triggers = [], variants, pages, enabled = true }) {
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');
  const existing = await getChart(k).catch(() => null);
  const row = normalizeChartRow({
    key: k,
    category,
    title,
    triggers,
    variants,
    pages,
    enabled,
    created_at: existing?.created_at ?? new Date().toISOString(),
  });
  await supabaseUpsert('charts', row, { onConflict: 'key' });
  cache.loadedAtMs = Date.now();
  cache.rawChartRows[k] = cloneRow(row);
  cache.charts[k] = row;
  const categoryKey = normalizeCategoryKey(row.category);
  if (!cache.byCategoryKey[categoryKey]) cache.byCategoryKey[categoryKey] = { category: row.category, keys: [] };
  if (!cache.byCategoryKey[categoryKey].keys.includes(k)) cache.byCategoryKey[categoryKey].keys.push(k);
  cache.byCategoryKey[categoryKey].keys.sort((a, b) => a.localeCompare(b));
  for (const trig of row.triggers || []) {
    cache.triggerToTypeKey[trig] = k;
  }
}

export async function updateChart(key, patch = {}) {
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');
  const existing = await getChart(k).catch(() => null);
  if (!existing) return;

  const nextPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'category')) {
    nextPatch.category = String(nextPatch.category ?? 'general').trim() || 'general';
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'triggers')) {
    nextPatch.triggers = Array.isArray(nextPatch.triggers) ? nextPatch.triggers.map(normalizeTrigger).filter(Boolean) : [];
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'variants')) {
    nextPatch.variants = Array.isArray(nextPatch.variants) ? nextPatch.variants : [];
  }
  if (Object.prototype.hasOwnProperty.call(nextPatch, 'pages')) {
    nextPatch.pages = Array.isArray(nextPatch.pages) ? nextPatch.pages : [];
  }

  await supabaseUpsert('charts', {
    key: k,
    ...existing,
    ...nextPatch,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  cache.loadedAtMs = Date.now();
  const rawNext = {
    key: k,
    ...existing,
    ...nextPatch,
    updated_at: new Date().toISOString(),
  };
  cache.rawChartRows[k] = cloneRow(rawNext);
  cache.charts[k] = {
    key: k,
    category: String(rawNext.category ?? 'general').trim() || 'general',
    categoryKey: normalizeCategoryKey(rawNext.category ?? 'general'),
    title: String(rawNext.title ?? k),
    triggers: Array.isArray(rawNext.triggers) ? rawNext.triggers.map(normalizeTrigger).filter(Boolean) : [],
    variants: normalizeVariantsRow(rawNext),
    enabled: Boolean(rawNext.enabled),
  };
  cache.byCategoryKey = {};
  cache.triggerToTypeKey = {};
  for (const [typeKey, rawRow] of Object.entries(cache.rawChartRows || {})) {
    const category = String(rawRow.category ?? 'general').trim() || 'general';
    const categoryKey = normalizeCategoryKey(category) || 'general';
    const triggers = Array.isArray(rawRow.triggers) ? rawRow.triggers : [];
    if (!cache.byCategoryKey[categoryKey]) cache.byCategoryKey[categoryKey] = { category, keys: [] };
    if (!cache.byCategoryKey[categoryKey].keys.includes(typeKey)) cache.byCategoryKey[categoryKey].keys.push(typeKey);
    for (const trig of triggers) {
      const normalizedTrig = normalizeTrigger(trig);
      if (normalizedTrig && !cache.triggerToTypeKey[normalizedTrig]) cache.triggerToTypeKey[normalizedTrig] = typeKey;
    }
  }
  for (const category of Object.values(cache.byCategoryKey)) {
    category.keys.sort((a, b) => a.localeCompare(b));
  }
}

export async function deleteChart(key) {
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');
  await supabaseDelete('charts', [{ column: 'key', op: 'eq', value: k }]);
  delete cache.rawChartRows[k];
  delete cache.charts[k];
  for (const category of Object.values(cache.byCategoryKey || {})) {
    category.keys = (category.keys || []).filter((item) => item !== k);
  }
  for (const [trig, typeKey] of Object.entries(cache.triggerToTypeKey || {})) {
    if (typeKey === k) delete cache.triggerToTypeKey[trig];
  }
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
