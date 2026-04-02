import { EmbedBuilder } from 'discord.js';
import { EMBED_COLOR, TASK_ALIASES, TASK_GROUPS, getJoinPrefixes } from '../config/constants.js';

export function generateRaidMapsEmbed(tasks, mapNumber) {
    let expandedTasks = [];
    
    for (const task of tasks) {
        const resolved = TASK_ALIASES[task] || task;
        if (TASK_GROUPS[resolved]) {
            expandedTasks = expandedTasks.concat(TASK_GROUPS[resolved]);
        } else {
            expandedTasks.push(resolved);
        }
    }

    // Ensure mapNumber is a string for consistent join
    const finalMapNumber = String(mapNumber); 

    const joinLinksWithPoints = expandedTasks
        .flatMap(task => {
            const prefixes = getJoinPrefixes(task);
            return prefixes.map(prefix => `\`\`\`/join ${prefix}-${finalMapNumber}\`\`\``);
        })
        .join('\n');


    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`Raid Maps for this raid:`)
        .setDescription(`${joinLinksWithPoints}`)
}

export function parseRaidTasks(raidTasksString) {
    return raidTasksString.split(/\s*[+,]\s*/).map(t => t.trim().toLowerCase());
}
