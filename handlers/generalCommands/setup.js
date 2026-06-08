import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    StringSelectMenuBuilder,
} from 'discord.js';

import {
    EMBED_COLOR,
    LEADERBOARD_CHANNEL_ID,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RAID_CHANNEL_ID,
    RAID_HELPER_ROLE_ID,
    RAID_MANAGER_ROLE_ID,
    RAID_MANAGEMENT_CHANNEL_ID,
} from '../../config/constants.js';








import { maybeHandleGifTextCommands } from './gifTextCommandsHandler.js';
import { handleGifCommandCrudInteraction, maybeHandleGifCommandCrudMessage } from './gifCommandsCrud.js';
import { handleChartsCrudInteraction, maybeHandleEditChartMessage } from './chartsCrud.js';

import {
    handleChartShowInteraction,
    handleChartsBrowseInteraction,
    maybeHandleChartTriggerMessage,
    maybeHandleChartsBrowseMessage,
} from '../charts/charts.js';

import {
    getCombinedTasksAndPointsEmbed,

    getCommandsEmbed,
    getHowToUseEmbed,
    getInitialButtonsRow,
    getLeaderboardCommandsEmbed,
    getModeratorCommandsEmbed,
    getRaidTasksPageCount,
    getRaidTasksPageComponents,
    getRaidRulesEmbed,
} from '../../Embeds/generalCommandsEmbeds.js';


import { getLeaderboardData, setLeaderboardData } from '../../utils/dbOps.js';

function isStaffMember(member) {
    if (!member) return false;
    return (
        member.roles.cache.has(MODERATOR_ROLE_ID) ||
        member.roles.cache.has(OFFICER_ROLE_ID) ||
        member.roles.cache.has(RAID_MANAGER_ROLE_ID)
    );
}

function tryParseUserPointsJson(textRaw) {
    const text = String(textRaw ?? '').trim();
    if (!text) throw new Error('Empty file.');

    const candidates = [text];
    if (!text.startsWith('{')) candidates.push(`{\n${text}\n}`);

    for (const cand of candidates) {
        try {
            const cleaned = cand.replace(/,\\s*([}\\]])/g, '$1'); // trailing commas
            const parsed = JSON.parse(cleaned);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Not an object.');
            return parsed;
        } catch {
            // try next candidate
        }
    }

    throw new Error('Invalid JSON format.');
}

async function applyLeaderboardBackupObject(obj) {
    const normalizeUserIdKey = (raw) => String(raw ?? '')
        .replace(/^\uFEFF/, '') // strip UTF-8 BOM if present
        .trim()
        .replace(/\s+/g, '');

    const entries = Object.entries(obj || {})
        .map(([userId, points]) => [normalizeUserIdKey(userId), Number(points)])
        .filter(([userId, points]) => userId && !userId.startsWith('_') && /^\d+$/.test(userId) && Number.isFinite(points) && points > 0);

    if (!entries.length) return { updated: 0, scanned: Object.keys(obj || {}).length };

    const leaderboard = await getLeaderboardData().catch(() => ({}));
    for (const [userId, points] of entries) {
        leaderboard[userId] = Math.floor(points);
    }
    await setLeaderboardData(leaderboard);

    invalidateLeaderboardCache();
    return { updated: entries.length, scanned: Object.keys(obj || {}).length };
}

export function setupGeneralCommandsHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const commandContent = message.content.toLowerCase();

        // Easter egg: respond when bot is mentioned (only in raid ticket channels)
        const botId = client.user.id;
        if (message.mentions.has(botId) && message.content.replace(/<@!?[\d]+>/g, '').trim() === '') {
            const { RAID_CATEGORY_ID } = await import('../../config/constants.js');
            if (message.channel?.parentId === RAID_CATEGORY_ID && message.channel.type === 0) {
                const { PING_RESPONSES } = await import('../../config/constants/pingMessages.js');
                const randomResponse = PING_RESPONSES[Math.floor(Math.random() * PING_RESPONSES.length)];
                await message.reply(randomResponse);
            }
            return;
        }

        if (await maybeHandleEditChartMessage(message)) return;

        if (await maybeHandleChartsBrowseMessage(message)) return;
        if (await maybeHandleChartTriggerMessage(message)) return;

        if (await maybeHandleGifCommandCrudMessage(message)) return;



        if (await maybeHandleGifTextCommands(message)) return;

        // --- Handle the !raidinfo command (formerly !raidcommands) ---
        if (commandContent === '!raidinfo' && message.channel.id === RAID_CHANNEL_ID) {
            const howToUseEmbed = getHowToUseEmbed();
            const initialButtonsRow = getInitialButtonsRow();

            try {
                await message.channel.send({ embeds: [howToUseEmbed], components: [initialButtonsRow] });
            } catch (error) {
                console.error('Error sending !raidinfo embed:', error);
                await message.channel.send('Failed to display raid information. Please try again later.');
            }
        }

        // !charts / !chart / chart triggers are handled above.

        if (commandContent === '!ping') {
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

        // --- Handle the !raidtasks command ---
        if (commandContent === '!raidtasks' && message.channel.id === RAID_CHANNEL_ID) {
            const tasksEmbed = getCombinedTasksAndPointsEmbed(0);
            try {
                await message.channel.send({
                    content: 'Below are the list of available tasks and exp values sectioned by their category.\n',
                    embeds: tasksEmbed,
                    components: getRaidTasksPageComponents(0),
                });
            } catch (error) {
                console.error('Error sending !raidtasks embed:', error);
                await message.channel.send('Failed to display raid tasks. Please try again later.');
            }
            return;
        }

        // --- Handle the !calculatetask command ---
        if (commandContent.startsWith('!calculatetask')) {
            const args = message.content.slice('!calculatetask'.length).trim();

            const {
                totalCalculatedPoints,
                originalTotalCalculatedPoints,
                unknownTasks,
            } = calculateTaskPointsWithMultiplier(args);

            let replyContent = `Calculated Points: **${totalCalculatedPoints}** EXP\n\n`;

            if (unknownTasks.length > 0) {
                replyContent += `\n\n_Note: The following tasks were not recognized and were not included in the calculation: ${unknownTasks.join(', ')}._`;
            }

            if (originalTotalCalculatedPoints > MAX_XP_PER_RAID) {
                replyContent += `\n_This calculation was capped at ${MAX_XP_PER_RAID} EXP (original total: ${originalTotalCalculatedPoints} EXP)._`;
            }

            await message.reply({ content: replyContent });
            return;
        }

        // --- Handle the !lbcommands command ---
        if (commandContent === '!lbcommands' && message.channel.id === LEADERBOARD_CHANNEL_ID) {
            const leaderboardCommandsEmbed = getLeaderboardCommandsEmbed();

            try {
                await message.channel.send({ embeds: [leaderboardCommandsEmbed] });
            } catch (error) {
                console.error('Error sending !lbcommands embed:', error);
                await message.channel.send('Failed to display leaderboard commands. Please try again later.');
            }
        }

        // --- Handle the !restorelb command (restore from JSON) ---
        if (commandContent === '!restorelb') {
            if (!message.guild) return;
            if (!isStaffMember(message.member)) {
                await message.reply({ content: 'You do not have permission to restore the leaderboard.' });
                return;
            }

            await message.reply('Upload the leaderboard JSON file in your next message (2 minutes).');

            try {
                const collected = await message.channel.awaitMessages({
                    filter: (m) => m.author.id === message.author.id && (m.attachments?.size ?? 0) > 0,
                    max: 1,
                    time: 120000,
                    errors: ['time'],
                });

                const nextMsg = collected.first();
                const attachment = nextMsg?.attachments?.first?.();
                const url = attachment?.url ? String(attachment.url) : '';
                if (!url) throw new Error('No attachment url.');

                const res = await fetch(url);
                const text = await res.text();
                const parsed = tryParseUserPointsJson(text);
                const { updated, scanned } = await applyLeaderboardBackupObject(parsed);

                await message.reply(`Leaderboard restored. Updated **${updated}** user(s) out of **${scanned ?? 0}** row(s). (Ignored 0-point rows.)`);
            } catch {
                await message.reply('Timed out or no attachment received.');
            }
            return;
        }

        // --- handle the moderator commands ---
        if (commandContent === '!modcommands' && message.channel.id === RAID_MANAGEMENT_CHANNEL_ID) {
            const moderatorCommandsEmbed = getModeratorCommandsEmbed();

            try {
                await message.channel.send({ embeds: [moderatorCommandsEmbed] });
            } catch (error) {
                console.error('Error sending !modcommands embed:', error);
                await message.channel.send('Failed to display moderator commands. Please try again later.');
            }
        }
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isButton()) return;

        if (await handleChartsCrudInteraction(interaction)) return;
        if (await handleChartShowInteraction(interaction)) return;
        if (await handleChartsBrowseInteraction(interaction)) return;
        if (await handleGifCommandCrudInteraction(interaction)) return;
        if (await handleRaidTaskCrudInteraction(interaction)) return;

        if (
            interaction.customId.startsWith('raidtasks_first_')
            || interaction.customId.startsWith('raidtasks_prev_')
            || interaction.customId.startsWith('raidtasks_next_')
            || interaction.customId.startsWith('raidtasks_last_')
        ) {
            const isFirst = interaction.customId.startsWith('raidtasks_first_');
            const isNext = interaction.customId.startsWith('raidtasks_next_');
            const isLast = interaction.customId.startsWith('raidtasks_last_');
            const current = Number(interaction.customId.split('_').pop()) || 0;
            const lastPage = Math.max(0, getRaidTasksPageCount() - 1);
            const page = isFirst ? 0 : isLast ? lastPage : Math.max(0, Math.min(lastPage, current + (isNext ? 1 : -1)));
            await interaction.update({
                embeds: getCombinedTasksAndPointsEmbed(page),
                components: getRaidTasksPageComponents(page),
            });
            return;
        }

        if (interaction.customId === 'startRaidWizard_btn') {
            if (!interaction.member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
                await interaction.reply({
                    content: `You need the <@&${RAID_HELPER_ROLE_ID}> role to start a raid. Click 'Get Help Role' first.`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const sessionId = createRaidWizardSession({ userId: interaction.user.id, guildId: interaction.guildId });

            await interaction.reply({
                components: [getWizardCategoryV2(sessionId, [])],
                flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
            });

            // Store the interaction token so the modal submit handler can edit this ephemeral wizard message later.
            updateRaidWizardSession(sessionId, { originAppId: interaction.applicationId, originToken: interaction.token });
            return;
        }

        if (interaction.customId.startsWith('raidWizard_')) {
            const handled = await handleRaidWizardNavButtons(interaction, WIZARD_MODE.CREATE, {
                getSession: getRaidWizardSession,
                validateSession: (session) => session.userId === interaction.user.id,
                onCancel: consumeRaidWizardSession,
                onBack: (sessionId) => updateRaidWizardSession(sessionId, { step: 'category' }),
                onAdvanceToTasks: (sessionId) => updateRaidWizardSession(sessionId, { step: 'tasks' }),
                onContinueFromTasks: async (navInteraction, session) => {
                    const tasks = session.tasks || [];
                    await navInteraction.showModal(getRaidWizardDetailsModal(session.sessionId, {
                        includeMapName: raidNeedsModalMapName(tasks),
                        requireMapName: raidRequiresModalMapName(tasks),
                    }));
                },
            });
            if (handled) return;
        }

        switch (interaction.customId) {
            case 'getHelpRole_btn': {
                const guild = interaction.guild;
                const member = interaction.member;

                if (!guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
                    return;
                }

                try {
                    const role = await guild.roles.fetch(RAID_HELPER_ROLE_ID);

                    if (!role) {
                        await interaction.reply({ content: 'The specified helper role was not found. Please contact an administrator.', flags: MessageFlags.Ephemeral });
                        return;
                    }

                    const botMember = await guild.members.fetch(client.user.id);
                    if (!botMember.permissions.has('ManageRoles')) {
                        await interaction.reply({ content: 'I do not have the necessary permissions (`Manage Roles`) to assign roles. Please ask an administrator to grant me this permission.', flags: MessageFlags.Ephemeral });
                        return;
                    }
                    if (botMember.roles.highest.position <= role.position) {
                        await interaction.reply({ content: `My role is not high enough to assign the \`${role.name}\` role. Please ensure my role is above the Raid Helper role in the server settings.`, flags: MessageFlags.Ephemeral });
                        return;
                    }

                    if (member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
                        await member.roles.remove(RAID_HELPER_ROLE_ID, 'Requested via Get Help Role button');

                        const embed = new EmbedBuilder()
                            .setColor(EMBED_COLOR)
                            .setDescription(`<@&${RAID_HELPER_ROLE_ID}> role has been removed.`);

                        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                    } else {
                        await member.roles.add(RAID_HELPER_ROLE_ID, 'Requested via Get Help Role button');

                        const embed = new EmbedBuilder()
                            .setColor(EMBED_COLOR)
                            .setDescription(`<@&${RAID_HELPER_ROLE_ID}> role has been added`);

                        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
                    }
                } catch (error) {
                    console.error('Error assigning help role:', error);
                    await interaction.reply({ content: 'There was an error trying to assign you the role. Please ensure I have `Manage Roles` permission and my role is above the Raid Helper role.', flags: MessageFlags.Ephemeral });
                }
                break;
            }

            case 'seeRaidTasks_btn': {
                const tasksEmbed = getCombinedTasksAndPointsEmbed(0);
                await interaction.reply({
                    content: 'Below are the list of available tasks and exp values sectioned by their category.\n',
                    embeds: tasksEmbed,
                    components: getRaidTasksPageComponents(0),
                    flags: MessageFlags.Ephemeral,
                });
                break;
            }

            case 'showAllCommands_btn': {
                const commandsEmbed = getCommandsEmbed();
                await interaction.reply({ embeds: [commandsEmbed], flags: MessageFlags.Ephemeral });
                break;
            }

            default:
                break;
        }
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isModalSubmit()) return;
        if (await handleChartsCrudInteraction(interaction)) return;
        if (await handleGifCommandCrudInteraction(interaction)) return;
        if (await handleRaidTaskCrudInteraction(interaction)) return;
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isStringSelectMenu()) return;

        if (await handleChartsCrudInteraction(interaction)) return;
        if (await handleChartsBrowseInteraction(interaction)) return;
        // CRUD modal submits land on the same interactionCreate event, but we already handle them above via the button listener.
        if (await handleGifCommandCrudInteraction(interaction)) return;
        if (await handleRaidTaskCrudInteraction(interaction)) return;

        const wizardSelectHandled = await handleRaidWizardTaskSelect(interaction, WIZARD_MODE.CREATE, {
            getSession: getRaidWizardSession,
            validateSession: (session) => session.userId === interaction.user.id,
            autoAdvanceOnValidCategory: true,
            updateCategoryKeys: (sessionId, categoryKeys, { autoAdvance } = {}) => {
                const optionCount = getRaidWizardTaskOptionsCount(categoryKeys);
                const canContinue = categoryKeys.length > 0 && optionCount <= 25;
                const nextStep = autoAdvance && canContinue ? 'tasks' : 'category';
                return updateRaidWizardSession(sessionId, { categoryKeys, step: nextStep, tasks: [] });
            },
            updateTasks: (sessionId, tasks) => updateRaidWizardSession(sessionId, { tasks, step: 'tasks' }),
        });
        if (wizardSelectHandled) return;
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isUserSelectMenu()) return;
        if (await handleChartsCrudInteraction(interaction)) return;
        if (await handleGifCommandCrudInteraction(interaction)) return;
        if (await handleRaidTaskCrudInteraction(interaction)) return;
    });
}
