import { EmbedBuilder, ChannelType, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { RAID_CATEGORY_ID, RAID_HELPER_ROLE_ID } from '../../config/constants.js';
import { createRaid } from '../../activeRaidState.js';
import { validateAndResolveTasks } from '../../utils/allowedTasks.js';
import { threadActionRow } from '../../Embeds/raidTicketEmbeds.js';

const COLOR_WAITING = 0x0099ff;

export async function handleRaidCreation(interaction) {
    if (!interaction.isModalSubmit() || !interaction.customId.startsWith('raidRequestModal')) return;

    const rawTasksInput = interaction.fields.getTextInputValue('taskInput');
    const raidType = interaction.customId.split('_')[1]; // e.g., '4-man'
    const mapName = interaction.fields.getTextInputValue('mapNameInput');
    const mapNumber = interaction.fields.getTextInputValue('mapNumberInput');
    const server = interaction.fields.getTextInputValue('serverInput');
    const description = interaction.fields.getTextInputValue('descriptionInput');

    // Validate Tasks
    const { resolvedTasks, invalidTasks } = validateAndResolveTasks(rawTasksInput, raidType);

    if (invalidTasks.length > 0) {
        return interaction.reply({
            content: `Task(s) not allowed in a ${raidType} room: ${invalidTasks.join(', ')}`,
            flags: MessageFlags.Ephemeral
        });
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
                { name: 'Map', value: `${mapName}`, inline: false},
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
            content: `Use the buttons below to manage your raid.`,
            components: [threadActionRow]
        });

        await sentMsg.pin();

        // Save to DB
        await createRaid(ticketChannel.id, {
            messageId: sentMsg.id,
            originalChannelId: ticketChannel.id,
            task: resolvedTasks.join(', '),
            requesterId: interaction.user.id,
            mapName, mapNumber, server, description,
            status: 'active',
            color: COLOR_WAITING,
            size: raidType,
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