import { EmbedBuilder } from 'discord.js';

import {
    EMBED_COLOR,
    LEADERBOARD_CHANNEL_ID,
    MAX_XP_PER_RAID,
    RAID_CHANNEL_ID,
    RAID_HELPER_ROLE_ID,
    RAID_MANAGEMENT_CHANNEL_ID,
} from '../../config/constants.js';

import {
    getRaidWizardCategoryDef,
    getRaidWizardCategorySelectRow,
    getRaidWizardDetailsModal,
    getRaidWizardNavRow,
    getRaidWizardTaskOptionsCount,
    getRaidWizardTasksSelectRow,
} from '../../Embeds/raidTicketEmbeds.js';

import { calculateTaskPointsWithMultiplier } from '../../utils/taskCalculations.js';
import {
    consumeRaidWizardSession,
    createRaidWizardSession,
    getRaidWizardSession,
    updateRaidWizardSession,
} from '../raidTickets/raidWizardSession.js';

import { maybeHandleGifTextCommands } from './gifTextCommandsHandler.js';

import {
    getChartsEmbed,
    getCombinedTasksAndPointsEmbed,
    getCommandsEmbed,
    getHowToUseEmbed,
    getInitialButtonsRow,
    getLeaderboardCommandsEmbed,
    getModeratorCommandsEmbed,
    getRaidRulesEmbed,
} from '../../Embeds/generalCommandsEmbeds.js';

function getWizardCategoryEmbed({ categoryKeys = [] } = {}) {
    const categories = (categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);

    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Start Raid')
        .setDescription('Page 1/2: Select a category.');

    if (categories.length) {
        embed.addFields({
            name: 'Selected Categories',
            value: categories.map((c) => `• **${c.label}**`).join('\n').slice(0, 1024),
            inline: false,
        });
    }

    return embed;
}

function getWizardTasksEmbed({ categoryKeys, tasks = [] }) {
    const categories = (categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);
    const categoryLabel = categories.length ? categories.map((c) => c.label).join(', ') : (categoryKeys || []).join(', ');

    const embed = new EmbedBuilder()
        .setColor(EMBED_COLOR)
        .setTitle('Start Raid')
        .setDescription(`Page 2/2: Select task(s) for **${categoryLabel || 'selected categories'}**.`);

    embed.addFields({
        name: 'Selected Tasks',
        value: tasks.length ? tasks.map((t) => `\`${t}\``).join(', ') : '*None*',
        inline: false,
    });

    return embed;
}

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

export function setupGeneralCommandsHandler(client) {
    client.on('messageCreate', async (message) => {
        if (message.author.bot) return;

        const commandContent = message.content.toLowerCase();

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

        if (interaction.customId === 'startRaidWizard_btn') {
            if (!interaction.member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
                await interaction.reply({
                    content: `You need the <@&${RAID_HELPER_ROLE_ID}> role to start a raid. Click 'ðŸ“£ Get Help Role' first.`,
                    ephemeral: true,
                });
                return;
            }

            const sessionId = createRaidWizardSession({ userId: interaction.user.id, guildId: interaction.guildId });

            await interaction.reply({
                embeds: [getWizardCategoryEmbed()],
                components: [
                    getRaidWizardCategorySelectRow(sessionId, []),
                    getRaidWizardNavRow(sessionId, { step: 'category', canContinue: false }),
                ],
                ephemeral: true,
            });
            return;
        }

        if (interaction.customId.startsWith('raidWizard_')) {
            const pick = (prefix) => (interaction.customId.startsWith(prefix) ? interaction.customId.slice(prefix.length) : null);

            const cancelSessionId = pick('raidWizard_cancel_');
            const backSessionId = pick('raidWizard_back_');
            const continueSessionId = pick('raidWizard_continue_');

            const sessionId = cancelSessionId || backSessionId || continueSessionId;
            if (!sessionId) return;

            const session = getRaidWizardSession(sessionId);
            if (!session || session.userId !== interaction.user.id) {
                await interaction.reply({ content: 'This raid creation session expired. Press Start Raid again.', ephemeral: true });
                return;
            }

            if (cancelSessionId) {
                consumeRaidWizardSession(cancelSessionId);
                await interaction.update({ content: 'Raid creation cancelled.', embeds: [], components: [] });
                return;
            }

            if (backSessionId) {
                const updated = updateRaidWizardSession(backSessionId, { step: 'category' });
                await interaction.update({
                    embeds: [getWizardCategoryEmbed({ categoryKeys: updated.categoryKeys })],
                    components: [
                        getRaidWizardCategorySelectRow(backSessionId, updated.categoryKeys),
                        getRaidWizardNavRow(backSessionId, { step: 'category', canContinue: (updated.categoryKeys?.length ?? 0) > 0 }),
                    ],
                });
                return;
            }

            if (continueSessionId) {
                if (session.step === 'category') {
                    if (!session.categoryKeys?.length) {
                        await interaction.reply({ content: 'Select at least one category first.', ephemeral: true });
                        return;
                    }

                    const optionCount = getRaidWizardTaskOptionsCount(session.categoryKeys);
                    if (optionCount > 25) {
                        await interaction.reply({ content: 'Too many tasks selected. Pick fewer categories (max 25 options).', ephemeral: true });
                        return;
                    }

                    const updated = updateRaidWizardSession(continueSessionId, { step: 'tasks' });

                    await interaction.update({
                        embeds: [getWizardTasksEmbed({ categoryKeys: updated.categoryKeys, tasks: updated.tasks })],
                        components: [
                            getRaidWizardTasksSelectRow(continueSessionId, updated.categoryKeys, updated.tasks),
                            getRaidWizardNavRow(continueSessionId, { step: 'tasks', canContinue: (updated.tasks?.length ?? 0) > 0 }),
                        ],
                    });
                    return;
                }

                if (!session.tasks?.length) {
                    await interaction.reply({ content: 'Select at least one task first.', ephemeral: true });
                    return;
                }

                const includesGeneric = session.tasks?.some((t) => ['simple', 'moderate', 'hard'].includes(t)) ?? false;
                const raidType = inferRaidTypeFromCategoryKeys(session.categoryKeys);
                const mapNameRequired = includesGeneric;

                await interaction.showModal(getRaidWizardDetailsModal(continueSessionId, raidType, { mapNameRequired }));
                return;
            }
        }

        switch (interaction.customId) {
            case 'getHelpRole_btn': {
                const guild = interaction.guild;
                const member = interaction.member;

                if (!guild) {
                    await interaction.reply({ content: 'This command can only be used in a server.', ephemeral: true });
                    return;
                }

                try {
                    const role = await guild.roles.fetch(RAID_HELPER_ROLE_ID);

                    if (!role) {
                        await interaction.reply({ content: 'The specified helper role was not found. Please contact an administrator.', ephemeral: true });
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

                    if (member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
                        await member.roles.remove(RAID_HELPER_ROLE_ID, 'Requested via Get Help Role button');

                        const embed = new EmbedBuilder()
                            .setColor(EMBED_COLOR)
                            .setDescription(`<@&${RAID_HELPER_ROLE_ID}> role has been removed.`);

                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    } else {
                        await member.roles.add(RAID_HELPER_ROLE_ID, 'Requested via Get Help Role button');

                        const embed = new EmbedBuilder()
                            .setColor(EMBED_COLOR)
                            .setDescription(`<@&${RAID_HELPER_ROLE_ID}> role has been added`);

                        await interaction.reply({ embeds: [embed], ephemeral: true });
                    }
                } catch (error) {
                    console.error('Error assigning help role:', error);
                    await interaction.reply({ content: 'There was an error trying to assign you the role. Please ensure I have `Manage Roles` permission and my role is above the Raid Helper role.', ephemeral: true });
                }
                break;
            }

            case 'seeRaidTasks_btn': {
                const tasksEmbed = getCombinedTasksAndPointsEmbed();
                await interaction.reply({
                    content: 'Below are the list of available tasks and exp values sectioned by their category.\n' +
                        '* You can use the following names for combined multiple tasks: `dailies` or `daily`, `weeklies` or `weekly`, `templeshrine`, `originul`, `legion`\n' +
                        '* You can also use /taskalias [task] for other names you could use for that task, like `gramiel` as `gram`\n' +
                        '* For multiple runs of the same task, you can append ` x[number]` to the task name, e.g. `nerfkitten x3` to indicate 3 runs of nerfkitten.',
                    embeds: tasksEmbed,
                    ephemeral: true,
                });
                break;
            }

            case 'showAllCommands_btn': {
                const commandsEmbed = getCommandsEmbed();
                await interaction.reply({ embeds: [commandsEmbed], ephemeral: true });
                break;
            }

            default:
                break;
        }
    });

    client.on('interactionCreate', async (interaction) => {
        if (!interaction.isStringSelectMenu()) return;

        if (interaction.customId.startsWith('raidWizard_category_')) {
            const sessionId = interaction.customId.slice('raidWizard_category_'.length);
            const session = getRaidWizardSession(sessionId);
            if (!session || session.userId !== interaction.user.id) {
                await interaction.reply({ content: 'This raid creation session expired. Press Start Raid again.', ephemeral: true });
                return;
            }

            const categoryKeys = interaction.values || [];
            const updated = updateRaidWizardSession(sessionId, { categoryKeys, step: 'category', tasks: [] });

            const optionCount = getRaidWizardTaskOptionsCount(updated.categoryKeys);
            const canContinue = updated.categoryKeys.length > 0 && optionCount <= 25;

            await interaction.update({
                embeds: [
                    getWizardCategoryEmbed({ categoryKeys: updated.categoryKeys })
                        .addFields({
                            name: 'Task Count',
                            value: optionCount <= 25
                                ? `This selection will show **${optionCount}** options on Page 2.`
                                : `Too many tasks (**${optionCount}** options). Select fewer categories (max 25 options).`,
                            inline: false,
                        }),
                ],
                components: [
                    getRaidWizardCategorySelectRow(sessionId, updated.categoryKeys),
                    getRaidWizardNavRow(sessionId, { step: 'category', canContinue }),
                ],
            });
            return;
        }

        if (interaction.customId.startsWith('raidWizard_tasks_')) {
            const sessionId = interaction.customId.slice('raidWizard_tasks_'.length);
            const session = getRaidWizardSession(sessionId);
            if (!session || session.userId !== interaction.user.id) {
                await interaction.reply({ content: 'This raid creation session expired. Press Start Raid again.', ephemeral: true });
                return;
            }

            const rawSelected = interaction.values || [];
            const categories = (session.categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);
            const allTasksForAllCategories = [...new Set(categories.flatMap((c) => c.tasks))];

            let tasks = [];
            if (rawSelected.includes('__all_selected__')) {
                tasks = allTasksForAllCategories;
            } else {
                const perCategoryAll = rawSelected
                    .filter((v) => v.startsWith('__all__:'))
                    .map((v) => v.slice('__all__:'.length));

                const expanded = perCategoryAll.flatMap((catKey) => getRaidWizardCategoryDef(catKey)?.tasks ?? []);
                const explicit = rawSelected.filter((v) => !v.startsWith('__all__:') && v !== '__all_selected__');
                tasks = [...new Set([...expanded, ...explicit])].filter(Boolean);
            }

            const updated = updateRaidWizardSession(sessionId, { tasks, step: 'tasks' });

            await interaction.update({
                embeds: [getWizardTasksEmbed({ categoryKeys: updated.categoryKeys, tasks })],
                components: [
                    getRaidWizardTasksSelectRow(sessionId, updated.categoryKeys, tasks),
                    getRaidWizardNavRow(sessionId, { step: 'tasks', canContinue: tasks.length > 0 }),
                ],
            });
        }
    });
}
