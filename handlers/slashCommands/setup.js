import { EmbedBuilder, MessageFlags } from 'discord.js';
import { MAX_XP_PER_RAID, TASK_ALIASES } from '../../config/constants.js';
import { calculateTaskPointsWithMultiplier } from '../../utils/taskCalculations.js';
import { sendLeaderboardBackup } from '../backup/index.js';
import { updateLeaderboard } from '../leaderboard/core.js';
import { sendLeaderboardCheckResults, sendLeaderboardResults } from '../leaderboard/setup.js';
import { createXpEmbed, isAdmin, replyNoPermission } from './utils.js';

function getMentionedUserIds(usersString = '') {
  return [...usersString.matchAll(/<@!?(\d+)>/g)].map((match) => match[1]);
}

export async function handleSlashCommandInteraction(interaction, client) {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'lb': {
      const rangeInput = interaction.options.getString('range') || '';
      const usersInput = interaction.options.getString('users') || '';
      const targetUserIds = getMentionedUserIds(usersInput);

      try {
        const send = async (payload) => {
          await interaction.reply(payload);
          return interaction.fetchReply();
        };

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
        await interaction.reply({
          content: error.message || 'Failed to load leaderboard data. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
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

    case 'calculatetask': {
      const tasksString = interaction.options.getString('tasks');

      try {
        const { totalCalculatedPoints, originalTotalCalculatedPoints, unknownTasks } =
          calculateTaskPointsWithMultiplier(tasksString);

        let replyContent = `Calculated Points: **${totalCalculatedPoints}** EXP`;

        if (unknownTasks.length > 0) {
          replyContent += `\n\n_Note: The following tasks were not recognized and were not included: ${unknownTasks.join(', ')}._`;
        }

        if (originalTotalCalculatedPoints > MAX_XP_PER_RAID) {
          replyContent += `\n_This calculation was capped at ${MAX_XP_PER_RAID} EXP (original total: ${originalTotalCalculatedPoints} EXP)._`;
        }

        await interaction.reply({ content: replyContent });
      } catch (error) {
        console.error('Error calculating task points:', error);
        await interaction.reply({
          content: 'Failed to calculate task points. Please try again later.',
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    case 'taskalias': {
      const tasksInput = interaction.options.getString('tasks').toLowerCase();
      const taskNames = tasksInput.split(',').map((task) => task.trim()).filter(Boolean);

      if (!taskNames.length) {
        await interaction.reply({
          content: 'Please provide at least one task.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      let descriptionText = '';

      for (const inputTask of taskNames) {
        const baseTask = TASK_ALIASES[inputTask] || inputTask;
        const matchingAliases = Object.entries(TASK_ALIASES)
          .filter(([, mappedTask]) => mappedTask === baseTask)
          .map(([alias]) => alias);

        if (!matchingAliases.length && !TASK_ALIASES[inputTask]) {
          descriptionText += `**${inputTask}**\nNo aliases found.\n\n`;
        } else {
          const aliasList = matchingAliases.length ? matchingAliases.map((alias) => `\`${alias}\``).join(', ') : '(none)';
          descriptionText += `**${baseTask}**\n * ${aliasList}\n`;
        }
      }

      const embed = new EmbedBuilder().setColor(0x0099ff).setTitle('Task Aliases').setDescription(descriptionText);
      await interaction.reply({ embeds: [embed] });
      return;
    }

    default:
      await interaction.reply({
        content: 'Unknown command.',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
  }
}
