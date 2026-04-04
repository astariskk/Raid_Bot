// config/constants/maps.js

// Maps a canonical task key to one or more `/join <prefix>-<room>` prefixes.
// If a task is not listed here, the default prefix is the task key itself.
export const TASK_JOIN_PREFIXES = {
  // --- dailies ---
  ezrajal: ['ultraezrajal'],
  warden: ['ultrawarden'],
  engineer: ['ultraengineer'],
  tyndarius: ['ultratyndarius'],
  kala: ['ultrakala'],
  iara: ['ultraiara'],

  // --- weeklies ---
  nulgath: ['ultranulgath'],
  drakath: ['championdrakath'],
  dage: ['ultradage'],
  darkon: ['ultradarkon'],
  drago: ['ultradrago'],
  speaker: ['ultraspeaker'],
  gramiel: ['ultragramiel'],

  // --- other seven ---
  mechabinky: ['grimchallenge'],
  kathool: ['kathooldepths'],

  // --- templeshrine ---
  tsmid: ['templeshrine'],
  tsleft: ['templeshrine'],
  tsright: ['templeshrine'],

  // --- VA daily ---
  vamem: ['ancienttrigoras', 'chaoskraken', 'gravechallenge'],
  vanonmem: ['voidflibbi', 'icewing', 'hydrachallenge'],

  // --- legion ---
  beast: ['sevencircleswar'],
  lichlord: ['frozenlair'],
};

export function getJoinPrefixes(taskKey) {
  return TASK_JOIN_PREFIXES[taskKey] || [taskKey];
}

