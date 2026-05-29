import { ChannelType } from 'discord.js';
import { getRaidInfo, getRaidInfoMinimal } from '../../activeRaidState.js';
import { RAID_CATEGORY_ID } from '../../config/constants.js';

import { handleRaidCreation } from './ticketCreation.js';
import { handleTicketMessages, handleCommandInteractions } from './ticketCommands.js';
import { handleLifecycleInteractions } from './ticketLifecycle.js';
import { handleCompletionInteractions } from './ticketCompletion.js';
import { handleReviewInteractions } from './ticketReview.js';
import { RAID_STATUS } from '../../config/constants.js';

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
        if (
            !interaction.isButton() &&
            !interaction.isModalSubmit() &&
            !interaction.isUserSelectMenu() &&
            !interaction.isMentionableSelectMenu?.() &&
            !interaction.isStringSelectMenu()
        ) return;

        const raidInfo = await getRaidInfoMinimal(interaction.channel?.id);
        if (!raidInfo) {
            // Check for Creation Modal (which happens before raidInfo exists)
            if (interaction.customId.startsWith('raidWizardDetailsModal_')) {
                await handleRaidCreation(interaction);
            }
            return;
        }

        // Route based on Raid Status & Component ID
        if (raidInfo.status === RAID_STATUS.ADMIN_REVIEW) {
            await handleReviewInteractions(interaction, raidInfo);
            return;
        }

        // Completion Flow (Close, Helpers, Proof)
        if (
            ['closeRaidTicket', 'closeRaid_SelectHelpers', 'confirmCloseSelection', 'provideProof', 'abortCloseRaid'].includes(interaction.customId)
        ) {
            await handleCompletionInteractions(interaction, raidInfo, client);
            return;
        }

// Lifecycle (Edit, Cancel)
        if (
            ['editRequest_btn', 'editRequest_tasks_btn', 'editRequest_details_btn', 'editRequest_description_btn', 'cancelRaidTicket'].includes(interaction.customId) ||
            interaction.customId.startsWith('editRequest_') ||
            interaction.customId.startsWith('raidWizardEdit_') ||
            interaction.customId.startsWith('raidWizardEditDetailsModal_') ||
            interaction.customId === 'editRequestDescriptionModal' ||
            interaction.customId === 'confirmCancelRaidModal'
        ) {
            await handleLifecycleInteractions(interaction, raidInfo, client);
            return;
        }

        // Commands (Maps, helpers)
        if (
            interaction.customId === 'joinRaidTicket'
            || interaction.customId === 'leaveRaidTicket'
            || interaction.customId === 'addHelperButton'
            || interaction.customId === 'kickHelperSelect'
            || interaction.customId === 'pingHelpersButton'
            || interaction.customId.includes('raidmaps')
            || interaction.customId.startsWith('kickRaidHelper_')
            || interaction.customId === 'addRaidHelperModal'
        ) {
            const fullRaidInfo = await getRaidInfo(interaction.channel?.id);
            await handleCommandInteractions(interaction, fullRaidInfo ?? raidInfo);
            return;
        }
    });
}
