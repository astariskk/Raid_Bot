import { EmbedBuilder } from 'discord.js';
import { EMBED_COLOR } from '../config/constants.js';
import { getJoinPrefixesForRaid } from '../handlers/raidTickets/raidTicketPresentation.js';

export function generateRaidMapsEmbed(tasksOrRaidInfo, mapNumber) {
    const raidInfo = tasksOrRaidInfo && typeof tasksOrRaidInfo === 'object' && 'task' in tasksOrRaidInfo
        ? tasksOrRaidInfo
        : { task: Array.isArray(tasksOrRaidInfo) ? tasksOrRaidInfo.join(', ') : String(tasksOrRaidInfo ?? '') };

    const finalMapNumber = String(mapNumber ?? '').trim();

    // If map number is missing, do not attempt to build join links.
    if (!finalMapNumber) {
        return new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle(`Raid Maps for this raid:`)
            .setDescription('No map number is set yet. Edit the ticket to add a map number.');
    }

    const prefixes = getJoinPrefixesForRaid(raidInfo);

    const joinLinksWithPoints = prefixes
        .map((prefix) => `\`\`\`/join ${prefix}-${finalMapNumber}\`\`\``)
        .join('\n');

    // discord.js/builders rejects empty string description values.
    const description = joinLinksWithPoints.trim()
        ? joinLinksWithPoints
        : 'No map links are available for this raid yet. Edit the ticket and add a map name or task with a join map.';

    return new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle(`Raid Maps for this raid:`)
        .setDescription(description);
}

export function parseRaidTasks(raidTasksString) {
    return raidTasksString.split(/\s*[+,]\s*/).map(t => t.trim().toLowerCase());
}

