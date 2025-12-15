import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { getEditTaskModal, updateRaid, updateRaidLogEmbed, deleteRaid } from '../../activeRaidState.js';
import { validateAndResolveTasks } from '../../utils/allowedTasks.js';
import { requireAuth } from './ticketUtils.js';
import { finalizeAdminReview } from './ticketReview.js'; 

export async function handleLifecycleInteractions(interaction, raidInfo, client) {
    
    if (raidInfo.isAwaitingCompletion) { 
        await interaction.reply({ content: "Raid is currently in the completion process.", flags: MessageFlags.Ephemeral });
        return;
    }
    // --- 1. Edit Task Button ---
    if (interaction.customId === "editTask_btn") {
        if (!await requireAuth(interaction, raidInfo)) return;
        const modal = getEditTaskModal(raidInfo.task, raidInfo.mapName, raidInfo.mapNumber, raidInfo.server, raidInfo.size, raidInfo.description);
        await interaction.showModal(modal);
    }

    // --- 2. Edit Task Modal Submission ---
    if (interaction.isModalSubmit() && interaction.customId === "editTaskModal") {
        if (!await requireAuth(interaction, raidInfo)) return;
        
        const rawTask = interaction.fields.getTextInputValue('editedTaskInput');
        const { resolvedTasks, invalidTasks } = validateAndResolveTasks(rawTask, raidInfo.size);
        
        if (invalidTasks.length) {
            return interaction.reply({ content: `Invalid tasks: ${invalidTasks.join(', ')}`, flags: MessageFlags.Ephemeral });
        }

        const updates = {
            task: resolvedTasks.join(', '),
            mapName: interaction.fields.getTextInputValue('editedMapInput'),
            mapNumber: interaction.fields.getTextInputValue('editedMapNumberInput'),
            server: interaction.fields.getTextInputValue('editedServerInput'),
            description: interaction.fields.getTextInputValue('editedDescriptionInput') || "No description."
        };

        await updateRaid(interaction.channel.id, updates);
        await updateRaidLogEmbed(client, interaction.channel.id, { 
            fields: [
                { name: 'Task(s)', value: updates.task }, 
                { name: 'Map', value: `${updates.mapName} (${updates.mapNumber})` }
            ] 
        });
        
        await interaction.reply({ content: "Raid Updated.", flags: MessageFlags.Ephemeral });
    }

    // --- 3. Cancel Raid Flow ---
    if (interaction.customId === "cancelRaidTicket") {
        if (!await requireAuth(interaction, raidInfo)) return;
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("confirmCancelRaid").setLabel("Confirm Cancel").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("abortCancelRaid").setLabel("Abort").setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({ content: "Cancel this raid?", components: [row], flags: MessageFlags.Ephemeral });
    }

    if (interaction.customId === "confirmCancelRaid") {
        if (!await requireAuth(interaction, raidInfo)) return;
        await interaction.update({ content: "Raid will now be cancelled.", components: [] });
        
        await finalizeAdminReview(client, interaction.channel, raidInfo, {}, interaction.user.id, "cancelled");
    }

    if (interaction.customId === "abortCancelRaid") {
        await interaction.update({ content: "Aborted.", components: [] });
    }
}