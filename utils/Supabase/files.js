import { EMBED_COLOR } from '../../config/constants.js';
import { resolveAssetUrl } from '../assetUrls.js';
import {
  supabaseDelete,
  supabaseSelect,
  supabaseSelectOne,
  supabaseUpsert,
} from './client.js';

const cache = {
  loadedAtMs: 0,
  gifCommands: {},
  textGifCommands: {},
  charts: {},
  byCategoryKey: {},
  triggerToTypeKey: {},
};

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

    if (row.kind === 'text') {
      const maybePath = row.attachment_url || row.asset_path || row.image_path;
      const url = resolveAssetUrl(maybePath);
      const linkUrl = row.message_url || row.asset_path || row.attachment_url || maybePath;

      const pingIds = Array.isArray(row.ping_user_ids) ? row.ping_user_ids.filter(Boolean).map(String) : [];
      const mentions = pingIds.length ? pingIds.map((id) => `<@${id}>`).join(' ') : '';
      const description = String(row.text_description ?? '').trim();
      const label = String(row.text_label ?? '').trim();

      if (url && label) {
        const prefix = mentions ? `${mentions} ` : '';
        const mid = description ? `${description} ` : '';
        textGifCommands[cmd] = `${prefix}${mid}[**${label}**](${linkUrl || url})`.trim();
      } else if (row.text_content) {
        textGifCommands[cmd] = String(row.text_content);
      }
      continue;
    }

    if (row.kind === 'gif') {
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
    kind: row.kind ?? 'gif',
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
  cache.gifCommands = gifCommands;
  cache.textGifCommands = textGifCommands;
  return { gifCommands, textGifCommands };
}

async function refreshChartCache() {
  const rows = await loadChartRows();
  const { byTypeKey, byCategoryKey, triggerToTypeKey } = buildChartCaches(rows);
  cache.loadedAtMs = Date.now();
  cache.charts = byTypeKey;
  cache.byCategoryKey = byCategoryKey;
  cache.triggerToTypeKey = triggerToTypeKey;
  return byTypeKey;
}

export async function loadGifCommandsCache() {
  return refreshGifCache();
}

export function getGifCommandsCache() {
  return {
    loadedAtMs: cache.loadedAtMs,
    gifCommands: cache.gifCommands,
    textGifCommands: cache.textGifCommands,
  };
}

export async function getGifCommand(command) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');
  return cloneRow(await supabaseSelectOne('gif_commands', { filters: [{ column: 'command', op: 'eq', value: cmd }] }));
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
  await refreshGifCache();
}

export async function updateGifCommand(command, patch = {}) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');
  await supabaseUpsert('gif_commands', { command: cmd, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'command' });
  await refreshGifCache();
}

export async function deleteGifCommand(command) {
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');
  await supabaseDelete('gif_commands', [{ column: 'command', op: 'eq', value: cmd }]);
  await refreshGifCache();
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
  return refreshChartCache();
}

export function getChartsCache() {
  return { loadedAtMs: cache.loadedAtMs, charts: cache.charts || {} };
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
  const row = await supabaseSelectOne('charts', { filters: [{ column: 'key', op: 'eq', value: k }] });
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
  await refreshChartCache();
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
  await refreshChartCache();
}

export async function deleteChart(key) {
  const k = normalizeTypeKey(key);
  if (!k) throw new Error('key is required');
  await supabaseDelete('charts', [{ column: 'key', op: 'eq', value: k }]);
  await refreshChartCache();
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
