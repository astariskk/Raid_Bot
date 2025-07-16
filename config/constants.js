// config/constants.js
// --- Channel ID's ---
export const RAID_CHANNEL_ID = '1394877134996242636';
export const RAID_LOGS_CHANNEL_ID = '1394877168223256586';
export const EXP_LAIR_CHANNEL_ID = '1394877213081604279';
export const LEADERBOARD_CHANNEL_ID = '1394877657421713478'; // Your Leaderboard Channel ID 1389203721505996903
export const RAID_MANAGEMENT_CHANNEL_ID = '1394877270652358656'; // Your Raid Logs Message ID 1389420600367251476

// --- ROLE ID's ---
export const RAID_HELPER_ROLE_ID = '1369140264395997305'; // Your Raid Helper Role ID 1373205396298141696
export const MODERATOR_ROLE_ID = '1274384274333630565'; // Your Moderator Role ID 1373356500252098670
export const OFFICER_ROLE_ID = '1274384274333630565'; // Your Officer Role ID 1373011008888639568
export const RAID_MANAGER_ROLE_ID = '1274384274333630565'; // Your Raid Manager Role ID 1388819716008706129

export const LEADERBOARD_FILE = 'data/leaderboard.json'; 

export const POINTS_CONFIG = {
    'kala': 300,
    'ezrajal': 300,
    'warden': 300,
    'engineer': 300,
    'tyndarius': 300,    
    'speaker': 4000,
    'mechabinky': 5000,
    'gramiel': 3000,    
    'darkon': 2000,    
    'drago': 1000,
    'dage': 1000,
    'nulgath': 1000,
    'drakath': 1000,
    'kathool': 1000,
    'astralshrine': 1000,
    'tsmid': 750,
    'tsleft': 375,
    'tsright': 375,
    'voidflibbi': 300,
    'voidnightbane': 300,
    'voidxyfrag': 300,
    'voidnerfkitten' : 300,
    'lavarockshore': 300,
    'simple': 300,
    'moderate': 2000,
    'hard': 6000,
};

// --- Separate Task Lists for validation and display ---
export const DAILIES_LIST = ['ezrajal', 'warden', 'engineer', 'tyndarius'];
export const WEEKLIES_LIST = ['nulgath', 'drakath', 'dage', 'darkon', 'drago', 'speaker'];
export const TEMPLESHRINE_LIST = ['tsmid', 'tsleft', 'tsright'];
export const ORIGINUL_LIST = ['voidflibbi', 'voidnightbane', 'voidxyfrag']
export const OTHERS_LIST = ['kathool', 'astralshrine', 'mechabinky','voidnerfkitten', 'gramiel', 'kala', 'lavarockshore'];
export const GENERIC_TASKS_LIST = ['simple', 'moderate', 'hard'];

// ALL_ALLOWED_TASK_NAMES should include all valid inputs, including aliases and dynamic check for custom tasks
export const ALLOWED_TASK_NAMES = [
    ...DAILIES_LIST, 'dailies', 'daily',
    ...WEEKLIES_LIST, 'weeklies', 'weekly',
    ...OTHERS_LIST, ...TEMPLESHRINE_LIST, 'templeshrine', 
    ...ORIGINUL_LIST, 'originul',
    ...GENERIC_TASKS_LIST,
];

// Dynamically generate DISPLAY_POINTS_LIST from POINTS_CONFIG for consistency
export const DISPLAY_POINTS_LIST = Object.entries(POINTS_CONFIG).map(([task, points]) => `${task} = ${points} EXP`);

export const MAX_XP_PER_RAID = 20000;

// --- Task Categories for !taskmaps command ---
export const TASK_MAP_CATEGORIES = {
    'dailies': DAILIES_LIST,
    'daily': DAILIES_LIST, // Alias for 'dailies'
    'weeklies': WEEKLIES_LIST,
    'weekly': WEEKLIES_LIST, // Alias for 'weeklies'
    'templeshrine': TEMPLESHRINE_LIST,
    'originul': ORIGINUL_LIST,
    'others': OTHERS_LIST,
    'generic': GENERIC_TASKS_LIST,
};

// --- NEW: Mapping for tasks that have different map prefixes than their task name ---
export const TASK_TO_MAP_PREFIX_MAPPING = {
    'ezrajal': 'ultraezrajal',
    'warden': 'ultrawarden',
    'engineer': 'ultraengineer',
    'tyndarius': 'ultratyndarius',
    'kala': 'ultrakala',
    'nulgath': 'ultranulgath',
    'drakath': 'championdrakath',     
    'dage': 'ultradage',
    'darkon': 'ultradarkon',
    'drago': 'ultradrago',    
    'speaker': 'ultraspeaker',
    'mechabinky': 'grimchallenge',
    'gramiel': 'ultragramiel',
    'voidflibbi': 'voidflibbi',
    'voidnightbane': 'voidnightbane',
    'voidxyfrag': 'voidxyfrag',
    'voidnerfkitten': 'voidnerfkitten',
    'kathool': 'kathooldepths',
    'astralshrine': 'astralshrine',
    'tsmid': 'templeshrine',
    'tsleft': 'templeshrine',
    'tsright': 'templeshrine',
    'lavarockshore': 'lavarockshore',   
};
