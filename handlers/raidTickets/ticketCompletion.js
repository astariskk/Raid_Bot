import { ActionRowBuilder, UserSelectMenuBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { updateRaid, getRaidInfo } from '../../activeRaidState.js'
import { 
    MAX_XP_PER_RAID,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RAID_MANAGER_ROLE_ID
 } from '../../config/constants.js'; 
import { calculateTaskPointsWithMultiplier } from '../../utils/taskCalculations.js';
import { requireAuth } from './ticketUtils.js';
import { finalizeAdminReview } from './ticketReview.js';

// Helper to generate the Select Menu row
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
            .setDisabled(!isConfirmedEnabled), // Disabled unless users are selected
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
    
    // 1. Start Close Process
    if (interaction.customId === "closeRaidTicket") {
        if (!await requireAuth(interaction, raidInfo)) return;
        
        // Initialize temporary state
        await updateRaid(interaction.channel.id, { isAwaitingCompletion: true, pendingHelperIds: [] });
        
        const maxHelpers = raidInfo.size === "4-man" ? 3 : (raidInfo.size === "7-man" ? 6 : 10);
        
        const selectRow = createHelperSelectRow(raidInfo, maxHelpers);
        const btnRow = createButtonRow(false, raidInfo.proofImage); // Confirm disabled initially

        await interaction.reply({ 
            content: `Select users who helped in this raid:`, 
            components: [selectRow, btnRow] 
        });
    }

    // 2. Handle Selection Updates (Refreshes the Embed/Buttons)
    if (interaction.customId === "closeRaid_SelectHelpers") {
        if (!await requireAuth(interaction, raidInfo)) return;

        const selectedIds = interaction.values;
        
        // Save the current selection temporarily
        await updateRaid(interaction.channel.id, { pendingHelperIds: selectedIds });

        // Re-generate components (with Confirm enabled if selection is present)
        const maxHelpers = raidInfo.size === "4-man" ? 3 : (raidInfo.size === "7-man" ? 6 : 10);
        const selectRow = createHelperSelectRow(raidInfo, maxHelpers);
        const btnRow = createButtonRow(selectedIds.length > 0, raidInfo.proofImage); // Enable Confirm if selected

        await interaction.update({ 
            content: `Selected helpers: ${selectedIds.map(id => `<@${id}>`).join(', ')}`, 
            components: [selectRow, btnRow] 
        });
    }

    // 3. Provide Proof (Wait for attachment)
    if (interaction.customId === "provideProof") {
        if (!await requireAuth(interaction, raidInfo)) return;
        await interaction.reply({ content: "Send the proof in the next message.", flags: MessageFlags.Ephemeral });
        
        try {
            const collected = await interaction.channel.awaitMessages({ 
                filter: m => m.author.id === interaction.user.id && m.attachments.size > 0, 
                max: 1, time: 30000, errors: ['time'] 
            });
            const proofUrl = collected.first().attachments.first().url;
            await updateRaid(interaction.channel.id, { proofImage: proofUrl });

            // Re-fetch current state to update buttons
            const updatedRaidInfo = await getRaidInfo(interaction.channel.id);
            const selectedIds = updatedRaidInfo.pendingHelperIds || [];
            const maxHelpers = updatedRaidInfo.size === "4-man" ? 3 : (updatedRaidInfo.size === "7-man" ? 6 : 10);
            
            const selectRow = createHelperSelectRow(updatedRaidInfo, maxHelpers);
            // Confirm button state depends on whether helpers were previously selected
            const btnRow = createButtonRow(selectedIds.length > 0, proofUrl); 
            
            // Edit the original interaction message (the one with the components)
            // interaction.message is the previous reply containing the components
            await interaction.message.edit({ 
                components: [selectRow, btnRow] 
            });

            await interaction.followUp({ content: "Proof saved! The button label is now updated.", flags: MessageFlags.Ephemeral });
        } catch {
            await interaction.followUp({ content: "Timed out or no attachment received.", flags: MessageFlags.Ephemeral });
        }
    }

    // 4. Confirm Closing
    if (interaction.customId === "confirmCloseSelection") {
        if (!await requireAuth(interaction, raidInfo)) return;

        // Retrieve the selected IDs from the updated state
        const currentRaidInfo = await getRaidInfo(interaction.channel.id); 
        const selectedIds = currentRaidInfo.pendingHelperIds || [];
        
        if (selectedIds.length === 0) {
            return interaction.editReply({ content: "Error: No helpers were selected. Please select users first.", flags: MessageFlags.Ephemeral });
        }

        const { originalTotalCalculatedPoints } = calculateTaskPointsWithMultiplier(currentRaidInfo.task);
        const pointsMap = {};
        selectedIds.forEach(id => pointsMap[id] = Math.min(originalTotalCalculatedPoints, MAX_XP_PER_RAID));

        // Finalize
        await finalizeAdminReview(client, interaction.channel, currentRaidInfo, pointsMap, interaction.user.id, "completed");
        
        // Clean up temporary state
        await updateRaid(interaction.channel.id, { isAwaitingCompletion: false, pendingHelperIds: null }); 
    }

    // 5. Abort
    if (interaction.customId === "abortCloseRaid") {
        await updateRaid(interaction.channel.id, { isAwaitingCompletion: false, pendingHelperIds: null });
        await interaction.update({ content: "Closing aborted.", components: [] });
    }
}