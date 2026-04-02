import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import { EMBED_COLOR, MODERATOR_ROLE_ID, OFFICER_ROLE_ID, RAID_MANAGER_ROLE_ID } from '../../config/constants.js';
import { sendLeaderboardBackup } from '../backup/index.js';
import {
    createLbCheckResponse,
    createPaginatedLeaderboardEmbed,
    getCachedLeaderboard,
    getDailyPointsForRange,
    getSortedLeaderboard,
    resetLeaderboard,
    sendPreviousLeaderboardAnnouncement,
    setupMonthlyResetTask,
    updateLeaderboard,
} from './core.js';

export const pendingResets = new Map();
export const RESET_CONFIRMATION_TIMEOUT_MS = 30 * 1000;
export const activePaginationSessions = new Map();
export const PAGINATION_SESSION_LIFETIME_MS = 5 * 60 * 1000;

function isAdmin(message) {
    if (!message.member) {
        console.warn('isAdmin called for a message without a member object.');
        return false;
    }

    return (
        message.member.roles.cache.has(MODERATOR_ROLE_ID) ||
        message.member.roles.cache.has(OFFICER_ROLE_ID) ||
        message.member.roles.cache.has(RAID_MANAGER_ROLE_ID)
    );
}

function createXpEmbed(action, amount, userIds) {
    const isPositive = action === 'add';
    const xpString = isPositive ? `added ${amount} EXP to` : `removed ${amount} EXP from`;

    return new EmbedBuilder()
        .setColor(isPositive ? EMBED_COLOR : 0xff0000)
        .setTitle(isPositive ? 'EXP Added' : 'EXP Removed')
        .setDescription(`${xpString} \n${userIds.map((id) => `<@${id}>`).join(', ')}`);
}

export function getDateRangeFromInput(input = '') {
    const now = new Date();
    const getUtcMidnight = (date) => new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const parts = input.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const MAX_RANGE_DAYS = 3;

    let startDate = null;
    let endDate = null;
    let description = '';

    if (parts.length === 0 || parts[0] === 'today') {
        startDate = getUtcMidnight(now);
        endDate = getUtcMidnight(now);
        description = 'Today';
    } else if (parts[0] === 'yesterday') {
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        startDate = getUtcMidnight(yesterday);
        endDate = getUtcMidnight(yesterday);
        description = 'Yesterday';
    } else if (parts[0] === 'from' && parts[1] && parts[2] === 'to' && parts[3]) {
        const startToken = parts[1];
        const endToken = parts[3];

        const isIso = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t);

        if (isIso(startToken) && isIso(endToken)) {
            const [sy, sm, sd] = startToken.split('-').map((v) => parseInt(v, 10));
            const [ey, em, ed] = endToken.split('-').map((v) => parseInt(v, 10));
            const sDate = new Date(sy, sm - 1, sd);
            const eDate = new Date(ey, em - 1, ed);

            if (isNaN(sDate.getTime()) || isNaN(eDate.getTime()) || sDate.getTime() > eDate.getTime()) {
                return { error: 'Invalid date range. Use `from YYYY-MM-DD to YYYY-MM-DD`.' };
            }

            startDate = getUtcMidnight(sDate);
            endDate = getUtcMidnight(eDate);
            description = `From ${startToken} to ${endToken}`;
        } else {
            const startDay = parseInt(startToken, 10);
            const endDay = parseInt(endToken, 10);

            if (isNaN(startDay) || isNaN(endDay) || startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31 || startDay > endDay) {
                return { error: 'Invalid date range. Use `from <day> to <day>` or `from YYYY-MM-DD to YYYY-MM-DD`.' };
            }

            startDate = getUtcMidnight(new Date(now.getFullYear(), now.getMonth(), startDay));
            endDate = getUtcMidnight(new Date(now.getFullYear(), now.getMonth(), endDay));
            description = `From Day ${startDay} to Day ${endDay} of this month`;
        }
    } else if (parts.length === 1 && !isNaN(parseInt(parts[0], 10))) {
        const day = parseInt(parts[0], 10);
        if (day < 1 || day > 31) {
            return { error: 'Invalid day number. Use a number between 1 and 31.' };
        }

        startDate = getUtcMidnight(new Date(now.getFullYear(), now.getMonth(), day));
        endDate = getUtcMidnight(new Date(now.getFullYear(), now.getMonth(), day));
        description = `On Day ${day} of this month`;
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
        const [yearText, monthText, dayText] = parts[0].split('-');
        const year = parseInt(yearText, 10);
        const month = parseInt(monthText, 10) - 1;
        const day = parseInt(dayText, 10);
        const parsedDate = new Date(year, month, day);

        if (parsedDate.getFullYear() !== year || parsedDate.getMonth() !== month || parsedDate.getDate() !== day) {
            return { error: 'Invalid date format. Use `YYYY-MM-DD`.' };
        }

        startDate = getUtcMidnight(parsedDate);
        endDate = getUtcMidnight(parsedDate);
        description = `On ${parts[0]}`;
    } else {
        return { error: 'Invalid usage. Use `today`, `yesterday`, `<day>`, `from <start> to <end>`, or `YYYY-MM-DD`.' };
    }

    // Clamp lb check ranges to at most 3 days to keep it readable.
    const daysSpan = Math.floor((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    if (daysSpan > MAX_RANGE_DAYS) {
        const clampedEnd = new Date(startDate);
        clampedEnd.setUTCDate(clampedEnd.getUTCDate() + (MAX_RANGE_DAYS - 1));
        endDate = getUtcMidnight(clampedEnd);
        description = `${description} (showing max ${MAX_RANGE_DAYS} days)`;
    }

    const formatToISO = (date) => date.toISOString().split('T')[0];

    return {
        startDateISO: formatToISO(startDate),
        endDateISO: formatToISO(endDate),
        description,
        rawStartDate: startDate,
        rawEndDate: endDate,
    };
}

function extractLbCheckRange(content, message) {
    let cleanContent = content.toLowerCase().replace('!lbcheck', '').trim();
    message.mentions.users.forEach((user) => {
        cleanContent = cleanContent.replace(new RegExp(`<@!?${user.id}>`, 'g'), '').trim();
    });
    return cleanContent;
}

function getDisabledPaginationRow(prefix, timestamp) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${prefix}_start_disabled_${timestamp}`).setLabel('<<').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${prefix}_prev_disabled_${timestamp}`).setLabel('<').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${prefix}_next_disabled_${timestamp}`).setLabel('>').setStyle(ButtonStyle.Secondary).setDisabled(true),
        new ButtonBuilder().setCustomId(`${prefix}_end_disabled_${timestamp}`).setLabel('>>').setStyle(ButtonStyle.Secondary).setDisabled(true),
    );
}

async function storePaginationSession(send, sessionData, renderResponse, prefix) {
    const response = await renderResponse(sessionData);
    const sentMessage = await send(response);

    activePaginationSessions.set(sentMessage.id, sessionData);
    sessionData.timeoutId = setTimeout(async () => {
        activePaginationSessions.delete(sentMessage.id);
        try {
            const expiredMessage = await sentMessage.channel.messages.fetch(sentMessage.id).catch(() => null);
            if (expiredMessage) {
                await expiredMessage.edit({ components: [getDisabledPaginationRow(prefix, sessionData.timestamp)] });
            }
        } catch (error) {
            console.error(`Error disabling buttons for expired ${prefix} session ${sentMessage.id}:`, error);
        }
    }, PAGINATION_SESSION_LIFETIME_MS);
}

export async function sendLeaderboardResults({ client, guild, requesterId, send }) {
    const leaderboard = await getCachedLeaderboard();
    const allPlayers = getSortedLeaderboard(leaderboard, Infinity, true);
    const lastResetDate = leaderboard._lastResetDate ? new Date(leaderboard._lastResetDate).toLocaleDateString() : 'Never';

    const sessionData = {
        type: 'leaderboard',
        currentPage: 1,
        totalPages: Math.max(1, Math.ceil(allPlayers.length / 10)),
        usersData: allPlayers,
        resetInfo: `Last reset: ${lastResetDate}`,
        originalRequesterId: requesterId,
        timestamp: Date.now(),
    };

    await storePaginationSession(
        send,
        sessionData,
        (currentSessionData) => createPaginatedLeaderboardEmbed(currentSessionData, client, guild),
        'lb',
    );
}

export async function sendLeaderboardCheckResults({ client, guild, requesterId, rangeInput = '', targetUserIds = [], send }) {
    const dateInfo = getDateRangeFromInput(rangeInput);
    if (dateInfo.error) {
        throw new Error(dateInfo.error);
    }

    const leaderboard = await getCachedLeaderboard();
    const effectiveTargetUserIds = new Set(targetUserIds);

    if (effectiveTargetUserIds.size === 0) {
        const allDailyPoints = await getDailyPointsForRange(
            Object.keys(leaderboard).filter((key) => !key.startsWith('_')),
            dateInfo.rawStartDate,
            dateInfo.rawEndDate,
        );
        allDailyPoints.forEach((entry) => effectiveTargetUserIds.add(entry.userId));
    }

    if (effectiveTargetUserIds.size === 0) {
        throw new Error(`No EXP recorded for anyone ${dateInfo.description}.`);
    }

    const usersData = await Promise.all(
        Array.from(effectiveTargetUserIds).map(async (userId) => {
            let userDisplayName = `<@${userId}>`;

            try {
                const member = await guild.members.fetch(userId);
                userDisplayName = member.displayName;
            } catch {
                try {
                    const user = await client.users.fetch(userId);
                    userDisplayName = user.username;
                } catch (error) {
                    console.error(`Could not resolve user ID ${userId}:`, error);
                }
            }

            const dailyDataForUser = await getDailyPointsForRange([userId], dateInfo.rawStartDate, dateInfo.rawEndDate);
            dailyDataForUser.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            let totalPointsForRange = 0;
            const dailyBreakdown = [];
            dailyDataForUser.forEach((entry) => {
                totalPointsForRange += entry.points;
                dailyBreakdown.push(`\`${entry.date}\`: ${entry.points} EXP`);
            });

            return {
                id: userId,
                displayName: userDisplayName,
                totalPointsForRange,
                dailyBreakdown,
                overallTotal: leaderboard[userId] || 0,
            };
        }),
    );

    const finalUsersData = targetUserIds.length === 0
        ? usersData.filter((userData) => userData.totalPointsForRange > 0)
        : usersData;

    if (finalUsersData.length === 0) {
        throw new Error(`No EXP recorded for the specified users/date ${dateInfo.description}.`);
    }

    finalUsersData.sort((a, b) => b.totalPointsForRange - a.totalPointsForRange);

    const sessionData = {
        type: 'lbcheck',
        currentPage: 1,
        totalPages: Math.max(1, Math.ceil(finalUsersData.length / 5)),
        usersData: finalUsersData,
        dateInfo,
        originalRequesterId: requesterId,
        timestamp: Date.now(),
    };

    await storePaginationSession(
        send,
        sessionData,
        (currentSessionData) => createLbCheckResponse(currentSessionData, client, guild),
        'lbcheck',
    );
}

async function handleAddXp(message, client) {
    const mentions = message.mentions.users;
    const amountMatch = message.content.match(/(-?\d+)$/);

    if (mentions.size === 0 || !amountMatch) {
        await message.reply({ content: 'Usage: `!addxp @user1 [@user2 ...] <amount>`' });
        return;
    }

    const amount = parseInt(amountMatch[1], 10);
    const addedToUserIds = Array.from(mentions.keys());

    for (const id of addedToUserIds) {
        await updateLeaderboard(id, amount);
    }

    await message.channel.send({ embeds: [createXpEmbed('add', amount, addedToUserIds)] });
    await sendLeaderboardBackup(client);
}

async function handleRemoveXp(message, client) {
    const mentions = message.mentions.users;
    const amountMatch = message.content.match(/(-?\d+)$/);

    if (mentions.size === 0 || !amountMatch) {
        await message.reply({ content: 'Usage: `!removexp @user1 [@user2 ...] <amount>`' });
        return;
    }

    const amount = parseInt(amountMatch[1], 10);
    const removedFromUserIds = Array.from(mentions.keys());

    for (const id of removedFromUserIds) {
        await updateLeaderboard(id, -amount);
    }

    await message.channel.send({ embeds: [createXpEmbed('remove', amount, removedFromUserIds)] });
    await sendLeaderboardBackup(client);
}

async function handleResetRequest(message) {
    const fullReset = message.content.toLowerCase().split(/\s+/).includes('all');

    pendingResets.set(message.author.id, {
        timestamp: Date.now(),
        fullReset,
        channelId: message.channel.id,
    });

    await message.reply({
        content: `Are you sure you want to ${fullReset ? '**fully** ' : ''}reset the leaderboard? Type \`!confirm\` within ${RESET_CONFIRMATION_TIMEOUT_MS / 1000} seconds, or \`!cancel\`.`,
    });

    const timeoutId = setTimeout(async () => {
        const pending = pendingResets.get(message.author.id);
        if (pending && pending.channelId === message.channel.id && Date.now() - pending.timestamp < RESET_CONFIRMATION_TIMEOUT_MS) {
            pendingResets.delete(message.author.id);
            await message.author.send(`Your leaderboard reset confirmation in <#${message.channel.id}> has expired.`).catch(() => {});
        }
    }, RESET_CONFIRMATION_TIMEOUT_MS);

    pendingResets.get(message.author.id).timeoutId = timeoutId;
}

async function handleResetConfirmation(message, client) {
    const pending = pendingResets.get(message.author.id);

    if (!pending || pending.channelId !== message.channel.id || Date.now() - pending.timestamp > RESET_CONFIRMATION_TIMEOUT_MS) {
        await message.reply({ content: 'No pending leaderboard reset confirmation found or it has expired. Please use `!resetlb` first.' });
        return;
    }

    if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
    }
    pendingResets.delete(message.author.id);

    await resetLeaderboard(pending.fullReset);
    await message.reply({ content: `Leaderboard ${pending.fullReset ? 'fully' : 'monthly'} reset successfully!` });
    await sendLeaderboardBackup(client);
}

async function handleResetCancellation(message) {
    const pending = pendingResets.get(message.author.id);
    if (!pending || pending.channelId !== message.channel.id || Date.now() - pending.timestamp > RESET_CONFIRMATION_TIMEOUT_MS) {
        await message.reply({ content: 'No pending leaderboard reset to cancel.' });
        return;
    }

    if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
    }

    pendingResets.delete(message.author.id);
    await message.reply({ content: 'Leaderboard reset cancelled.' });
}

export async function handleLeaderboardMessage(message, client) {
    if (message.author.bot) return;

    const content = message.content.toLowerCase();
    const checkAdmin = () => isAdmin(message);

    if (content === '!leaderboard' || content === '!lb') {
        if (!message.guild) {
            await message.reply({ content: 'This command can only be used in a server.' });
            return;
        }

        try {
            await sendLeaderboardResults({
                client,
                guild: message.guild,
                requesterId: message.author.id,
                send: (payload) => message.channel.send(payload),
            });
        } catch (error) {
            console.error('Error displaying leaderboard:', error);
            await message.reply({ content: 'Failed to retrieve leaderboard. Please try again later.' });
        }
        return;
    }

    if (content.startsWith('!lbcheck')) {
        if (!message.guild) {
            await message.reply({ content: 'This command can only be used in a server.' });
            return;
        }

        try {
            await sendLeaderboardCheckResults({
                client,
                guild: message.guild,
                requesterId: message.author.id,
                rangeInput: extractLbCheckRange(message.content, message),
                targetUserIds: Array.from(message.mentions.users.keys()),
                send: (payload) => message.channel.send(payload),
            });
        } catch (error) {
            await message.reply({ content: error.message || 'Failed to check EXP. Please try again later.' });
        }
        return;
    }

    if (content.startsWith('!addxp')) {
        if (!checkAdmin()) {
            await message.reply({ content: 'You do not have permission to use this command.' });
            return;
        }

        try {
            await handleAddXp(message, client);
        } catch (error) {
            console.error('Error adding XP:', error);
            await message.reply({ content: 'Failed to add XP. Please try again later.' });
        }
        return;
    }

    if (content.startsWith('!removexp')) {
        if (!checkAdmin()) {
            await message.reply({ content: 'You do not have permission to use this command.' });
            return;
        }

        try {
            await handleRemoveXp(message, client);
        } catch (error) {
            console.error('Error removing XP:', error);
            await message.reply({ content: 'Failed to remove XP. Please try again later.' });
        }
        return;
    }

    if (content.startsWith('!resetlb')) {
        if (!checkAdmin()) {
            await message.reply({ content: 'You do not have permission to use this command.' });
            return;
        }

        await handleResetRequest(message);
        return;
    }

    if (content === '!confirm') {
        if (!checkAdmin()) {
            await message.reply({ content: 'You do not have permission to use this command.' });
            return;
        }

        try {
            await handleResetConfirmation(message, client);
        } catch (error) {
            console.error('Error resetting leaderboard:', error);
            await message.reply({ content: 'Failed to reset leaderboard. Please try again later.' });
        }
        return;
    }

    if (content === '!cancel') {
        if (!checkAdmin()) {
            return;
        }

        await handleResetCancellation(message);
        return;
    }

    if (content === '!sendprevlb') {
        await sendPreviousLeaderboardAnnouncement(client, true);
        await message.reply({ content: 'Sent previous month\'s leaderboard' });
    }
}

export async function handleLeaderboardButtonInteraction(interaction, client) {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('lb_') && !interaction.customId.startsWith('lbcheck_')) return;

    const [prefix, action, , timestampText] = interaction.customId.split('_');
    const timestamp = parseInt(timestampText, 10);
    const sessionKey = interaction.message.id;
    const sessionData = activePaginationSessions.get(sessionKey);

    if (!sessionData || Date.now() - sessionData.timestamp > PAGINATION_SESSION_LIFETIME_MS) {
        if (sessionData?.timeoutId) {
            clearTimeout(sessionData.timeoutId);
        }
        activePaginationSessions.delete(sessionKey);

        await interaction.update({ components: [getDisabledPaginationRow('expired', timestamp)] }).catch(() => {});
        await interaction.followUp({ content: 'This session has expired. Please run the command again.', flags: MessageFlags.Ephemeral });
        return;
    }

    if (interaction.user.id !== sessionData.originalRequesterId) {
        await interaction.reply({ content: 'You can only navigate your own command results!', flags: MessageFlags.Ephemeral });
        return;
    }

    await interaction.deferUpdate();

    clearTimeout(sessionData.timeoutId);
    sessionData.timeoutId = setTimeout(async () => {
        activePaginationSessions.delete(sessionKey);
        try {
            const expiredMessage = await interaction.channel.messages.fetch(sessionKey).catch(() => null);
            if (expiredMessage) {
                await expiredMessage.edit({ components: [getDisabledPaginationRow(prefix, timestamp)] });
            }
        } catch (error) {
            console.error(`Error disabling buttons for expired ${prefix} session ${sessionKey}:`, error);
        }
    }, PAGINATION_SESSION_LIFETIME_MS);

    if (action === 'start') sessionData.currentPage = 1;
    if (action === 'end') sessionData.currentPage = sessionData.totalPages;
    if (action === 'next') sessionData.currentPage += 1;
    if (action === 'prev') sessionData.currentPage -= 1;

    sessionData.currentPage = Math.max(1, Math.min(sessionData.currentPage, sessionData.totalPages));
    activePaginationSessions.set(sessionKey, sessionData);

    const response = sessionData.type === 'leaderboard'
        ? await createPaginatedLeaderboardEmbed(sessionData, client, interaction.guild)
        : await createLbCheckResponse(sessionData, client, interaction.guild);

    await interaction.editReply(response);
}

export function startLeaderboardTasks(client) {
    setupMonthlyResetTask(client);
}
