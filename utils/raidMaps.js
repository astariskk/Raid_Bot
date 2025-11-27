import { EmbedBuilder } from 'discord.js';
import { TASK_MAP_CATEGORIES, TASK_TO_MAP_PREFIX_MAPPING } from '../config/constants.js';
import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';

export function getRaidMapsModal(raidInfo) {
    const modal = new ModalBuilder()
        .setCustomId('raidMapsModal')
        .setTitle('Enter Raid Map Number');

    const mapNumberInput = new TextInputBuilder()
        .setCustomId('raidMapNumberInput')
        .setLabel('Map number (1212, 2323 ...)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter a number...')
        .setRequired(true);

    const row = new ActionRowBuilder().addComponents(mapNumberInput);
    modal.addComponents(row);
    return modal;
}

export function generateRaidMapsEmbed(tasks, mapNumber) {
    let expandedTasks = [];

    for (const task of tasks) {
        if (TASK_MAP_CATEGORIES[task]) {
            expandedTasks = expandedTasks.concat(TASK_MAP_CATEGORIES[task]);
        } else {
            expandedTasks.push(task);
        }
    }

    const joinLinksWithPoints = expandedTasks.map(task => {
        const mapPrefix = TASK_TO_MAP_PREFIX_MAPPING[task] || task;
        return `* /join ${mapPrefix}-${mapNumber}`;
    }).join('\n');

    return new EmbedBuilder()
        .setColor(0x0099FF)
        .setTitle(`Raid Maps for this raid:`)
        .setDescription(`Here are the join commands:\n\n${joinLinksWithPoints}`)
        .setFooter({ text: 'Use the number to join the correct map instance.' });
}

export function parseRaidTasks(raidTasksString) {
    return raidTasksString.split(/\s*[+,]\s*/).map(t => t.trim().toLowerCase());
}
