import { EmbedBuilder } from 'discord.js';
import { EMBED_COLOR } from '../config/constants.js';
import { getJoinPrefixesForRaid } from '../handlers/raidTickets/raidTicketPresentation.js';

export function generateRaidMapsEmbed(tasksOrRaidInfo, mapNumber) {
    const raidInfo = tasksOrRaidInfo && typeof tasksOrRaidInfo === 'object' && 'task' in tasksOrRaidInfo
        ? tasksOrRaidInfo
        : { task: Array.isArray(tasksOrRaidInfo) ? tasksOrRaidInfo.join(', ') : String(tasksOrRaidInfo ?? '') };

    const finalMapNumber = String(mapNumber);
    const prefixes = getJoinPrefixesForRaid(raidInfo);

    const joinLinksWithPoints = prefixes
        .map((prefix) => `\`\`\`/join ${prefix}-${finalMapNumber}\`\`\``)
        .join('\n');


    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`Raid Maps for this raid:`)
        .setDescription(`${joinLinksWithPoints}`)
}

export function parseRaidTasks(raidTasksString) {
    return raidTasksString.split(/\s*[+,]\s*/).map(t => t.trim().toLowerCase());
}
