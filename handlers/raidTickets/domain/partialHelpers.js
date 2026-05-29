import { getRaidTaskFieldDisplay, getTaskKeys, isSpammingRaid } from '../raidTicketLogic.js';
import { getHelperTotalSeconds } from '../../../utils/raidParticipationStore.js';

const SPAMMING_KEY_PATTERN = (task) => task === 'spamming' || String(task).startsWith('spamming_');

/** Task keys that can be attached to partial helpers (never spamming). */
export function getAttachableTaskKeys(raidInfo) {
  return getTaskKeys(raidInfo?.task || '').filter((key) => !SPAMMING_KEY_PATTERN(key));
}

export function raidHasNonSpammingTasks(raidInfo) {
  return getAttachableTaskKeys(raidInfo).length > 0;
}

export function getPartialHelperNonSpammingTasks(entry) {
  return (entry?.tasks ?? []).filter((task) => !SPAMMING_KEY_PATTERN(task));
}

export function formatNonSpammingTasksDisplay(taskKeys) {
  const keys = (taskKeys || []).filter((key) => !SPAMMING_KEY_PATTERN(key));
  if (!keys.length) return null;
  return getRaidTaskFieldDisplay(keys.join(', '));
}

export function normalizePartialHelpers(raidInfo) {
  if (!isSpammingRaid(raidInfo)) return [];
  const raw = Array.isArray(raidInfo?.partialHelpers) ? raidInfo.partialHelpers : [];
  return raw
    .map((entry) => ({
      helperId: entry?.helperId ? String(entry.helperId) : null,
      tasks: Array.isArray(entry?.tasks) ? entry.tasks.map((t) => String(t).toLowerCase()).filter(Boolean) : [],
      timeSeconds: Number.isFinite(Number(entry?.timeSeconds)) ? Number(entry.timeSeconds) : null,
    }))
    .filter((entry) => entry.helperId);
}

export function getPartialHelperEntry(partialHelpers, helperId) {
  return partialHelpers.find((entry) => String(entry.helperId) === String(helperId)) ?? null;
}

export function formatParticipationDuration(totalSeconds) {
  const seconds = Math.max(0, Number(totalSeconds) || 0);
  if (!seconds) return null;
  const minutes = Math.max(1, Math.floor(seconds / 60));
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours > 0) return `${hours}h ${remainder}m`;
  return `${minutes}m`;
}

export function getPartialHelperDisplaySeconds(helper, partialEntry, { trackTime }) {
  if (!trackTime) return null;
  if (partialEntry?.timeSeconds != null) return partialEntry.timeSeconds;
  return getHelperTotalSeconds(helper);
}

/** Active helpers: `* @user` plus optional `  * Time: …` when spamming is on the raid. */
export function formatActiveHelperEmbedLines(activeHelpers, raidInfo) {
  if (!activeHelpers.length) return 'No helpers yet.';
  const trackTime = isSpammingRaid(raidInfo);

  return activeHelpers
    .map((helper) => {
      const duration = trackTime
        ? formatParticipationDuration(getHelperTotalSeconds(helper))
        : null;
      const timeLine = duration ? `\n  * Time: ${duration}` : '';
      return `* <@${helper.helperId}>${timeLine}`;
    })
    .join('\n');
}

export function formatPartialHelperEmbedLines(midRunPartials, partialHelpers, raidInfo) {
  if (!midRunPartials.length) return '';
  const trackTime = isSpammingRaid(raidInfo);
  const normalized = normalizePartialHelpers(raidInfo);

  return midRunPartials
    .map((helper) => {
      const entry = getPartialHelperEntry(normalized, helper.helperId);
      const nonSpamTasks = getPartialHelperNonSpammingTasks(entry);
      const taskLabel = nonSpamTasks.length
        ? formatNonSpammingTasksDisplay(nonSpamTasks)
        : 'No Task Helped';
      const duration = formatParticipationDuration(
        getPartialHelperDisplaySeconds(helper, entry, { trackTime }),
      );
      const timeLine = duration ? `\n  * Time: ${duration}` : '';
      return `* <@${helper.helperId}>: ${taskLabel}${timeLine}`;
    })
    .join('\n');
}

/** Merge attached tasks; snapshot participation time on spamming raids when tasks are set. */
export function mergePartialHelperAttachments(raidInfo, partialHelpers, { helperIds, tasks, helpers }) {
  if (!isSpammingRaid(raidInfo)) return [];
  const trackTime = true;
  const participationById = new Map((helpers || []).map((row) => [String(row.helperId), row]));
  const cleanedTasks = [...new Set(
    (tasks || []).map((t) => String(t).toLowerCase()).filter((t) => t && !SPAMMING_KEY_PATTERN(t)),
  )];
  let next = [...partialHelpers];

  for (const helperId of helperIds) {
    const existing = getPartialHelperEntry(next, helperId);
    const mergedTasks = [...new Set([
      ...getPartialHelperNonSpammingTasks(existing),
      ...cleanedTasks,
    ])];
    const helperRow = participationById.get(String(helperId));
    const timeSeconds = trackTime && helperRow
      ? getHelperTotalSeconds(helperRow)
      : existing?.timeSeconds ?? null;

    next = next.filter((entry) => entry.helperId !== helperId);
    next.push({
      helperId,
      tasks: mergedTasks,
      ...(timeSeconds != null ? { timeSeconds } : {}),
    });
  }

  return next;
}

export function getRemovedParticipationHelpers(joinedHelpers = [], requesterId = null) {
  return joinedHelpers.filter(
    (helper) => helper.removedAt && String(helper.helperId) !== String(requesterId ?? ''),
  );
}

/** Removed helpers who still need non-spamming tasks attached (mixed raids only). */
export function getPartialHelpersNeedingTaskAttach(raidInfo, joinedHelpers = []) {
  if (!isSpammingRaid(raidInfo) || !raidHasNonSpammingTasks(raidInfo)) return [];

  const partialHelpers = normalizePartialHelpers(raidInfo);
  return getRemovedParticipationHelpers(joinedHelpers, raidInfo?.requesterId).filter((helper) => {
    const entry = getPartialHelperEntry(partialHelpers, helper.helperId);
    return getPartialHelperNonSpammingTasks(entry).length === 0;
  });
}

/** @deprecated use getPartialHelpersNeedingTaskAttach */
export function getPartialHelpersMissingTasks(raidInfo, joinedHelpers = []) {
  return getPartialHelpersNeedingTaskAttach(raidInfo, joinedHelpers);
}

/** Create or keep partial-helper row when someone leaves (tasks default empty). */
export function buildPartialHelperRecordOnLeave(raidInfo, helperId, helpers) {
  const partialHelpers = normalizePartialHelpers(raidInfo);
  if (!isSpammingRaid(raidInfo)) return partialHelpers;
  const existing = getPartialHelperEntry(partialHelpers, helperId);
  if (existing) return partialHelpers;

  const helperRow = (helpers || []).find((row) => String(row.helperId) === String(helperId));
  const timeSeconds = helperRow ? getHelperTotalSeconds(helperRow) : null;

  return [
    ...partialHelpers,
    {
      helperId: String(helperId),
      tasks: [],
      ...(timeSeconds != null ? { timeSeconds } : {}),
    },
  ];
}
