import { EmbedBuilder, ChannelType, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { RAID_CATEGORY_ID, RAID_HELPER_ROLE_ID, EMBED_COLOR, GENERIC_TASKS_LIST } from '../../config/constants.js';
import { createRaid } from '../../activeRaidState.js';
import { validateAndResolveTasks, validateAndResolveTaskList } from '../../utils/allowedTasks.js';
import { threadActionRow } from '../../Embeds/raidTicketEmbeds.js';
import { consumeRaidWizardSession } from './raidWizardSession.js';

const COLOR_WAITING = EMBED_COLOR;

function inferRaidTypeFromCategoryKeys(categoryKeys) {
    const keys = (categoryKeys || []).filter(Boolean);
    if (!keys.length) return 'other';

    const typeSet = new Set();
    for (const key of keys) {
        if (['dailies', 'weeklies', 'templeshrine', 'other_four'].includes(key)) typeSet.add('4-man');
        else if (['originul', 'legion', 'other_seven'].includes(key)) typeSet.add('7-man');
        else typeSet.add('other');
    }

    if (typeSet.size === 1) return [...typeSet][0];
    return 'other';
}

export async function handleRaidCreation(interaction) {
    if (!interaction.isModalSubmit()) return;

    let raidType;
    let resolvedTasks;

    if (interaction.customId.startsWith('raidWizardDetailsModal_')) {
        const sessionId = interaction.customId.slice('raidWizardDetailsModal_'.length);
        const session = consumeRaidWizardSession(sessionId);

        if (!session || session.userId !== interaction.user.id) {
            await interaction.reply({
                content: 'This raid creation session expired. Please press Start Raid again.',
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        raidType = inferRaidTypeFromCategoryKeys(session.categoryKeys);
        const { resolvedTasks: tasks, invalidTasks } = validateAndResolveTaskList(session.tasks, 'any');

        if (invalidTasks.length > 0) {
            await interaction.reply({
                content: `Invalid task(s): ${invalidTasks.join(', ')}`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        resolvedTasks = tasks;
    } else if (interaction.customId.startsWith('raidRequestModal')) {
        const rawTasksInput = interaction.fields.getTextInputValue('taskInput');
        raidType = interaction.customId.split('_')[1]; // e.g., '4-man'

        const { resolvedTasks: tasks, invalidTasks } = validateAndResolveTasks(rawTasksInput, raidType);
        if (invalidTasks.length > 0) {
            await interaction.reply({
                content: `Task(s) not allowed in a ${raidType} room: ${invalidTasks.join(', ')}`,
                flags: MessageFlags.Ephemeral
            });
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
        await interaction.reply({
            content: 'Map Name is required for generic tasks (`simple`, `moderate`, `hard`).',
            flags: MessageFlags.Ephemeral
        });
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
        const embed = new EmbedBuilder()
            .setColor(COLOR_WAITING)
            .setTitle(`${raidType} Raid Request`)
            .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() })
            .addFields(
                { name: 'Task(s)', value: resolvedTasks.join(', '), inline: false },
                { name: 'Map', value: `${mapName || 'Auto (based on task)'}`, inline: false},
                { name: 'Room Number', value: `${mapNumber}`, inline: true },
                { name: 'Server', value: server, inline: true },
                { name: 'Status', value: 'Waiting', inline: true },
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
            status: 'active',
            color: COLOR_WAITING,
            size: raidType,
            proofImage: null,
            isAwaitingCompletion: false,
            originalName: baseName
        });

        await interaction.reply({
            content: `Raid ticket created: <#${ticketChannel.id}>`,
            flags: MessageFlags.Ephemeral
        });

    } catch (error) {
        console.error("Raid Creation Error:", error);
        await interaction.reply({ content: "Failed to create raid ticket.", flags: MessageFlags.Ephemeral });
    }
}
