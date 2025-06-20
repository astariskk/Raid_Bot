// config/constants.js

export const RAID_CHANNEL_ID = '1385452423291600966';
export const RAID_LOGS_CHANNEL_ID = '1385452747544985682';
export const EXP_LAIR_CHANNEL_ID = '1385500247593193502';
export const RAID_HELPER_ROLE_ID = '1385471833192792115';

export const LEADERBOARD_FILE = '../data/leaderboard.json'; // Recommend using a path like this if it's in a 'data' folder

export const POINTS_CONFIG = {
    'weekly': 8000,
    'ultra weekly': 10000, // Added explicit points for ultra weekly
    'speaker': 3000,
    'daily': 1000,
    'ultra daily': 1500, // Added explicit points for ultra daily
    'drago': 1000,
    'darkon': 2000,
    'dage': 1000,
    'nulgath': 1000,
    'drakath': 500,
    'ezrajal': 200,
    'warden': 300,
    'engineer': 200,
    'tyndarius': 300,
    'kathool': 300
};

// --- Separate Task Lists for validation and display ---
// Use the primary names from POINTS_CONFIG
export const DAILIES_LIST = ['daily', 'ultra daily', 'ezrajal', 'warden', 'engineer', 'tyndarius', 'kathool'];
export const WEEKLIES_LIST = ['weekly', 'ultra weekly', 'nulgath', 'drakath', 'dage', 'darkon', 'drago', 'speaker'];

// ALLOWED_TASK_NAMES should include all valid inputs, including aliases if you want them
export const ALLOWED_TASK_NAMES = [
    ...DAILIES_LIST,
    ...WEEKLIES_LIST,
    // Add aliases here if users might type them differently but mean the same thing
    'dailies', // Alias for 'daily'
    'weeklies', // Alias for 'weekly'
];

// Dynamically generate DISPLAY_POINTS_LIST from POINTS_CONFIG for consistency
export const DISPLAY_POINTS_LIST = Object.entries(POINTS_CONFIG).map(([task, points]) => `${task}: ${points} EXP`);