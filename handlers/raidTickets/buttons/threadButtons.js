import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const joinTicketButton = new ButtonBuilder()
    .setCustomId('joinRaidTicket')
    .setLabel('Join Ticket')
    .setStyle(ButtonStyle.Success);

export const closeTicketButton = new ButtonBuilder()
    .setCustomId('closeRaidTicket')
    .setLabel('Close Raid')
    .setStyle(ButtonStyle.Danger);

export const editRequestButton = new ButtonBuilder()
    .setCustomId('editRequest_btn')
    .setLabel('Edit Request')
    .setStyle(ButtonStyle.Secondary);

export const editTasksButton = new ButtonBuilder()
    .setCustomId('editRequest_tasks_btn')
    .setLabel('Edit Tasks')
    .setStyle(ButtonStyle.Secondary);

export const editServerButton = new ButtonBuilder()
    .setCustomId('editRequest_details_btn')
    .setLabel('Edit Server')
    .setStyle(ButtonStyle.Secondary);

export const cancelTicketButton = new ButtonBuilder()
    .setCustomId('cancelRaidTicket')
    .setLabel('Cancel Raid')
    .setStyle(ButtonStyle.Danger);

export const raidmapsButton = new ButtonBuilder()
    .setCustomId('raidmapsButton')
    .setLabel('Maps')
    .setStyle(ButtonStyle.Secondary);

export const threadActionRow = new ActionRowBuilder().addComponents(joinTicketButton, closeTicketButton, cancelTicketButton, raidmapsButton);

export function getEditRequestRow() {
    return new ActionRowBuilder().addComponents(editTasksButton, editServerButton);
}

export function getThreadActionRow() {
    return new ActionRowBuilder().addComponents(joinTicketButton, closeTicketButton, cancelTicketButton, raidmapsButton);
}

export function getHelperKickRows(helpers = []) {
    const rows = [];
    const helperIds = helpers
        .map((helper) => String(helper?.helperId ?? '').trim())
        .filter(Boolean)
        .slice(0, 10);

    for (let i = 0; i < helperIds.length; i += 5) {
        const row = new ActionRowBuilder();
        helperIds.slice(i, i + 5).forEach((helperId, index) => {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`kickRaidHelper_${helperId}`)
                    .setLabel(`Kick Helper ${i + index + 1}`)
                    .setStyle(ButtonStyle.Secondary),
            );
        });
        rows.push(row);
    }

    return rows;
}

export function buildRaidRequestComponents(helpers = []) {
    return [
        getEditRequestRow(),
        getThreadActionRow(),
        ...getHelperKickRows(helpers),
    ].slice(0, 5);
}
