import { getRaidTaskFieldDisplay, isSpammingRaid } from '../raidTicketLogic.js';
import { getHelperTotalSeconds } from '../../../utils/raidParticipationStore.js';

export function normalizePartialHelpers(raidInfo) {
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

export function formatPartialHelperEmbedLines(midRunPartials, partialHelpers, raidInfo) {
  if (!midRunPartials.length) return '';
  const trackTime = isSpammingRaid(raidInfo);
  const normalized = normalizePartialHelpers(raidInfo);

  return midRunPartials
    .map((helper) => {
      const entry = getPartialHelperEntry(normalized, helper.helperId);
      const tasks = entry?.tasks?.length
        ? getRaidTaskFieldDisplay(entry.tasks.join(', '))
        : 'No Task Helped';
      const duration = formatParticipationDuration(
        getPartialHelperDisplaySeconds(helper, entry, { trackTime }),
      );
      const timeLine = duration ? `\n  * Time: ${duration}` : '';
      return `* <@${helper.helperId}>: ${tasks}${timeLine}`;
    })
    .join('\n');
}

/** Merge attached tasks; snapshot participation time on spamming raids when tasks are set. */
export function mergePartialHelperAttachments(raidInfo, partialHelpers, { helperIds, tasks, helpers }) {
  const trackTime = isSpammingRaid(raidInfo);
  const participationById = new Map((helpers || []).map((row) => [String(row.helperId), row]));
  let next = [...partialHelpers];

  for (const helperId of helperIds) {
    const existing = getPartialHelperEntry(next, helperId);
    const mergedTasks = [...new Set([...(existing?.tasks ?? []), ...tasks])];
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

export function getPartialHelpersMissingTasks(raidInfo, joinedHelpers = []) {
  if (isSpammingRaid(raidInfo)) return [];
  const partialHelpers = normalizePartialHelpers(raidInfo);
  const withTasks = new Set(partialHelpers.filter((e) => e.tasks?.length).map((e) => e.helperId));
  return getRemovedParticipationHelpers(joinedHelpers, raidInfo?.requesterId)
    .filter((helper) => !withTasks.has(helper.helperId));
}
