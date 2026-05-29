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
import {
  formatNonSpammingTasksDisplay,
  getAttachableTaskKeys,
  getPartialHelperEntry,
  getPartialHelperNonSpammingTasks,
  normalizePartialHelpers,
  raidHasNonSpammingTasks,
} from './partialHelpers.js';

function getResolvableTaskString(taskString = '') {
  const normal = getNormalTaskString(taskString);
  if (normal) return normal;
  return getAttachableTaskKeys({ task: taskString }).join(', ');
}

function getHelperCloseTaskDisplay(raidInfo, partial, isRemoved) {
  const nonSpamPartial = getPartialHelperNonSpammingTasks(partial);
  if (partial) {
    if (nonSpamPartial.length) return formatNonSpammingTasksDisplay(nonSpamPartial);
    return null;
  }
  if (!isRemoved && raidHasNonSpammingTasks(raidInfo)) {
    return formatNonSpammingTasksDisplay(getAttachableTaskKeys(raidInfo));
  }
  return null;
}

function formatTaskKeyForDisplay(taskKey) {
  return TASK_DISPLAY_NAMES?.[taskKey] ?? taskKey;
}

function parseDateMs(value) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function getRaidDurationMinutes(joinedById, endedAt = new Date()) {
  const rows = Array.from(joinedById.values());
  const startTimes = rows
    .map((row) => parseDateMs(row.joinedAt))
    .filter((time) => time != null);
  const endTime = parseDateMs(endedAt);
  if (!startTimes.length || !endTime) return 0;

  const startTime = Math.min(...startTimes);
  if (endTime <= startTime) return 0;
  return Math.max(1, Math.floor((endTime - startTime) / 60000));
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
  const activeIds = joinedHelpers.filter((h) => !h.removedAt).map((h) => h.helperId);
  const removedIds = new Set(
    joinedHelpers.filter((h) => h.removedAt).map((h) => h.helperId),
  );

  const allHelperIds = [...new Set([
    ...selectedHelperIds,
    ...partialHelpers.map((e) => e.helperId),
    ...activeIds,
    ...removedIds,
  ])].filter((id) => id && id !== raidInfo?.requesterId);

  const endedAt = new Date();
  const fullTaskPoints = calculateTaskPointsWithMultiplier(
    getResolvableTaskString(raidInfo?.task) || '',
  ).originalTotalCalculatedPoints;

  const joinedById = new Map(joinedHelpers.map((helper) => [helper.helperId, helper]));
  const pointsMap = {};

  for (const uid of allHelperIds) {
    const partial = getPartialHelperEntry(partialHelpers, uid);
    const isRemoved = removedIds.has(uid);
    let normalPoints = 0;

    const nonSpamTasks = getPartialHelperNonSpammingTasks(partial);
    if (nonSpamTasks.length) {
      normalPoints = calculateTaskPointsWithMultiplier(
        getResolvableTaskString(nonSpamTasks.join(', ')) || nonSpamTasks.join(', '),
      ).originalTotalCalculatedPoints;
    } else if (!isRemoved) {
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

  return { pointsMap, partialHelpers, spamming: isSpammingRaid(raidInfo), joinedById, endedAt };
}

function buildTaskExpBreakdownSection(raidInfo, { spamming, joinedById, endedAt }) {
  const lines = ['', 'Task EXP Breakdown:'];
  const resolvable = getResolvableTaskString(raidInfo?.task);
  const taskCalc = calculateTaskPointsWithMultiplier(resolvable || '');

  if (spamming) {
    const totalMinutes = getRaidDurationMinutes(joinedById, endedAt);
    const totalSpamExp = totalMinutes * SPAMMING_RATE_PER_MINUTE;
    // Raid-wide: how long the raid stayed open, not how long helpers collectively spent.
    lines.push(`Spamming (Raid Open Duration): ${totalMinutes} minutes = ${totalSpamExp} EXP`);
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
    for (const key of getAttachableTaskKeys(raidInfo)) {
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
  endedAt = new Date(),
}) {
  const partialMap = new Map((partialHelpers || []).map((e) => [e.helperId, e]));
  const removedIds = new Set(
    [...joinedById.values()].filter((h) => h.removedAt).map((h) => h.helperId),
  );
  const totalMinutes = spamming ? getRaidDurationMinutes(joinedById, endedAt) : 0;
  const totalSpamExp = spamming ? totalMinutes * SPAMMING_RATE_PER_MINUTE : 0;
  const totalTaskPoints = calculateTaskPointsWithMultiplier(getResolvableTaskString(raidInfo?.task) || '').originalTotalCalculatedPoints;
  const totalAvailableExp = totalTaskPoints + totalSpamExp;

  const lines = [
    'This thread contains the full details for the raid',
    `**Total EXP Calculated: ${totalAvailableExp} EXP**`,
    '',
    '**Helper earned EXP (capped):**',

  ];


  const fullTaskPoints = calculateTaskPointsWithMultiplier(getResolvableTaskString(raidInfo?.task) || '').originalTotalCalculatedPoints;
  const maxRaidPoints = Math.min(fullTaskPoints + (spamming ? SPAMMING_EXP_CAP : 0), MAX_XP_PER_RAID);

  for (const [uid, points] of Object.entries(pointsMap)) {
    const name = await resolveMemberDisplayName(guild, uid);
    const partial = partialMap.get(uid);
    const helperRow = joinedById.get(uid);
    const isRemoved = removedIds.has(uid);
    const isMaxPoints = points >= maxRaidPoints;

    // Points shown here are what this helper earned (capped), not the raid-wide total.
    lines.push(`${name}: ${points} EXP`);

    if (!isMaxPoints) {
      let taskLabel = getHelperCloseTaskDisplay(raidInfo, partial, isRemoved);
      if (!taskLabel) {
        taskLabel = getRaidTaskFieldDisplay(raidInfo?.task)
          .replace(/(?:^|,\s*)Spamming(?:\s*$|,\s*)?/i, '')
          .replace(/(?:,\s*)$/,'')
          .trim();
      }

      const detailParts = [];
      if (taskLabel) detailParts.push(taskLabel);

      // Intentionally omit per-helper spamming duration from the closing summary to avoid misleading “shared time” wording.
      if (detailParts.length) {
        lines.push(`* Task: ${detailParts.join(', ')}`);
      }
    }
  }


  lines.push(...buildTaskExpBreakdownSection(raidInfo, { spamming, joinedById, endedAt }));

  return lines.join('\n');
}
