import { getSupabase } from './supabaseClient.js';

let chartsCache = null;
let chartsLoadedAtMs = 0;

function normalizeKey(key) {
  return String(key ?? '').trim().toLowerCase().replace(/^\//, '').replace(/[^\w-]/g, '').slice(0, 32);
}

export async function loadChartsCache() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('charts')
    .select('key,title,pages,enabled')
    .eq('enabled', true);
  if (error) throw error;

  const byKey = {};
  for (const row of data ?? []) {
    const key = normalizeKey(row.key);
    if (!key) continue;

    const pages = Array.isArray(row.pages) ? row.pages : (row.pages ? JSON.parse(row.pages) : []);
    byKey[key] = {
      key,
      title: String(row.title ?? key),
      pages: Array.isArray(pages) ? pages : [],
      enabled: Boolean(row.enabled),
    };
  }

  chartsCache = byKey;
  chartsLoadedAtMs = Date.now();
  return chartsCache;
}

export function getChartsCache() {
  return { loadedAtMs: chartsLoadedAtMs, charts: chartsCache || {} };
}

export async function listChartsKeys() {
  const supabase = getSupabase();
  const { data, error } = await supabase.from('charts').select('key').order('key', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => normalizeKey(r.key)).filter(Boolean);
}

export async function getChart(key) {
  const supabase = getSupabase();
  const k = normalizeKey(key);
  if (!k) throw new Error('key is required');

  const { data, error } = await supabase
    .from('charts')
    .select('key,title,pages,enabled')
    .eq('key', k)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    key: k,
    title: String(data.title ?? k),
    pages: Array.isArray(data.pages) ? data.pages : [],
    enabled: Boolean(data.enabled),
  };
}

export async function upsertChart({ key, title, pages, enabled = true }) {
  const supabase = getSupabase();
  const k = normalizeKey(key);
  if (!k) throw new Error('key is required');

  const row = {
    key: k,
    title: String(title ?? k),
    pages: pages ?? [],
    enabled,
  };

  const { error } = await supabase.from('charts').upsert(row, { onConflict: 'key' });
  if (error) throw error;

  await loadChartsCache();
}

export async function updateChart(key, patch = {}) {
  const supabase = getSupabase();
  const k = normalizeKey(key);
  if (!k) throw new Error('key is required');

  const { error } = await supabase.from('charts').update(patch).eq('key', k);
  if (error) throw error;

  await loadChartsCache();
}

export async function deleteChart(key) {
  const supabase = getSupabase();
  const k = normalizeKey(key);
  if (!k) throw new Error('key is required');

  const { error } = await supabase.from('charts').delete().eq('key', k);
  if (error) throw error;

  await loadChartsCache();
}

