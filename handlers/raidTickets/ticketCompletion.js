import {
    ActionRowBuilder,
    UserSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} from 'discord.js';

import { updateRaid, getRaidInfo } from '../../activeRaidState.js';

import {
    MAX_XP_PER_RAID
} from '../../config/constants.js';

import { calculateTaskPointsWithMultiplier } from '../../utils/taskCalculations.js';
import { requireAuth } from './ticketUtils.js';
import { finalizeAdminReview } from './ticketReview.js';

/* -------------------- UI HELPERS -------------------- */
function createHelperSelectRow(raidInfo, maxValues) {
    return new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId("closeRaid_SelectHelpers")
            .setPlaceholder(`Select Helpers (Max ${maxValues})`)
            .setMaxValues(maxValues)
            .setMinValues(1)
    );
}

function createButtonRow(isConfirmedEnabled, proofImageUrl) {
    const hasProof = !!proofImageUrl;

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId("confirmCloseSelection")
            .setLabel("Confirm")
            .setStyle(ButtonStyle.Success)
            .setDisabled(!isConfirmedEnabled),

        new ButtonBuilder()
            .setCustomId("provideProof")
            .setLabel(hasProof ? "Proof Attached ✅" : "Attach Proof")
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId("abortCloseRaid")
            .setLabel("Abort")
            .setStyle(ButtonStyle.Secondary)
    );
}

export async function handleCompletionInteractions(interaction, raidInfo, client) {

    /* ---------- AUTH ---------- */
    if (!await requireAuth(interaction, raidInfo)) return;

    /* ---------- HARD LOCK: ADMIN REVIEW ---------- */
    if (raidInfo?.status === "admin_review") {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "The raid is already closed.",
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
        return;
    }

    /* ---------- UPDATE HELPER SELECTION ---------- */
    if (interaction.customId === "closeRaid_SelectHelpers") {
        const selectedIds = interaction.values;

        await updateRaid(interaction.channel.id, {
            pendingHelperIds: selectedIds
        });

        const maxHelpers =
            raidInfo.size === "4-man" ? 3 :
            raidInfo.size === "7-man" ? 6 : 10;

        const selectRow = createHelperSelectRow(raidInfo, maxHelpers);
        const btnRow = createButtonRow(selectedIds.length > 0, raidInfo.proofImage);

        await interaction.update({
            content: `Selected helpers: ${selectedIds.map(id => `<@${id}>`).join(", ")}`,
            components: [selectRow, btnRow]
        });
        return;
    }

    /* ---------- PROVIDE PROOF ---------- */
    if (interaction.customId === "provideProof") {
        await interaction.reply({
            content: "Send the proof image in the next message.",
            flags: MessageFlags.Ephemeral
        });

        try {
            const collected = await interaction.channel.awaitMessages({
                filter: m =>
                    m.author.id === interaction.user.id &&
                    m.attachments.size > 0,
                max: 1,
                time: 30000,
                errors: ['time']
            });

            const proofUrl = collected.first().attachments.first().url;

            await updateRaid(interaction.channel.id, {
                proofImage: proofUrl
            });

            const updatedRaid = await getRaidInfo(interaction.channel.id);
            const selectedIds = updatedRaid.pendingHelperIds || [];

            const maxHelpers =
                updatedRaid.size === "4-man" ? 3 :
                updatedRaid.size === "7-man" ? 6 : 10;

            const selectRow = createHelperSelectRow(updatedRaid, maxHelpers);
            const btnRow = createButtonRow(selectedIds.length > 0, proofUrl);

            await interaction.message.edit({
                components: [selectRow, btnRow]
            });

            await interaction.followUp({
                content: "Proof saved!",
                flags: MessageFlags.Ephemeral
            });

        } catch {
            await interaction.followUp({
                content: "Timed out or no attachment received.",
                flags: MessageFlags.Ephemeral
            });
        }
        return;
    }

    /* ---------- CONFIRM CLOSING ---------- */
    if (interaction.customId === "confirmCloseSelection") {
        const currentRaidInfo = await getRaidInfo(interaction.channel.id);
        const selectedIds = currentRaidInfo.pendingHelperIds || [];

        await interaction.update({
            content: "Selected Raid Helpers: "+selectedIds.map(id => `<@${id}>`).join(", ")+"\n" +
            "Raid marked for completion.",
            components: []
        });
                
        if (!selectedIds.length) {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                    content: "No helpers selected.",
                    flags: MessageFlags.Ephemeral
                });
            }
            return;
        }

        const { originalTotalCalculatedPoints } =
            calculateTaskPointsWithMultiplier(currentRaidInfo.task);

        const pointsMap = {};
        for (const uid of selectedIds) {
            pointsMap[uid] = Math.min(originalTotalCalculatedPoints, MAX_XP_PER_RAID);
        }

        await finalizeAdminReview(
            client,
            interaction.channel,
            currentRaidInfo,
            pointsMap,
            interaction.user.id,
            "completed"
        );

        await updateRaid(interaction.channel.id, {
            isAwaitingCompletion: false,
            pendingHelperIds: null
        });

        return;
    }

    /* ---------- ABORT ---------- */
    if (interaction.customId === "abortCloseRaid") {
        await updateRaid(interaction.channel.id, {
            isAwaitingCompletion: false,
            pendingHelperIds: null
        });

        await interaction.update({
            content: "Closing aborted.",
            components: []
        });
        return;
    }

    /* ---------- AWAITING COMPLETION LOCK ---------- */
    if (raidInfo?.isAwaitingCompletion) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "The raid closure confirmation is currently active. Please confirm or use the 'Abort' button.",
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
        return;
    }
            
    /* ---------- START CLOSE PROCESS ---------- */
    if (interaction.customId === "closeRaidTicket") {
        await updateRaid(interaction.channel.id, {
            isAwaitingCompletion: true,
            pendingHelperIds: []
        });

        const maxHelpers =
            raidInfo.size === "4-man" ? 3 :
            raidInfo.size === "7-man" ? 6 : 10;

        const selectRow = createHelperSelectRow(raidInfo, maxHelpers);
        const btnRow = createButtonRow(false, raidInfo.proofImage);

        await interaction.reply({
            content: "Select users who helped in this raid:",
            components: [selectRow, btnRow]
        });
        return;
    }    
}
