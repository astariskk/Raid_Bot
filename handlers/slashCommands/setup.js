import { MessageFlags } from 'discord.js';
import { EMBED_COLOR } from '../../config/constants.js';

import { createXpEmbed, isAdmin, replyNoPermission } from './utils.js';
import { getCombinedTasksAndPointsEmbed, getRaidTasksPageComponents } from '../../Embeds/generalCommandsEmbeds.js';
import { startAddGifWizardInteraction, startGifCommandCrudSession } from '../generalCommands/gifCommandsCrud.js';

import { getGifCommand } from '../../utils/gifCommandsStore.js';
let startRaidTaskManagerInteraction = async () => {};
try {
  ({ startRaidTaskManagerInteraction } = await import('../generalCommands/raidTasksCrud.js'));
} catch {
  // raid modules may be missing in trimmed repo
}

import { startEditChartFlowInteraction } from '../generalCommands/chartsCrud.js';
import { postChartToChannel, startChartBrowseInteraction } from '../charts/charts.js';
let getRaidInfo = async () => null;
let updateRaid = async () => {};
let listRaidHelpers = async () => [];
let removeRaidHelper = async () => {};
try {
  ({ getRaidInfo, updateRaid } = await import('../../activeRaidState.js'));
} catch {
  // ignore
}
try {
  ({ listRaidHelpers, removeRaidHelper } = await import('../../utils/raidParticipationStore.js'));
} catch {
  // ignore
}






function getMentionedUserIds(usersString = '') {
  const input = String(usersString ?? '');
  const ids = new Set();

  for (const match of input.matchAll(/<@!?(\d+)>/g)) {
    if (match[1]) ids.add(match[1]);
  }

  // Allow raw IDs (17-20 digits) in addition to mentions.
  for (const match of input.matchAll(/\b(\d{17,20})\b/g)) {
    if (match[1]) ids.add(match[1]);
  }

  return [...ids];
}

export async function handleSlashCommandInteraction(interaction, client) {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'lb': {
      const rangeOption = interaction.options.getString('range') || '';
      const fromOption = interaction.options.getString('from') || '';
      const toOption = interaction.options.getString('to') || '';
      const usersInput = interaction.options.getString('users') || '';
      const targetUserIds = getMentionedUserIds(usersInput);

      try {
        // /lb can take longer than Discord's 3s interaction window; defer immediately.
        await interaction.deferReply().catch(() => {});

        const send = async (payload) => {
          await interaction.editReply(payload);
          return interaction.fetchReply();
        };

        const usingFromTo = Boolean(fromOption || toOption);
        if (usingFromTo && (!fromOption || !toOption)) {
          await interaction.editReply({
            content: 'If you use `from`, you must also provide `to` (and vice versa).',
          });
          return;
        }
        if (usingFromTo && rangeOption) {
          await interaction.editReply({
            content: 'Use either `range` or (`from` + `to`), not both.',
          });
          return;
        }

        const rangeInput = usingFromTo ? `from ${fromOption} to ${toOption}` : rangeOption;

        if (!rangeInput && targetUserIds.length === 0) {
          await sendLeaderboardResults({
            client,
            guild: interaction.guild,
            requesterId: interaction.user.id,
            send,
          });
        } else {
          await sendLeaderboardCheckResults({
            client,
            guild: interaction.guild,
            requesterId: interaction.user.id,
            rangeInput,
            targetUserIds,
            send,
          });
        }
      } catch (error) {
        const msg = error?.message || 'Failed to load leaderboard data. Please try again later.';
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({ content: msg }).catch(() => {});
        } else {
          await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral }).catch(() => {});
        }
      }
      return;
    }

    case 'ping': {
      try {
        await interaction.reply('Bot is running!');
      } catch (error) {
        console.error('Error replying to ping command:', error);
        if (!interaction.replied) {
          await interaction.reply({
            content: 'There was an error trying to respond to this command.',
            flags: MessageFlags.Ephemeral,
          }).catch(() => {});
        }
      }
      return;
    }

    case 'addxp': {
      if (!isAdmin(interaction)) return replyNoPermission(interaction);

      const amount = interaction.options.getInteger('amount');

      try {
        const usersString = interaction.options.getString('users');
        const userIds = getMentionedUserIds(usersString);

        if (!userIds.length) {
          await interaction.reply({
            content: 'Please mention at least one user in the `users` field (e.g. `<@123> <@456>`).',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        for (const id of userIds) {
          await updateLeaderboard(id, amount);
        }

        await interaction.reply({ embeds: [createXpEmbed('add', amount, userIds)] });
        await sendLeaderboardBackup(client);
      } catch (error) {
        console.error('Error adding XP:', error);
        await interaction.reply({
          content: 'Failed to add XP. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    case 'removexp': {
      if (!isAdmin(interaction)) return replyNoPermission(interaction);

      const amount = interaction.options.getInteger('amount');

      try {
        const usersString = interaction.options.getString('users');
        const userIds = getMentionedUserIds(usersString);

        if (!userIds.length) {
          await interaction.reply({
            content: 'Please mention at least one user in the `users` field (e.g. `<@123> <@456>`).',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        for (const id of userIds) {
          await updateLeaderboard(id, -amount);
        }

        await interaction.reply({ embeds: [createXpEmbed('remove', amount, userIds)] });
        await sendLeaderboardBackup(client);
      } catch (error) {
        console.error('Error removing XP:', error);
        await interaction.reply({
          content: 'Failed to remove XP. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    case 'addgif': {
      if (!isAdmin(interaction)) return replyNoPermission(interaction);

      const raw = interaction.options.getString('command', true);
      const normalized = String(raw ?? '')
        .trim()
        .replace(/^\//, '')
        .toLowerCase();

      try {
        // startAddGifWizardInteraction() calls interaction.reply() internally,
        // so do NOT deferReply() here.
        await startAddGifWizardInteraction(interaction, { command: normalized });
      } catch (error) {
        console.error('Error handling /addgif:', error);
        await interaction.editReply({
          content: error?.message || 'Failed to start GIF/text command wizard.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
      return;
    }

    case 'editgif': {
      if (!isAdmin(interaction)) return replyNoPermission(interaction);


      const raw = interaction.options.getString('command', true);
      const normalized = String(raw ?? '').trim().replace(/^\//, '').toLowerCase();
      if (!normalized) {
        await interaction.reply({ content: 'Please provide an existing command name.', flags: MessageFlags.Ephemeral });
        return;
      }

      try {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => {});

        const existing = await getGifCommand(normalized).catch(() => null);
        if (!existing) {
          await interaction.editReply({
            content: `\`/${normalized}\` does not exist yet. Use \`/addgif\` to create it.`,
          });
          return;
        }

        await startGifCommandCrudSession({
          channel: interaction.channel,
          guild: interaction.guild,
          member: interaction.member,
          ownerId: interaction.user.id,
          command: normalized,
          kind: existing.kind,
        });

        await interaction.deleteReply().catch(() => {});
      } catch (error) {
        console.error('Error handling /editgif:', error);
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply({
            content: error?.message || 'Failed to open GIF editor.',
          }).catch(() => {});
          return;
        }

        await interaction.reply({
          content: error?.message || 'Failed to open GIF editor.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
      return;
    }

    case 'editchart': {
      if (!isAdmin(interaction)) return replyNoPermission(interaction);
      try {
        await startEditChartFlowInteraction(interaction);
      } catch (error) {
        console.error('Error handling /editchart:', error);
        await interaction.reply({
          content: error?.message || 'Failed to start chart editor.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
      return;
    }

    case 'chart': {
      const categoryKey = (interaction.options.getString('category') || '').trim();
      const chartToken = (interaction.options.getString('chart') || '').trim();
      try {
        if (chartToken.toLowerCase().startsWith('type:')) {
          const typeKey = chartToken.slice('type:'.length).trim();
          await postChartToChannel({ channel: interaction.channel, chartKey: typeKey, variantKey: 'main', ownerId: interaction.user.id });
          await interaction.reply({ content: 'Posted.', flags: MessageFlags.Ephemeral }).catch(() => {});
          return;
        }

        if (categoryKey) {
          await startChartBrowseInteraction(interaction, { query: `cat:${categoryKey}` });
          return;
        }

        await startChartBrowseInteraction(interaction);
      } catch (error) {
        console.error('Error handling /chart:', error);
        await interaction.reply({
          content: error?.message || 'Failed to browse charts.',
          flags: MessageFlags.Ephemeral,
        }).catch(() => {});
      }
      return;
    }

    default:
      await interaction.reply({
        content: 'Unknown command.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
  }
}
