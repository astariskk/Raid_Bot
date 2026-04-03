import { EmbedBuilder } from 'discord.js';
import { EMBED_COLOR, getJoinPrefixes } from '../config/constants.js';

export function generateRaidMapsEmbed(tasks, mapNumber) {
    const normalizedTasks = [];
    
    for (const task of tasks) {
        const normalized = String(task ?? '').trim().toLowerCase();
        if (!normalized) continue;
        normalizedTasks.push(normalized);
    }

    // Ensure mapNumber is a string for consistent join
    const finalMapNumber = String(mapNumber); 

    const joinLinksWithPoints = normalizedTasks
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
