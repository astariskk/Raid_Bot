// config/constants/tasks.js
import { getSupabase } from '../../utils/supabaseClient.js';

export const MAX_XP_PER_RAID = 30000; // 30,000 EXP per raid

const CATEGORY_LABELS = {
  four_man_daily: '4-Man Daily',
  four_man_weekly: '4-Man Weekly',
  seven_man_weekly: '7-Man Weekly',
  seven_man_daily: '7-Man Daily',
  two_man_daily: '2-Man Daily',
  templeshrine: 'Temple Shrine',
  void_aura_daily: 'Void Aura Daily',
  originul: 'Originul',
  legion: 'Legion',
  other_seven: 'Other 7-Man',
  generic: 'Generic',
  spamming: 'Spamming',
};

const CATEGORY_ORDER = [
  'four_man_daily',
  'four_man_weekly',
  'seven_man_weekly',
  'seven_man_daily',
  'two_man_daily',
  'templeshrine',
  'void_aura_daily',
  'originul',
  'legion',
  'other_seven',
  'generic',
  'spamming',
];

const FALLBACK_CATEGORY_ROWS = [
  { key: 'four_man_daily', display_name: '4-Man Daily', sort_order: 10 },
  { key: 'four_man_weekly', display_name: '4-Man Weekly', sort_order: 20 },
  { key: 'seven_man_weekly', display_name: '7-Man Weekly', sort_order: 30 },
  { key: 'seven_man_daily', display_name: '7-Man Daily', sort_order: 40 },
  { key: 'two_man_daily', display_name: '2-Man Daily', sort_order: 50 },
  { key: 'templeshrine', display_name: 'Temple Shrine', sort_order: 60 },
  { key: 'void_aura_daily', display_name: 'Void Aura Daily', sort_order: 70 },
  { key: 'originul', display_name: 'Originul', sort_order: 80 },
  { key: 'legion', display_name: 'Legion', sort_order: 90 },
  { key: 'other_seven', display_name: 'Other 7-Man', sort_order: 100 },
  { key: 'generic', display_name: 'Generic', sort_order: 110 },
  { key: 'spamming', display_name: 'Spamming', sort_order: 120 },
];

const FALLBACK_TASK_ROWS = [
  { key: 'ezrajal', display_name: 'Ultra Ezrajal', points: 1000, category: 'four_man_daily', active: true, map_names: ['ultraezrajal'], aliases: [], sort_order: 10 },
  { key: 'warden', display_name: 'Ultra Warden', points: 1000, category: 'four_man_daily', active: true, map_names: ['ultrawarden'], aliases: [], sort_order: 20 },
  { key: 'engineer', display_name: 'Ultra Engineer', points: 1000, category: 'four_man_daily', active: true, map_names: ['ultraengineer'], aliases: [], sort_order: 30 },
  { key: 'tyndarius', display_name: 'Ultra Tyndarius', points: 1000, category: 'four_man_daily', active: true, map_names: ['ultratyndarius'], aliases: [], sort_order: 40 },
  { key: 'kala', display_name: 'Ultra Kala', points: 1000, category: 'four_man_daily', active: false, map_names: ['ultrakala'], aliases: [], sort_order: 50 },
  { key: 'iara', display_name: 'Ultra Iara', points: 1000, category: 'four_man_daily', active: false, map_names: ['ultraiara'], aliases: [], sort_order: 60 },

  { key: 'dage', display_name: 'Ultra Dage', points: 2000, category: 'four_man_weekly', active: true, map_names: ['ultradage'], aliases: [], sort_order: 10 },
  { key: 'nulgath', display_name: 'Ultra Nulgath', points: 2000, category: 'four_man_weekly', active: true, map_names: ['ultranulgath'], aliases: [], sort_order: 20 },
  { key: 'drakath', display_name: 'Champion Drakath', points: 2000, category: 'four_man_weekly', active: true, map_names: ['championdrakath'], aliases: [], sort_order: 30 },
  { key: 'darkon', display_name: 'Ultra Darkon', points: 3000, category: 'four_man_weekly', active: true, map_names: ['ultradarkon'], aliases: [], sort_order: 40 },
  { key: 'drago', display_name: 'Ultra Drago', points: 1000, category: 'four_man_weekly', active: true, map_names: ['ultradrago'], aliases: [], sort_order: 50 },
  { key: 'speaker', display_name: 'Ultra Speaker', points: 4000, category: 'four_man_weekly', active: true, map_names: ['ultraspeaker'], aliases: [], sort_order: 60 },
  { key: 'gramiel', display_name: 'Ultra Gramiel', points: 3000, category: 'four_man_weekly', active: true, map_names: ['ultragramiel'], aliases: [], sort_order: 70 },

  { key: 'mechabinky', display_name: 'Mechabinky', points: 5000, category: 'seven_man_weekly', active: true, map_names: ['grimchallenge'], aliases: ['grim'], sort_order: 10 },

  { key: 'astralshrine', display_name: 'Astral Shrine', points: 3000, category: 'seven_man_daily', active: true, map_names: ['astralshrine'], aliases: ['astral'], sort_order: 10 },
  { key: 'kathool', display_name: 'Kathool', points: 2000, category: 'seven_man_daily', active: true, map_names: ['kathooldepths'], aliases: ['kath'], sort_order: 20 },
  { key: 'apexazalith', display_name: 'Apex Azalith', points: 1000, category: 'seven_man_daily', active: true, map_names: ['apexazalith'], aliases: ['apex'], sort_order: 30 },

  { key: 'flameusurper', display_name: 'Flame Usurper', points: 2000, category: 'two_man_daily', active: true, map_names: ['flameusurper'], aliases: ['flame'], sort_order: 10 },

  { key: 'tsleft', display_name: 'Templeshrine Left', points: 1000, category: 'templeshrine', active: true, map_names: ['templeshrine'], aliases: ['temple shrine left', 'templeshrineleft'], sort_order: 10 },
  { key: 'tsright', display_name: 'Templeshrine Right', points: 1000, category: 'templeshrine', active: true, map_names: ['templeshrine'], aliases: ['temple shrine right', 'templeshrineright'], sort_order: 20 },
  { key: 'tsmid', display_name: 'Templeshrine Mid', points: 2000, category: 'templeshrine', active: true, map_names: ['templeshrine'], aliases: ['temple shrine mid', 'templeshrinemid'], sort_order: 30 },

  { key: 'vanonmem', display_name: 'Void Aura Daily (Non-Mem)', points: 2000, category: 'void_aura_daily', active: true, map_names: ['voidflibbi', 'icewing', 'hydrachallenge'], aliases: ['vanm'], sort_order: 10 },
  { key: 'vamem', display_name: 'Void Aura Daily (Mem)', points: 1000, category: 'void_aura_daily', active: true, map_names: ['ancienttrigoras', 'chaoskraken', 'gravechallenge'], aliases: ['vam'], sort_order: 20 },

  { key: 'voidflibbi', display_name: 'Void Flibbi', points: 1000, category: 'originul', active: true, map_names: ['voidflibbi'], aliases: ['flibbi'], sort_order: 10 },
  { key: 'voidnightbane', display_name: 'Void Nightbane', points: 1000, category: 'originul', active: true, map_names: ['voidnightbane'], aliases: ['nightbane'], sort_order: 20 },
  { key: 'voidxyfrag', display_name: 'Void Xyfrag', points: 1000, category: 'originul', active: true, map_names: ['voidxyfrag'], aliases: ['xyfrag'], sort_order: 30 },

  { key: 'deimos', display_name: 'Deimos', points: 500, category: 'legion', active: true, map_names: ['deimos'], aliases: [], sort_order: 10 },
  { key: 'beast', display_name: 'Beast', points: 500, category: 'legion', active: true, map_names: ['sevencircleswar'], aliases: [], sort_order: 20 },
  { key: 'lichlord', display_name: 'Lich Lord', points: 500, category: 'legion', active: true, map_names: ['frozenlair'], aliases: ['lich'], sort_order: 30 },

  { key: 'voidnerfkitten', display_name: 'Void Nerf Kitten', points: 1000, category: 'other_seven', active: true, map_names: ['voidnerfkitten'], aliases: ['nerfkitten'], sort_order: 10 },

  { key: 'generic_2man', display_name: '2-Man room', points: 1000, category: 'generic', active: true, map_names: [], aliases: ['generic2', 'generic2man'], sort_order: 10 },
  { key: 'generic_4man', display_name: '4-Man room', points: 1000, category: 'generic', active: true, map_names: [], aliases: ['generic4', 'generic4man'], sort_order: 20 },
  { key: 'generic_5man', display_name: '5-Man room', points: 1000, category: 'generic', active: true, map_names: [], aliases: ['generic5', 'generic5man'], sort_order: 30 },
  { key: 'generic_7man', display_name: '7-Man room', points: 1000, category: 'generic', active: true, map_names: [], aliases: ['generic7', 'generic7man'], sort_order: 40 },

  { key: 'spamming_2man', display_name: '2-Man room', points: 0, category: 'spamming', active: true, map_names: [], aliases: ['spamming2', 'spamming2man'], sort_order: 10 },
  { key: 'spamming_4man', display_name: '4-Man room', points: 0, category: 'spamming', active: true, map_names: [], aliases: ['spamming4', 'spamming4man'], sort_order: 20 },
  { key: 'spamming_5man', display_name: '5-Man room', points: 0, category: 'spamming', active: true, map_names: [], aliases: ['spamming5', 'spamming5man'], sort_order: 30 },
  { key: 'spamming_7man', display_name: '7-Man room', points: 0, category: 'spamming', active: true, map_names: [], aliases: ['spamming7', 'spamming7man'], sort_order: 40 },
];

export const POINTS_CONFIG = {};
export const TASK_DISPLAY_NAMES = {};
export const TASK_ALIASES = {};
export const TASK_JOIN_PREFIXES = {};
export const TASK_CATEGORY_BY_TASK = {};
export const DISPLAY_POINTS_LIST = [];

export const DAILIES_LIST = [];
export const WEEKLIES_LIST = [];
export const TEMPLESHRINE_LIST = [];
export const ORIGINUL_LIST = [];
export const OTHERS_FOUR_LIST = [];
export const OTHERS_SEVEN_LIST = [];
export const GENERIC_TASKS_LIST = [];
export const LEGION_LIST = [];
export const SPAMMING_TASKS_LIST = [];

export const RAID_TASK_CATEGORIES = [];

let loadedAtMs = 0;
let loadedFrom = 'fallback';
let lastLoadError = null;

function normalizeTaskKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

function normalizeTaskAliasKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function replaceObject(target, source) {
  for (const key of Object.keys(target)) delete target[key];
  Object.assign(target, source);
}

function replaceArray(target, source) {
  target.splice(0, target.length, ...source);
}

function formatCategoryLabel(key) {
  return String(key ?? '')
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Custom';
}

function normalizeCategoryRows(rows = []) {
  return rows
    .map((row) => {
      const key = normalizeTaskKey(row.key);
      if (!key) return null;
      return {
        key,
        display_name: String(row.display_name || CATEGORY_LABELS[key] || formatCategoryLabel(key)).trim(),
        sort_order: Math.floor(Number(row.sort_order ?? 0) || 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.sort_order - b.sort_order) || a.display_name.localeCompare(b.display_name) || a.key.localeCompare(b.key));
}

function getCategoryMeta(categoryRows = []) {
  const normalized = normalizeCategoryRows(categoryRows.length ? categoryRows : FALLBACK_CATEGORY_ROWS);
  const map = new Map(normalized.map((row) => [row.key, row]));
  return { rows: normalized, map };
}

function normalizeRows(rows = [], categoryRows = []) {
  const { rows: normalizedCategories, map: categoryMap } = getCategoryMeta(categoryRows);
  const categoryIndex = new Map(normalizedCategories.map((row, index) => [row.key, index]));

  return rows
    .map((row) => {
      const key = normalizeTaskKey(row.key);
      if (!key) return null;

      return {
        key,
        display_name: String(row.display_name || key).trim(),
        points: Math.max(0, Math.floor(Number(row.points ?? 0) || 0)),
        category: normalizeTaskKey(row.category || 'generic') || 'generic',
        active: row.active !== false,
        description: row.description ?? null,
        map_names: Array.isArray(row.map_names) ? row.map_names.map(String).map((v) => v.trim()).filter(Boolean) : [],
        aliases: Array.isArray(row.aliases) ? row.aliases.map(String).map((v) => v.trim()).filter(Boolean) : [],
        sort_order: Math.floor(Number(row.sort_order ?? 0) || 0),
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const aIndex = categoryIndex.has(a.category)
        ? categoryIndex.get(a.category)
        : (CATEGORY_ORDER.includes(a.category) ? normalizedCategories.length + CATEGORY_ORDER.indexOf(a.category) : normalizedCategories.length + CATEGORY_ORDER.length);
      const bIndex = categoryIndex.has(b.category)
        ? categoryIndex.get(b.category)
        : (CATEGORY_ORDER.includes(b.category) ? normalizedCategories.length + CATEGORY_ORDER.indexOf(b.category) : normalizedCategories.length + CATEGORY_ORDER.length);
      const catDiff = aIndex - bIndex;
      if (catDiff) return catDiff;
      const categoryNameDiff = a.category.localeCompare(b.category);
      if (categoryNameDiff) return categoryNameDiff;
      return (a.sort_order - b.sort_order) || a.key.localeCompare(b.key);
    });
}

function applyTaskRows(rows, { source = 'database', error = null, categoryRows = [] } = {}) {
  const { rows: normalizedCategories, map: categoryMap } = getCategoryMeta(categoryRows);
  const activeRows = normalizeRows(rows, normalizedCategories).filter((row) => row.active);
  const taskListsByCategory = {
    four_man_daily: DAILIES_LIST,
    four_man_weekly: WEEKLIES_LIST,
    templeshrine: TEMPLESHRINE_LIST,
    originul: ORIGINUL_LIST,
    legion: LEGION_LIST,
    other_seven: OTHERS_SEVEN_LIST,
    generic: GENERIC_TASKS_LIST,
    spamming: SPAMMING_TASKS_LIST,
  };
  const pointsConfig = {};
  const displayNames = {};
  const aliases = {};
  const joinPrefixes = {};
  const categoryByTask = {};
  const displayPoints = [];

  for (const list of Object.values(taskListsByCategory)) replaceArray(list, []);

  for (const row of activeRows) {
    pointsConfig[row.key] = row.points;
    displayNames[row.key] = row.display_name;
    categoryByTask[row.key] = row.category;
    displayPoints.push(`${row.key} = ${row.points} EXP`);

    if (!taskListsByCategory[row.category]) taskListsByCategory[row.category] = [];
    taskListsByCategory[row.category].push(row.key);

    const usesModalMapsOnly = row.key.startsWith('generic_')
      || row.key.startsWith('spamming_')
      || row.key === 'spamming';
    const mapNames = row.map_names.length
      ? row.map_names
      : (usesModalMapsOnly ? [] : [row.key]);
    joinPrefixes[row.key] = mapNames;

    const aliasInputs = [
      row.key,
      row.display_name,
      ...row.aliases,
      ...mapNames,
    ];

    for (const alias of aliasInputs) {
      const aliasKey = normalizeTaskAliasKey(alias);
      if (aliasKey) aliases[aliasKey] = row.key;
    }
  }

  replaceObject(POINTS_CONFIG, pointsConfig);
  replaceObject(TASK_DISPLAY_NAMES, displayNames);
  replaceObject(TASK_ALIASES, aliases);
  replaceObject(TASK_JOIN_PREFIXES, joinPrefixes);
  replaceObject(TASK_CATEGORY_BY_TASK, categoryByTask);
  replaceArray(DISPLAY_POINTS_LIST, displayPoints);

  const categories = [];
  const seenCategories = new Set();
  for (const category of normalizedCategories) {
    if (!taskListsByCategory[category.key]?.length) continue;
    seenCategories.add(category.key);
    categories.push({
      key: category.key,
      label: category.display_name || CATEGORY_LABELS[category.key] || formatCategoryLabel(category.key),
      tasks: taskListsByCategory[category.key],
    });
  }

  const extraCategoryKeys = Object.keys(taskListsByCategory)
    .filter((key) => !seenCategories.has(key) && taskListsByCategory[key]?.length)
    .sort((a, b) => {
      const aMeta = categoryMap.get(a);
      const bMeta = categoryMap.get(b);
      if (aMeta || bMeta) return (aMeta?.sort_order ?? 9999) - (bMeta?.sort_order ?? 9999);
      return a.localeCompare(b);
    });

  for (const key of extraCategoryKeys) {
    const meta = categoryMap.get(key);
    categories.push({ key, label: meta?.display_name || CATEGORY_LABELS[key] || formatCategoryLabel(key), tasks: taskListsByCategory[key] });
  }

  replaceArray(RAID_TASK_CATEGORIES, categories);

  loadedAtMs = Date.now();
  loadedFrom = source;
  lastLoadError = error;
}

export async function loadRaidTasksCache({ fallbackOnError = true } = {}) {
  try {
    const supabase = getSupabase();
    const [{ data, error }, { data: categoryData, error: categoryError }] = await Promise.all([
      supabase
      .from('raid_tasks')
      .select('key,display_name,points,category,active,description,map_names,aliases,sort_order')
      .order('category', { ascending: true })
      .order('sort_order', { ascending: true })
        .order('key', { ascending: true }),
      supabase
        .from('raid_task_categories')
        .select('key,display_name,sort_order')
        .order('sort_order', { ascending: true })
        .order('display_name', { ascending: true }),
    ]);

    if (error) throw error;
    if (categoryError) throw categoryError;

    const rows = data?.length ? data : FALLBACK_TASK_ROWS;
    applyTaskRows(rows, { source: data?.length ? 'database' : 'fallback', categoryRows: categoryData?.length ? categoryData : FALLBACK_CATEGORY_ROWS });
  } catch (error) {
    if (!fallbackOnError) throw error;
    applyTaskRows(FALLBACK_TASK_ROWS, { source: 'fallback', error, categoryRows: FALLBACK_CATEGORY_ROWS });
    console.warn('Failed to load raid tasks from database; using fallback constants:', error?.message || error);
  }

  return getRaidTasksCacheState();
}

export function getRaidTasksCacheState() {
  return {
    loadedAtMs,
    loadedFrom,
    lastLoadError,
    taskCount: Object.keys(POINTS_CONFIG).length,
  };
}

export function getJoinPrefixesForTask(taskKey) {
  const key = normalizeTaskKey(taskKey);
  return TASK_JOIN_PREFIXES[key] || [key];
}

export function taskUsesModalMaps(taskKey) {
  const key = normalizeTaskKey(taskKey);
  if (!key) return false;
  return key.startsWith('generic_')
    || key.startsWith('spamming_')
    || key === 'spamming'
    || ['simple', 'moderate', 'difficult'].includes(key);
}

export function raidNeedsModalMapName(tasks = []) {
  return (tasks || []).some((task) => taskUsesModalMaps(task));
}

// Populate synchronously so imported constants are usable before startup refreshes from Supabase.
applyTaskRows(FALLBACK_TASK_ROWS, { source: 'fallback', categoryRows: FALLBACK_CATEGORY_ROWS });
