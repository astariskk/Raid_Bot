import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { LEADERBOARD_CHANNEL_ID } from '../../config/constants.js';
import { BLUE_EMBED_COLOR, EMBED_COLOR } from '../../config/constants.js';
import { sendLeaderboardBackup } from '../backup/index.js';
import { resolveDisplayName } from '../../utils/discordNames.js';
import {
  connectDB,
  getDailyPointsForRange,
  getLeaderboardData as fetchLeaderboardFromDB,
  setLeaderboardData as writeLeaderboardToDB,
  updateUserExp as updateExpInDB,
} from '../../utils/dbOps.js';

const CACHE_LIFETIME_MS = 5 * 60 * 1000;
let leaderboardCache = null;
let lastCacheTime = 0;

export function invalidateLeaderboardCache() {
  leaderboardCache = null;
  lastCacheTime = 0;
}

export async function getCachedLeaderboard() {
  const now = Date.now();
  if (leaderboardCache && now - lastCacheTime < CACHE_LIFETIME_MS) {
    return leaderboardCache;
  }

  leaderboardCache = await fetchLeaderboardFromDB();
  lastCacheTime = now;
  return leaderboardCache;
}

export function getSortedLeaderboard(leaderboard, limit = Infinity, filterZeroExp = true) {
  let players = Object.entries(leaderboard)
    .filter(([key]) => !key.startsWith('_'))
    .map(([userId, totalExp]) => ({ userId, totalExp }));

  if (filterZeroExp) {
    players = players.filter((player) => player.totalExp > 0);
  }

  return players.sort((a, b) => b.totalExp - a.totalExp).slice(0, limit);
}

export async function resetLeaderboard(fullReset = false) {
  const newLeaderboardState = {
    _lastResetDate: new Date().toISOString(),
    _dailyPoints: {},
  };

  if (!fullReset) {
    const currentLeaderboard = await getCachedLeaderboard();
    for (const userId in currentLeaderboard) {
      if (!userId.startsWith('_')) {
        newLeaderboardState[userId] = 0;
      }
    }
  }

  await writeLeaderboardToDB(newLeaderboardState);
  leaderboardCache = null;
  console.log(fullReset ? 'Full leaderboard reset initiated.' : 'Monthly leaderboard reset initiated.');
}

export async function updateLeaderboard(userId, pointsToAdd) {
  await updateExpInDB(userId, pointsToAdd);
  leaderboardCache = null;
}

function createPaginationRow(prefix, currentPage, totalPages, originalRequesterId, timestamp) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${prefix}_start_${originalRequesterId}_${timestamp}`)
      .setLabel('<<')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 1),
    new ButtonBuilder()
      .setCustomId(`${prefix}_prev_${originalRequesterId}_${timestamp}`)
      .setLabel('<')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === 1),
    new ButtonBuilder()
      .setCustomId(`${prefix}_next_${originalRequesterId}_${timestamp}`)
      .setLabel('>')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === totalPages),
    new ButtonBuilder()
      .setCustomId(`${prefix}_end_${originalRequesterId}_${timestamp}`)
      .setLabel('>>')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(currentPage === totalPages),
  );
}

export async function createPaginatedLeaderboardEmbed(sessionData, client, guild) {
  const { currentPage, totalPages, usersData, resetInfo, originalRequesterId, timestamp } = sessionData;
  const usersPerPage = 10;
  const startIndex = (currentPage - 1) * usersPerPage;
  const endIndex = Math.min(startIndex + usersPerPage, usersData.length);
  const usersOnPage = usersData.slice(startIndex, endIndex);

  const nowUnix = Math.floor(Date.now() / 1000);
  const headerDescription = `Raid leaderboard rankings | <t:${nowUnix}:f>`;
  const description = resetInfo ? `${resetInfo}\n${headerDescription}` : headerDescription;
  const formatExp = (value) => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return String(value);
    return new Intl.NumberFormat('en-US').format(n);
  };

  const embed = new EmbedBuilder()
    .setColor(BLUE_EMBED_COLOR)
    .setTitle('🏆 Raid Leaderboard 🏆')
    .setDescription(description)
    .setTimestamp()
    .setFooter({ text: `Page ${currentPage} of ${totalPages}` });

  if (usersOnPage.length === 0) {
    embed.setDescription(`${description}\n\nThe leaderboard is empty. Start earning some EXP!`);
  } else {
    const ranks = [];
    const names = [];
    const points = [];
    const NAME_MAX = 22;

    for (let index = 0; index < usersOnPage.length; index += 1) {
      const player = usersOnPage[index];
      const userName = await resolveDisplayName({ client, guild, userId: player.userId });

      const safeName = String(userName).replace(/\s+/g, ' ').trim();
      ranks.push(String(startIndex + index + 1));
      names.push(safeName.length > NAME_MAX ? `${safeName.slice(0, Math.max(0, NAME_MAX - 3))}...` : safeName);
      points.push(formatExp(player.totalExp));
    }

    embed.addFields(
      { name: '#', value: ranks.join('\n').slice(0, 1024) || '\u200b', inline: true },
      { name: 'Name', value: names.join('\n').slice(0, 1024) || '\u200b', inline: true },
      { name: 'EXP', value: points.join('\n').slice(0, 1024) || '\u200b', inline: true },
    );
  }

  if (originalRequesterId === 'scheduled_reset') {
    return { embeds: [embed], components: [] };
  }

  return {
    embeds: [embed],
    components: [createPaginationRow('lb', currentPage, totalPages, originalRequesterId, timestamp)],
  };
}

export async function createLbCheckResponse(sessionData, client, guild) {
  const { currentPage, totalPages, usersData, dateInfo, originalRequesterId, timestamp } = sessionData;
  const usersPerPage = 5;
  const startIndex = (currentPage - 1) * usersPerPage;
  const endIndex = Math.min(startIndex + usersPerPage, usersData.length);
  const usersOnPage = usersData.slice(startIndex, endIndex);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`EXP Check ${dateInfo.description}`)
    .setTimestamp()
    .setFooter({ text: `Page ${currentPage}/${totalPages} | Raid Helper Bot | EXP Breakdown` });

  let descriptionContent = '';
  if (usersOnPage.length === 0) {
    descriptionContent = 'No EXP data found for this page.';
  } else {
    for (const userData of usersOnPage) {
      const displayName = await resolveDisplayName({ client, guild, userId: userData.id });
      descriptionContent += `**${displayName}**\n`;
      if (dateInfo.rawStartDate.getTime() === dateInfo.rawEndDate.getTime()) {
        descriptionContent += `- EXP Gained: ${userData.totalPointsForRange} EXP\n`;
      } else {
        descriptionContent += `- Total EXP in range: ${userData.totalPointsForRange} EXP\n`;
        if (userData.dailyBreakdown.length > 1 && userData.totalPointsForRange > 0) {
          descriptionContent += '  Breakdown:\n';
          const maxBreakdownLines = 5;
          if (userData.dailyBreakdown.length > maxBreakdownLines) {
            descriptionContent += `${userData.dailyBreakdown.slice(0, Math.ceil(maxBreakdownLines / 2)).join('\n')}\n`;
            descriptionContent += `  ... (${userData.dailyBreakdown.length - maxBreakdownLines} more days) ...\n`;
            descriptionContent += `${userData.dailyBreakdown.slice(-Math.floor(maxBreakdownLines / 2)).join('\n')}\n`;
          } else {
            descriptionContent += `${userData.dailyBreakdown.join('\n')}\n`;
          }
        }
      }
      descriptionContent += `- Overall Total EXP: ${userData.overallTotal} EXP\n\n`;
    }
  }

  embed.setDescription(descriptionContent);

  return {
    embeds: [embed],
    components: [createPaginationRow('lbcheck', currentPage, totalPages, originalRequesterId, timestamp)],
  };
}

export async function sendPreviousLeaderboardAnnouncement(client, isManualTrigger = false) {
  try {
    const now = new Date();
    const managementChannel = await client.channels.fetch(LEADERBOARD_CHANNEL_ID);
    if (!managementChannel || !managementChannel.isTextBased()) {
      console.warn(`LEADERBOARD_CHANNEL_ID (${LEADERBOARD_CHANNEL_ID}) is not a text channel or could not be fetched.`);
      return;
    }

    const guild = client.guilds.cache.first();
    if (!guild) {
      console.warn('No guild found to create leaderboard embed for announcement.');
      return;
    }

    const oldLeaderboard = await getCachedLeaderboard();
    const allSortedPlayers = getSortedLeaderboard(oldLeaderboard, Infinity, true);
    const totalPages = Math.ceil(allSortedPlayers.length / 10);
    const targetMonth = new Date(now.getFullYear(), now.getMonth() - (isManualTrigger ? 0 : 1), 1);
    const displayMonthYear = targetMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const resetInfoDescription = `Final Leaderboard for ${displayMonthYear}`;

    if (allSortedPlayers.length === 0) {
      await managementChannel.send(`Monthly Raid Leaderboard for ${displayMonthYear}: No raids were recorded last month.`);
      return;
    }

    const initialMessage = await managementChannel.send(`## Monthly Raid Leaderboard for ${displayMonthYear}`);
    const threadChannel = await initialMessage.startThread({
      name: `Raid Leaderboard - ${displayMonthYear}`,
      autoArchiveDuration: 1440,
      reason: `Monthly leaderboard announcement for ${displayMonthYear}`,
    });

    for (let page = 1; page <= totalPages; page += 1) {
      const sessionData = {
        currentPage: page,
        totalPages,
        usersData: allSortedPlayers,
        resetInfo: resetInfoDescription,
        originalRequesterId: 'scheduled_reset',
        timestamp: Date.now(),
      };

      const { embeds } = await createPaginatedLeaderboardEmbed(sessionData, client, guild);
      await threadChannel.send({ embeds });
    }
  } catch (error) {
    console.error('Error sending previous leaderboard announcement:', error);
  }
}

export function setupMonthlyResetTask(client) {
  const performMonthlyCheck = async () => {
    try {
      const leaderboard = await getCachedLeaderboard();
      const lastReset = leaderboard._lastResetDate ? new Date(leaderboard._lastResetDate) : null;
      const now = new Date();

      if (!lastReset || lastReset.getMonth() !== now.getMonth() || lastReset.getFullYear() !== now.getFullYear()) {
        console.log('Performing automatic monthly leaderboard reset...');
        await sendPreviousLeaderboardAnnouncement(client, false);
        await resetLeaderboard(false);
        await sendLeaderboardBackup(client);
      }

      console.log('Monthly reset task disabled.');
    } catch (error) {
      console.error('Error in monthly leaderboard reset check:', error);
    }
  };

  performMonthlyCheck();
  setInterval(performMonthlyCheck, 6 * 60 * 60 * 1000);
}

export { connectDB, getDailyPointsForRange };
