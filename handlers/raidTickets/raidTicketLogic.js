import {
  RAID_STATUS,
  TASK_CATEGORY_BY_TASK,
  TASK_DISPLAY_NAMES,
  getJoinPrefixesForTask,
  taskUsesModalMaps,
} from '../../config/constants.js';

export const SPAMMING_TASK_KEY = 'spamming';
export const SPAMMING_RATE_PER_MINUTE = 300;
export const SPAMMING_EXP_CAP = 10000;

export function getTaskKeys(taskString = '') {
  return String(taskString ?? '')
    .split(/\s*[+,]\s*/)
    .map((task) => task.trim().toLowerCase())
    .filter(Boolean);
}

export function getTaskDisplayNames(taskStringOrTasks = '') {
  const tasks = Array.isArray(taskStringOrTasks) ? taskStringOrTasks : getTaskKeys(taskStringOrTasks);
  return tasks.map((task) => TASK_DISPLAY_NAMES?.[task] ?? task);
}

export function getRaidTaskFieldDisplay(taskStringOrTasks = '') {
  const tasks = Array.isArray(taskStringOrTasks) ? taskStringOrTasks : getTaskKeys(taskStringOrTasks);
  const labels = [];
  let hasGeneric = false;
  let hasSpamming = false;

  for (const task of tasks) {
    if (task.startsWith('generic_')) {
      hasGeneric = true;
      continue;
    }
    if (task === SPAMMING_TASK_KEY || task.startsWith('spamming_')) {
      hasSpamming = true;
      continue;
    }
    labels.push(TASK_DISPLAY_NAMES?.[task] ?? task);
  }

  if (hasGeneric) labels.push('Generic Task');
  if (hasSpamming) labels.push('Spamming');
  return labels.length ? labels.join(', ') : 'None';
}

export function parseMapNameList(mapNameField = '') {
  const raw = String(mapNameField ?? '').trim();
  if (!raw || raw.toLowerCase() === 'auto (based on task)') return [];
  return [...new Set(
    raw
      .split(/[,;\n]+/)
      .map((part) => part.trim().toLowerCase().replace(/[^a-z0-9_-]/g, ''))
      .filter(Boolean),
  )];
}

export function getJoinPrefixesForRaid(raidInfo) {
  const tasks = getTaskKeys(raidInfo?.task || '');
  const modalMaps = parseMapNameList(raidInfo?.mapName);
  const prefixes = [];

  for (const task of tasks) {
    if (taskUsesModalMaps(task)) continue;
    for (const prefix of getJoinPrefixesForTask(task)) {
      if (!prefixes.includes(prefix)) prefixes.push(prefix);
    }
  }

  for (const mapName of modalMaps) {
    if (!prefixes.includes(mapName)) prefixes.push(mapName);
  }

  return prefixes;
}

export function isSpammingRaid(raidInfoOrTasks) {
  const tasks = Array.isArray(raidInfoOrTasks)
    ? raidInfoOrTasks
    : getTaskKeys(raidInfoOrTasks?.task || raidInfoOrTasks?.tasks || '');
  return tasks.some((task) => task === SPAMMING_TASK_KEY || task.startsWith('spamming_'));
}

export function getNormalTaskString(taskString = '') {
  return getTaskKeys(taskString).filter((task) => task !== SPAMMING_TASK_KEY).join(', ');
}

export function getRaidStatusForHelpers({ isSpamming, helperCount, maxHelpers = 4 }) {
  if (!isSpamming) return RAID_STATUS.WAITING;
  if (helperCount >= maxHelpers) return RAID_STATUS.FULL;
  if (helperCount > 1) return RAID_STATUS.ONGOING;
  return RAID_STATUS.WAITING;
}

function getPartySizeFromTaskKey(taskKey) {
  const roomMatch = String(taskKey).match(/_(\d)man$/);
  if (roomMatch) return Number(roomMatch[1]);

  const category = TASK_CATEGORY_BY_TASK?.[taskKey];
  if (category === 'two_man_daily') return 2;
  if (category === 'four_man_daily' || category === 'four_man_weekly') return 4;
  if (
    category === 'seven_man_weekly'
    || category === 'seven_man_daily'
    || ['originul', 'legion', 'other_seven', 'templeshrine', 'void_aura_daily'].includes(category)
  ) {
    return 7;
  }
  return null;
}

export function getRaidPartySize(raidInfoOrTasks) {
  const tasks = Array.isArray(raidInfoOrTasks)
    ? raidInfoOrTasks
    : getTaskKeys(raidInfoOrTasks?.task || raidInfoOrTasks?.tasks || '');
  const sizes = tasks.map(getPartySizeFromTaskKey).filter((size) => Number.isFinite(size));
  if (sizes.length) return Math.max(...sizes);
  return 4;
}

export function getRaidHelperCapacity(raidInfoOrTasks) {
  return Math.max(1, getRaidPartySize(raidInfoOrTasks) - 1);
}

export function getVisibleHelpers(helpers = [], requesterId = null) {
  return helpers.filter((helper) => String(helper?.helperId ?? '') && String(helper.helperId) !== String(requesterId ?? ''));
}
