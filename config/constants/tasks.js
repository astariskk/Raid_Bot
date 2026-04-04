// config/constants/tasks.js

export const MAX_XP_PER_RAID = 30000; // 30,000 EXP per raid

export const POINTS_CONFIG = {
  // --- daily tasks ---
  ezrajal: 1000,
  warden: 1000,
  engineer: 1000,
  tyndarius: 1000,

  // --- other four ---
  kala: 1000,
  iara: 1000,

  // --- temple shrine tasks ---
  tsleft: 1000,
  tsmid: 2000,
  tsright: 1000,

  // --- weekly tasks ---
  speaker: 4000,
  gramiel: 3000,
  darkon: 3000,
  drago: 1000,
  dage: 2000,
  nulgath: 2000,
  drakath: 2000,

  // --- other seven ---
  mechabinky: 5000,
  astralshrine: 3000,
  kathool: 2000,
  voidnerfkitten: 1000,
  lavarockshore: 1000,
  apexazalith: 1000,

  // --- VA daily ---
  vamem: 1000,
  vanonmem: 2000,

  // --- originul ---
  voidflibbi: 1000,
  voidnightbane: 1000,
  voidxyfrag: 1000,

  // --- generic tasks ---
  simple: 1000,
  moderate: 5000,
  difficult: 10000,

  // --- legion ---
  deimos: 500,
  beast: 500,
  lichlord: 500,
};

// --- Canonical task group members ---
export const DAILIES_LIST = ['ezrajal', 'warden', 'engineer', 'tyndarius'];
export const WEEKLIES_LIST = ['nulgath', 'dage', 'drakath', 'darkon', 'drago', 'speaker', 'gramiel'];
export const TEMPLESHRINE_LIST = ['tsleft', 'tsmid', 'tsright'];
export const ORIGINUL_LIST = ['voidflibbi', 'voidnightbane', 'voidxyfrag'];
export const OTHERS_FOUR_LIST = ['kala', 'iara'];
export const OTHERS_SEVEN_LIST = [
  'mechabinky',
  'kathool',
  'astralshrine',
  'voidnerfkitten',
  'lavarockshore',
  'apexazalith',
  'vamem',
  'vanonmem',
];
export const GENERIC_TASKS_LIST = ['simple', 'moderate', 'difficult'];
export const LEGION_LIST = ['deimos', 'beast', 'lichlord'];

// --- Raid Task Categories (single source of truth for the raid wizard UI) ---
// Keep list exports above for backwards compatibility.
export const RAID_TASK_CATEGORIES = Object.freeze([
  { key: 'dailies', label: 'Dailies', tasks: DAILIES_LIST },
  { key: 'weeklies', label: 'Weeklies', tasks: WEEKLIES_LIST },
  { key: 'templeshrine', label: 'Temple Shrine', tasks: TEMPLESHRINE_LIST },
  { key: 'originul', label: 'Originul', tasks: ORIGINUL_LIST },
  { key: 'legion', label: 'Legion', tasks: LEGION_LIST },
  { key: 'other_four', label: 'Other 4-man', tasks: OTHERS_FOUR_LIST },
  { key: 'other_seven', label: 'Other 7-man', tasks: OTHERS_SEVEN_LIST },
  { key: 'generic', label: 'Other Tasks', tasks: GENERIC_TASKS_LIST },
]);

export const TASK_CATEGORY_BY_TASK = Object.freeze(
  Object.fromEntries(
    RAID_TASK_CATEGORIES.flatMap((cat) => (cat.tasks || []).map((task) => [task, cat.key])),
  ),
);

export const DISPLAY_POINTS_LIST = Object.entries(POINTS_CONFIG).map(
  ([task, points]) => `${task} = ${points} EXP`,
);

export const TASK_DISPLAY_NAMES = Object.freeze({
  tsleft: 'Templeshrine Left',
  tsmid: 'Templeshrine Mid',
  tsright: 'Templeshrine Right',
  vamem: 'Void Aura Daily (Mem)',
  vanonmem: 'Void Aura Daily (Non-Mem)',
});

function normalizeTaskAliasKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export const TASK_ALIASES = Object.freeze(() => {
  const aliases = {};

  // Always accept canonical keys (even if the user types spaces/punctuation).
  for (const key of Object.keys(POINTS_CONFIG)) {
    aliases[normalizeTaskAliasKey(key)] = key;
  }

  // Accept display names as aliases (e.g. "Templeshrine Left").
  for (const [key, display] of Object.entries(TASK_DISPLAY_NAMES)) {
    aliases[normalizeTaskAliasKey(display)] = key;
  }

  // Extra friendly aliases (not necessarily shown in UI).
  aliases[normalizeTaskAliasKey('Temple Shrine Left')] = 'tsleft';
  aliases[normalizeTaskAliasKey('Temple Shrine Mid')] = 'tsmid';
  aliases[normalizeTaskAliasKey('Temple Shrine Right')] = 'tsright';
  aliases[normalizeTaskAliasKey('Temple Shrine (Left)')] = 'tsleft';
  aliases[normalizeTaskAliasKey('Temple Shrine (Mid)')] = 'tsmid';
  aliases[normalizeTaskAliasKey('Temple Shrine (Right)')] = 'tsright';

  aliases[normalizeTaskAliasKey('Void Flibbi')] = 'voidflibbi';
  aliases[normalizeTaskAliasKey('Void Nightbane')] = 'voidnightbane';
  aliases[normalizeTaskAliasKey('Void Xyfrag')] = 'voidxyfrag';

  return aliases;
})();

