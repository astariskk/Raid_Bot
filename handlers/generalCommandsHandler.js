import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
    GENERAL_CHANNEL_ID,
    AQW_CHANNEL_ID,
    RAID_CHANNEL_ID,
    RAID_HELPER_ROLE_ID,
    LEADERBOARD_CHANNEL_ID,
    RAID_MANAGEMENT_CHANNEL_ID,
    MAX_XP_PER_RAID,
    POINTS_CONFIG,
    TASK_ALIASES,
} from '../config/constants.js';
import { getRaidRequestModal } from '../Embeds/raidTicketEmbeds.js';
import { calculateTaskPointsWithMultiplier } from '../utils/taskCalculations.js'; // Import the new helper

// Import all necessary embed and button creation functions from the new file
import {
    getHowToUseEmbed,
    getInitialButtonsRow,
    getStringSelectMenu,
    getChartsEmbed,
    getRaidRulesEmbed,
    getLeaderboardCommandsEmbed,
    getModeratorCommandsEmbed,
    getSecretCommandsEmbed,
    createCustomGifEmbed,
    getCombinedTasksAndPointsEmbed,
    getCommandsEmbed,
} from '../Embeds/generalCommandsEmbeds.js';

// Import GIF command maps
import { textGifCommands, gifCommands } from '../Embeds/customGifEmbeds.js';


// --- Cooldown management for GIF commands ---
const gifCooldowns = new Map();
const cooldownWarningMessages = new Map();
const GIF_COOLDOWN_DURATION = 10 * 1000;

// --- User IDs to ban from specific commands ---
const BANNED_USERS_FOR_COMMANDS = {
    // Kuro 719443918621638660 banned from 'marbike'
};

export function setupGeneralCommandsHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const commandContent = message.content.toLowerCase();
        const userId = message.author.id;
        const now = Date.now();
        const lastUsed = gifCooldowns.get(userId);

        // Helper function to delete a cooldown warning message
        const deleteCooldownWarning = async (idToDelete) => {
            const messageToDelete = cooldownWarningMessages.get(idToDelete);
            if (messageToDelete) {
                try {
                    await messageToDelete.delete();
                } catch (err) {
                    if (err.code !== 10008) {
                        console.error(`Error deleting cooldown warning message for user ${idToDelete}:`, err);
                    }
                } finally {
                    cooldownWarningMessages.delete(idToDelete);
                }
            }
        };


        // --- Handle the !raidinfo command (formerly !raidcommands) ---
        if (commandContent === '!raidinfo' && message.channel.id === RAID_CHANNEL_ID) {

            // USE IMPORTED EMBED FUNCTION
            const howToUseEmbed = getHowToUseEmbed();
            const initialButtonsRow = getInitialButtonsRow();
            const stringSelectMenuRow = getStringSelectMenu();

            try {
                await message.channel.send({ embeds: [howToUseEmbed], components: [initialButtonsRow] });
                await message.channel.send({ content: null, components: [stringSelectMenuRow] });

            } catch (error) {
                console.error('Error sending !raidinfo embed:', error);
                await message.channel.send('Failed to display raid information. Please try again later.');
            }
        }

        // --- Handle the !charts command ---
        if (commandContent === '!charts') {
            const chartsEmbed = getChartsEmbed();
            try {
                await message.channel.send({ embeds: [chartsEmbed] });
            } catch (error) {
                console.error('Error sending !charts embed:', error);
                await message.channel.send('Failed to display charts. Please try again later.');
            }
        return;
        }

        if (commandContent === `!ping`) {
            await message.reply('Pong!');
            console.log(`Ping command used by ${message.author.tag}`);
            return;
        }

        // --- Handle the !RaidRules command ---
        if (commandContent === '!raidrules' && message.channel.id === RAID_CHANNEL_ID) {
            const raidRulesEmbed = getRaidRulesEmbed();
            try {
                await message.channel.send({ embeds: [raidRulesEmbed] });
            } catch (error) {
                console.error('Error sending !raidrules embed:', error);
                await message.channel.send('Failed to display raid rules. Please try again later.');
            }
            return;
        }

        // --- Handle the !calculatetask command ---
        if (commandContent.startsWith('!calculatetask')) {
            const args = message.content.slice('!calculatetask'.length).trim();

            const {
                totalCalculatedPoints,
                originalTotalCalculatedPoints,
                unknownTasks
            } = calculateTaskPointsWithMultiplier(args);

            let replyContent = `Calculated Points: **${totalCalculatedPoints}** EXP\n\n`;


            if (unknownTasks.length > 0) {
                replyContent += `\n\n_Note: The following tasks were not recognized and were not included in the calculation: ${unknownTasks.join(', ')}._`;
            }

            if (originalTotalCalculatedPoints > MAX_XP_PER_RAID) {
                replyContent += `\n_This calculation was capped at ${MAX_XP_PER_RAID} EXP (original total: ${originalTotalCalculatedPoints} EXP)._`;
            }

            await message.reply({ content: replyContent, ephemeral: true });
            return;
        }


        // --- Handle the !commandslb command ---
        if (commandContent === '!lbcommands' && message.channel.id === LEADERBOARD_CHANNEL_ID) {
            const leaderboardCommandsEmbed = getLeaderboardCommandsEmbed();

            try {
                await message.channel.send({ embeds: [leaderboardCommandsEmbed] });
            } catch (error) {
                console.error('Error sending !commandslb embed:', error);
                await message.channel.send('Failed to display leaderboard commands. Please try again later.');
            }
        }

        // --- handle the moderator commands ---
        if (commandContent === '!modcommands' && message.channel.id === RAID_MANAGEMENT_CHANNEL_ID) {
            const moderatorCommandsEmbed = getModeratorCommandsEmbed();

            try {
                await message.channel.send({ embeds: [moderatorCommandsEmbed] });
            } catch (error) {
                console.error('Error sending !commandslb embed:', error);
                await message.channel.send('Failed to display leaderboard commands. Please try again later.');
            }
        }

        // --- Handle !secretcommands to list all GIF commands ---
        if (commandContent === '!secretcommands') {
            const secretCommandsEmbed = getSecretCommandsEmbed(gifCommands, textGifCommands);
            try {
                await message.channel.send({ embeds: [secretCommandsEmbed] });
            } catch (error) {
                console.error('Error sending !secretcommands embed:', error);
                await message.channel.send('Failed to display secret Gif commands. Please try again later.');
            }
        }

        // --- Consolidated Custom GIF Commands Handling (Embeds) ---
        if (gifCommands[commandContent]) {

            if (message.channel.id === GENERAL_CHANNEL_ID || message.channel.id === AQW_CHANNEL_ID ) return;

            if (lastUsed && (now - lastUsed < GIF_COOLDOWN_DURATION)) {
                const remaining = (GIF_COOLDOWN_DURATION - (now - lastUsed)) / 1000;
                const cooldownMessageContent = `Please wait ${remaining.toFixed(1)} seconds before using a GIF command again.`;

                await deleteCooldownWarning(userId);

                const warningMessage = await message.reply({ content: cooldownMessageContent });
                cooldownWarningMessages.set(userId, warningMessage);

                // Set a timeout to delete the warning message when the cooldown expires
                setTimeout(async () => {
                    await deleteCooldownWarning(userId);
                }, GIF_COOLDOWN_DURATION);
                return;
            }

            // If not on cooldown, proceed to send the GIF
            gifCooldowns.set(userId, now);
            await deleteCooldownWarning(userId);

            let gifInfo = gifCommands[commandContent];
            // Check if the value is an array, if so, pick a random entry
            if (Array.isArray(gifInfo)) {
                const randomIndex = Math.floor(Math.random() * gifInfo.length);
                gifInfo = gifInfo[randomIndex];
            }

            // USE IMPORTED EMBED FUNCTION
            const gifEmbed = createCustomGifEmbed(gifInfo);

            try {
                await message.channel.send({ embeds: [gifEmbed] });
            } catch (error) {
                console.error('Error sending custom GIF:', error);
                await message.channel.send('Could not display the beautiful thing.');
            }
        }

        // Check for text gif commands (no embeds)
        else if (textGifCommands[commandContent]) {
            
            if (message.channel.id === GENERAL_CHANNEL_ID || message.channel.id === AQW_CHANNEL_ID ) return;
            
            // Banned User Check
            const bannedUsers = BANNED_USERS_FOR_COMMANDS[commandContent];
            if (bannedUsers && bannedUsers.includes(userId)) {
                return;
            }

            if (lastUsed && (now - lastUsed < GIF_COOLDOWN_DURATION)) {
                const remaining = (GIF_COOLDOWN_DURATION - (now - lastUsed)) / 1000;
                const cooldownMessageContent = `Please wait ${remaining.toFixed(1)} seconds before using a GIF command again.`;

                await deleteCooldownWarning(userId);

                const warningMessage = await message.reply({ content: cooldownMessageContent });
                cooldownWarningMessages.set(userId, warningMessage);

                // Set a timeout to delete the warning message when the cooldown expires
                setTimeout(async () => {
                    await deleteCooldownWarning(userId);
                }, GIF_COOLDOWN_DURATION);
                return; // Exit if still on cooldown
            }

            // If not on cooldown, proceed to send the GIF
            gifCooldowns.set(userId, now);
            await deleteCooldownWarning(userId);

            const messageToSend = textGifCommands[commandContent];

            try {
                await message.channel.send(messageToSend);
            } catch (error) {
                console.error(`Error sending text GIF command "${commandContent}":`, error);
                await message.channel.send('Could not send the requested GIF message.');
            }
        }

    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;

        switch (interaction.customId) {
            case 'getHelpRole_btn':
                const guild = interaction.guild;
                const member = interaction.member;

                if (!guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
                    return;
                }

                try {
                    const role = await guild.roles.fetch(RAID_HELPER_ROLE_ID);

                    // Debugging Purposes
                    if (!role) {
                        await interaction.reply({ content: 'The specified helper role was not found. Please contact an an administrator.', ephemeral: true });
                        return;
                    }
                    const botMember = await guild.members.fetch(client.user.id);
                    if (!botMember.permissions.has('ManageRoles')) {
                        await interaction.reply({ content: 'I do not have the necessary permissions (`Manage Roles`) to assign roles. Please ask an administrator to grant me this permission.', ephemeral: true });
                        return;
                    }
                    if (botMember.roles.highest.position <= role.position) {
                        await interaction.reply({ content: `My role is not high enough to assign the \`${role.name}\` role. Please ensure my role is above the Raid Helper role in the server settings.`, ephemeral: true });
                        return;
                    }

                    // Role assignment logic
                    if (member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
                        await member.roles.remove(RAID_HELPER_ROLE_ID, 'Requested via Get Help Role button');

                        const embed = new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setDescription(`<@&${RAID_HELPER_ROLE_ID}> role has been removed.`); // Using <@&roleID> to mention the role

                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    } else {
                        await member.roles.add(RAID_HELPER_ROLE_ID, 'Requested via Get Help Role button');

                        const embed = new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setDescription(`<@&${RAID_HELPER_ROLE_ID}> role has been added`); // Using <@&roleID> to mention the role

                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    }

                } catch (error) {
                    console.error('Error assigning help role:', error);
                    await interaction.reply({ content: 'There was an error trying to assign you the role. Please ensure I have `Manage Roles` permission and my role is above the Raid Helper role.', ephemeral: true });
                }
                break;
            
            case 'seeRaidTasks_btn':
                const tasksEmbed = getCombinedTasksAndPointsEmbed();
                await interaction.reply({
                    content:'Below are the list of available tasks and exp values sectioned by their category.\n' +            
                            '* You can use the following names for combined multiple tasks: `dailies` or `daily`, `weeklies` or `weekly`, `templeshrine`, `originul`, `legion`\n'+
                            '* You can also use /taskalias [task] for other names you could use for that task, like \`gramiel\` as \`gram\`\n'+
                            '* For multiple runs of the same task, you can append \` x[number]\` to the task name, e.g. \`nerfkitten x3\` to indicate 3 runs of nerfkitten.',
                     embeds: tasksEmbed, ephemeral: true });
                break;
            
            case 'showAllCommands_btn':
                const commandsEmbed = getCommandsEmbed();
                await interaction.reply({ embeds: [commandsEmbed], ephemeral: true });
                break;
            default:
                break;
        }
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isStringSelectMenu()) return; 
        switch (interaction.customId) {
            case 'raidTypeSelect':
                // Only allow raid helpers
                if (!interaction.member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
                    await interaction.reply({
                        content: `You need the <@&${RAID_HELPER_ROLE_ID}> role to start a raid. Click '📣 Get Help Role' first.`,
                        ephemeral: true
                    });
                    return;
                }

                // Grab the selected raid type
                const selectedRaidType = interaction.values[0]; // "4-man", "7-man", or "other"
                const modal = getRaidRequestModal(selectedRaidType);

                await interaction.showModal(modal);

                try {
                    await interaction.message.edit({
                        components: [getStringSelectMenu()] // new fresh menu
                    });
                } catch (e) {
                    console.error("Failed to reset select menu:", e);
                }              
                  
                break;
            default:
                break;
        }
    });            
}
