import { ChannelType } from 'discord.js';
import { getRaidInfo } from '../../activeRaidState.js';
import { RAID_CATEGORY_ID } from '../../config/constants.js';

import { handleRaidCreation } from './ticketCreation.js';
import { handleTicketMessages, handleCommandInteractions } from './ticketCommands.js';
import { handleLifecycleInteractions } from './ticketLifecycle.js';
import { handleCompletionInteractions } from './ticketCompletion.js';
import { handleReviewInteractions } from './ticketReview.js';

export function setupRaidHandlers(client) {

    // 1. Message Listener (Commands)
    client.on("messageCreate", async (message) => {
        if (message.author.bot || message.channel.type !== ChannelType.GuildText) return;
        
        // Check if inside a Raid Ticket
        const raidInfo = await getRaidInfo(message.channel.id);
        const isTicket = raidInfo && message.channel.parentId === RAID_CATEGORY_ID;

        // Pass to command handler
        if (isTicket || message.content.startsWith('!')) {
            await handleTicketMessages(message, client, raidInfo);
        }
    });

    // 2. Interaction Listener (Buttons/Modals)
    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isUserSelectMenu() && !interaction.isStringSelectMenu()) return;

        const raidInfo = await getRaidInfo(interaction.channel?.id);
        if (!raidInfo) {
            // Check for Creation Modal (which happens before raidInfo exists)
            if (interaction.customId.startsWith('raidRequestModal') || interaction.customId.startsWith('raidWizardDetailsModal_')) {
                await handleRaidCreation(interaction);
            }
            return;
        }

        // Route based on Raid Status & Component ID
        if (raidInfo.status === 'admin_review') {
            await handleReviewInteractions(interaction, raidInfo);
            return;
        }

        // Completion Flow (Close, Helpers, Proof)
        if (
            ['closeRaidTicket', 'closeRaid_SelectHelpers', 'confirmCloseSelection', 'provideProof', 'abortCloseRaid', 'partialHelper_btn'].includes(interaction.customId) ||
            interaction.customId.startsWith('partialHelper_')
        ) {
            await handleCompletionInteractions(interaction, raidInfo, client);
            return;
        }

        // Lifecycle (Edit, Cancel)
        if (
            ['editTask_btn', 'editTaskModal', 'cancelRaidTicket', 'confirmCancelRaid'].includes(interaction.customId) ||
            interaction.customId.startsWith('raidWizardEdit_') ||
            interaction.customId.startsWith('raidWizardEditDetailsModal_')
        ) {
            await handleLifecycleInteractions(interaction, raidInfo, client);
            return;
        }

        // Commands (Maps, Charts)
        if (interaction.customId.includes('raidmaps') || interaction.customId.includes('chart_')) {
            await handleCommandInteractions(interaction, raidInfo);
            return;
        }
    });
}
