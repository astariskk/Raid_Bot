import { EmbedBuilder } from 'discord.js';
import { TASK_MAP_CATEGORIES, TASK_TO_MAP_PREFIX_MAPPING } from '../config/constants.js';

export function generateRaidMapsEmbed(tasks, mapNumber) {
    let expandedTasks = [];
    
    for (const task of tasks) {
        if (TASK_MAP_CATEGORIES[task]) {
            expandedTasks = expandedTasks.concat(TASK_MAP_CATEGORIES[task]);
        } else {
            expandedTasks.push(task);
        }
    }

    // Ensure mapNumber is a string for consistent join
    const finalMapNumber = String(mapNumber); 

    const joinLinksWithPoints = expandedTasks.map(task => {
        const mapPrefix = TASK_TO_MAP_PREFIX_MAPPING[task] || task;
        return `* /join ${mapPrefix}-${finalMapNumber}`;
    }).join('\n');

    return new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`Raid Maps for this raid:`)
        .setDescription(`${joinLinksWithPoints}`)
}

export function parseRaidTasks(raidTasksString) {
    return raidTasksString.split(/\s*[+,]\s*/).map(t => t.trim().toLowerCase());
}