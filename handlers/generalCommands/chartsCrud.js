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
import { getStoredAssetValueFromAttachment, resolveAssetUrl } from '../../utils/assetUrls.js';
import { uploadAttachmentToArchive } from '../../utils/discordMediaArchive.js';
import {
  findChartKeyByTrigger,
  getChart,
  listChartCategories,
  listChartTypesInCategory,
  loadChartsCache,
  normalizeChartVariantKey,
  updateChart,
  upsertChart,
  deleteChart,
} from '../../utils/chartsStore.js';

const sessions = new Map(); // messageId -> session

function isAdminMember(member) {
  if (!member) return false;
  return (
    member.roles.cache.has(MODERATOR_ROLE_ID) ||
    member.roles.cache.has(OFFICER_ROLE_ID) ||
    member.roles.cache.has(RAID_MANAGER_ROLE_ID)
  );
}

function normalizeTypeKey(key) {
  return String(key ?? '').trim().toLowerCase().replace(/^\//, '').replace(/[^\w-]/g, '').slice(0, 32);
}

function normalizeCategoryKey(category) {
  return String(category ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 64);
}

function parseTriggers(input) {
  const raw = String(input ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const normalized = raw.map((t) => (t.startsWith('!') || t.startsWith('/') ? t : `!${t}`));
  return Array.from(new Set(normalized.map((s) => s.toLowerCase()))).slice(0, 10);
}

function buildWizardEmbed(session) {
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle(session.mode === 'add' ? 'Add Chart' : 'Edit Chart');

  if (session.step === 'category') {
    embed.setDescription('Page 1/2: Select a chart category.');
    if (session.category) embed.addFields({ name: 'Selected Category', value: `\`${session.category}\``, inline: false });
    return embed;
  }

  if (session.step === 'type') {
    embed.setDescription('Page 2/2: Select a type (e.g. 2 Man).');
    embed.addFields({ name: 'Category', value: `\`${session.category || '—'}\``, inline: false });
    if (session.typeTitle) embed.addFields({ name: 'Selected Type', value: `\`${session.typeTitle}\``, inline: false });
    return embed;
  }

  if (session.step === 'variant') {
    embed.setDescription('Page 3/3: Select a chart variant (e.g. KE-LOO).');
    embed.addFields(
      { name: 'Category', value: `\`${session.category || '—'}\``, inline: false },
      { name: 'Type', value: `\`${session.typeTitle || session.typeKey || '—'}\``, inline: false },
    );
    if (session.variantTitle) embed.addFields({ name: 'Selected Variant', value: `\`${session.variantTitle}\``, inline: false });
    return embed;
  }

  const chart = session.chart;
  const variant = (chart?.variants || []).find((v) => v.key === session.variantKey) || chart?.variants?.[0];
  const pages = Array.isArray(variant?.pages) ? variant.pages : [];
  const total = pages.length;
  const idx = Math.max(0, Math.min(session.pageIndex ?? 0, Math.max(0, total - 1)));
  const page = pages[idx];

  embed.setTitle(String(variant?.title ?? chart?.title ?? 'Chart'));
  embed.setDescription(null);

  if (page?.attachment_url || page?.asset_path || page?.image_path) {
    const url = resolveAssetUrl(page.attachment_url || page.asset_path || page.image_path);
    if (url) embed.setImage(url);
  } else {
    embed.addFields({ name: 'No pages yet', value: 'Use `Add Page` to upload an image.', inline: false });
  }

  return embed;
}

function buildEditorEmbeds(session) {
  const chart = session.chart;
  const category = String(chart?.category ?? session.category ?? 'general');
  const typeTitle = String(chart?.title ?? session.typeTitle ?? session.typeKey ?? 'Type');

  const categoryEmbed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Category').setDescription(category);
  const typeEmbed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Type').setDescription(typeTitle);

  const variants = Array.isArray(chart?.variants) ? chart.variants : [];
  const variant = variants.find((v) => v.key === session.variantKey) || variants[0] || null;
  const pages = Array.isArray(variant?.pages) ? variant.pages : [];
  const total = pages.length;
  const idx = Math.max(0, Math.min(session.pageIndex ?? 0, Math.max(0, total - 1)));
  const page = pages[idx];

  const defaultTitle = `${category} ${typeTitle}`.trim();
  const embedTitle = String(page?.title ?? variant?.embed_title ?? defaultTitle);

  const variantEmbed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(embedTitle)
    .setDescription(null)
    .setFooter({ text: total ? `Page ${idx + 1}/${total}` : 'Page 0/0' });

  if (page?.attachment_url || page?.asset_path || page?.image_path) {
    const url = resolveAssetUrl(page.attachment_url || page.asset_path || page.image_path);
    if (url) variantEmbed.setImage(url);
  } else {
    variantEmbed.addFields({ name: 'No pages yet', value: 'Use `Add Page` to upload an image.', inline: false });
  }

  if (variants.length) {
    typeEmbed.addFields({
      name: 'Variants',
      value: variants
        .map((v) => {
          const isActive = v.key === variant?.key;
          const label = String(v.name ?? v.title ?? v.key);
          return `${isActive ? '• **' : '• '}${label}${isActive ? '**' : ''}`;
        })
        .join('\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  return [categoryEmbed, typeEmbed, variantEmbed];
}

async function buildWizardComponents(session, { messageId }) {
  if (session.step === 'category') {
    const categories = await listChartCategories().catch(() => []);
    const select = new StringSelectMenuBuilder()
      .setCustomId(`chartwiz_cat_${messageId}`)
      .setPlaceholder('Select a category...')
      .setMinValues(1)
      .setMaxValues(1);

    const options = categories.slice(0, 24).map((c) => ({ label: c.slice(0, 100), value: normalizeCategoryKey(c) }));
    options.unshift({ label: 'New category…', value: '__new__' });
    select.addOptions(options.length ? options : [{ label: 'New category…', value: '__new__' }]);

    const nextBtn = new ButtonBuilder()
      .setCustomId(`chartwiz_next_${messageId}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!session.category);

    const deleteCategoryBtn = new ButtonBuilder()
      .setCustomId(`chartwiz_delcat_${messageId}`)
      .setLabel('Delete Category')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!session.category);

    const cancelBtn = new ButtonBuilder()
      .setCustomId(`chartwiz_cancel_${messageId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger);

    return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(nextBtn, deleteCategoryBtn, cancelBtn)];
  }

  if (session.step === 'type') {
    const types = await listChartTypesInCategory(session.category).catch(() => []);
    const select = new StringSelectMenuBuilder()
      .setCustomId(`chartwiz_type_${messageId}`)
      .setPlaceholder('Select a type...')
      .setMinValues(1)
      .setMaxValues(1);

    const opts = [];
    if (session.mode === 'add') opts.push({ label: 'Add new type…', value: '__new__' });
    for (const t of types.slice(0, 25 - opts.length)) {
      const trigPreview = (t.triggers || []).slice(0, 2).join(', ');
      opts.push({
        label: String(t.title ?? t.key).slice(0, 100),
        description: trigPreview ? `Triggers: ${trigPreview}`.slice(0, 100) : undefined,
        value: t.key,
      });
    }
    if (!opts.length) opts.push({ label: 'Add new type…', value: '__new__' });
    select.addOptions(opts);

    const backBtn = new ButtonBuilder().setCustomId(`chartwiz_back_${messageId}`).setLabel('Back').setStyle(ButtonStyle.Secondary);
    const nextBtn = new ButtonBuilder()
      .setCustomId(`chartwiz_next_${messageId}`)
      .setLabel('Next')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(session.mode === 'edit' && !session.typeKey);
    const cancelBtn = new ButtonBuilder().setCustomId(`chartwiz_cancel_${messageId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger);

    const deleteTypeBtn = new ButtonBuilder()
      .setCustomId(`chartwiz_deltype_${messageId}`)
      .setLabel('Delete Type')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(!session.typeKey);

    return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backBtn, nextBtn, deleteTypeBtn, cancelBtn)];
  }

  if (session.step === 'variant') {
    const chart = session.chart || (session.typeKey ? await getChart(session.typeKey).catch(() => null) : null);
    const variants = Array.isArray(chart?.variants) ? chart.variants : [];

    const select = new StringSelectMenuBuilder()
      .setCustomId(`chartwiz_variant_${messageId}`)
      .setPlaceholder('Select a variant...')
      .setMinValues(1)
      .setMaxValues(1);

    const opts = [];
    opts.push({ label: 'Add new variant…', value: '__new__' });
    for (const v of variants.slice(0, 25 - opts.length)) {
      opts.push({ label: String(v.title ?? v.key).slice(0, 100), value: v.key });
    }
    if (!opts.length) opts.push({ label: 'Add new variant…', value: '__new__' });
    select.addOptions(opts);

    const backBtn = new ButtonBuilder().setCustomId(`chartwiz_back_${messageId}`).setLabel('Back').setStyle(ButtonStyle.Secondary);
    const openBtn = new ButtonBuilder()
      .setCustomId(`chartwiz_open_${messageId}`)
      .setLabel('Open Editor')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!session.variantKey);
    const cancelBtn = new ButtonBuilder().setCustomId(`chartwiz_cancel_${messageId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger);

    return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(backBtn, openBtn, cancelBtn)];
  }

  // editor
  const chartForEditor = session.chart;
  const variantsForEditor = Array.isArray(chartForEditor?.variants) ? chartForEditor.variants : [];
  const activeVariantForEditor = variantsForEditor.find((v) => v.key === session.variantKey) || variantsForEditor[0] || null;

  const variantSelect = new StringSelectMenuBuilder()
    .setCustomId(`chartedit_variant_${messageId}`)
    .setPlaceholder('Select variant...')
    .setMinValues(1)
    .setMaxValues(1);

  const variantOptions = [{ label: 'Add new variant…', value: '__new__' }];
  for (const v of variantsForEditor.slice(0, 24)) {
    variantOptions.push({
      label: String(v.name ?? v.title ?? v.key).slice(0, 100),
      value: v.key,
      default: v.key === activeVariantForEditor?.key,
    });
  }
  variantSelect.addOptions(variantOptions);
  const prevBtn = new ButtonBuilder().setCustomId(`chartedit_prev_${messageId}`).setLabel('<').setStyle(ButtonStyle.Secondary);
  const nextBtn = new ButtonBuilder().setCustomId(`chartedit_next_${messageId}`).setLabel('>').setStyle(ButtonStyle.Secondary);
  const addBtn = new ButtonBuilder().setCustomId(`chartedit_add_${messageId}`).setLabel('Add Page').setStyle(ButtonStyle.Secondary);
  const editImageBtn = new ButtonBuilder().setCustomId(`chartedit_img_${messageId}`).setLabel('Edit Image').setStyle(ButtonStyle.Secondary);
  const editVariantTitleBtn = new ButtonBuilder().setCustomId(`chartedit_vtitle_${messageId}`).setLabel('Edit Title').setStyle(ButtonStyle.Secondary);
  const removeBtn = new ButtonBuilder().setCustomId(`chartedit_remove_${messageId}`).setLabel('Remove Page').setStyle(ButtonStyle.Danger);
  const deleteTypeBtn = new ButtonBuilder().setCustomId(`chartedit_delete_${messageId}`).setLabel('Delete Type').setStyle(ButtonStyle.Danger);
  const editTriggersBtn = new ButtonBuilder().setCustomId(`chartedit_trig_${messageId}`).setLabel('Edit Triggers').setStyle(ButtonStyle.Secondary);
  const closeBtn = new ButtonBuilder().setCustomId(`chartedit_close_${messageId}`).setLabel('Save and Close').setStyle(ButtonStyle.Success);

  return [
    new ActionRowBuilder().addComponents(variantSelect),
    new ActionRowBuilder().addComponents(prevBtn, nextBtn, addBtn, editImageBtn, editVariantTitleBtn),
    new ActionRowBuilder().addComponents(editTriggersBtn, removeBtn, deleteTypeBtn, closeBtn),
  ];
}

async function buildWizardPayload(session, messageId) {
  const embeds = session.step === 'editor' ? buildEditorEmbeds(session) : [buildWizardEmbed(session)];
  return { embeds, components: await buildWizardComponents(session, { messageId }) };
}

async function refreshFromComponentInteraction(interaction, session) {
  const payload = await buildWizardPayload(session, interaction.message.id);
  await interaction.update(payload).catch(async () => {
    await interaction.editReply(payload).catch(() => {});
  });
}

async function refreshFromModalInteraction(interaction, session) {
  const msgId = interaction.message?.id;
  if (!msgId) {
    await interaction.reply({ content: 'Updated.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return;
  }
  const payload = await buildWizardPayload(session, msgId);
  await interaction.update(payload).catch(async () => {
    await interaction.editReply(payload).catch(() => {});
  });
}

function buildNewCategoryModal(messageId) {
  return new ModalBuilder()
    .setCustomId(`chartwiz_catmodal_${messageId}`)
    .setTitle('New Category')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('category').setLabel('Category name').setStyle(TextInputStyle.Short).setRequired(true),
      ),
    );
}

function buildTypeModal({ messageId, initialTitle = '', initialTriggers = '' }) {
  return new ModalBuilder()
    .setCustomId(`chartwiz_typemodal_${messageId}`)
    .setTitle('Chart Type')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Type name (e.g. 2 Man)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(initialTitle),
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('triggers')
          .setLabel('Trigger words (comma separated)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('!2man, !2m')
          .setValue(initialTriggers),
      ),
    );
}

function buildVariantModal({ messageId, initialTitle = '' }) {
  return new ModalBuilder()
    .setCustomId(`chartwiz_variantmodal_${messageId}`)
    .setTitle('Chart Variant')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Variant title (e.g. KE-LOO)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(initialTitle),
      ),
    );
}

function buildAddVariantModal({ messageId }) {
  return new ModalBuilder()
    .setCustomId(`chartedit_addvariantmodal_${messageId}`)
    .setTitle('Add Variant')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('name')
          .setLabel('Variant name (e.g. AP LOO)')
          .setStyle(TextInputStyle.Short)
          .setRequired(true),
      ),
    );
}

function buildEditPageTitleModal({ messageId, initialTitle = '' }) {
  return new ModalBuilder()
    .setCustomId(`chartedit_ptitlemodal_${messageId}`)
    .setTitle('Edit Page Title')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('title')
          .setLabel('Title for this page')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setValue(initialTitle),
      ),
    );
}

function buildEditTriggersModal({ messageId, initialTriggers = '' }) {
  return new ModalBuilder()
    .setCustomId(`chartedit_trigmodal_${messageId}`)
    .setTitle('Edit Triggers')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('triggers')
          .setLabel('Trigger words (comma separated)')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('!2man, !2m')
          .setValue(initialTriggers),
      ),
    );
}

async function uploadChartPage({ typeKey, variantKey, attachment }) {
  const url = getStoredAssetValueFromAttachment(attachment);
  if (!url) throw new Error('Attachment URL is missing.');
  return uploadAttachmentToArchive({
    kind: 'chart',
    attachment,
    fileName: attachment?.name || `${normalizeTypeKey(typeKey)}_${normalizeChartVariantKey(variantKey) || 'page'}.png`,
    message: `Chart page: ${typeKey}/${variantKey}\nSource: ${url}`,
  });
}

async function deleteAllTypeAssets(chart) {
  return chart;
}

async function deleteTypeWithAssets(typeKey) {
  const chart = await getChart(typeKey).catch(() => null);
  if (!chart) return;
  await deleteAllTypeAssets(chart);
  await deleteChart(chart.key);
}

async function deleteCategoryWithAssets(category) {
  const types = await listChartTypesInCategory(category).catch(() => []);
  for (const t of types) {
    await deleteTypeWithAssets(t.key);
  }
}

async function ensureUniqueTriggers({ triggers, currentTypeKey = null }) {
  for (const t of triggers) {
    const existingKey = await findChartKeyByTrigger(t).catch(() => null);
    if (existingKey && existingKey !== currentTypeKey) throw new Error(`Trigger \`${t}\` is already used by \`/${existingKey}\`.`);
  }
  await loadChartsCache().catch(() => {});
}

export async function startEditChartFlowInteraction(interaction) {
  if (!interaction.guild || !interaction.member) throw new Error('This can only be used in a server.');
  if (!isAdminMember(interaction.member)) throw new Error('No permission.');

  const session = {
    ownerId: interaction.user.id,
    mode: 'add',
    step: 'category',
    category: null,
    typeKey: null,
    typeTitle: null,
    variantKey: null,
    variantTitle: null,
    chart: null,
    pageIndex: 0,
  };

  await interaction.reply({ embeds: [buildWizardEmbed(session)], components: [], flags: MessageFlags.Ephemeral });
  const msg = await interaction.fetchReply();
  sessions.set(msg.id, session);
  await interaction.editReply(await buildWizardPayload(session, msg.id));
}

export async function maybeHandleEditChartMessage(message) {
  const content = String(message.content ?? '').trim();
  if (!content.toLowerCase().startsWith('!editchart')) return false;

  if (!message.guild) return true;
  if (!isAdminMember(message.member)) {
    await message.reply({ content: 'You do not have permission to manage charts.' });
    return true;
  }

  const session = {
    ownerId: message.author.id,
    mode: 'add',
    step: 'category',
    category: null,
    typeKey: null,
    typeTitle: null,
    variantKey: null,
    variantTitle: null,
    chart: null,
    pageIndex: 0,
  };

  const sent = await message.channel.send({ embeds: [buildWizardEmbed(session)], components: [] });
  sessions.set(sent.id, session);
  await sent.edit(await buildWizardPayload(session, sent.id));
  return true;
}

function pickCategoryFromValue(categories, value) {
  return categories.find((c) => normalizeCategoryKey(c) === value) || null;
}

export async function handleChartsCrudInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return false;
  const id = interaction.customId || '';
  if (!id.startsWith('chartwiz_') && !id.startsWith('chartedit_')) return false;

  const messageId = interaction.message?.id;
  if (!messageId) return false;

  const session = sessions.get(messageId);
  if (!session) return false;

  if (session.ownerId && session.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the session owner can use this.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  // ---- Category select
  if (interaction.isStringSelectMenu() && id === `chartwiz_cat_${messageId}`) {
    const value = interaction.values?.[0];
    if (value === '__new__') {
      await interaction.showModal(buildNewCategoryModal(messageId));
      return true;
    }

    const categories = await listChartCategories().catch(() => []);
    session.category = pickCategoryFromValue(categories, value);
    session.typeKey = null;
    session.typeTitle = null;
    session.variantKey = null;
    session.variantTitle = null;
    session.chart = null;
    session.step = session.category ? 'type' : 'category';
    sessions.set(messageId, session);
    await refreshFromComponentInteraction(interaction, session);
    return true;
  }

  if (interaction.isModalSubmit() && id === `chartwiz_catmodal_${messageId}`) {
    const category = String(interaction.fields.getTextInputValue('category') ?? '').trim();
    if (!category) {
      await interaction.reply({ content: 'Category is required.', flags: MessageFlags.Ephemeral });
      return true;
    }
    session.category = category;
    session.typeKey = null;
    session.typeTitle = null;
    session.variantKey = null;
    session.variantTitle = null;
    session.chart = null;
    session.step = 'type';
    sessions.set(messageId, session);
    await refreshFromModalInteraction(interaction, session);
    return true;
  }

  // ---- Wizard nav
  if (interaction.isButton() && id === `chartwiz_cancel_${messageId}`) {
    sessions.delete(messageId);
    await interaction.update({ content: 'Cancelled.', embeds: [], components: [] }).catch(() => {});
    return true;
  }

  if (interaction.isButton() && id === `chartwiz_delcat_${messageId}`) {
    if (!session.category) {
      await interaction.reply({ content: 'Select a category first.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.deferUpdate().catch(() => {});
    await deleteCategoryWithAssets(session.category);

    session.category = null;
    session.typeKey = null;
    session.typeTitle = null;
    session.chart = null;
    session.step = 'category';
    sessions.set(messageId, session);

    await interaction.followUp({ content: 'Deleted category.', flags: MessageFlags.Ephemeral }).catch(() => {});
    await interaction.editReply(await buildWizardPayload(session, messageId)).catch(() => {});
    return true;
  }

  if (interaction.isButton() && id === `chartwiz_deltype_${messageId}`) {
    if (!session.typeKey) {
      await interaction.reply({ content: 'Select a type first.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await interaction.deferUpdate().catch(() => {});
    await deleteTypeWithAssets(session.typeKey);

    session.typeKey = null;
    session.typeTitle = null;
    session.chart = null;
    session.step = 'type';
    sessions.set(messageId, session);

    await interaction.followUp({ content: 'Deleted type.', flags: MessageFlags.Ephemeral }).catch(() => {});
    await interaction.editReply(await buildWizardPayload(session, messageId)).catch(() => {});
    return true;
  }

  if (interaction.isButton() && id === `chartwiz_back_${messageId}`) {
    if (session.step === 'type') session.step = 'category';
    else if (session.step === 'editor') session.step = 'type';
    session.pageIndex = 0;
    sessions.set(messageId, session);
    await refreshFromComponentInteraction(interaction, session);
    return true;
  }

  if (interaction.isButton() && id === `chartwiz_next_${messageId}`) {
    if (session.step === 'category') {
      if (!session.category) {
        await interaction.reply({ content: 'Select a category first.', flags: MessageFlags.Ephemeral });
        return true;
      }
      session.step = 'type';
      sessions.set(messageId, session);
      await refreshFromComponentInteraction(interaction, session);
      return true;
    }

    if (session.step === 'type') {
      if (!session.category) {
        await interaction.reply({ content: 'Select a category first.', flags: MessageFlags.Ephemeral });
        return true;
      }

      if (session.mode === 'add') {
        await interaction.showModal(buildTypeModal({ messageId }));
        return true;
      }

      if (!session.typeKey) {
        await interaction.reply({ content: 'Select a type first.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const chart = await getChart(session.typeKey).catch(() => null);
      if (!chart) {
        await interaction.reply({ content: 'Type not found.', flags: MessageFlags.Ephemeral });
        return true;
      }

      session.chart = chart;
      session.step = 'editor';
      session.variantKey = chart?.variants?.[0]?.key || null;
      session.variantTitle = null;
      sessions.set(messageId, session);
      await refreshFromComponentInteraction(interaction, session);
      return true;
    }
  }

  // ---- Type select
  if (interaction.isStringSelectMenu() && id === `chartwiz_type_${messageId}`) {
    const value = interaction.values?.[0];
    if (value === '__new__') {
      await interaction.showModal(buildTypeModal({ messageId }));
      return true;
    }

    const chart = await getChart(value).catch(() => null);
    if (!chart) {
      await interaction.reply({ content: 'Type not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    session.typeKey = chart.key;
    session.typeTitle = chart.title;
    session.chart = chart;
    session.step = 'editor';
    session.variantKey = chart?.variants?.[0]?.key || null;
    session.variantTitle = null;
    sessions.set(messageId, session);
    await refreshFromComponentInteraction(interaction, session);
    return true;
  }

  // ---- Type modal
  if (interaction.isModalSubmit() && id === `chartwiz_typemodal_${messageId}`) {
    const title = String(interaction.fields.getTextInputValue('title') ?? '').trim();
    const triggers = parseTriggers(interaction.fields.getTextInputValue('triggers'));
    if (!title) {
      await interaction.reply({ content: 'Type name is required.', flags: MessageFlags.Ephemeral });
      return true;
    }
    if (!session.category) {
      await interaction.reply({ content: 'Select a category first.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const editingExistingTypeKey = session.typeKey || session.chart?.key || null;
    try {
      await ensureUniqueTriggers({ triggers, currentTypeKey: editingExistingTypeKey });
    } catch (e) {
      await interaction.reply({ content: e?.message || 'Invalid triggers.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const desiredKey = editingExistingTypeKey || normalizeTypeKey(`${normalizeCategoryKey(session.category)}_${title}`) || normalizeTypeKey(title);
    const typeKey = editingExistingTypeKey || desiredKey;
    if (!typeKey) {
      await interaction.reply({ content: 'Could not generate a key for this type.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (!editingExistingTypeKey) {
      const existing = await getChart(typeKey).catch(() => null);
      if (existing) {
        await interaction.reply({
          content: `Type already exists as \`/${existing.key}\`. Pick it from the list or choose a different name.`,
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      await upsertChart({ key: typeKey, category: session.category, title, triggers, variants: [], enabled: true });
    } else {
      await updateChart(typeKey, { category: session.category, title, triggers });
    }

    const chart = await getChart(typeKey);
    session.typeKey = chart.key;
    session.typeTitle = chart.title;
    session.chart = chart;
    session.step = 'editor';
    session.variantKey = chart?.variants?.[0]?.key || null;
    session.variantTitle = null;
    sessions.set(messageId, session);
    await refreshFromModalInteraction(interaction, session);
    return true;
  }

  // ---- Add variant modal (editor)
  if (interaction.isModalSubmit() && id === `chartedit_addvariantmodal_${messageId}`) {
    if (!session.typeKey) {
      await interaction.reply({ content: 'Select a type first.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const name = String(interaction.fields.getTextInputValue('name') ?? '').trim();
    if (!name) {
      await interaction.reply({ content: 'Variant name is required.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const chart = await getChart(session.typeKey).catch(() => null);
    if (!chart) {
      await interaction.reply({ content: 'Type not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const key = normalizeChartVariantKey(name) || 'variant';
    const variants = Array.isArray(chart.variants) ? [...chart.variants] : [];
    if (variants.some((v) => v.key === key)) {
      await interaction.reply({ content: 'A variant with that name already exists.', flags: MessageFlags.Ephemeral });
      return true;
    }

    variants.push({ key, name, embed_title: null, pages: [] });
    await updateChart(chart.key, { variants });
    const updated = await getChart(chart.key);

    session.chart = updated;
    session.step = 'editor';
    session.variantKey = key;
    session.variantTitle = name;
    session.pageIndex = 0;
    sessions.set(messageId, session);
    await refreshFromModalInteraction(interaction, session);
    return true;
  }

  // ---- Edit page title modal (editor)
  if (interaction.isModalSubmit() && id === `chartedit_ptitlemodal_${messageId}`) {
    if (!session.typeKey || !session.variantKey) {
      await interaction.reply({ content: 'Select a variant first.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const title = String(interaction.fields.getTextInputValue('title') ?? '').trim();
    if (!title) {
      await interaction.reply({ content: 'Title is required.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const chart = await getChart(session.typeKey).catch(() => null);
    if (!chart) {
      await interaction.reply({ content: 'Type not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const variantIndex = (chart.variants || []).findIndex((v) => v.key === session.variantKey);
    if (variantIndex < 0) {
      await interaction.reply({ content: 'Variant not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const variant = chart.variants[variantIndex];
    const pages = Array.isArray(variant.pages) ? [...variant.pages] : [];
    if (!pages.length) {
      await interaction.reply({ content: 'No pages yet.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const pageIndex = Math.max(0, Math.min(session.pageIndex ?? 0, pages.length - 1));
    pages[pageIndex] = { ...pages[pageIndex], title };

    const updatedVariants = [...chart.variants];
    updatedVariants[variantIndex] = { ...updatedVariants[variantIndex], pages };
    await updateChart(chart.key, { variants: updatedVariants });

    const updated = await getChart(chart.key);
    session.chart = updated;
    sessions.set(messageId, session);
    await refreshFromModalInteraction(interaction, session);
    return true;
  }

  // ---- Edit triggers modal (editor)
  if (interaction.isModalSubmit() && id === `chartedit_trigmodal_${messageId}`) {
    if (!session.typeKey) {
      await interaction.reply({ content: 'Select a type first.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const triggers = parseTriggers(interaction.fields.getTextInputValue('triggers'));

    try {
      await ensureUniqueTriggers({ triggers, currentTypeKey: session.typeKey });
    } catch (e) {
      await interaction.reply({ content: e?.message || 'Invalid triggers.', flags: MessageFlags.Ephemeral });
      return true;
    }

    await updateChart(session.typeKey, { triggers });
    const updated = await getChart(session.typeKey);
    session.chart = updated;
    sessions.set(messageId, session);
    await refreshFromModalInteraction(interaction, session);
    return true;
  }

  // ---- Editor variant select (switch current variant / add new)
  if (interaction.isStringSelectMenu() && id === `chartedit_variant_${messageId}`) {
    if (!session.typeKey) {
      await interaction.reply({ content: 'Select a type first.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const value = interaction.values?.[0];
    if (!value) return true;

    if (value === '__new__') {
      await interaction.showModal(buildAddVariantModal({ messageId }));
      return true;
    }

    const chart = await getChart(session.typeKey).catch(() => null);
    if (!chart) {
      await interaction.reply({ content: 'Type not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const variants = Array.isArray(chart.variants) ? chart.variants : [];
    const picked = variants.find((v) => v.key === value);
    if (!picked) {
      await interaction.reply({ content: 'Variant not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    session.chart = chart;
    session.step = 'editor';
    session.variantKey = picked.key;
    session.variantTitle = picked.name ?? picked.title ?? picked.key;
    session.pageIndex = 0;
    sessions.set(messageId, session);
    await refreshFromComponentInteraction(interaction, session);
    return true;
  }

  // ---- Variant select
  if (interaction.isStringSelectMenu() && id === `chartwiz_variant_${messageId}`) {
    const value = interaction.values?.[0];
    if (value === '__new__') {
      await interaction.showModal(buildVariantModal({ messageId }));
      return true;
    }

    const chart = session.chart || (session.typeKey ? await getChart(session.typeKey).catch(() => null) : null);
    if (!chart) {
      await interaction.reply({ content: 'Type not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const variant = (chart.variants || []).find((v) => v.key === value);
    if (!variant) {
      await interaction.reply({ content: 'Variant not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    session.chart = chart;
    session.variantKey = variant.key;
    session.variantTitle = variant.name ?? variant.title ?? variant.key;
    sessions.set(messageId, session);
    await refreshFromComponentInteraction(interaction, session);
    return true;
  }

  // ---- Variant modal (create OR edit title in editor)
  if (interaction.isModalSubmit() && id === `chartwiz_variantmodal_${messageId}`) {
    const title = String(interaction.fields.getTextInputValue('title') ?? '').trim();
    if (!title) {
      await interaction.reply({ content: 'Variant title is required.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (!session.typeKey) {
      await interaction.reply({ content: 'Select a type first.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const chart = await getChart(session.typeKey).catch(() => null);
    if (!chart) {
      await interaction.reply({ content: 'Type not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    if (session.step === 'editor' && session.variantKey) {
      const idx = (chart.variants || []).findIndex((v) => v.key === session.variantKey);
      if (idx < 0) {
        await interaction.reply({ content: 'Variant not found.', flags: MessageFlags.Ephemeral });
        return true;
      }
      const updatedVariants = [...chart.variants];
      updatedVariants[idx] = { ...updatedVariants[idx], name: title };
      await updateChart(chart.key, { variants: updatedVariants });
      const updated = await getChart(chart.key);
      session.chart = updated;
      session.variantTitle = title;
      sessions.set(messageId, session);
      await refreshFromModalInteraction(interaction, session);
      return true;
    }

    const key = normalizeChartVariantKey(title) || 'variant';
    const variants = Array.isArray(chart.variants) ? [...chart.variants] : [];
    if (variants.some((v) => v.key === key)) {
      await interaction.reply({ content: 'A variant with that name already exists.', flags: MessageFlags.Ephemeral });
      return true;
    }

    variants.push({ key, name: title, embed_title: null, pages: [] });
    await updateChart(chart.key, { variants });
    const updated = await getChart(chart.key);

    session.chart = updated;
    session.variantKey = key;
    session.variantTitle = title;
    session.step = 'editor';
    sessions.set(messageId, session);
    await refreshFromModalInteraction(interaction, session);
    return true;
  }

  // ---- Open editor from variant step
  if (interaction.isButton() && id === `chartwiz_open_${messageId}`) {
    if (!session.typeKey || !session.variantKey) {
      await interaction.reply({ content: 'Select a variant first.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const chart = await getChart(session.typeKey).catch(() => null);
    if (!chart) {
      await interaction.reply({ content: 'Type not found.', flags: MessageFlags.Ephemeral });
      return true;
    }
    const variant = (chart.variants || []).find((v) => v.key === session.variantKey) || null;
    if (!variant) {
      await interaction.reply({ content: 'Variant not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    session.chart = chart;
    session.variantTitle = variant.name ?? variant.title ?? variant.key;
    session.step = 'editor';
    session.pageIndex = 0;
    sessions.set(messageId, session);
    await refreshFromComponentInteraction(interaction, session);
    return true;
  }

  // ---- Editor actions
  if (interaction.isButton() && id.startsWith('chartedit_')) {
    if (session.step !== 'editor' || !session.typeKey || !session.variantKey) {
      await interaction.reply({ content: 'Open a variant editor first.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const action = id.split('_')[1];
    const chart = await getChart(session.typeKey).catch(() => null);
    if (!chart) {
      await interaction.reply({ content: 'Type not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const variantIndex = (chart.variants || []).findIndex((v) => v.key === session.variantKey);
    if (variantIndex < 0) {
      await interaction.reply({ content: 'Variant not found.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const variant = chart.variants[variantIndex];
    const pages = Array.isArray(variant.pages) ? variant.pages : [];

    if (action === 'close') {
      sessions.delete(messageId);
      await interaction.update({ content: 'Saved.', embeds: [], components: [] }).catch(() => {});
      return true;
    }

    if (action === 'delete') {
      await deleteAllTypeAssets(chart);
      await deleteChart(chart.key);
      sessions.delete(messageId);
      await interaction.update({ content: 'Deleted type.', embeds: [], components: [] }).catch(() => {});
      return true;
    }

    if (action === 'delvariant') {
      chart.variants.splice(variantIndex, 1);

      await updateChart(chart.key, { variants: chart.variants });
      const updated = await getChart(chart.key);
      session.chart = updated;
      session.step = 'editor';
      session.variantKey = updated?.variants?.[0]?.key || null;
      session.variantTitle = updated?.variants?.[0]?.name ?? updated?.variants?.[0]?.title ?? null;
      session.pageIndex = 0;
      sessions.set(messageId, session);
      await interaction.deferUpdate().catch(() => {});
      await interaction.followUp({ content: 'Deleted variant.', flags: MessageFlags.Ephemeral }).catch(() => {});
      await interaction.editReply(await buildWizardPayload(session, messageId)).catch(() => {});
      return true;
    }

    if (action === 'prev' || action === 'next') {
      if (!pages.length) {
        await interaction.reply({ content: 'No pages yet.', flags: MessageFlags.Ephemeral });
        return true;
      }
      session.pageIndex = action === 'prev'
        ? Math.max(0, (session.pageIndex ?? 0) - 1)
        : Math.min(pages.length - 1, (session.pageIndex ?? 0) + 1);
      session.chart = chart;
      sessions.set(messageId, session);
      await refreshFromComponentInteraction(interaction, session);
      return true;
    }

    if (action === 'vtitle') {
      const currentPageTitle = String(pages[Math.max(0, Math.min(session.pageIndex ?? 0, Math.max(0, pages.length - 1)))]?.title ?? '');
      await interaction.showModal(buildEditPageTitleModal({ messageId, initialTitle: currentPageTitle }));
      return true;
    }

    if (action === 'trig') {
      const triggersValue = Array.isArray(chart.triggers) ? chart.triggers.join(', ') : '';
      await interaction.showModal(buildEditTriggersModal({ messageId, initialTriggers: triggersValue }));
      return true;
    }

    if (action === 'add') {
      await interaction.deferUpdate().catch(() => {});
      await interaction.followUp({ content: 'Upload the chart image as your next message (within 60s).', flags: MessageFlags.Ephemeral }).catch(() => {});

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
        const uploaded = await uploadChartPage({ typeKey: chart.key, variantKey: variant.key, attachment });

        const updatedVariants = [...chart.variants];
        const updatedVariant = { ...updatedVariants[variantIndex] };
        const defaultTitle = `${String(chart.category ?? 'Chart')} ${String(chart.title ?? '')}`.trim();
        updatedVariant.pages = [...pages, {
          asset_path: uploaded.attachmentUrl,
          attachment_url: uploaded.attachmentUrl,
          message_url: uploaded.messageUrl,
          message_id: uploaded.messageId,
          channel_id: uploaded.channelId,
          title: defaultTitle || null,
        }];
        updatedVariants[variantIndex] = updatedVariant;

        await updateChart(chart.key, { variants: updatedVariants });
        const updated = await getChart(chart.key);

        session.chart = updated;
        session.pageIndex = (updated.variants.find((v) => v.key === variant.key)?.pages?.length || 1) - 1;
        sessions.set(messageId, session);

        await interaction.followUp({ content: 'Page added.', flags: MessageFlags.Ephemeral }).catch(() => {});
        await interaction.editReply(await buildWizardPayload(session, messageId)).catch(() => {});
      } catch {
        await interaction.followUp({ content: 'Timed out waiting for an attachment.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return true;
    }

    if (action === 'img') {
      if (!pages.length) {
        await interaction.reply({ content: 'No pages yet. Use Add Page first.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const idx = Math.max(0, Math.min(session.pageIndex ?? 0, pages.length - 1));

      await interaction.deferUpdate().catch(() => {});
      await interaction.followUp({ content: 'Upload the new chart image as your next message (within 60s).', flags: MessageFlags.Ephemeral }).catch(() => {});

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
        const uploaded = await uploadChartPage({ typeKey: chart.key, variantKey: variant.key, attachment });

        const updatedPages = [...pages];
        updatedPages[idx] = {
          ...updatedPages[idx],
          asset_path: uploaded.attachmentUrl,
          attachment_url: uploaded.attachmentUrl,
          message_url: uploaded.messageUrl,
          message_id: uploaded.messageId,
          channel_id: uploaded.channelId,
        };

        const updatedVariants = [...chart.variants];
        updatedVariants[variantIndex] = { ...updatedVariants[variantIndex], pages: updatedPages };

        await updateChart(chart.key, { variants: updatedVariants });
        const updated = await getChart(chart.key);

        session.chart = updated;
        session.pageIndex = idx;
        sessions.set(messageId, session);

        await interaction.followUp({ content: 'Image updated.', flags: MessageFlags.Ephemeral }).catch(() => {});
        await interaction.editReply(await buildWizardPayload(session, messageId)).catch(() => {});
      } catch {
        await interaction.followUp({ content: 'Timed out waiting for an attachment.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
      return true;
    }

    if (action === 'remove') {
      if (!pages.length) {
        await interaction.reply({ content: 'No pages to remove.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const idx = Math.max(0, Math.min(session.pageIndex ?? 0, pages.length - 1));
      const newPages = pages.filter((_, i) => i !== idx);
      const updatedVariants = [...chart.variants];
      updatedVariants[variantIndex] = { ...updatedVariants[variantIndex], pages: newPages };
      await updateChart(chart.key, { variants: updatedVariants });
      const updated = await getChart(chart.key);

      session.chart = updated;
      session.pageIndex = Math.min(session.pageIndex ?? 0, Math.max(0, newPages.length - 1));
      sessions.set(messageId, session);

      await interaction.deferUpdate().catch(() => {});
      await interaction.followUp({ content: 'Removed page.', flags: MessageFlags.Ephemeral }).catch(() => {});
      await interaction.editReply(await buildWizardPayload(session, messageId)).catch(() => {});
      return true;
    }
  }

  return false;
}
