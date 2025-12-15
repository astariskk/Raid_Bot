import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} from 'discord.js';

import {
    getEditTaskModal,
    updateRaid,
    updateRaidLogEmbed
} from '../../activeRaidState.js';

import { validateAndResolveTasks } from '../../utils/allowedTasks.js';
import { requireAuth } from './ticketUtils.js';
import { finalizeAdminReview } from './ticketReview.js';

/* -------------------- MAIN HANDLER -------------------- */
export async function handleLifecycleInteractions(interaction, raidInfo, client) {

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

    /* ---------- AUTH ---------- */
    if (!await requireAuth(interaction, raidInfo)) return;

    /* ---------- 1. EDIT TASK ---------- */
    if (interaction.customId === "editTask_btn") {
        const modal = getEditTaskModal(
            raidInfo.task,
            raidInfo.mapName,
            raidInfo.mapNumber,
            raidInfo.server,
            raidInfo.size,
            raidInfo.description
        );
        await interaction.showModal(modal);
        return;
    }

    /* ---------- 2. EDIT TASK MODAL ---------- */
    if (interaction.isModalSubmit() && interaction.customId === "editTaskModal") {
        const rawTask = interaction.fields.getTextInputValue('editedTaskInput');
        const { resolvedTasks, invalidTasks } =
            validateAndResolveTasks(rawTask, raidInfo.size);

        if (invalidTasks.length) {
            await interaction.reply({
                content: `Invalid tasks: ${invalidTasks.join(", ")}`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const updates = {
            task: resolvedTasks.join(", "),
            mapName: interaction.fields.getTextInputValue('editedMapInput'),
            mapNumber: interaction.fields.getTextInputValue('editedMapNumberInput'),
            server: interaction.fields.getTextInputValue('editedServerInput'),
            description:
                interaction.fields.getTextInputValue('editedDescriptionInput') ||
                "No description."
        };

        await updateRaid(interaction.channel.id, updates);

        await updateRaidLogEmbed(client, interaction.channel.id, {
            fields: [
                { name: "Task(s)", value: updates.task },
                { name: "Map", value: `${updates.mapName}` },
                { name: "Server", value: updates.server },
                { name: "Description", value: updates.description }
            ]
        });

        await interaction.reply({
            content: "Raid updated.",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    /* ---------- 3. CANCEL RAID ---------- */
    if (interaction.customId === "cancelRaidTicket") {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("confirmCancelRaid")
                .setLabel("Confirm Cancel")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId("abortCancelRaid")
                .setLabel("Abort")
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: "Cancel this raid?",
            components: [row],
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (interaction.customId === "confirmCancelRaid") {
        await interaction.update({
            content: "Raid will now be cancelled.",
            components: []
        });

        await finalizeAdminReview(
            client,
            interaction.channel,
            raidInfo,
            {},
            interaction.user.id,
            "cancelled"
        );
        return;
    }

    if (interaction.customId === "abortCancelRaid") {
        await interaction.update({
            content: "Cancelled.",
            components: []
        });
        return;
    }
}
