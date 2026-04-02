import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { EMBED_COLOR, MODERATOR_ROLE_ID, OFFICER_ROLE_ID, RAID_MANAGER_ROLE_ID } from '../../config/constants.js';
import { deleteGifCommand, getGifCommand, updateGifCommandImage, upsertGifCommand } from '../../utils/gifCommandsStore.js';
import { getSupabase } from '../../utils/supabaseClient.js';

const sessions = new Map(); // messageId -> { command, kind, ownerId }

function isAdminMember(member) {
  if (!member) return false;
  return (
    member.roles.cache.has(MODERATOR_ROLE_ID) ||
    member.roles.cache.has(OFFICER_ROLE_ID) ||
    member.roles.cache.has(RAID_MANAGER_ROLE_ID)
  );
}

function buildPreviewEmbed({ command, kind, row }) {
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`/${command}`);

  if (kind === 'text') {
    embed.setDescription(row?.text_content ? String(row.text_content) : '*No text set yet.*');
    embed.setFooter({ text: 'Text command preview' });
    return embed;
  }

  embed.setTitle(row?.title ? String(row.title) : `/${command}`);
  if (row?.footer) embed.setFooter({ text: String(row.footer) });

  if (row?.image_path) {
    const bucket = process.env.SUPABASE_GIF_BUCKET || 'gif-commands';
    const supabase = getSupabase();
    const { data } = supabase.storage.from(bucket).getPublicUrl(String(row.image_path));
    if (data?.publicUrl) embed.setImage(data.publicUrl);
  } else {
    embed.setDescription('*No GIF set yet. Use `Change Gif`.*');
  }

  return embed;
}

function buildButtonsRow(messageId, { isDeleted = false } = {}) {
  const closeBtn = new ButtonBuilder()
    .setCustomId(`gifcmd_close_${messageId}`)
    .setLabel('Close')
    .setStyle(ButtonStyle.Secondary);

  if (isDeleted) {
    return new ActionRowBuilder().addComponents(closeBtn);
  }

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`gifcmd_edit_${messageId}`).setLabel('Edit').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`gifcmd_change_${messageId}`).setLabel('Change Gif').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`gifcmd_delete_${messageId}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
    closeBtn,
  );
}

function parseAddGifCommand(contentRaw) {
  const content = String(contentRaw ?? '').trim();
  const parts = content.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  if (cmd !== '!addgif' && cmd !== '!addtextgif') return null;

  const kind = cmd === '!addtextgif' ? 'text' : (parts[1]?.toLowerCase() === 'text' ? 'text' : 'gif');
  const name = cmd === '!addtextgif' ? parts[1] : (kind === 'text' ? parts[2] : parts[1]);
  const command = String(name ?? '').trim().toLowerCase();

  return { kind, command };
}

export async function maybeHandleGifCommandCrudMessage(message) {
  const parsed = parseAddGifCommand(message.content);
  if (!parsed) return false;

  if (!message.guild) return true;
  if (!isAdminMember(message.member)) {
    await message.reply({ content: 'You do not have permission to manage GIF commands.' });
    return true;
  }

  if (!parsed.command) {
    await message.reply({ content: 'Usage: `!addgif <command>` or `!addtextgif <command>`' });
    return true;
  }

  await upsertGifCommand({
    command: parsed.command,
    kind: parsed.kind,
    title: parsed.kind === 'gif' ? parsed.command : null,
    footer: null,
    textContent: parsed.kind === 'text' ? 'Example text...' : null,
    enabled: true,
  });

  const row = await getGifCommand(parsed.command);
  const embed = buildPreviewEmbed({ command: parsed.command, kind: parsed.kind, row });

  const sent = await message.channel.send({
    embeds: [embed],
    components: [],
  });

  sessions.set(sent.id, { command: parsed.command, kind: parsed.kind, ownerId: message.author.id });
  await sent.edit({ components: [buildButtonsRow(sent.id)] });
  return true;
}

export async function handleGifCommandCrudInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isModalSubmit()) return false;

  const id = interaction.customId || '';
  if (!id.startsWith('gifcmd_')) return false;

  const parts = id.split('_'); // gifcmd, action, messageId
  const action = parts[1];
  const messageId = parts.slice(2).join('_');
  const session = sessions.get(messageId);
  if (!session) {
    await interaction.reply({ content: 'This GIF command session expired.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (!interaction.member || !isAdminMember(interaction.member)) {
    await interaction.reply({ content: 'You do not have permission to manage GIF commands.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.isButton()) {
    if (action === 'close') {
      sessions.delete(messageId);
      await interaction.message.delete().catch(() => {});
      return true;
    }

    if (action === 'delete') {
      await deleteGifCommand(session.command);
      sessions.delete(messageId);
      await interaction.update({
        embeds: [
          new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle('Deleted')
            .setDescription(`Deleted command \`${session.command}\`.`),
        ],
        components: [buildButtonsRow(messageId, { isDeleted: true })],
      });
      return true;
    }

    if (action === 'edit') {
      const row = await getGifCommand(session.command);

      const modal = new ModalBuilder().setCustomId(`gifcmd_editmodal_${messageId}`).setTitle('Edit GIF Command');

      if (session.kind === 'gif') {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('title')
              .setLabel('Title')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setValue(row?.title ?? ''),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('footer')
              .setLabel('Footer')
              .setStyle(TextInputStyle.Short)
              .setRequired(false)
              .setValue(row?.footer ?? ''),
          ),
        );
      } else {
        modal.addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('text')
              .setLabel('Message Text')
              .setStyle(TextInputStyle.Paragraph)
              .setRequired(true)
              .setValue(row?.text_content ?? ''),
          ),
        );
      }

      await interaction.showModal(modal);
      return true;
    }

    if (action === 'change') {
      await interaction.reply({ content: 'Upload the GIF/image in your next message (within 60s).', flags: MessageFlags.Ephemeral });

      const channel = interaction.channel;
      if (!channel) return true;

      try {
        const collected = await channel.awaitMessages({
          filter: (m) => m.author.id === interaction.user.id && m.attachments.size > 0,
          max: 1,
          time: 60000,
          errors: ['time'],
        });

        const attachment = collected.first().attachments.first();
        const url = attachment.url;
        const filename = attachment.name || 'gif';

        const res = await fetch(url);
        const arr = await res.arrayBuffer();
        const buffer = Buffer.from(arr);

        const bucket = process.env.SUPABASE_GIF_BUCKET || 'gif-commands';
        const path = `${session.command}/${Date.now()}_${filename}`.slice(0, 450);

        const supabase = getSupabase();
        const { error: uploadError } = await supabase.storage.from(bucket).upload(path, buffer, {
          contentType: attachment.contentType || 'image/gif',
          upsert: true,
        });
        if (uploadError) throw uploadError;

        await updateGifCommandImage(session.command, path);

        const row = await getGifCommand(session.command);
        const embed = buildPreviewEmbed({ command: session.command, kind: session.kind, row });

        await interaction.message.edit({ embeds: [embed] });
        await interaction.followUp({ content: 'GIF updated.', flags: MessageFlags.Ephemeral });
      } catch {
        await interaction.followUp({ content: 'Timed out or no attachment received.', flags: MessageFlags.Ephemeral });
      }

      return true;
    }

    return true;
  }

  if (interaction.isModalSubmit()) {
    if (!interaction.customId.startsWith('gifcmd_editmodal_')) return false;

    const modalMessageId = interaction.customId.slice('gifcmd_editmodal_'.length);
    const modalSession = sessions.get(modalMessageId);
    if (!modalSession) {
      await interaction.reply({ content: 'This GIF command session expired.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (modalSession.kind === 'gif') {
      const title = interaction.fields.getTextInputValue('title');
      const footer = interaction.fields.getTextInputValue('footer');
      await upsertGifCommand({ command: modalSession.command, kind: 'gif', title, footer, enabled: true });
    } else {
      const text = interaction.fields.getTextInputValue('text');
      await upsertGifCommand({ command: modalSession.command, kind: 'text', textContent: text, enabled: true });
    }

    const row = await getGifCommand(modalSession.command);
    const embed = buildPreviewEmbed({ command: modalSession.command, kind: modalSession.kind, row });

    await interaction.reply({ content: 'Updated.', flags: MessageFlags.Ephemeral });
    await interaction.message?.edit({ embeds: [embed] }).catch(() => {});
    return true;
  }

  return false;
}
