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
  hard: 10000,

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
export const GENERIC_TASKS_LIST = ['simple', 'moderate', 'hard'];
export const LEGION_LIST = ['deimos', 'beast', 'lichlord'];

// --- Task groups (used for expanding meta tasks like "dailies") ---
export const TASK_GROUPS = {
  dailies: DAILIES_LIST,
  weeklies: WEEKLIES_LIST,
  templeshrine: TEMPLESHRINE_LIST,
  originul: ORIGINUL_LIST,
  legion: LEGION_LIST,
};

export const DISPLAY_POINTS_LIST = Object.entries(POINTS_CONFIG).map(
  ([task, points]) => `${task} = ${points} EXP`,
);

