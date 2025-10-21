import { Client, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
    RAID_CHANNEL_ID,
    RAID_HELPER_ROLE_ID,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RECORD_HOLDER_ROLE_ID,
    LEADERBOARD_CHANNEL_ID,
    RAID_MANAGEMENT_CHANNEL_ID,
    MAX_XP_PER_RAID,
    POINTS_CONFIG,
    TASK_ALIASES,
} from '../config/constants.js';
import { getRaidRequestModal } from './raidTicketHandler.js';
import { calculateTaskPointsWithMultiplier } from '../utils/taskCalculations.js'; // Import the new helper

// Import all necessary embed and button creation functions from the new file
import {
    getHowToUseEmbed,
    getInitialButtonsRow,
    getChartsEmbed,
    getRaidRulesEmbed,
    getLeaderboardCommandsEmbed,
    getModeratorCommandsEmbed,
    getSecretCommandsEmbed,
    createCustomGifEmbed,
    getCombinedTasksAndPointsEmbed,
    getCommandsEmbed,
} from '../Embeds/generalCommandsEmbeds.js';


// --- Cooldown management for GIF commands ---
const gifCooldowns = new Map();
const cooldownWarningMessages = new Map();
const GIF_COOLDOWN_DURATION = 10 * 1000;

// --- User IDs to ban from specific commands ---
const BANNED_USERS_FOR_COMMANDS = {
    // Kuro 719443918621638660 banned from 'marbike'
};

// --- Custom GIF Commands (for embeds) ---
export const gifCommands = {

    // 50/50 of getting one of the gifs
    "shaboingboing": [
        {
            title: "You gotta give him that Hawk Tuah",
            image: 'https://files.catbox.moe/qy74ka.gif',
            footer: 'Gawk gawk gawk',
            color: 0xaa8f7d
        },
        {
            title: "wait, there's another HAWK TUAH!?",
            image: 'https://files.catbox.moe/21jx2k.gif',
            footer: 'The throat goat',
            color: 0xaa8f7d
        }
    ],
};

// --- Custom TEXT GIF Commands (no embeds) ---
export const textGifCommands = {
    // --- other tags ---
    'acefault': '<@467703633618796544> [**ALWAYS AT FAURLT**](https://files.catbox.moe/chroap.gif)', 	// Ace 467703633618796544
    'kaerat': "<@792031861425569822> [**IT'S THE RAT**](https://files.catbox.moe/1leclp.gif)", 	// kae 792031861425569822
    'sybauwordles' :'<@252026199667245056> [**Bark for me like you mean it**](https://tenor.com/view/rage-rage-bait-baited-rage-baited-angry-dog-gif-2047466162835898859)', 	// wordle 252026199667245056
    'ninjaboing' : '<@502473085857824779> [**I LIKE TO MOVE IT MOVE IT**](https://files.catbox.moe/6lusbi.gif)', 	// ninja 502473085857824779

    // --- xy --- 965985831649169438
    'xyfart': '<@965985831649169438> [**BABAGAN MENYANG**](https://files.catbox.moe/kyqp98.gif)', 	// xy 965985831649169438

    // --- amarah --- 1030038861851664404
    'marbike': '<@1030038861851664404> [**RIDE TO THE HARAM LAND WHERE I BELONG**](https://files.catbox.moe/ayl6ui.gif)', 	
    'marplane': '<@1030038861851664404> [**KABOOM BITCHESSS**](https://files.catbox.moe/owtx3d.gif)', 	

    // --- kuro --- 719443918621638660
    'kurobike': `<@719443918621638660> [**RIDING JINU'S DIHH**](https://imgur.com/a/wKpRDrw)`, 	
    'kurodance' : `<@719443918621638660> 🗣️ [**SHUT UP AND DANCE WITH ME**](https://files.catbox.moe/l80j6z.gif)`, 	

    // -- kui --- 713920796913041459
    'kuipunt': `<@713920796913041459> [**MISU BROKE MY HEART LIKE THIS**](https://files.catbox.moe/zhlcsh.gif)`, 	
    'kuimilk' : '<@713920796913041459> [**I LOVE THIS THICK WHITE STUFF DRINK**](https://files.catbox.moe/gkvm27.gif)', 	
    'kuiscream': '<@713920796913041459> [**MISUUU LET ME INNNN**](https://imgur.com/a/Tqgr3tA)',	

    // --- famis --- 365314970633633793
    'famisgoon' : `<@365314970633633793> [**LET ME GOON**](https://files.catbox.moe/xrf4y6.gif)`, 	
    'fapmisgoon' : `<@365314970633633793> [**IM GONNA GOON TILL I PASS OUT**](https://files.catbox.moe/bffw6o.gif)`,
    'goonmis' : '<@365314970633633793> [**SHE CAN SUCK MORE THAN JUST MY BLOOD**](https://files.catbox.moe/3o3stq.gif)',
    'famridaa' : '<@365314970633633793> [**GOON RIDAAA**](https://files.catbox.moe/ae1svi.gif)', 	

    // --- keiji --- 227002059784716288
    'keijiwave' : '<@227002059784716288> [**The boy from up!**](https://files.catbox.moe/661usf.gif)', 	
    'keijifart' : '<@227002059784716288> 🗣️🗣️ [**I FART SO HARD, AND GOT SO FAR**](https://files.catbox.moe/99wg0n.gif)', 	
    'keijidance' : `<@227002059784716288> [**IM 'BOUT TO GET UP ON THAT AHH RIGHT NYEOW**](https://files.catbox.moe/1gitfq.gif)`,

    // --- pix --- 192921939818315777
    'pixpunt' :'<@192921939818315777> [**SYBAU PIX**](https://files.catbox.moe/rvy8fy.gif)', 	

    // --- royalty --- 201893726535024640
    'royaltyswag' : `<@201893726535024640> [**SWIGGITY SWOOTY IM COMIN' FO DAT BOOTY**](https://files.catbox.moe/dgg08v.gif)`,

    // --- others --- 	
    'ungyatt': 'UN QUE? [**UN GYATT**](https://imgur.com/a/VT1KU6I)',

}

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
            let raidHelperRoleName = 'Raid Helper';
            if (message.guild) {
                try {
                    const role = await message.guild.roles.fetch(RAID_HELPER_ROLE_ID);
                    if (role) {
                        raidHelperRoleName = role.name;
                    }
                } catch (error) {
                    console.error('Error fetching RAID_HELPER_ROLE_ID name for !raidinfo:', error);
                }
            }

            // USE IMPORTED EMBED FUNCTION
            const howToUseEmbed = getHowToUseEmbed(raidHelperRoleName);
            const initialButtonsRow = getInitialButtonsRow();

            try {
                await message.channel.send({ embeds: [howToUseEmbed], components: [initialButtonsRow] });
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
            // USE IMPORTED EMBED FUNCTION, passing the command maps for formatting
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
                            .setDescription(`The <@&${RAID_HELPER_ROLE_ID}> role has been removed.`); // Using <@&roleID> to mention the role

                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    } else {
                        await member.roles.add(RAID_HELPER_ROLE_ID, 'Requested via Get Help Role button');

                        const embed = new EmbedBuilder()
                            .setColor(0x3498DB)
                            .setDescription(`The <@&${RAID_HELPER_ROLE_ID}> role has been added!`); // Using <@&roleID> to mention the role

                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    }

                } catch (error) {
                    console.error('Error assigning help role:', error);
                    await interaction.reply({ content: 'There was an error trying to assign you the role. Please ensure I have `Manage Roles` permission and my role is above the Raid Helper role.', ephemeral: true });
                }
                break;
            case 'startRaid_btn':
                // check if they are a raid helper
                if (!interaction.member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
                    await interaction.reply({
                        content: `You need the <@&${RAID_HELPER_ROLE_ID}> role to start a raid. Please click the '📣 Get Help Role' button first to obtain it.`, ephemeral: true
                    });
                    return;
                }
                // Show the raid request modal
                const modal = getRaidRequestModal(interaction.user.id);
                await interaction.showModal(modal);
                break;
            case 'seeRaidTasks_btn':
                const tasksEmbed = getCombinedTasksAndPointsEmbed();
                await interaction.reply({ embeds: [tasksEmbed], ephemeral: true });
                break;
            case 'showAllCommands_btn':
                const commandsEmbed = getCommandsEmbed();
                await interaction.reply({ embeds: [commandsEmbed], ephemeral: true });
                break;
            default:
                break;
        }
    });
}
