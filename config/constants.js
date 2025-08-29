// config/constants.js

// --- Channel ID's ---
export const RAID_CHANNEL_ID = '1394877134996242636'; // Raid Logs Channel ID 1388854499023519847
export const EXP_LAIR_CHANNEL_ID = '1394877213081604279'; // EXP Lair Channel ID 1388865498065666059
export const LEADERBOARD_CHANNEL_ID = '1394877657421713478'; // Leaderboard Channel ID 1389203721505996903
export const RAID_MANAGEMENT_CHANNEL_ID = '1394877270652358656'; // Raid Logs Message ID 1389420600367251476
export const RAID_CATEGORY_ID = '1394877046961868951'; // Raid Category ID 1394877046961868951
export const LB_BACKUP_CHANNEL_ID = '1410646163299766393'; // Channel ID for leaderboard backups

// --- ROLE ID's --- 
export const RAID_HELPER_ROLE_ID = '1385471833192792115'; // Raid Helper Role ID 1373205396298141696
export const MODERATOR_ROLE_ID = '1274384274333630565'; // Your Moderator Role ID 1373356500252098670
export const OFFICER_ROLE_ID = '1274384274333630565'; // Your Officer Role ID 1373011008888639568
export const RAID_MANAGER_ROLE_ID = '1274384274333630565'; // Your Raid Manager Role ID 1388819716008706129
export const RAID_CHAMPION_ROLE_ID =  '1274384274333630565'; // Record Holder Role ID 1375432757076955258
export const RECORD_HOLDER_ROLE_ID =  '1274384274333630565'; // Record Holder Role ID 1375432757076955258


/* --- my server constants ---
// --- Channel ID's ---
export const RAID_CHANNEL_ID = '1394877134996242636'; // Raid Logs Channel ID 1388854499023519847
export const EXP_LAIR_CHANNEL_ID = '1394877213081604279'; // EXP Lair Channel ID 1388865498065666059
export const LEADERBOARD_CHANNEL_ID = '1394877657421713478'; // Leaderboard Channel ID 1389203721505996903
export const RAID_MANAGEMENT_CHANNEL_ID = '1394877270652358656'; // Raid Logs Message ID 1389420600367251476
export const RAID_CATEGORY_ID = '1394877046961868951'; // Raid Category ID 1394877046961868951
export const LB_BACKUP_CHANNEL_ID = '1410646163299766393'; // Channel ID for leaderboard backups

// --- ROLE ID's ---
export const RAID_HELPER_ROLE_ID = '1385471833192792115'; // Raid Helper Role ID 1373205396298141696
export const MODERATOR_ROLE_ID = '1274384274333630565'; // Your Moderator Role ID 1373356500252098670
export const OFFICER_ROLE_ID = '1274384274333630565'; // Your Officer Role ID 1373011008888639568
export const RAID_MANAGER_ROLE_ID = '1274384274333630565'; // Your Raid Manager Role ID 1388819716008706129
export const RAID_CHAMPION_ROLE_ID =  '1274384274333630565'; // Record Holder Role ID 1375432757076955258
export const RECORD_HOLDER_ROLE_ID =  '1274384274333630565'; // Record Holder Role ID 1375432757076955258
*/

/* --- vanaheim constants ---
// --- Channel ID's ---
export const RAID_CHANNEL_ID = '1388854499023519847'; // Raid Logs Channel ID 1388854499023519847
export const EXP_LAIR_CHANNEL_ID = '1388865498065666059'; // EXP Lair Channel ID 1388865498065666059
export const LEADERBOARD_CHANNEL_ID = '1389203721505996903'; // Leaderboard Channel ID 1389203721505996903
export const RAID_MANAGEMENT_CHANNEL_ID = '1389420600367251476'; // Raid Logs Message ID 1389420600367251476
export const RAID_CATEGORY_ID = '1373033908236714095'; // Raid Category ID 1373033908236714095
export const LB_BACKUP_CHANNEL_ID = '1410646163299766393'; // Channel ID for leaderboard backups

// --- ROLE ID's ---
export const RAID_HELPER_ROLE_ID = '1373205396298141696'; // Raid Helper Role ID 1373205396298141696
export const MODERATOR_ROLE_ID = '1373356500252098670'; // Your Moderator Role ID 1373356500252098670
export const OFFICER_ROLE_ID = '1373011008888639568'; // Your Officer Role ID 1373011008888639568
export const RAID_MANAGER_ROLE_ID = '1388819716008706129'; // Your Raid Manager Role ID 1388819716008706129
export const RAID_CHAMPION_ROLE_ID = '1378322255980920952'; // Raid Champion Role ID 1378322255980920952
export const RECORD_HOLDER_ROLE_ID =  '1274384274333630565'; // Record Holder Role ID 1375432757076955258
*/
export const LEADERBOARD_FILE = 'data/leaderboard.json'; 

export const POINTS_CONFIG = {
    // --- daily tasks ---
    'kala': 1000,
    'iara': 1000,
    'ezrajal': 1000,
    'warden': 1000,
    'engineer': 1000,
    'tyndarius': 1000,     

    // --- temple shrine tasks ---
    'tsleft': 1000,
    'tsmid': 2000, 
    'tsright': 1000,

    // --- weekly tasks ---
    'mechabinky': 5000,     
    'speaker': 4000,
    'gramiel': 3000,     
    'darkon': 3000,     
    'drago': 2000,
    'dage': 2000,
    'nulgath': 2000,
    'drakath': 2000,

    // -- 7 man rooms
    'kathool': 2000,
    'voidnerfkitten' : 2000,
    'lavarockshore': 1000,
    'apexazalith': 1000,    
    'astralshrine': 2000,
    'voidflibbi': 1000,
    'voidnightbane': 1000,
    'voidxyfrag': 1000,

    // --- generic tasks ---
    'simple': 1000,
    'moderate': 5000,
    'hard': 10000,
};

// --- Separate Task Lists for validation and display ---
export const DAILIES_LIST = ['ezrajal', 'warden', 'engineer', 'tyndarius'];
export const WEEKLIES_LIST = ['nulgath', 'drakath', 'dage', 'darkon', 'drago', 'gramiel', 'speaker'];
export const TEMPLESHRINE_LIST = ['tsleft', 'tsmid', 'tsright'];
export const ORIGINUL_LIST = ['voidflibbi', 'voidnightbane', 'voidxyfrag'];
export const OTHERS_FOUR_LIST = ['kala', 'iara']; 
export const OTHERS_SEVEN_LIST = ['mechabinky', 'kathool', 'astralshrine', 'voidnerfkitten', 'lavarockshore', 'apexazalith'];
export const GENERIC_TASKS_LIST = ['simple', 'moderate', 'hard'];

// ALL_ALLOWED_TASK_NAMES should include all valid inputs, including aliases and dynamic check for custom tasks
export const ALLOWED_TASK_NAMES = [
    ...DAILIES_LIST, 'dailies', 'daily',
    ...WEEKLIES_LIST, 'weeklies', 'weekly',
    ...TEMPLESHRINE_LIST, 'templeshrine', 
    ...ORIGINUL_LIST, 'originul',
    ...OTHERS_FOUR_LIST,
    ...OTHERS_SEVEN_LIST,
    ...GENERIC_TASKS_LIST,
];

export const DISPLAY_POINTS_LIST = Object.entries(POINTS_CONFIG).map(([task, points]) => `${task} = ${points} EXP`);

export const MAX_XP_PER_RAID = 30000;   // 30 000 EXP per raid

// --- Task Categories for !taskmaps command ---
export const TASK_MAP_CATEGORIES = {
    'dailies': DAILIES_LIST,
    'daily': DAILIES_LIST, // Alias for 'dailies'
    'weeklies': WEEKLIES_LIST,
    'weekly': WEEKLIES_LIST, // Alias for 'weeklies'
    'templeshrine': TEMPLESHRINE_LIST,
    'originul': ORIGINUL_LIST,
    'othersfour': OTHERS_FOUR_LIST,
    'othersseven': OTHERS_SEVEN_LIST,
    'generic': GENERIC_TASKS_LIST,
};

// --- Mapping for tasks ---
export const TASK_TO_MAP_PREFIX_MAPPING = {
    'ezrajal': 'ultraezrajal',
    'warden': 'ultrawarden',
    'engineer': 'ultraengineer',
    'tyndarius': 'ultratyndarius',
    'kala': 'ultrakala',
    'iara': 'ultraiara',
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
    'apexazalith': 'apexazalith',
};
