import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const closeTicketButton = new ButtonBuilder()
    .setCustomId('closeRaidTicket')
    .setLabel('🔒 Close Raid')
    .setStyle(ButtonStyle.Danger);

export const editRequestButton = new ButtonBuilder()
    .setCustomId('editRequest_btn')
    .setLabel('✏️ Edit Request')
    .setStyle(ButtonStyle.Secondary);

export const cancelTicketButton = new ButtonBuilder()
    .setCustomId('cancelRaidTicket')
    .setLabel('❌ Cancel')
    .setStyle(ButtonStyle.Danger);

export const raidmapsButton = new ButtonBuilder()
    .setCustomId('raidmapsButton')
    .setLabel('🗺️ Maps')
    .setStyle(ButtonStyle.Secondary);

export const threadActionRow = new ActionRowBuilder().addComponents(
    closeTicketButton,
    cancelTicketButton,
    editRequestButton,
    raidmapsButton,
);

