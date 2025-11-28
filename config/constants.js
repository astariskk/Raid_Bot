// config/constants.js

// --- Channel ID's ---
export const RAID_CHANNEL_ID = '1394877134996242636'; 
export const EXP_LAIR_CHANNEL_ID = '1394877213081604279'; 
export const LEADERBOARD_CHANNEL_ID = '1394877657421713478'; 
export const RAID_MANAGEMENT_CHANNEL_ID = '1394877270652358656'; 
export const RAID_CATEGORY_ID = '1394877046961868951'; 
export const LB_BACKUP_CHANNEL_ID = '1410646163299766393'; 

// --- ROLE ID's --- 
export const RAID_HELPER_ROLE_ID = '1385471833192792115'; // Warrior 1385471833192792115
export const MODERATOR_ROLE_ID = '1274384274333630565'; // Patient Zero 1274384274333630565
export const OFFICER_ROLE_ID = '1274384274333630565'; //  Patient Zero  1373011008888639568
export const RAID_MANAGER_ROLE_ID = '1274384274333630565'; // Patient Zero  1388819716008706129
export const RAID_CHAMPION_ROLE_ID =  '1274384274333630565'; // Patient Zero 1375432757076955258
export const RECORD_HOLDER_ROLE_ID =  '1274384274333630565'; // Patient Zero  1375432757076955258


/* --- my server constants ---
// --- Channel ID's ---
export const RAID_CHANNEL_ID = '1394877134996242636'; 
export const EXP_LAIR_CHANNEL_ID = '1394877213081604279'; 
export const LEADERBOARD_CHANNEL_ID = '1394877657421713478'; 
export const RAID_MANAGEMENT_CHANNEL_ID = '1394877270652358656'; 
export const RAID_CATEGORY_ID = '1394877046961868951'; 
export const LB_BACKUP_CHANNEL_ID = '1410646163299766393'; 

// --- ROLE ID's --- 
export const RAID_HELPER_ROLE_ID = '1385471833192792115'; // Warrior 1385471833192792115
export const MODERATOR_ROLE_ID = '1274384274333630565'; // Patient Zero 1274384274333630565
export const OFFICER_ROLE_ID = '1274384274333630565'; //  Patient Zero  1373011008888639568
export const RAID_MANAGER_ROLE_ID = '1274384274333630565'; // Patient Zero  1388819716008706129
export const RAID_CHAMPION_ROLE_ID =  '1274384274333630565'; // Patient Zero 1375432757076955258
export const RECORD_HOLDER_ROLE_ID =  '1274384274333630565'; // Patient Zero  1375432757076955258
*/

/* --- vanaheim constants ---
// --- Channel ID's ---
export const RAID_CHANNEL_ID = '1388854499023519847'; 
export const EXP_LAIR_CHANNEL_ID = '1388865498065666059'; 
export const LEADERBOARD_CHANNEL_ID = '1389203721505996903'; 
export const RAID_MANAGEMENT_CHANNEL_ID = '1389420600367251476'; 
export const RAID_CATEGORY_ID = '1373033908236714095'; 
export const LB_BACKUP_CHANNEL_ID = '1410646163299766393'; 

// --- ROLE ID's ---
export const RAID_HELPER_ROLE_ID = '1373205396298141696'; // Raid Helper 1373205396298141696
export const MODERATOR_ROLE_ID = '1373356500252098670'; // Moderator 1373356500252098670
export const OFFICER_ROLE_ID = '1373011008888639568'; // Officer 1373011008888639568
export const RAID_MANAGER_ROLE_ID = '1388819716008706129'; //  Raid Manager 1388819716008706129
export const RAID_CHAMPION_ROLE_ID = '1378322255980920952'; // Raid Champion 1378322255980920952
export const RECORD_HOLDER_ROLE_ID =  '1274384274333630565'; // Record Holder 1375432757076955258
*/

export const LEADERBOARD_FILE = 'data/leaderboard.json'; 

export const POINTS_CONFIG = {
    // --- daily tasks ---
    'ezrajal': 1000,
    'warden': 1000,
    'engineer': 1000,
    'tyndarius': 1000,     

    // --- other four ---
    'kala': 1000,
    'iara': 1000,

    // --- temple shrine tasks ---
    'tsleft': 1000,
    'tsmid': 2000, 
    'tsright': 1000,

    // --- weekly tasks ---
    'speaker': 4000,   
    'gramiel': 3000,     
    'darkon': 3000,     
    'drago': 1000,
    'dage': 2000,
    'nulgath': 2000,
    'drakath': 2000,

    // -- other seven ---
    'mechabinky': 5000,  
    'astralshrine': 3000,    
    'kathool': 2000,
    'voidnerfkitten' : 1000,
    'lavarockshore': 1000,
    'apexazalith': 1000,    

    // -- originul
    'voidflibbi': 1000,
    'voidnightbane': 1000,
    'voidxyfrag': 1000,

    // --- generic tasks ---
    'simple': 1000,
    'moderate': 5000,
    'hard': 10000,

    // --- Legion ---
    'deimos': 500,
    'beast' : 500,
    'lichlord': 500,
};

// --- Separate Task Lists for validation and display ---
export const DAILIES_LIST = ['ezrajal', 'warden', 'engineer', 'tyndarius'];
export const WEEKLIES_LIST = ['nulgath', 'drakath', 'dage', 'darkon', 'drago', 'gramiel', 'speaker'];
export const TEMPLESHRINE_LIST = ['tsleft', 'tsmid', 'tsright'];
export const ORIGINUL_LIST = ['voidflibbi', 'voidnightbane', 'voidxyfrag'];
export const OTHERS_FOUR_LIST = ['kala', 'iara']; 
export const OTHERS_SEVEN_LIST = ['mechabinky', 'kathool', 'astralshrine', 'voidnerfkitten', 'lavarockshore', 'apexazalith'];
export const GENERIC_TASKS_LIST = ['simple', 'moderate', 'hard'];
export const LEGION_LIST = ['deimos', 'beast', 'lichlord'];

// ALL_ALLOWED_TASK_NAMES should include all valid inputs, including aliases and dynamic check for custom tasks
export const ALLOWED_TASK_NAMES = [
    ...DAILIES_LIST, 'dailies', 'daily',
    ...WEEKLIES_LIST, 'weeklies', 'weekly',
    ...TEMPLESHRINE_LIST, 'templeshrine', 
    ...ORIGINUL_LIST, 'originul',
    ...LEGION_LIST, 'legion',
    ...OTHERS_FOUR_LIST,
    ...OTHERS_SEVEN_LIST,
    ...GENERIC_TASKS_LIST,
];

export const ALLOWED_TASK_FOUR = [
    ...DAILIES_LIST, 'daily', 'dailies',
    ...WEEKLIES_LIST, 'weekly', 'weeklies',
    ...TEMPLESHRINE_LIST,
    ...OTHERS_FOUR_LIST,
    ...GENERIC_TASKS_LIST
];

export const ALLOWED_TASK_SEVEN = [
    ...ORIGINUL_LIST, 'originul',
    ...OTHERS_SEVEN_LIST,
    ...GENERIC_TASKS_LIST,
    ...LEGION_LIST, 'legion'
]

export const DISPLAY_POINTS_LIST = Object.entries(POINTS_CONFIG).map(([task, points]) => `${task} = ${points} EXP`);

export const MAX_XP_PER_RAID = 30000;   // 30 000 EXP per raid

export const TASK_ALIASES = {
    // --- weeklies ---
    'ultradage': 'dage',
    'dave': 'dage',
    'david': 'dage',

    'ultraspeaker': 'speaker',
    'malgor' : 'speaker',
    'malgae' : 'speaker',
    'malg' : 'speaker',
    'spika' : 'speaker',
    'yapper' : 'speaker',

    'championdrakath': 'drakath',
    'drak': 'drakath',
    'drakky' : 'drakath',

    'ultranulgath': 'nulgath',   
    'nully' : 'nulgath',
    'nul': 'nulgath',
    'nulg': 'nulgath',
    'nugget' : 'nulgath',

    'ultradarkon': 'darkon',
    'dark' : 'darkon',

    'ultradrago': 'drago',
    'drag': 'drago',    
    
    'ultragramiel' : 'gramiel',
    'gram' : 'gramiel',
    'grammy' : 'gramiel',

    // --- dailies ---
    'ultraezrajal': 'ezrajal',
    'ezra' : 'ezrajal',
    'ultrawarden': 'warden',
    'ward' : 'warden',     
    'ultraengineer': 'engineer',
    'engi': 'engineer',
    'ultratyndarius': 'tyndarius',
    'tyn': 'tyndarius',
    'tynd' : 'tyndarius',
    'thundarius' : 'tyndarius',

    // --- templeshrine ---
    'tleft': 'tsleft',
    'tmid': 'tsmid',
    'tright': 'tsright',
    'templeshrineleft': 'tsleft',
    'templeshrinemid': 'tsmid',
    'templeshrineright': 'tsright',

    // --- others four ---
    'ultrakala': 'kala',
    'pregnantman': 'kala',
    'ultraiara': 'iara',
    'ariel' : 'iara',

    // --- legion ---
    'sevencircleswar': 'beast',
    'mrbeast': 'beast',
    'lich': 'lichlord',

    // --- originul ---
    'flibbi': 'voidflibbi',
    'nightbane': 'voidnightbane',
    'xyfrag': 'voidxyfrag',

    // --- other seven ---
    'grimchallenge': 'mechabinky',
    'stupidhorse': 'mechabinky',
    'dabinky' : 'mechabinky',
    
    'kathooldepths': 'kathool',
    'kathy': 'kathool',
    'katherine': 'kathool',
    'takoyaki': 'kathool',

    'nerfkitten': 'voidnerfkitten',
    'astral': 'astralshrine',
    'lava': 'lavarockshore', 
    'lavarock': 'lavarockshore',
    'rockshore': 'lavarockshore',
    'apex': 'apexazalith',

    // -- generic tasks ---
    'easy': 'simple',
    'medium': 'moderate',
    'difficult': 'hard',
};

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
    'legion': LEGION_LIST,
};

export const TASK_TO_MAP_PREFIX_MAPPING = {

    // --- dailies ---
    'ezrajal': 'ultraezrajal',
    'warden': 'ultrawarden',
    'engineer': 'ultraengineer',
    'tyndarius': 'ultratyndarius',
    'kala': 'ultrakala',
    'iara': 'ultraiara',

    // --- weeklies ---
    'nulgath': 'ultranulgath',
    'drakath': 'championdrakath',     
    'dage': 'ultradage',
    'darkon': 'ultradarkon',
    'drago': 'ultradrago',     
    'speaker': 'ultraspeaker',
    'gramiel': 'ultragramiel',
    
    // --- originul ---
    'voidflibbi': 'voidflibbi',
    'voidnightbane': 'voidnightbane',
    'voidxyfrag': 'voidxyfrag',

    // --- other seven ---
    'mechabinky': 'grimchallenge',    
    'voidnerfkitten': 'voidnerfkitten',
    'kathool': 'kathooldepths',
    'astralshrine': 'astralshrine',
    'lavarockshore': 'lavarockshore',   
    'apexazalith': 'apexazalith',

    // --- other seven ---
    'tsmid': 'templeshrine',
    'tsleft': 'templeshrine',
    'tsright': 'templeshrine',
    
    // --- legion ---
    'deimos': 'deimos',
    'beast': 'sevencircleswar',
    'lichlord' : 'frozenlair',
};
