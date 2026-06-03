import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { EMBED_COLOR, MODERATOR_ROLE_ID, OFFICER_ROLE_ID, RAID_MANAGER_ROLE_ID } from '../../config/constants.js';
import { deleteGifCommand, getGifCommand, updateGifCommand, updateGifCommandImage, upsertGifCommand } from '../../utils/Supabase/files.js';
import { getStoredAssetValueFromAttachment, resolveAssetUrl } from '../../utils/assetUrls.js';
import { uploadAttachmentToArchive } from '../../utils/discordMediaArchive.js';

const sessions = new Map(); // messageId -> { command, kind, ownerId }
const createWizards = new Map(); // wizardSessionId -> { ownerId, command, kind|null, step, pingUserIds }

function newWizardSessionId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function sanitizeCommandName(input = '') {
  return String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\//, '')
    .replace(/[^\w-]/g, '')
    .slice(0, 32);
}

function buildTriggerModal(sessionId) {
  return new ModalBuilder()
    .setCustomId(`addgif_trigger_${sessionId}`)
    .setTitle('Add GIF/Text Command')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('command')
          .setLabel('Trigger word (no spaces)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
}

function buildRenameModal(messageId, currentCommand) {
  const input = new TextInputBuilder()
    .setCustomId('command')
    .setLabel('New trigger word (no spaces)')
    .setStyle(TextInputStyle.Short)
    .setRequired(true);

  const current = sanitizeCommandName(currentCommand);
  if (current) input.setValue(current);

  return new ModalBuilder()
    .setCustomId(`gifcmd_renamemodal_${messageId}`)
    .setTitle('Edit Trigger Word')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function deleteCommandAssetIfAny(row) {
  return row;
}

async function uploadAssetFromAttachment({ command, attachment, kind }) {
  const safeCmd = sanitizeCommandName(command);
  const assetUrl = getStoredAssetValueFromAttachment(attachment);
  if (!assetUrl) throw new Error('Attachment URL is missing.');

  const uploaded = await uploadAttachmentToArchive({
    kind: 'gif',
    attachment,
    fileName: attachment?.name || `${safeCmd}.${String(attachment?.contentType || '').includes('gif') ? 'gif' : 'png'}`,
    message: `GIF/text command: ${safeCmd}\nSource: ${assetUrl}`,
  });

  await updateGifCommandImage(safeCmd, {
    asset_path: uploaded.attachmentUrl,
    image_path: uploaded.attachmentUrl,
    attachment_url: uploaded.attachmentUrl,
    message_url: uploaded.messageUrl,
    message_id: uploaded.messageId,
    channel_id: uploaded.channelId,
  });
  return uploaded.attachmentUrl;
}

async function editPreviewMessage(channel, messageId, payload) {
  if (!channel) return;
  try {
    const msg = await channel.messages.fetch(messageId);
    if (msg) await msg.edit(payload);
  } catch {
    // ignore
  }
}

function computeRenamedAssetPath(oldCommand, newCommand, oldPath) {
  const oldPrefix = `${oldCommand}/`;
  const newPrefix = `${newCommand}/`;
  const p = String(oldPath ?? '');
  if (!p) return null;
  if (p.startsWith(oldPrefix)) return `${newPrefix}${p.slice(oldPrefix.length)}`;
  const tail = p.includes('/') ? p.slice(p.lastIndexOf('/') + 1) : p;
  return `${newPrefix}${tail}`;
}

async function moveOrCopyStorageObject(bucket, fromPath, toPath) {
  return { bucket, fromPath, toPath };
}

function isAdminMember(member) {
  if (!member) return false;
  return (
    member.roles.cache.has(MODERATOR_ROLE_ID) ||
    member.roles.cache.has(OFFICER_ROLE_ID) ||
    member.roles.cache.has(RAID_MANAGER_ROLE_ID)
  );
}

function buildPreviewEmbed({ command, kind, row }) {
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(`${command}`);

  if (kind === 'text') {
    const pingIds = Array.isArray(row?.ping_user_ids) ? row.ping_user_ids.filter(Boolean).map(String) : [];
    const mentions = pingIds.length ? pingIds.map((id) => `<@${id}>`).join(' ') : '';
    const description = String(row?.text_description ?? '').trim();
    const label = String(row?.text_label ?? '').trim();

    const maybePath = row?.attachment_url || row?.asset_path || row?.image_path;
    const url = resolveAssetUrl(maybePath) || '';
    const linkUrl = row?.message_url || url;

    const prefix = mentions ? `${mentions} ` : '';
    const mid = description ? `${description} ` : '';
    const outlined = label && url ? `[**${label}**](${linkUrl})` : (row?.text_content ? String(row.text_content) : '*Incomplete text command (missing image or label).*');

    embed.setDescription(`${prefix}${mid}${outlined}`.trim());
    if (url) embed.setImage(url);
    embed.setFooter({ text: 'Text command preview (sends a message, not an embed)' });
    return embed;
  }

  embed.setTitle(row?.title ? String(row.title) : `${command}`);
  if (row?.footer) embed.setFooter({ text: String(row.footer) });

  if (row?.attachment_url || row?.asset_path || row?.image_path) {
    const url = resolveAssetUrl(row.attachment_url || row.asset_path || row.image_path);
    if (url) embed.setImage(url);
  } else {
    embed.setDescription('*No image set yet. Use `Change Image`.*');
  }

  return embed;
}

function buildButtonsRows(messageId, { kind = 'gif', isDeleted = false } = {}) {
  const closeBtn = new ButtonBuilder()
    .setCustomId(`gifcmd_close_${messageId}`)
    .setLabel('Save and Close')
    .setStyle(ButtonStyle.Primary);

  if (isDeleted) {
    return [new ActionRowBuilder().addComponents(closeBtn)];
  }

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`gifcmd_edit_${messageId}`)
      .setLabel(kind === 'text' ? 'Edit Text' : 'Edit')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`gifcmd_rename_${messageId}`)
      .setLabel('Edit Trigger')
      .setStyle(ButtonStyle.Secondary),
  );

  if (kind === 'text') {
    row1.addComponents(new ButtonBuilder().setCustomId(`gifcmd_pings_${messageId}`).setLabel('Edit Pings').setStyle(ButtonStyle.Secondary));
  }

  row1.addComponents(
    new ButtonBuilder().setCustomId(`gifcmd_change_${messageId}`).setLabel('Change Image').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`gifcmd_delete_${messageId}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
  );

  const row2 = new ActionRowBuilder().addComponents(closeBtn);

  return [row1, row2];
}

function parseStartCommand(contentRaw) {
  const content = String(contentRaw ?? '').trim();
  const parts = content.split(/\s+/);
  const cmd = parts[0]?.toLowerCase();
  if (!['!addgif', '!editgif', '!addcommand', '!editcommand'].includes(cmd)) return null;

  const command = String(parts[1] ?? '').trim().toLowerCase().replace(/^\//, '');
  return { cmd, command, presetKind: null };
}

export async function startGifCommandCrudSession({ channel, guild, member, ownerId, command, kind, pingUserIds = undefined, message = null }) {
  if (!channel && !message?.channel) {
    throw new Error('No channel available to start GIF command CRUD.');
  }
  if (!guild || !member) {
    throw new Error('GIF command CRUD can only be used in a server.');
  }
  if (!isAdminMember(member)) {
    throw new Error('You do not have permission to manage GIF commands.');
  }

  const normalizedCommand = String(command ?? '').trim().toLowerCase();
  if (!normalizedCommand) {
    throw new Error('Missing command name.');
  }

  const normalizedKind = kind === 'text' ? 'text' : 'gif';

  const existing = await getGifCommand(normalizedCommand);

  if (!existing) {
    await upsertGifCommand({
      command: normalizedCommand,
      kind: normalizedKind,
      title: normalizedKind === 'gif' ? normalizedCommand : null,
      footer: null,
      textContent: null,
      pingUserIds: normalizedKind === 'text' ? (pingUserIds ?? []) : undefined,
      textLabel: normalizedKind === 'text' ? '' : undefined,
      textDescription: normalizedKind === 'text' ? '' : undefined,
      enabled: true,
    });
  } else if (normalizedKind === 'text' && pingUserIds !== undefined) {
    await updateGifCommand(normalizedCommand, { ping_user_ids: pingUserIds });
  }

  const row = await getGifCommand(normalizedCommand);
  const embed = buildPreviewEmbed({ command: normalizedCommand, kind: normalizedKind, row });

  const sent = message || await channel.send({ embeds: [embed], components: [] });

  sessions.set(sent.id, { command: normalizedCommand, kind: normalizedKind, ownerId: ownerId ?? null });
  await sent.edit({ content: '', embeds: [embed], components: buildButtonsRows(sent.id, { kind: normalizedKind }) });
  return sent;
}

async function buildGifCommandCrudPayload({ messageId, guild, member, ownerId, command, kind, pingUserIds = undefined }) {
  if (!guild || !member) {
    throw new Error('GIF command CRUD can only be used in a server.');
  }
  if (!isAdminMember(member)) {
    throw new Error('You do not have permission to manage GIF commands.');
  }

  const normalizedCommand = String(command ?? '').trim().toLowerCase();
  if (!normalizedCommand) throw new Error('Missing command name.');

  const normalizedKind = kind === 'text' ? 'text' : 'gif';
  const existing = await getGifCommand(normalizedCommand);

  if (!existing) {
    await upsertGifCommand({
      command: normalizedCommand,
      kind: normalizedKind,
      title: normalizedKind === 'gif' ? normalizedCommand : null,
      footer: null,
      textContent: null,
      pingUserIds: normalizedKind === 'text' ? (pingUserIds ?? []) : undefined,
      textLabel: normalizedKind === 'text' ? '' : undefined,
      textDescription: normalizedKind === 'text' ? '' : undefined,
      enabled: true,
    });
  } else if (normalizedKind === 'text' && pingUserIds !== undefined) {
    await updateGifCommand(normalizedCommand, { ping_user_ids: pingUserIds });
  }

  const row = await getGifCommand(normalizedCommand);
  const embed = buildPreviewEmbed({ command: normalizedCommand, kind: normalizedKind, row });
  sessions.set(messageId, { command: normalizedCommand, kind: normalizedKind, ownerId: ownerId ?? null });

  return {
    content: '',
    embeds: [embed],
    components: buildButtonsRows(messageId, { kind: normalizedKind }),
  };
}

function buildTypeWizardEmbed({ command, kind }) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Create GIF/Text Command')
    .setDescription(`Trigger word: \`${command}\`\nSelect what type of command you want to create.`);

  if (kind) {
    embed.addFields({ name: 'Selected Type', value: kind === 'text' ? '`Text`' : '`GIF Embed`', inline: false });
  }

  return embed;
}

function buildTypeWizardComponents(sessionId, { kind } = {}) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(`addgif_type_${sessionId}`)
    .setPlaceholder('Select command type...')
    .addOptions(
      { label: 'GIF Embed Command', value: 'gif', description: 'Sends an embed with an image from the bucket', default: kind === 'gif' },
      { label: 'Text Command', value: 'text', description: 'Sends a text message', default: kind === 'text' },
    );

  const row1 = new ActionRowBuilder().addComponents(select);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`addgif_next_${sessionId}`)
    .setLabel('Next')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!kind);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`addgif_cancel_${sessionId}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger);

  const row2 = new ActionRowBuilder().addComponents(nextBtn, cancelBtn);

  return [row1, row2];
}

function buildPingsWizardEmbed({ command, pingUserIds = [] } = {}) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Create Text Command')
    .setDescription(`Trigger word: \`${command}\`\nSelect user(s) to ping when the command is used.`);

  if (pingUserIds.length) {
    embed.addFields({
      name: 'Selected Pings',
      value: pingUserIds.map((id) => `<@${id}>`).join(' ').slice(0, 1024),
      inline: false,
    });
  }

  return embed;
}

function buildPingsWizardComponents(sessionId, { pingUserIds = [] } = {}) {
  const select = new UserSelectMenuBuilder()
    .setCustomId(`addgif_pings_${sessionId}`)
    .setPlaceholder('Select user(s) to ping...')
    .setMinValues(0)
    .setMaxValues(10);

  const row1 = new ActionRowBuilder().addComponents(select);

  const backBtn = new ButtonBuilder()
    .setCustomId(`addgif_back_${sessionId}`)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`addgif_next_${sessionId}`)
    .setLabel('Next')
    .setStyle(ButtonStyle.Secondary);

  const cancelBtn = new ButtonBuilder()
    .setCustomId(`addgif_cancel_${sessionId}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger);

  const row2 = new ActionRowBuilder().addComponents(backBtn, nextBtn, cancelBtn);
  return [row1, row2];
}

function buildInitialEditModal({ previewMessageId, kind, row }) {
  const modal = new ModalBuilder()
    .setCustomId(`gifcmd_editmodal_${previewMessageId}`)
    .setTitle(kind === 'text' ? 'Edit Text Command' : 'Edit GIF Command');

  if (kind === 'text') {
    const labelInput = new TextInputBuilder()
      .setCustomId('label')
      .setLabel('Outlined word (bold + clickable)')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const defaultLabel = String(row?.text_label ?? '').trim();
    if (defaultLabel) labelInput.setValue(defaultLabel);

    const descInput = new TextInputBuilder()
      .setCustomId('description')
      .setLabel('Description (optional)')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false);
    const defaultDesc = String(row?.text_description ?? '').trim();
    if (defaultDesc) descInput.setValue(defaultDesc);

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        labelInput,
      ),
      new ActionRowBuilder().addComponents(
        descInput,
      ),
    );
    return modal;
  }

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

  return modal;
}

export async function startAddGifWizardInteraction(interaction, { command, presetKind = null } = {}) {
  if (!interaction) throw new Error('Missing interaction.');
  if (!interaction.channel) throw new Error('No channel available.');
  if (!interaction.guild || !interaction.member) throw new Error('This can only be used in a server.');
  if (!isAdminMember(interaction.member)) throw new Error('You do not have permission to manage GIF commands.');

  const normalizedCommand = sanitizeCommandName(command);
  if (!normalizedCommand) throw new Error('Missing trigger word.');

  const sessionId = newWizardSessionId();
  createWizards.set(sessionId, {
    ownerId: interaction.user.id,
    command: normalizedCommand,
    kind: presetKind,
    step: 'type',
    pingUserIds: [],
  });

  await interaction.reply({
    embeds: [buildTypeWizardEmbed({ command: normalizedCommand, kind: presetKind })],
    components: buildTypeWizardComponents(sessionId, { kind: presetKind }),
  });
}

export async function startAddGifTriggerModal(interaction) {
  if (!interaction) throw new Error('Missing interaction.');
  if (!interaction.guild || !interaction.member) throw new Error('This can only be used in a server.');
  if (!isAdminMember(interaction.member)) throw new Error('You do not have permission to manage GIF commands.');

  const sessionId = newWizardSessionId();
  createWizards.set(sessionId, {
    ownerId: interaction.user.id,
    command: null,
    kind: null,
    step: 'trigger',
    pingUserIds: [],
  });

  await interaction.showModal(buildTriggerModal(sessionId));
}

export async function maybeHandleGifCommandCrudMessage(message) {
  const parsed = parseStartCommand(message.content);
  if (!parsed) return false;

  if (!message.guild) return true;
  if (!isAdminMember(message.member)) {
    await message.reply({ content: 'You do not have permission to manage GIF commands.' });
    return true;
  }

  if (!parsed.command) {
    await message.reply({ content: 'Usage: `!addgif <triggerword>`, `!addcommand <triggerword>`, or `!editgif <triggerword>`' });
    return true;
  }

  const normalized = sanitizeCommandName(parsed.command);

  const existing = await getGifCommand(normalized).catch(() => null);
  if (parsed.cmd === '!editgif' || parsed.cmd === '!editcommand') {
    if (!existing) {
      await message.reply({ content: `\`/${normalized}\` does not exist yet. Use \`!addcommand ${normalized}\` to create it.` });
      return true;
    }

    await startGifCommandCrudSession({
      channel: message.channel,
      guild: message.guild,
      member: message.member,
      ownerId: message.author.id,
      command: normalized,
      kind: existing.kind,
    });
    return true;
  }

  // !addgif
  if (existing) {
    await message.reply({ content: `\`/${normalized}\` already exists. Use \`!editgif ${normalized}\` to edit it.` });
    return true;
  }

  const sessionId = newWizardSessionId();
  createWizards.set(sessionId, {
    ownerId: message.author.id,
    command: normalized,
    kind: null,
    step: 'type',
    pingUserIds: [],
  });

  await message.channel.send({
    embeds: [buildTypeWizardEmbed({ command: normalized, kind: null })],
    components: buildTypeWizardComponents(sessionId, { kind: null }),
  });
  return true;
}

export async function handleGifCommandCrudInteraction(interaction) {
  if (
    !interaction.isButton() &&
    !interaction.isModalSubmit() &&
    !interaction.isStringSelectMenu() &&
    !interaction.isUserSelectMenu()
  ) return false;

  const id = interaction.customId || '';
  const isWizard =
    id.startsWith('addgif_trigger_') ||
    id.startsWith('addgif_type_') ||
    id.startsWith('addgif_pings_') ||
    id.startsWith('addgif_next_') ||
    id.startsWith('addgif_back_') ||
    id.startsWith('addgif_cancel_');

  const isCrud =
    id.startsWith('gifcmd_') ||
    id.startsWith('gifcmd_pingsel_');

  if (!isWizard && !isCrud) return false;

  // ----------------------
  // Wizard: trigger modal
  // ----------------------
  if (interaction.isModalSubmit() && id.startsWith('addgif_trigger_')) {
    const sessionId = id.slice('addgif_trigger_'.length);
    const session = createWizards.get(sessionId);
    if (!session) {
      await interaction.reply({ content: 'This create-command session expired.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (session.ownerId && session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'This create-command session is not yours.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const raw = interaction.fields.getTextInputValue('command');
    const normalized = sanitizeCommandName(raw);
    if (!normalized) {
      await interaction.reply({ content: 'Invalid trigger word.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const existing = await getGifCommand(normalized).catch(() => null);
    if (existing) {
      createWizards.delete(sessionId);
      await interaction.reply({
        content: `\`/${normalized}\` already exists. Use \`/editgif\` to edit it.`,
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    session.command = normalized;
    session.step = 'type';
    createWizards.set(sessionId, session);

    await interaction.reply({
      embeds: [buildTypeWizardEmbed({ command: normalized, kind: session.kind })],
      components: buildTypeWizardComponents(sessionId, { kind: session.kind }),
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  // ----------------------
  // Wizard: type select
  // ----------------------
  if (interaction.isStringSelectMenu() && id.startsWith('addgif_type_')) {
    const sessionId = id.slice('addgif_type_'.length);
    const session = createWizards.get(sessionId);
    if (!session) {
      await interaction.reply({ content: 'This create-command session expired.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (session.ownerId && session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'This create-command session is not yours.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const kind = (interaction.values?.[0] === 'text') ? 'text' : 'gif';
    session.kind = kind;
    session.step = 'type';
    createWizards.set(sessionId, session);

    await interaction.update({
      embeds: [buildTypeWizardEmbed({ command: session.command, kind })],
      components: buildTypeWizardComponents(sessionId, { kind }),
    });
    return true;
  }

  // ----------------------
  // Wizard: pings select
  // ----------------------
  if (interaction.isUserSelectMenu() && id.startsWith('addgif_pings_')) {
    const sessionId = id.slice('addgif_pings_'.length);
    const session = createWizards.get(sessionId);
    if (!session) {
      await interaction.reply({ content: 'This create-command session expired.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (session.ownerId && session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'This create-command session is not yours.', flags: MessageFlags.Ephemeral });
      return true;
    }

    session.pingUserIds = interaction.values || [];
    session.step = 'pings';
    createWizards.set(sessionId, session);

    await interaction.update({
      embeds: [buildPingsWizardEmbed({ command: session.command, pingUserIds: session.pingUserIds })],
      components: buildPingsWizardComponents(sessionId, { pingUserIds: session.pingUserIds }),
    });
    return true;
  }

  // ----------------------
  // Wizard: buttons
  // ----------------------
  if (interaction.isButton() && id.startsWith('addgif_cancel_')) {
    const sessionId = id.slice('addgif_cancel_'.length);
    createWizards.delete(sessionId);
    await interaction.update({ content: 'Cancelled.', embeds: [], components: [] }).catch(async () => {
      await interaction.reply({ content: 'Cancelled.', flags: MessageFlags.Ephemeral });
    });
    return true;
  }

  if (interaction.isButton() && id.startsWith('addgif_back_')) {
    const sessionId = id.slice('addgif_back_'.length);
    const session = createWizards.get(sessionId);
    if (!session) {
      await interaction.reply({ content: 'This create-command session expired.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (session.ownerId && session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'This create-command session is not yours.', flags: MessageFlags.Ephemeral });
      return true;
    }

    session.step = 'type';
    createWizards.set(sessionId, session);

    await interaction.update({
      embeds: [buildTypeWizardEmbed({ command: session.command, kind: session.kind })],
      components: buildTypeWizardComponents(sessionId, { kind: session.kind }),
    });
    return true;
  }

  if (interaction.isButton() && id.startsWith('addgif_next_')) {
    const sessionId = id.slice('addgif_next_'.length);
    const session = createWizards.get(sessionId);
    if (!session) {
      await interaction.reply({ content: 'This create-command session expired.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (session.ownerId && session.ownerId !== interaction.user.id) {
      await interaction.reply({ content: 'This create-command session is not yours.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!session.kind) {
      await interaction.reply({ content: 'Select a type first.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (session.kind === 'text' && session.step !== 'pings') {
      session.step = 'pings';
      session.pingUserIds = session.pingUserIds || [];
      createWizards.set(sessionId, session);
      await interaction.update({
        embeds: [buildPingsWizardEmbed({ command: session.command, pingUserIds: session.pingUserIds })],
        components: buildPingsWizardComponents(sessionId, { pingUserIds: session.pingUserIds }),
      });
      return true;
    }

    try {
      const payload = await buildGifCommandCrudPayload({
        messageId: interaction.message.id,
        guild: interaction.guild,
        member: interaction.member,
        ownerId: interaction.user.id,
        command: session.command,
        kind: session.kind,
        pingUserIds: session.kind === 'text' ? (session.pingUserIds || []) : undefined,
      });

      createWizards.delete(sessionId);
      await interaction.update(payload);
    } catch (error) {
      console.error('Error starting GIF command CRUD from wizard:', error);
      await interaction.reply({ content: 'Failed to start the editor. Please try again.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    return true;
  }

  // ----------------------
  // CRUD: edit pings select
  // ----------------------
  if (interaction.isUserSelectMenu() && id.startsWith('gifcmd_pingsel_')) {
    const messageId = id.slice('gifcmd_pingsel_'.length);
    const session = sessions.get(messageId);
    if (!session) {
      await interaction.reply({ content: 'This GIF command session expired.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!interaction.member || !isAdminMember(interaction.member)) {
      await interaction.reply({ content: 'You do not have permission to manage GIF commands.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (session.kind !== 'text') {
      await interaction.reply({ content: 'This is only for text commands.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await updateGifCommand(session.command, { ping_user_ids: interaction.values || [] });

    const row = await getGifCommand(session.command);
    const embed = buildPreviewEmbed({ command: session.command, kind: session.kind, row });
    await interaction.message?.edit({ embeds: [embed] }).catch(() => {});

    await interaction.reply({ content: 'Updated pings.', flags: MessageFlags.Ephemeral });
    return true;
  }

  // ----------------------
  // CRUD: buttons
  // ----------------------
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
      const command = session.command;
      sessions.delete(messageId);
      await interaction.deferUpdate().catch(() => {});
      await interaction.message.delete().catch(async () => {
        await interaction.message.edit({ content: '', embeds: [], components: [] }).catch(() => {});
      });
      await interaction.followUp({ content: `\`${command}\` command has been saved`, flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    if (action === 'delete') {
      const row = await getGifCommand(session.command).catch(() => null);
      if (row) await deleteCommandAssetIfAny(row);

      await deleteGifCommand(session.command).catch(() => {});
      sessions.delete(messageId);

      await interaction.deferUpdate().catch(() => {});
      await interaction.message.delete().catch(() => {});
      return true;
    }

    if (action === 'edit') {
      const row = await getGifCommand(session.command);
      const modal = buildInitialEditModal({ previewMessageId: messageId, kind: session.kind, row });
      await interaction.showModal(modal);
      return true;
    }

    if (action === 'rename') {
      const modal = buildRenameModal(messageId, session.command);
      await interaction.showModal(modal);
      return true;
    }

    if (action === 'pings') {
      if (session.kind !== 'text') {
        await interaction.reply({ content: 'This is only for text commands.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const row = await getGifCommand(session.command);
      const current = Array.isArray(row?.ping_user_ids) ? row.ping_user_ids.filter(Boolean).map(String) : [];

      const select = new UserSelectMenuBuilder()
        .setCustomId(`gifcmd_pingsel_${messageId}`)
        .setPlaceholder('Select user(s) to ping...')
        .setMinValues(0)
        .setMaxValues(10);

      if (typeof select.setDefaultUsers === 'function' && current.length) {
        select.setDefaultUsers(current);
      }

      await interaction.reply({
        content: 'Select who this command should ping:',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (action === 'change') {
      await interaction.reply({ content: 'Upload the image/GIF in your next message (within 60s).', flags: MessageFlags.Ephemeral });

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
        await uploadAssetFromAttachment({ command: session.command, attachment, kind: session.kind });

        const row = await getGifCommand(session.command);
        const embed = buildPreviewEmbed({ command: session.command, kind: session.kind, row });

        await interaction.message.edit({ embeds: [embed] });
        await interaction.followUp({ content: 'Image updated.', flags: MessageFlags.Ephemeral });
      } catch {
        await interaction.followUp({ content: 'Timed out or no attachment received.', flags: MessageFlags.Ephemeral });
      }

      return true;
    }
  }

  // ----------------------
  // CRUD: edit modal submit
  // ----------------------
  if (interaction.isModalSubmit() && id.startsWith('gifcmd_renamemodal_')) {
    const messageId = id.slice('gifcmd_renamemodal_'.length);
    const modalSession = sessions.get(messageId);
    if (!modalSession) {
      await interaction.reply({ content: 'This GIF command session expired.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const newCommandRaw = interaction.fields.getTextInputValue('command');
    const newCommand = sanitizeCommandName(newCommandRaw);
    if (!newCommand) {
      await interaction.reply({ content: 'Invalid trigger word.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const oldCommand = modalSession.command;
    if (newCommand === oldCommand) {
      await interaction.reply({ content: 'No changes.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const exists = await getGifCommand(newCommand).catch(() => null);
    if (exists) {
      await interaction.reply({ content: `\`/${newCommand}\` already exists. Choose another trigger word.`, flags: MessageFlags.Ephemeral });
      return true;
    }

    const oldRow = await getGifCommand(oldCommand).catch(() => null);
    if (!oldRow) {
      await interaction.reply({ content: 'Original command no longer exists.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const oldPath = oldRow.asset_path || oldRow.image_path;

    await upsertGifCommand({
      command: newCommand,
      kind: oldRow.kind,
      title: oldRow.title ?? null,
      footer: oldRow.footer ?? null,
      assetPath: oldPath ?? undefined,
      imagePath: oldPath ?? undefined,
      pingUserIds: oldRow.ping_user_ids ?? undefined,
      textLabel: oldRow.text_label ?? undefined,
      textDescription: oldRow.text_description ?? undefined,
      textContent: oldRow.text_content ?? undefined,
      color: oldRow.color ?? undefined,
      enabled: oldRow.enabled ?? true,
    });

    await deleteGifCommand(oldCommand).catch(() => {});

    modalSession.command = newCommand;
    sessions.set(messageId, modalSession);

    const row = await getGifCommand(newCommand);
    const embed = buildPreviewEmbed({ command: newCommand, kind: modalSession.kind, row });
    await editPreviewMessage(interaction.channel, messageId, { embeds: [embed] });

    await interaction.reply({ content: `Renamed to \`/${newCommand}\`.`, flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.isModalSubmit() && id.startsWith('gifcmd_editmodal_')) {
    const modalMessageId = id.slice('gifcmd_editmodal_'.length);
    const modalSession = sessions.get(modalMessageId);
    if (!modalSession) {
      await interaction.reply({ content: 'This GIF command session expired.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (modalSession.kind === 'gif') {
      const title = interaction.fields.getTextInputValue('title');
      const footer = interaction.fields.getTextInputValue('footer');
      await upsertGifCommand({ command: modalSession.command, kind: 'gif', title, footer, enabled: true });

      const row = await getGifCommand(modalSession.command);
      const embed = buildPreviewEmbed({ command: modalSession.command, kind: modalSession.kind, row });
      await interaction.reply({ content: 'Updated.', flags: MessageFlags.Ephemeral });
      await editPreviewMessage(interaction.channel, modalMessageId, { embeds: [embed], components: buildButtonsRows(modalMessageId, { kind: modalSession.kind }) });
      return true;
    }

    const label = interaction.fields.getTextInputValue('label');
    const description = interaction.fields.getTextInputValue('description');

    await upsertGifCommand({
      command: modalSession.command,
      kind: 'text',
      textLabel: String(label ?? '').trim(),
      textDescription: String(description ?? '').trim(),
      textContent: null,
      enabled: true,
    });

    let row = await getGifCommand(modalSession.command);
    let embed = buildPreviewEmbed({ command: modalSession.command, kind: modalSession.kind, row });

    await editPreviewMessage(interaction.channel, modalMessageId, { embeds: [embed] });

    const hasAsset = Boolean(row?.asset_path || row?.image_path);
    if (hasAsset || !interaction.channel) {
      await interaction.reply({ content: 'Updated.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.reply({ content: 'Now upload the image/GIF as your next message (within 60s).', flags: MessageFlags.Ephemeral });

    try {
      const collected = await interaction.channel.awaitMessages({
        filter: (m) => m.author.id === interaction.user.id && m.attachments.size > 0,
        max: 1,
        time: 60000,
        errors: ['time'],
      });

      const attachment = collected.first().attachments.first();
      await uploadAssetFromAttachment({ command: modalSession.command, attachment, kind: modalSession.kind });

      row = await getGifCommand(modalSession.command);
      embed = buildPreviewEmbed({ command: modalSession.command, kind: modalSession.kind, row });
      await editPreviewMessage(interaction.channel, modalMessageId, { embeds: [embed] });

      await interaction.followUp({ content: 'Image uploaded.', flags: MessageFlags.Ephemeral });
    } catch {
      await interaction.followUp({ content: 'Timed out waiting for an attachment. You can use `Change Image` later.', flags: MessageFlags.Ephemeral });
    }

    return true;
  }

  return true;
}
