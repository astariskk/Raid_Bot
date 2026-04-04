import { EmbedBuilder, ChannelType, PermissionFlagsBits, MessageFlags, WebhookClient } from 'discord.js';
import { RAID_CATEGORY_ID, RAID_HELPER_ROLE_ID, EMBED_COLOR, GENERIC_TASKS_LIST, STATUS_COLORS, RAID_STATUS, TASK_DISPLAY_NAMES } from '../../config/constants.js';
import { createRaid } from '../../activeRaidState.js';
import { validateAndResolveTaskList } from '../../utils/allowedTasks.js';
import { threadActionRow } from './buttons/threadButtons.js';
import { consumeRaidWizardSession } from './raidWizardSession.js';

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

    const mapName = interaction.fields.getTextInputValue('mapNameInput');
    const mapNumber = interaction.fields.getTextInputValue('mapNumberInput');
    const server = interaction.fields.getTextInputValue('serverInput');
    const description = interaction.fields.getTextInputValue('descriptionInput');

    const isMapNameRequired = resolvedTasks.some((t) => GENERIC_TASKS_LIST.includes(t));
    if (isMapNameRequired && !String(mapName ?? '').trim()) {
        const msg = 'Map Name is required for other tasks (`simple`, `moderate`, `difficult`).';
        if (interaction.replied || interaction.deferred) {
            await interaction.editReply({ content: msg }).catch(() => {});
        } else {
            await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return;
    }

    try {
        const guild = interaction.guild;
        const baseName = `${interaction.member.displayName.toLowerCase().replace(/[^a-z0-9]/g, '-')}-raid`;

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

        // Build Embed
        const displayTasks = resolvedTasks.map((t) => TASK_DISPLAY_NAMES?.[t] ?? t);
        const embed = new EmbedBuilder()
            .setColor(STATUS_COLORS?.[RAID_STATUS.WAITING] ?? EMBED_COLOR)
            .setTitle('Raid Request')
            .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
            .addFields(
                { name: 'Task(s)', value: displayTasks.join(', '), inline: false },
                { name: 'Map', value: `${mapName || 'Auto (based on task)'}`, inline: false},
                { name: 'Room Number', value: `${mapNumber}`, inline: true },
                { name: 'Server', value: server, inline: true },
                { name: 'Status', value: RAID_STATUS.WAITING, inline: true },
                { name: 'Description', value: description || 'No description provided.' }
            );

        const sentMsg = await ticketChannel.send({
            content: `<@&${RAID_HELPER_ROLE_ID}> New raid request from ${interaction.user}`,
            embeds: [embed]
        });
        
        await ticketChannel.send({
            content: `You can type **!waiting** **!ongoing** or **!full** to update the raid status\n`+
                `Use the buttons below to manage your raid.`,
            components: [threadActionRow]
        });

        await sentMsg.pin();

        // Save to DB
        await createRaid(ticketChannel.id, {
            messageId: sentMsg.id,
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
        });

        const createdContent = `Ticket has been created: <#${ticketChannel.id}>`;

        // Edit the original Start Raid ephemeral wizard message if possible (we store its interaction token in the session).
        if (wizardSession?.originAppId && wizardSession?.originToken) {
            try {
                const webhook = new WebhookClient({ id: wizardSession.originAppId, token: wizardSession.originToken });
                await webhook.editMessage('@original', { content: createdContent, embeds: [], components: [] }).catch(() => {});
            } catch (e) {
                console.warn('Failed to edit original Start Raid wizard message:', e);
            }
        } else if (canEditWizardMessage) {
            // Fallback (only works if discord.js provides interaction.message for this modal submit).
            await interaction.message.edit({ content: createdContent, embeds: [], components: [] }).catch(() => {});
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
