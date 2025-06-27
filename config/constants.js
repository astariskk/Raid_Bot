export const RAID_CHANNEL_ID = '1385452423291600966';
export const RAID_LOGS_CHANNEL_ID = '1387781279919112284';
export const EXP_LAIR_CHANNEL_ID = '1387799141203181638';
export const RAID_HELPER_ROLE_ID = '1385471833192792115';

// --- IMPORTANT: Using forward slash for cross-platform compatibility ---
export const LEADERBOARD_FILE = 'data/leaderboard.json'; 

export const POINTS_CONFIG = {
    'ezrajal': 200,
    'warden': 300,
    'engineer': 200,
    'tyndarius': 300,    
    'speaker': 3000,
    'mechabinky': 3000,
    'drago': 1000,
    'darkon': 2000,
    'dage': 1000,
    'nulgath': 1000,
    'drakath': 1000,
    'kathool': 300,
    'astralshrine': 300,
    'tsmid': 1250,
    'tsleft': 375,
    'tsright': 375,
};

// --- Separate Task Lists for validation and display ---
export const DAILIES_LIST = ['ezrajal', 'warden', 'engineer', 'tyndarius'];
export const WEEKLIES_LIST = ['nulgath', 'drakath', 'dage', 'darkon', 'drago', 'speaker'];
export const OTHERS_LIST = ['kathool', 'astralshrine', 'Mechabinky'];
export const TEMPLESHRINE_LIST = ['tsmid', 'tsleft', 'tsright'];

// ALL_ALLOWED_TASK_NAMES should include all valid inputs, including aliases
export const ALLOWED_TASK_NAMES = [
    ...DAILIES_LIST, 'dailies', 'daily',
    ...WEEKLIES_LIST, 'weeklies', 'weekly',
    ...OTHERS_LIST, ...TEMPLESHRINE_LIST, 'templeshrine', 
];

// Dynamically generate DISPLAY_POINTS_LIST from POINTS_CONFIG for consistency
export const DISPLAY_POINTS_LIST = Object.entries(POINTS_CONFIG).map(([task, points]) => `${task} = ${points} EXP`);
