import { MAX_XP_PER_RAID } from '../../../config/constants.js';
import { calculateTaskPointsWithMultiplier } from '../../../utils/taskCalculations.js';
import {
  calculateSpammingPoints,
  getHelperTotalMinutes,
} from '../../../utils/raidParticipationStore.js';
import {
  getNormalTaskString,
  getRaidTaskFieldDisplay,
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

/**
 * Build helperId -> EXP awarded for raid close.
 */
export function buildClosePointsMap(raidInfo, joinedHelpers, selectedHelperIds = []) {
  const partialHelpers = normalizePartialHelpers(raidInfo);
  const partialsWithTasks = partialHelpers.filter((p) => p.tasks?.length > 0);
  const activeIds = joinedHelpers.filter((h) => !h.removedAt).map((h) => h.helperId);
  const removedIds = joinedHelpers.filter((h) => h.removedAt).map((h) => h.helperId);
  const spamming = isSpammingRaid(raidInfo);

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
    const spammingPoints = spamming && helperRow
      ? calculateSpammingPoints({
        helper: helperRow,
        endedAt,
        ratePerMinute: SPAMMING_RATE_PER_MINUTE,
        cap: SPAMMING_EXP_CAP,
      })
      : 0;

    pointsMap[uid] = Math.min(normalPoints + spammingPoints, MAX_XP_PER_RAID);
  }

  return { pointsMap, partialHelpers, spamming, joinedById, endedAt };
}

export function buildExpLairThreadBreakdown(raidInfo, pointsMap, { partialHelpers, spamming, joinedById }) {
  const lines = ['This thread contains the full details for the raid\n'];
  const totalAwarded = Object.values(pointsMap).reduce((sum, n) => sum + n, 0);

  lines.push(`**Total EXP awarded to helpers:** ${totalAwarded} EXP\n`);
  lines.push('**Points awarded to Helpers:**\n');

  const partialMap = new Map(
    partialHelpers.filter((e) => e.tasks?.length).map((e) => [e.helperId, e]),
  );

  for (const [uid, points] of Object.entries(pointsMap)) {
    lines.push(`<@${uid}>: ${points} EXP`);
    const partial = partialMap.get(uid);
    if (partial?.tasks?.length) {
      lines.push(`* Tasks: ${getRaidTaskFieldDisplay(partial.tasks.join(', '))}`);
    }
    const helperRow = joinedById.get(uid);
    if (spamming && helperRow) {
      const minutes = getHelperTotalMinutes(helperRow);
      const spamOnly = calculateSpammingPoints({
        helper: helperRow,
        ratePerMinute: SPAMMING_RATE_PER_MINUTE,
        cap: SPAMMING_EXP_CAP,
      });
      lines.push(`* Spamming: ${minutes} min × ${SPAMMING_RATE_PER_MINUTE} EXP/min = ${spamOnly} EXP`);
    }
    lines.push('');
  }

  const resolvable = getResolvableTaskString(raidInfo?.task);
  const taskCalc = calculateTaskPointsWithMultiplier(resolvable || '');
  if (taskCalc.calculatedBreakdown.length) {
    lines.push('**Task EXP reference (listed tasks):**\n');
    for (const row of taskCalc.calculatedBreakdown) {
      lines.push(`* ${row}`);
    }
  } else if (spamming) {
    lines.push(`**Task:** ${getRaidTaskFieldDisplay(raidInfo?.task)}`);
    lines.push(`* Spamming raids use **${SPAMMING_RATE_PER_MINUTE} EXP per minute** in ticket (cap ${SPAMMING_EXP_CAP} EXP per helper).`);
  } else if (getRaidTaskFieldDisplay(raidInfo?.task) !== 'None') {
    lines.push(`**Task:** ${getRaidTaskFieldDisplay(raidInfo?.task)}`);
    lines.push('* Task EXP follows partial helper task assignments or manual staff review for generic runs.');
  }

  if (taskCalc.unknownTasks?.length) {
    lines.push('\n⚠️ **Unrecognized task keys (no static EXP table):**');
    for (const t of taskCalc.unknownTasks) {
      lines.push(`* \`${t}\``);
    }
  }

  return lines.join('\n').trim();
}
