import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';

export const joinTicketButton = new ButtonBuilder()
    .setCustomId('joinRaidTicket')
    .setLabel('➕ Join Raid')
    .setStyle(ButtonStyle.Success);

export const closeTicketButton = new ButtonBuilder()
    .setCustomId('closeRaidTicket')
    .setLabel('🔒 Close Raid')
    .setStyle(ButtonStyle.Danger);

export const editRequestButton = new ButtonBuilder()
    .setCustomId('editRequest_btn')
    .setLabel('✏️ Edit Raid')
    .setStyle(ButtonStyle.Secondary);

export const editTasksButton = new ButtonBuilder()
    .setCustomId('editRequest_tasks_btn')
    .setLabel('📋 Edit Tasks')
    .setStyle(ButtonStyle.Secondary);

export const editMapServerButton = new ButtonBuilder()
    .setCustomId('editRequest_details_btn')
    .setLabel('🗺️ Edit Map & Server')
    .setStyle(ButtonStyle.Secondary);

/** @deprecated use editMapServerButton */
export const editServerButton = editMapServerButton;

export const editDescriptionButton = new ButtonBuilder()
    .setCustomId('editRequest_description_btn')
    .setLabel('📝 Edit Description')
    .setStyle(ButtonStyle.Secondary);

export const cancelTicketButton = new ButtonBuilder()
    .setCustomId('cancelRaidTicket')
    .setLabel('❌ Cancel Raid')
    .setStyle(ButtonStyle.Danger);

export const raidmapsButton = new ButtonBuilder()
    .setCustomId('raidmapsButton')
    .setLabel('🗺️ Show Maps')
    .setStyle(ButtonStyle.Success);

export const pingHelpersButton = new ButtonBuilder()
    .setCustomId('pingHelpersButton')
    .setLabel('📣 Ping Helpers')
    .setStyle(ButtonStyle.Secondary);

export const addHelperButton = new ButtonBuilder()
    .setCustomId('addHelperButton')
    .setLabel('➕ Add Helper')
    .setStyle(ButtonStyle.Secondary);

export const threadActionRow = new ActionRowBuilder().addComponents(joinTicketButton, raidmapsButton, closeTicketButton, cancelTicketButton);

export function getEditRequestRow() {
    return new ActionRowBuilder().addComponents(editTasksButton, editServerButton, editDescriptionButton);
}

export function getThreadActionRow() {
    return new ActionRowBuilder().addComponents(joinTicketButton, raidmapsButton, closeTicketButton, cancelTicketButton);
}

export function getHelperKickRows(helpers = []) {
    const rows = [];
    const helperEntries = helpers
        .map((helper) => ({
            helperId: String(helper?.helperId ?? '').trim(),
            displayName: String(helper?.displayName ?? '').trim(),
        }))
        .filter((helper) => helper.helperId)
        .slice(0, 10);

    for (let i = 0; i < helperEntries.length; i += 5) {
        const row = new ActionRowBuilder();
        helperEntries.slice(i, i + 5).forEach((helper, index) => {
            const name = helper.displayName || `Helper ${i + index + 1}`;
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`kickRaidHelper_${helper.helperId}`)
                    .setLabel(`Kick ${name}`.slice(0, 80))
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
        ...getHelperKickRows(helpers),
        getThreadActionRow(),
    ].slice(0, 5);
}

export function getCloseConfirmRow({ proofImageUrl } = {}) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('confirmCloseSelection')
            .setLabel('🔒 Confirm Close')
            .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
            .setCustomId('provideProof')
            .setLabel(proofImageUrl ? '✅ Proof Attached' : ' 📸 Attach Proof')
            .setStyle(ButtonStyle.Success),            
        new ButtonBuilder()
            .setCustomId('abortCloseRaid')
            .setLabel('❌ Cancel Closing')
            .setStyle(ButtonStyle.Danger),
    );
}

export function getKickHelperButton(helper, fallbackLabel = 'Helper') {
    const helperId = String(helper?.helperId ?? '').trim();
    return new ButtonBuilder()
        .setCustomId(`kickRaidHelper_${helperId}`)
        .setLabel('Kick Helper')
        .setStyle(ButtonStyle.Danger);
}

export function getTaskHelpedButton(helper) {
    const helperId = String(helper?.helperId ?? '').trim();
    return new ButtonBuilder()
        .setCustomId(`taskHelped_${helperId}`)
        .setLabel('Task Helped')
        .setStyle(ButtonStyle.Secondary);
}

export function getHelperControlRow(helper, { showTaskHelped = false } = {}) {
    const components = [getKickHelperButton(helper)];
    if (showTaskHelped) components.push(getTaskHelpedButton(helper));
    return new ActionRowBuilder().addComponents(...components);
}
