import { BLUE_EMBED_COLOR } from './ui.js';

export const RAID_STATUS = Object.freeze({
  WAITING: 'Waiting',
  ONGOING: 'Ongoing',
  FULL: 'Full',
  ADMIN_REVIEW: 'admin_review',
  AWAITING_COMPLETION: 'awaiting_completion',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

export const MAX_HELPERS = 10;

// Prefer STATUS_COLORS from ui.js for Waiting/Ongoing/Full. This is a fallback + single place to map status -> color.
export const RAID_STATUS_COLORS = Object.freeze({
  [RAID_STATUS.WAITING]: BLUE_EMBED_COLOR,
  [RAID_STATUS.ONGOING]: 0x78b159,
  [RAID_STATUS.FULL]: 0xdd2e44,
});
