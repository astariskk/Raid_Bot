import { ChannelType, ContainerBuilder, MessageFlags, PermissionFlagsBits, TextDisplayBuilder, WebhookClient } from 'discord.js';
import { RAID_CATEGORY_ID, RAID_HELPER_ROLE_ID, RAID_STATUS } from '../../config/constants.js';
import { createRaid } from '../../activeRaidState.js';
import { validateAndResolveTaskList } from '../../utils/allowedTasks.js';
import { consumeRaidWizardSession } from './raidWizardSession.js';
import { normalizeRoomNumber } from '../../utils/roomNumber.js';
import { sendRaidTicketMessages } from './raidTicketPresentation.js';

export async function handleRaidCreation(interaction) {
    if (!interaction.isModalSubmit()) return;

    let wizardSession = null;
    let resolvedTasks;
    const canEditWizardMessage = Boolean(interaction.message?.edit);

    // Acknowledge quickly (channel creation + DB writes can exceed Discord's 3s window).
    if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
            content: 'Creating raid ticket...',
            flags: MessageFlags.Ephemeral
        }).catch(() => {});
    }

    if (interaction.customId.startsWith('raidWizardDetailsModal_')) {
        const sessionId = interaction.customId.slice('raidWizardDetailsModal_'.length);
        const session = consumeRaidWizardSession(sessionId);
        wizardSession = session;

        if (!session || session.userId !== interaction.user.id) {
            await interaction.reply({
                content: 'This raid creation session expired. Please press Start Raid again.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const { resolvedTasks: tasks, invalidTasks } = validateAndResolveTaskList(session.tasks, 'any');

        if (invalidTasks.length > 0) {
            if (interaction.replied || interaction.deferred) {
                await interaction.editReply({ content: `Invalid task(s): ${invalidTasks.join(', ')}` }).catch(() => {});
            } else {
                await interaction.reply({ content: `Invalid task(s): ${invalidTasks.join(', ')}`, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
            return;
        }

        resolvedTasks = tasks;
    } else {
        return;
    }

    let mapName = '';
    try {
        mapName = interaction.fields.getTextInputValue('mapNameInput');
    } catch {
        mapName = '';
    }
    const mapNumberRaw = interaction.fields.getTextInputValue('mapNumberInput');
    const mapNumber = normalizeRoomNumber(mapNumberRaw);
    const server = interaction.fields.getTextInputValue('serverInput');
    const description = interaction.fields.getTextInputValue('descriptionInput');

    if (!mapNumber) {
        const msg = 'Room Number must contain at least one digit.';
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: msg }).catch(() => {});
        } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return;
    }

    try {
        const guild = interaction.guild;
        const baseName = `🎟️︱${interaction.member.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-raid`;

        // Create Channel
        const ticketChannel = await guild.channels.create({
            name: baseName,
            type: ChannelType.GuildText,
            parent: RAID_CATEGORY_ID,
            permissionOverwrites: [
                { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                { id: RAID_HELPER_ROLE_ID, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
                { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] }
            ]
        });

        const raidDetails = {
            messageId: null,
            originalChannelId: ticketChannel.id,
            task: resolvedTasks.join(', '),
            requesterId: interaction.user.id,
            mapName: mapName || 'Auto (based on task)',
            mapNumber,
            server,
            description,
            status: RAID_STATUS.WAITING,
            proofImage: null,
            isAwaitingCompletion: false,
            partialHelpers: [],
            originalName: baseName,
        };

        const { messageId, lastHelperRoleMentionAt } = await sendRaidTicketMessages(ticketChannel, {
            requester: interaction.member,
            raidInfo: raidDetails,
            helpers: [],
        });

        // Save to DB
        await createRaid(ticketChannel.id, { ...raidDetails, messageId, lastHelperRoleMentionAt });

        const channelUrl = `https://discord.com/channels/${guild.id}/${ticketChannel.id}`;
        const wizardCompletePayload = {
            content: null,
            embeds: [],
            flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
            components: [
                new ContainerBuilder().addTextDisplayComponents(
                    new TextDisplayBuilder().setContent(`Raid Request Created: ${channelUrl}`),
                ),
            ],
        };

        // Edit the original Start Raid ephemeral wizard message if possible (we store its interaction token in the session).
        if (wizardSession?.originAppId && wizardSession?.originToken) {
            try {
                const webhook = new WebhookClient({ id: wizardSession.originAppId, token: wizardSession.originToken });
                await webhook.editMessage('@original', wizardCompletePayload).catch(() => {});
            } catch (e) {
                console.warn('Failed to edit original Start Raid wizard message:', e);
            }
        } else if (canEditWizardMessage) {
            // Fallback (only works if discord.js provides interaction.message for this modal submit).
            await interaction.message.edit(wizardCompletePayload).catch(() => {});
        }

        // Don't send a second "ticket created" message; the wizard message is updated instead.
        if (interaction.replied || interaction.deferred) {
            await interaction.deleteReply().catch(() => {});
        }

    } catch (error) {
        console.error("Raid Creation Error:", error);
        const msg = "Failed to create raid ticket.";
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: msg }).catch(() => {});
        } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
    }
}
