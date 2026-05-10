// config/constants/maps.js
import { TASK_JOIN_PREFIXES, getJoinPrefixesForTask } from './tasks.js';

export { TASK_JOIN_PREFIXES };

export function getJoinPrefixes(taskKey) {
  return getJoinPrefixesForTask(taskKey);
}

