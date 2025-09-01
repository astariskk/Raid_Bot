// handlers/slashCommandsHandler.js
import { REST, Routes, ApplicationCommandOptionType, MessageFlags, EmbedBuilder } from 'discord.js';
import { updateLeaderboard } from './leaderboardCore.js';
import { MODERATOR_ROLE_ID, OFFICER_ROLE_ID, RAID_MANAGER_ROLE_ID } from '../config/constants.js';
import { sendLeaderboardBackup } from './backupHandler.js';

// --- utility functions ---
function isAdmin(interaction) {
    if (!interaction.member) {
        console.warn('isAdmin called without a member object (e.g., DM).');
        return false;
    }
    return (
        interaction.member.roles.cache.has(MODERATOR_ROLE_ID) ||
        interaction.member.roles.cache.has(OFFICER_ROLE_ID) ||
        interaction.member.roles.cache.has(RAID_MANAGER_ROLE_ID)
    );
}

const createXpEmbed = (action, amount, userIds) => {
    const isPositive = action === 'add';
    const xpString = isPositive ? `added ${amount} EXP to` : `removed ${amount} EXP from`;
    const title = isPositive ? 'EXP Added' : 'EXP Removed';
    const color = isPositive ? 0x0099ff : 0xFF0000; // blue for add, red for remove

    const userMentions = userIds.map(id => `<@${id}>`).join(', ');

    return new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(`${xpString} to: \n${userMentions}`);
};

// --- defining slash commands ---
const commands = [
    {
        name: 'ping',
        description: 'Checks if the bot is running!',
    },
    {
        name: 'echo',
        description: 'Repeats your message back to you.',
        options: [
            {
                name: 'message',
                description: 'The message to echo.',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
        ],
    },
    {
        name: 'addxp',
        description: 'Add XP to one or more users.',
        options: [
            {
                name: 'users',
                description: 'User(s) to award XP to',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'amount',
                description: 'Amount of XP to add',
                type: ApplicationCommandOptionType.Integer, 
                required: true,
            },
        ],
    },
    {
        name: 'removexp',
        description: 'Remove XP from one or more users.',
        options: [
            {
                name: 'users',
                description: 'User(s) to deduct XP from',
                type: ApplicationCommandOptionType.String,
                required: true,
            },
            {
                name: 'amount',
                description: 'Amount of XP to remove',
                type: ApplicationCommandOptionType.Integer,
                required: true,
            },
        ],
    }, 
];

export async function registerSlashCommands(client) {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    await rest.put(
        Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
        { body: commands },
    );
}

export function setupSlashCommandsHandler(client) {
    client.on('interactionCreate', async interaction => {
        // Only handle chat input commands
        if (!interaction.isChatInputCommand()) return;

        console.log(`[Interaction] Received command: /${interaction.commandName} (ID: ${interaction.id})`);
        console.log(`[Interaction] isReplied: ${interaction.replied}, isDeferred: ${interaction.deferred}`);     

        switch (interaction.commandName) {
            case 'ping':
                try {
                    await interaction.reply('Bot is running!');
                    console.log(`[Interaction] Successfully replied to /${interaction.commandName} (ID: ${interaction.id})`);
                } catch (error) {
                    console.error('Error replying to ping command:', error);
                    if (!interaction.replied) {
                        await interaction.reply({ // Changed from editReply to reply (if it was ever editReply)
                            content: 'There was an error trying to respond to this command.',
                            flags: MessageFlags.Ephemeral
                        }).catch(e => console.error('Failed to send fallback reply:', e));
                    }
                }
                break;

            case 'echo':
                try {
                    const messageToEcho = interaction.options.getString('message');
                    await interaction.reply({ content: messageToEcho });
                    console.log(`[Interaction] Successfully replied to /${interaction.commandName} (ID: ${interaction.id})`);
                } catch (error) {
                    console.error('Error replying to echo command:', error);
                    if (!interaction.replied) {
                        await interaction.reply({ // Changed from editReply to reply (if it was ever editReply)
                            content: 'There was an error trying to echo your message.',
                            flags: MessageFlags.Ephemeral
                        }).catch(e => console.error('Failed to send fallback reply:', e));
                    }
                }
                break;
        case 'addxp': {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: 'You do not have permission to use this command.',
                    flags: MessageFlags.Ephemeral
                });
            }

            const amount = interaction.options.getInteger('amount');

            try {
                const usersString = interaction.options.getString('users');
                const userIds = [...usersString.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);

                for (const id of userIds) {
                await updateLeaderboard(id, amount);
                }

                const xpEmbed = createXpEmbed('add', amount, userIds);

                await interaction.reply({ embeds: [xpEmbed] });

                await sendLeaderboardBackup(client);
            } catch (error) {
                console.error('Error adding XP:', error);
                await interaction.reply({
                    content: 'Failed to add XP. Please try again later.',
                    flags: MessageFlags.Ephemeral
                });
            }
            break;
        }

        case 'removexp': {
            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content: 'You do not have permission to use this command.',
                    flags: MessageFlags.Ephemeral
                });
            }


            const amount = interaction.options.getInteger('amount');

            try {
                const usersString = interaction.options.getString('users');
                const userIds = [...usersString.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);

                for (const id of userIds) {
                await updateLeaderboard(id, -amount);
                }

                const xpEmbed = createXpEmbed('remove', amount, userIds);

                await interaction.reply({ embeds: [xpEmbed] });

                await sendLeaderboardBackup(client);
            } catch (error) {
                console.error('Error removing XP:', error);
                await interaction.reply({
                    content: 'Failed to remove XP. Please try again later.',
                    flags: MessageFlags.Ephemeral
                });
            }
            break;              
        }
            default:
                console.log(`Unhandled slash command: ${interaction.commandName}`);
                await interaction.reply({
                    content: 'Unknown command.',
                    flags: MessageFlags.Ephemeral
                }).catch(e => console.error('Error replying to unknown command:', e));
                break;
        }
    });
}
