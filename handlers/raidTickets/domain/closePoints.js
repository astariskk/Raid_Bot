import { MAX_XP_PER_RAID, TASK_DISPLAY_NAMES } from '../../../config/constants.js';
import { calculateTaskPointsWithMultiplier } from '../../../utils/taskCalculations.js';
import {
  calculateSpammingPoints,
  getHelperTotalMinutes,
} from '../../../utils/raidParticipationStore.js';
import {
  getNormalTaskString,
  getRaidTaskFieldDisplay,
  getTaskKeys,
  isSpammingRaid,
  SPAMMING_EXP_CAP,
  SPAMMING_RATE_PER_MINUTE,
} from '../raidTicketLogic.js';
import { normalizePartialHelpers } from './partialHelpers.js';

function getResolvableTaskString(taskString = '') {
  const normal = getNormalTaskString(taskString);
  if (normal) return normal;
  return String(taskString ?? '')
    .split(/[+,]/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && !t.startsWith('generic_') && t !== 'spamming' && !t.startsWith('spamming_'))
    .join(', ');
}

function formatTaskKeyForDisplay(taskKey) {
  return TASK_DISPLAY_NAMES?.[taskKey] ?? taskKey;
}

async function resolveMemberDisplayName(guild, userId) {
  if (!guild || !userId) return String(userId);
  const member = await guild.members.fetch(userId).catch(() => null);
  return member?.displayName ?? member?.user?.username ?? String(userId);
}

/**
 * Build helperId -> EXP awarded for raid close.
 */
export function buildClosePointsMap(raidInfo, joinedHelpers, selectedHelperIds = []) {
  const partialHelpers = normalizePartialHelpers(raidInfo);
  const partialsWithTasks = partialHelpers.filter((p) => p.tasks?.length > 0);
  const activeIds = joinedHelpers.filter((h) => !h.removedAt).map((h) => h.helperId);
  const removedIds = joinedHelpers.filter((h) => h.removedAt).map((h) => h.helperId);

  const allHelperIds = [...new Set([
    ...selectedHelperIds,
    ...partialsWithTasks.map((e) => e.helperId),
    ...activeIds,
    ...removedIds,
  ])].filter((id) => id && id !== raidInfo?.requesterId);

  const endedAt = new Date();
  const fullTaskPoints = calculateTaskPointsWithMultiplier(
    getResolvableTaskString(raidInfo?.task) || raidInfo?.task || '',
  ).originalTotalCalculatedPoints;

  const joinedById = new Map(joinedHelpers.map((helper) => [helper.helperId, helper]));
  const pointsMap = {};

  for (const uid of allHelperIds) {
    const partial = partialHelpers.find((e) => e.helperId === uid);
    let normalPoints = 0;

    if (partial?.tasks?.length) {
      const subset = partial.tasks
        .filter((task) => task !== 'spamming' && !String(task).startsWith('spamming_'))
        .join(', ');
      normalPoints = subset
        ? calculateTaskPointsWithMultiplier(getResolvableTaskString(subset) || subset).originalTotalCalculatedPoints
        : 0;
    } else {
      normalPoints = fullTaskPoints;
    }

    const helperRow = joinedById.get(uid);
    const spammingPoints = isSpammingRaid(raidInfo) && helperRow
      ? calculateSpammingPoints({
        helper: helperRow,
        endedAt,
        ratePerMinute: SPAMMING_RATE_PER_MINUTE,
        cap: SPAMMING_EXP_CAP,
      })
      : 0;

    pointsMap[uid] = Math.min(normalPoints + spammingPoints, MAX_XP_PER_RAID);
  }

  return { pointsMap, partialHelpers, spamming: isSpammingRaid(raidInfo), joinedById, endedAt, fullTaskPoints };
}

function buildTaskExpBreakdownSection(raidInfo, { spamming, joinedById, pointsMap }) {
  const lines = ['', 'Task EXP Breakdown:'];
  const resolvable = getResolvableTaskString(raidInfo?.task);
  const taskCalc = calculateTaskPointsWithMultiplier(resolvable || '');

  if (spamming) {
    let totalMinutes = 0;
    let totalSpamExp = 0;
    for (const uid of Object.keys(pointsMap)) {
      const helperRow = joinedById.get(uid);
      if (!helperRow) continue;
      const minutes = getHelperTotalMinutes(helperRow);
      const spamExp = calculateSpammingPoints({
        helper: helperRow,
        ratePerMinute: SPAMMING_RATE_PER_MINUTE,
        cap: SPAMMING_EXP_CAP,
      });
      totalMinutes += minutes;
      totalSpamExp += spamExp;
    }
    lines.push(`Spamming: ${totalMinutes} min x ${SPAMMING_RATE_PER_MINUTE}/minute = ${totalSpamExp}`);
  }

  if (taskCalc.calculatedBreakdown.length) {
    for (const row of taskCalc.calculatedBreakdown) {
      const m = String(row).match(/^([a-z0-9_]+)(?:x(\d+))?:\s*(\d+)\s*EXP/i);
      if (m) {
        lines.push(`${formatTaskKeyForDisplay(m[1])}: ${m[3]} EXP`);
      } else {
        lines.push(row);
      }
    }
  } else {
    const keys = getTaskKeys(raidInfo?.task).filter(
      (k) => k !== 'spamming' && !k.startsWith('spamming_'),
    );
    for (const key of keys) {
      const single = calculateTaskPointsWithMultiplier(key);
      if (single.originalTotalCalculatedPoints > 0) {
        lines.push(`${formatTaskKeyForDisplay(key)}: ${single.originalTotalCalculatedPoints} EXP`);
      }
    }
  }

  return lines;
}

export async function buildExpLairThreadBreakdown(guild, raidInfo, pointsMap, {
  partialHelpers = [],
  spamming,
  joinedById,
}) {
  const totalAwarded = Object.values(pointsMap).reduce((sum, n) => sum + n, 0);
  const partialMap = new Map(
    (partialHelpers || []).filter((e) => e.tasks?.length).map((e) => [e.helperId, e]),
  );
  const fullTaskPoints = calculateTaskPointsWithMultiplier(
    getResolvableTaskString(raidInfo?.task) || raidInfo?.task || '',
  ).originalTotalCalculatedPoints;
  const raidTaskDisplay = getRaidTaskFieldDisplay(raidInfo?.task);

  const lines = [
    'This thread contains the full details for the raid',
    `Total EXP Calculated: ${totalAwarded} EXP`,
    '',
    'Points awarded to Helpers:',
  ];

  for (const [uid, points] of Object.entries(pointsMap)) {
    const name = await resolveMemberDisplayName(guild, uid);
    lines.push(`${name}: ${points} EXP`);

    const partial = partialMap.get(uid);
    const helperRow = joinedById.get(uid);

    if (partial?.tasks?.length) {
      lines.push(`* Tasks: ${getRaidTaskFieldDisplay(partial.tasks.join(', '))}`);
    } else if (!partial && fullTaskPoints > 0 && raidTaskDisplay !== 'None') {
      const taskOnlyDisplay = getRaidTaskFieldDisplay(getNormalTaskString(raidInfo?.task) || raidInfo?.task);
      if (taskOnlyDisplay && taskOnlyDisplay !== 'Spamming') {
        lines.push(`* Tasks: ${taskOnlyDisplay}`);
      }
    }

    if (spamming && helperRow) {
      const minutes = getHelperTotalMinutes(helperRow);
      const spamOnly = calculateSpammingPoints({
        helper: helperRow,
        ratePerMinute: SPAMMING_RATE_PER_MINUTE,
        cap: SPAMMING_EXP_CAP,
      });
      if (spamOnly > 0) {
        lines.push(`* Spamming: ${minutes} min x ${SPAMMING_RATE_PER_MINUTE} EXP/min = ${spamOnly} EXP`);
      }
    }
  }

  lines.push(...buildTaskExpBreakdownSection(raidInfo, { spamming, joinedById, pointsMap }));

  return lines.join('\n');
}
