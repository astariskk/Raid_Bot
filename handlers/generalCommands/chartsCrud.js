import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { EMBED_COLOR, MODERATOR_ROLE_ID, OFFICER_ROLE_ID, RAID_MANAGER_ROLE_ID } from '../../config/constants.js';
import { getSupabase } from '../../utils/supabaseClient.js';
import { deleteChart, getChart, listChartsKeys, upsertChart, updateChart } from '../../utils/chartsStore.js';

const pickSessions = new Map(); // sessionId -> { ownerId, mode: 'add'|'edit' }
const editorSessions = new Map(); // messageId -> { ownerId, key, pageIndex }

function isAdminMember(member) {
  if (!member) return false;
  return (
    member.roles.cache.has(MODERATOR_ROLE_ID) ||
    member.roles.cache.has(OFFICER_ROLE_ID) ||
    member.roles.cache.has(RAID_MANAGER_ROLE_ID)
  );
}

function newSessionId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeKey(key) {
  return String(key ?? '').trim().toLowerCase().replace(/^\//, '').replace(/[^\w-]/g, '').slice(0, 32);
}

function getChartsBucket() {
  return process.env.SUPABASE_CHARTS_BUCKET || process.env.SUPABASE_GIF_BUCKET || 'gif-commands';
}

function buildPickEmbed({ mode = 'edit' } = {}) {
  return new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(mode === 'add' ? 'Add Chart' : 'Edit Chart')
    .setDescription(mode === 'add' ? 'Create a new chart.' : 'Select an existing chart to edit or remove pages.');
}

async function buildPickComponents(sessionId) {
  const keys = await listChartsKeys().catch(() => []);

  const select = new StringSelectMenuBuilder()
    .setCustomId(`chart_pick_${sessionId}`)
    .setPlaceholder('Select a chart...')
    ;

  for (const key of keys.slice(0, 25)) {
    select.addOptions({ label: key, value: key });
  }

  return [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`chart_cancel_${sessionId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
    ),
  ];
}

function buildNewChartModal(sessionId) {
  return new ModalBuilder()
    .setCustomId(`chart_new_${sessionId}`)
    .setTitle('Create Chart')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('key')
          .setLabel('Chart key (no spaces)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Chart title')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
}

async function openChartEditor({ channel, ownerId, chart }) {
  if (!channel) throw new Error('No channel');

  const editorMsg = await channel.send({
    embeds: [buildEditorEmbed(chart, 0)],
    components: [],
  });

  editorSessions.set(editorMsg.id, { ownerId, key: chart.key, pageIndex: 0 });
  await editorMsg.edit({ components: buildEditorComponents(editorMsg.id) });
  return editorMsg;
}

function buildEditorEmbed(chart, pageIndex) {
  const pages = Array.isArray(chart?.pages) ? chart.pages : [];
  const total = pages.length || 0;
  const idx = Math.max(0, Math.min(pageIndex, Math.max(0, total - 1)));
  const page = pages[idx];

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(chart?.title ? String(chart.title) : chart?.key)
    .setDescription(`Key: \`/${chart?.key}\`\nPage: ${total ? (idx + 1) : 0}/${total}`);

  if (page?.asset_path) {
    const supabase = getSupabase();
    const bucket = getChartsBucket();
    const { data } = supabase.storage.from(bucket).getPublicUrl(String(page.asset_path));
    if (data?.publicUrl) embed.setImage(data.publicUrl);
  } else if (total === 0) {
    embed.addFields({ name: 'No pages yet', value: 'Use `Add Page` to upload an image.', inline: false });
  }

  return embed;
}

function buildEditorComponents(messageId, session) {
  const prevBtn = new ButtonBuilder()
    .setCustomId(`chart_prev_${messageId}`)
    .setLabel('Prev')
    .setStyle(ButtonStyle.Secondary);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`chart_next_${messageId}`)
    .setLabel('Next')
    .setStyle(ButtonStyle.Secondary);

  const addBtn = new ButtonBuilder()
    .setCustomId(`chart_add_${messageId}`)
    .setLabel('Add Page')
    .setStyle(ButtonStyle.Secondary);

  const removeBtn = new ButtonBuilder()
    .setCustomId(`chart_remove_${messageId}`)
    .setLabel('Remove Page')
    .setStyle(ButtonStyle.Secondary);

  const editTitleBtn = new ButtonBuilder()
    .setCustomId(`chart_title_${messageId}`)
    .setLabel('Edit Title')
    .setStyle(ButtonStyle.Secondary);

  const deleteBtn = new ButtonBuilder()
    .setCustomId(`chart_delete_${messageId}`)
    .setLabel('Delete Chart')
    .setStyle(ButtonStyle.Danger);

  const closeBtn = new ButtonBuilder()
    .setCustomId(`chart_close_${messageId}`)
    .setLabel('Save and Close')
    .setStyle(ButtonStyle.Primary);

  return [
    new ActionRowBuilder().addComponents(prevBtn, nextBtn, addBtn, removeBtn, editTitleBtn),
    new ActionRowBuilder().addComponents(deleteBtn, closeBtn),
  ];
}

async function uploadChartPage({ key, attachment }) {
  const url = attachment.url;
  const filename = attachment.name || 'chart';

  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  const buffer = Buffer.from(arr);

  const bucket = getChartsBucket();
  const safeKey = normalizeKey(key);
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
  const path = `${safeKey}/${Date.now()}_${Math.random().toString(16).slice(2)}${ext || ''}`.slice(0, 450);

  const supabase = getSupabase();
  const { error: uploadError } = await supabase.storage.from(bucket).upload(path, buffer, {
    contentType: attachment.contentType || 'image/png',
    upsert: true,
  });
  if (uploadError) throw uploadError;

  return path;
}

async function deleteAllChartAssets(chart) {
  const pages = Array.isArray(chart?.pages) ? chart.pages : [];
  const paths = pages.map((p) => p?.asset_path).filter(Boolean).map(String);
  if (!paths.length) return;

  const supabase = getSupabase();
  await supabase.storage.from(getChartsBucket()).remove(paths).catch(() => {});
}

export async function startAddChartFlowInteraction(interaction) {
  if (!interaction.guild || !interaction.member) throw new Error('This can only be used in a server.');
  if (!isAdminMember(interaction.member)) throw new Error('No permission.');

  const sessionId = newSessionId();
  pickSessions.set(sessionId, { ownerId: interaction.user.id, mode: 'add' });
  await interaction.showModal(buildNewChartModal(sessionId));
}

export async function startEditChartFlowInteraction(interaction) {
  if (!interaction.guild || !interaction.member) throw new Error('This can only be used in a server.');
  if (!isAdminMember(interaction.member)) throw new Error('No permission.');

  const sessionId = newSessionId();
  pickSessions.set(sessionId, { ownerId: interaction.user.id, mode: 'edit' });

  await interaction.reply({
    embeds: [buildPickEmbed({ mode: 'edit' })],
    components: await buildPickComponents(sessionId),
    flags: MessageFlags.Ephemeral,
  });
}

export async function maybeHandleAddChartMessage(message) {
  const content = String(message.content ?? '').trim();
  if (!content.toLowerCase().startsWith('!addchart')) return false;

  if (!message.guild) return true;
  if (!isAdminMember(message.member)) {
    await message.reply({ content: 'You do not have permission to manage charts.' });
    return true;
  }

  const args = content.slice('!addchart'.length).trim();
  const parts = args.split(/\s+/).filter(Boolean);
  const key = normalizeKey(parts[0]);
  const title = parts.slice(1).join(' ').trim();

  if (!key || !title) {
    await message.reply({ content: 'Usage: `!addchart <key> <title...>`' });
    return true;
  }

  const existing = await getChart(key).catch(() => null);
  if (existing) {
    await message.reply({ content: `Chart \`/${key}\` already exists. Use \`!editchart\` or \`/editchart\`.` });
    return true;
  }

  await upsertChart({ key, title, pages: [], enabled: true });
  const chart = await getChart(key);
  await openChartEditor({ channel: message.channel, ownerId: message.author.id, chart });
  return true;
}

export async function maybeHandleEditChartMessage(message) {
  const content = String(message.content ?? '').trim();
  if (!content.toLowerCase().startsWith('!editchart')) return false;

  if (!message.guild) return true;
  if (!isAdminMember(message.member)) {
    await message.reply({ content: 'You do not have permission to manage charts.' });
    return true;
  }

  const sessionId = newSessionId();
  pickSessions.set(sessionId, { ownerId: message.author.id, mode: 'edit' });

  await message.channel.send({
    embeds: [buildPickEmbed({ mode: 'edit' })],
    components: await buildPickComponents(sessionId),
  });

  return true;
}

export async function handleChartsCrudInteraction(interaction) {
  if (
    !interaction.isButton() &&
    !interaction.isStringSelectMenu() &&
    !interaction.isModalSubmit()
  ) return false;

  const id = interaction.customId || '';
  if (!id.startsWith('chart_')) return false;

  // Picker cancel
  if (interaction.isButton() && id.startsWith('chart_cancel_')) {
    const sessionId = id.slice('chart_cancel_'.length);
    pickSessions.delete(sessionId);
    await interaction.update({ content: 'Cancelled.', embeds: [], components: [] }).catch(() => {});
    return true;
  }

  // Picker select
  if (interaction.isStringSelectMenu() && id.startsWith('chart_pick_')) {
    const sessionId = id.slice('chart_pick_'.length);
    const session = pickSessions.get(sessionId);
    if (!session) {
      await interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (session.ownerId && session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Not your session.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const value = interaction.values?.[0];
    const chart = await getChart(value);
    if (!chart) {
      await interaction.reply({ content: 'Chart not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    pickSessions.delete(sessionId);

    const messageId = interaction.message?.id;
    if (!messageId) {
      await openChartEditor({ channel: interaction.channel, ownerId: interaction.user.id, chart });
      await interaction.reply({ content: `Opened editor for \`/${chart.key}\`.`, flags: MessageFlags.Ephemeral });
      return true;
    }

    editorSessions.set(messageId, { ownerId: interaction.user.id, key: chart.key, pageIndex: 0 });

    await interaction.update({
      embeds: [buildEditorEmbed(chart, 0)],
      components: buildEditorComponents(messageId),
    });
    return true;
  }

  // New chart modal submit
  if (interaction.isModalSubmit() && id.startsWith('chart_new_')) {
    const sessionId = id.slice('chart_new_'.length);
    const session = pickSessions.get(sessionId);
    if (!session) {
      await interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (session.ownerId && session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Not your session.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const key = normalizeKey(interaction.fields.getTextInputValue('key'));
    const title = String(interaction.fields.getTextInputValue('title') ?? '').trim();
    if (!key || !title) {
      await interaction.reply({ content: 'Key and title are required.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const existing = await getChart(key).catch(() => null);
    if (existing) {
      await interaction.reply({ content: `Chart \`/${key}\` already exists. Use \`/editchart\` to edit it.`, flags: MessageFlags.Ephemeral });
      return true;
    }

    await upsertChart({ key, title, pages: [], enabled: true });
    pickSessions.delete(sessionId);

    const chart = await getChart(key);
    await openChartEditor({ channel: interaction.channel, ownerId: interaction.user.id, chart });

    await interaction.reply({ content: `Created chart \`/${chart.key}\` and opened the editor.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  // Editor buttons
  if (interaction.isButton()) {
    const parts = id.split('_'); // chart, action, messageId
    const action = parts[1];
    const messageId = parts.slice(2).join('_');
    const session = editorSessions.get(messageId);
    if (!session) return false;

    if (session.ownerId && session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the session owner can edit this chart.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const chart = await getChart(session.key);
    if (!chart) {
      await interaction.reply({ content: 'Chart not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === 'close') {
      editorSessions.delete(messageId);
      await interaction.deferUpdate().catch(() => {});
      await interaction.message.delete().catch(() => {});
      return true;
    }

    if (action === 'delete') {
      await deleteAllChartAssets(chart);
      await deleteChart(chart.key);
      editorSessions.delete(messageId);
      await interaction.deferUpdate().catch(() => {});
      await interaction.message.delete().catch(() => {});
      return true;
    }

    if (action === 'prev' || action === 'next') {
      const total = chart.pages.length;
      if (!total) {
        await interaction.reply({ content: 'No pages yet.', flags: MessageFlags.Ephemeral });
        return true;
      }
      session.pageIndex = action === 'prev'
        ? Math.max(0, session.pageIndex - 1)
        : Math.min(total - 1, session.pageIndex + 1);
      editorSessions.set(messageId, session);
      await interaction.update({ embeds: [buildEditorEmbed(chart, session.pageIndex)] });
      return true;
    }

    if (action === 'add') {
      await interaction.reply({ content: 'Upload the chart image as your next message (within 60s).', flags: MessageFlags.Ephemeral });

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
        const assetPath = await uploadChartPage({ key: chart.key, attachment });

        const pages = [...chart.pages, { asset_path: assetPath }];
        await updateChart(chart.key, { pages });

        const updated = await getChart(chart.key);
        session.pageIndex = updated.pages.length - 1;
        editorSessions.set(messageId, session);

        await interaction.message.edit({ embeds: [buildEditorEmbed(updated, session.pageIndex)] }).catch(() => {});
        await interaction.followUp({ content: 'Page added.', flags: MessageFlags.Ephemeral });
      } catch {
        await interaction.followUp({ content: 'Timed out waiting for an attachment.', flags: MessageFlags.Ephemeral });
      }
      return true;
    }

    if (action === 'remove') {
      const total = chart.pages.length;
      if (!total) {
        await interaction.reply({ content: 'No pages to remove.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const select = new StringSelectMenuBuilder()
        .setCustomId(`chart_remove_pick_${messageId}`)
        .setPlaceholder('Pick a page to remove...')
        .addOptions(chart.pages.slice(0, 25).map((_, idx) => ({ label: `Page ${idx + 1}`, value: String(idx) })));

      await interaction.reply({
        content: 'Select which page to remove:',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (action === 'title') {
      const modal = new ModalBuilder()
        .setCustomId(`chart_title_${messageId}`)
        .setTitle('Edit Chart Title')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('title')
              .setLabel('Title')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setValue(chart.title),
          ),
        );

      await interaction.showModal(modal);
      return true;
    }
  }

  // Remove pick select menu
  if (interaction.isStringSelectMenu() && id.startsWith('chart_remove_pick_')) {
    const messageId = id.slice('chart_remove_pick_'.length);
    const session = editorSessions.get(messageId);
    if (!session) return false;
    if (session.ownerId && session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the session owner can edit this chart.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const chart = await getChart(session.key);
    if (!chart) {
      await interaction.reply({ content: 'Chart not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const idx = parseInt(interaction.values?.[0], 10);
    if (Number.isNaN(idx) || idx < 0 || idx >= chart.pages.length) {
      await interaction.reply({ content: 'Invalid page.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const removed = chart.pages[idx];
    if (removed?.asset_path) {
      const supabase = getSupabase();
      await supabase.storage.from(getChartsBucket()).remove([String(removed.asset_path)]).catch(() => {});
    }

    const pages = chart.pages.filter((_, i) => i !== idx);
    await updateChart(chart.key, { pages });

    const updated = await getChart(chart.key);
    session.pageIndex = Math.min(session.pageIndex, Math.max(0, updated.pages.length - 1));
    editorSessions.set(messageId, session);

    await interaction.reply({ content: 'Removed page.', flags: MessageFlags.Ephemeral });
    await interaction.channel?.messages.fetch(messageId).then((m) => m.edit({ embeds: [buildEditorEmbed(updated, session.pageIndex)] })).catch(() => {});
    return true;
  }

  // Title modal submit
  if (interaction.isModalSubmit() && id.startsWith('chart_title_')) {
    const messageId = id.slice('chart_title_'.length);
    const session = editorSessions.get(messageId);
    if (!session) return false;
    if (session.ownerId && session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'Only the session owner can edit this chart.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const chart = await getChart(session.key);
    if (!chart) {
      await interaction.reply({ content: 'Chart not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const title = String(interaction.fields.getTextInputValue('title') ?? '').trim();
    if (!title) {
      await interaction.reply({ content: 'Title is required.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await updateChart(chart.key, { title });
    const updated = await getChart(chart.key);
    await interaction.reply({ content: 'Updated title.', flags: MessageFlags.Ephemeral });
    await interaction.channel?.messages.fetch(messageId).then((m) => m.edit({ embeds: [buildEditorEmbed(updated, session.pageIndex)] })).catch(() => {});
    return true;
  }

  return false;
}
