import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from 'discord.js';

import { EMBED_COLOR } from '../../config/constants.js';
import { getSupabase } from '../../utils/supabaseClient.js';
import {
  findChartKeyByTrigger,
  getChart,
  getChartsCache,
  listChartCategories,
  listChartTypesInCategory,
  loadChartsCache,
} from '../../utils/chartsStore.js';

const browseSessions = new Map(); // sessionId -> { ownerId, step, category, categoryKey, typeKey }
const showSessions = new Map(); // messageId -> { ownerId, typeKey, variantKey, pageIndex, ts }
const triggerVariantPickSessions = new Map(); // sessionId -> { ownerId, typeKey }

function newSessionId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeCategoryKey(category) {
  return String(category ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 64);
}

function getChartsBucket() {
  return process.env.SUPABASE_CHARTS_BUCKET || process.env.SUPABASE_GIF_BUCKET || 'gif-commands';
}

function buildChartsListEmbed({ categories }) {
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Charts')
    .setDescription('Use `!chart` or `/chart` to browse by category. You can also use trigger words like `!2man` if configured.');

  for (const cat of categories.slice(0, 25)) {
    embed.addFields({ name: cat.name, value: cat.value || '—', inline: false });
  }

  return embed;
}

async function buildDynamicChartsListEmbed() {
  await loadChartsCache().catch(() => {});
  const categories = await listChartCategories().catch(() => []);

  const fields = [];
  for (const c of categories) {
    const types = await listChartTypesInCategory(c).catch(() => []);
    const lines = [];
    for (const t of types) {
      const trig = (t.triggers || []).slice(0, 6).map((x) => `\`${x}\``).join(' ');
      const variantCount = Array.isArray(t.variants) ? t.variants.length : 0;
      lines.push(`• **${String(t.title ?? t.key)}**${variantCount ? ` (${variantCount} variants)` : ''} ${trig ? `— ${trig}` : ''}`.trim());
      if (lines.join('\n').length > 900) break;
    }
    fields.push({ name: c, value: lines.join('\n') || '—' });
  }

  return buildChartsListEmbed({ categories: fields.map((f) => ({ name: f.name, value: f.value })) });
}

function buildBrowseEmbed(session) {
  const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Charts');

  if (session.step === 'category') {
    embed.setDescription('Select a category.');
    return embed;
  }

  if (session.step === 'type') {
    embed.setDescription(`Category: \`${session.category}\`\nSelect a chart type.`);
    return embed;
  }

  embed.setDescription(`Category: \`${session.category}\`\nType: \`${session.typeTitle || session.typeKey || '—'}\`\nSelect a variant.`);
  return embed;
}

async function buildBrowseComponents(session, sessionId) {
  if (session.step === 'category') {
    const categories = await listChartCategories().catch(() => []);
    const query = String(session.categoryQuery ?? '').trim().toLowerCase();
    const filtered = query ? categories.filter((c) => String(c).toLowerCase().includes(query)) : categories;
    const select = new StringSelectMenuBuilder()
      .setCustomId(`chart_browse_cat_${sessionId}`)
      .setPlaceholder('Select category...')
      .setMinValues(1)
      .setMaxValues(1);

    const options = filtered.slice(0, 25).map((c) => ({ label: c.slice(0, 100), value: normalizeCategoryKey(c) }));
    if (!options.length) options.push({ label: 'No categories found', value: '__none__' });
    select.addOptions(options);

    const cancel = new ButtonBuilder()
      .setCustomId(`chart_browse_cancel_${sessionId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger);

    return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(cancel)];
  }

  if (session.step === 'variant') {
    const chart = await getChart(session.typeKey).catch(() => null);
    const variants = Array.isArray(chart?.variants) ? chart.variants : [];

    const select = new StringSelectMenuBuilder()
      .setCustomId(`chart_browse_variant_${sessionId}`)
      .setPlaceholder('Select variant...')
      .setMinValues(1)
      .setMaxValues(1);

    const options = variants.slice(0, 25).map((v) => ({ label: String(v.name ?? v.title ?? v.key).slice(0, 100), value: v.key }));
    if (!options.length) options.push({ label: 'No variants found', value: '__none__' });
    select.addOptions(options);

    const back = new ButtonBuilder()
      .setCustomId(`chart_browse_back_${sessionId}`)
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary);

    const cancel = new ButtonBuilder()
      .setCustomId(`chart_browse_cancel_${sessionId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Danger);

    return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(back, cancel)];
  }

  const types = await listChartTypesInCategory(session.category).catch(() => []);
  const select = new StringSelectMenuBuilder()
    .setCustomId(`chart_browse_type_${sessionId}`)
    .setPlaceholder('Select type...')
    .setMinValues(1)
    .setMaxValues(1);

  const typeOptions = types.slice(0, 25).map((t) => {
    const trigPreview = (t.triggers || []).slice(0, 2).join(', ');
    return {
      label: String(t.title ?? t.key).slice(0, 100),
      description: trigPreview ? `Triggers: ${trigPreview}`.slice(0, 100) : undefined,
      value: t.key,
    };
  });
  if (!typeOptions.length) typeOptions.push({ label: 'No types found', value: '__none__' });
  select.addOptions(typeOptions);

  const back = new ButtonBuilder()
    .setCustomId(`chart_browse_back_${sessionId}`)
    .setLabel('Back')
    .setStyle(ButtonStyle.Secondary);

  const cancel = new ButtonBuilder()
    .setCustomId(`chart_browse_cancel_${sessionId}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger);

  return [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(back, cancel)];
}

function buildChartEmbed(chart, variantKey, pageIndex) {
  const variant = (chart?.variants || []).find((v) => v.key === variantKey) || chart?.variants?.[0];
  const pages = Array.isArray(variant?.pages) ? variant.pages : [];
  const total = pages.length || 0;
  const idx = Math.max(0, Math.min(pageIndex, Math.max(0, total - 1)));
  const page = pages[idx];

  const defaultTitle = (`${chart?.category || 'Chart'} ${chart?.title || ''}`.trim() || 'Chart');
  const title = String(page?.title ?? variant?.embed_title ?? defaultTitle);
  const triggers = Array.isArray(chart?.triggers) ? chart.triggers : [];

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(title)
    .setDescription(triggers.length ? `Triggers: ${triggers.map((t) => `\`${t}\``).join(', ')}`.slice(0, 4096) : null)
    .setFooter({ text: total ? `Page ${idx + 1}/${total}` : 'Page 0/0' });

  if (page?.asset_path) {
    const supabase = getSupabase();
    const { data } = supabase.storage.from(getChartsBucket()).getPublicUrl(String(page.asset_path));
    if (data?.publicUrl) embed.setImage(data.publicUrl);
  }

  return embed;
}

function buildNavRow({ ownerId, ts, disabledPrev, disabledNext }) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`chart_show_prev_${ownerId}_${ts}`)
      .setLabel('<')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(Boolean(disabledPrev)),
    new ButtonBuilder()
      .setCustomId(`chart_show_next_${ownerId}_${ts}`)
      .setLabel('>')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(Boolean(disabledNext)),
  );
}

export async function postChartToChannel({ channel, chartKey, variantKey, ownerId }) {
  const chart = await getChart(chartKey);
  if (!chart) throw new Error('Chart not found.');

  const variant = (chart.variants || []).find((v) => v.key === variantKey) || chart.variants?.[0];
  const resolvedVariantKey = variant?.key || 'main';
  const total = Array.isArray(variant?.pages) ? variant.pages.length : 0;
  const ts = Date.now();
  const row = total > 1 ? buildNavRow({ ownerId, ts, disabledPrev: true, disabledNext: false }) : null;

  const sent = await channel.send({
    embeds: [buildChartEmbed(chart, resolvedVariantKey, 0)],
    components: row ? [row] : [],
  });

  showSessions.set(sent.id, { ownerId, typeKey: chart.key, variantKey: resolvedVariantKey, pageIndex: 0, ts });
  setTimeout(() => showSessions.delete(sent.id), 5 * 60_000);
  return sent;
}

export async function maybeHandleChartTriggerMessage(message) {
  const content = String(message.content ?? '').trim();
  if (!content) return false;
  if (content.toLowerCase().startsWith('!editchart')) return false;
  if (content.toLowerCase().startsWith('!chart') || content.toLowerCase().startsWith('!charts')) return false;

  const first = content.split(/\s+/)[0]?.toLowerCase();
  if (!first) return false;

  const key = await findChartKeyByTrigger(first).catch(() => null);
  if (!key) return false;

  const chart = await getChart(key).catch(() => null);
  if (!chart) return false;

  const variants = Array.isArray(chart.variants) ? chart.variants : [];
  if (variants.length <= 1) {
    await postChartToChannel({ channel: message.channel, chartKey: chart.key, variantKey: variants[0]?.key, ownerId: message.author.id });
    return true;
  }

  const sessionId = newSessionId();
  triggerVariantPickSessions.set(sessionId, { ownerId: message.author.id, typeKey: chart.key });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`chart_trigpick_${sessionId}`)
    .setPlaceholder('Select variant...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(variants.slice(0, 25).map((v) => ({ label: String(v.name ?? v.title ?? v.key).slice(0, 100), value: v.key })));

  const cancel = new ButtonBuilder()
    .setCustomId(`chart_trigpick_cancel_${sessionId}`)
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Danger);

  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Select Chart Variant')
    .setDescription(`Type: **${String(chart.title ?? chart.key)}**`);

  await message.channel.send({
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(cancel)],
  });
  return true;
}

export async function handleChartTriggerVariantPickInteraction(interaction) {
  if (!interaction.isStringSelectMenu() && !interaction.isButton()) return false;
  const id = interaction.customId || '';
  if (!id.startsWith('chart_trigpick_')) return false;

  if (interaction.isButton() && id.startsWith('chart_trigpick_cancel_')) {
    const sessionId = id.slice('chart_trigpick_cancel_'.length);
    triggerVariantPickSessions.delete(sessionId);
    await interaction.update({ content: 'Cancelled.', embeds: [], components: [] }).catch(() => {});
    return true;
  }

  if (!interaction.isStringSelectMenu()) return false;

  const sessionId = id.slice('chart_trigpick_'.length);
  const session = triggerVariantPickSessions.get(sessionId);
  if (!session) {
    await interaction.reply({ content: 'Session expired.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (session.ownerId && session.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Not your session.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const variantKey = interaction.values?.[0];
  if (!variantKey) return true;

  try {
    await postChartToChannel({ channel: interaction.channel, chartKey: session.typeKey, variantKey, ownerId: interaction.user.id });
  } catch (e) {
    await interaction.reply({ content: e?.message || 'Failed to post chart.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  triggerVariantPickSessions.delete(sessionId);
  await interaction.update({ content: 'Posted.', embeds: [], components: [] }).catch(() => {});
  return true;
}

export async function maybeHandleChartsBrowseMessage(message) {
  const content = String(message.content ?? '').trim();
  const lower = content.toLowerCase();

  if (lower === '!charts') {
    const embed = await buildDynamicChartsListEmbed();
    await message.channel.send({ embeds: [embed] });
    return true;
  }

  if (!lower.startsWith('!chart')) return false;

  const sessionId = newSessionId();
  browseSessions.set(sessionId, { ownerId: message.author.id, step: 'category', category: null, categoryKey: null, typeKey: null, typeTitle: null });

  const sent = await message.channel.send({
    embeds: [buildBrowseEmbed({ step: 'category' })],
    components: await buildBrowseComponents({ step: 'category' }, sessionId),
  });

  // tie message id to session for easier cleanup (optional)
  browseSessions.get(sessionId).messageId = sent.id;
  return true;
}

export async function startChartBrowseInteraction(interaction, { query = '' } = {}) {
  const sessionId = newSessionId();
  const session = { ownerId: interaction.user.id, step: 'category', category: null, categoryKey: null, typeKey: null, typeTitle: null, categoryQuery: null };

  const q = String(query ?? '').trim();
  if (q) {
    // Token values from autocomplete:
    // - cat:<categoryKey>
    // - type:<typeKey>
    // - trig:!trigger
    const lower = q.toLowerCase();
    if (lower.startsWith('cat:')) {
      const catKey = lower.slice('cat:'.length).trim();
      const categories = await listChartCategories().catch(() => []);
      const picked = categories.find((c) => normalizeCategoryKey(c) === catKey);
      if (picked) {
        session.step = 'type';
        session.category = picked;
        session.categoryKey = normalizeCategoryKey(picked);
      } else {
        session.categoryQuery = q;
      }
    } else if (lower.startsWith('type:')) {
      const typeKey = lower.slice('type:'.length).trim();
      const chart = await getChart(typeKey).catch(() => null);
      if (chart) {
        session.step = 'variant';
        session.category = chart.category;
        session.categoryKey = normalizeCategoryKey(chart.category);
        session.typeKey = chart.key;
        session.typeTitle = chart.title;
      } else {
        session.categoryQuery = q;
      }
    } else if (lower.startsWith('trig:')) {
      const trig = lower.slice('trig:'.length).trim();
      const key = await findChartKeyByTrigger(trig).catch(() => null);
      const chart = key ? await getChart(key).catch(() => null) : null;
      if (chart) {
        session.step = 'variant';
        session.category = chart.category;
        session.categoryKey = normalizeCategoryKey(chart.category);
        session.typeKey = chart.key;
        session.typeTitle = chart.title;
      } else {
        session.categoryQuery = q;
      }
    } else {
      session.categoryQuery = q;
    }
  }
  browseSessions.set(sessionId, session);

  await interaction.reply({
    embeds: [buildBrowseEmbed(session)],
    components: await buildBrowseComponents(session, sessionId),
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleChartsAutocompleteInteraction(interaction) {
  try {
    const focused = interaction.options.getFocused(true);
    if (!focused) return;

    const isChartsCommand = interaction.commandName === 'charts';
    const isChartCommand = interaction.commandName === 'chart';
    if (isChartsCommand && focused.name !== 'query') return;
    if (isChartCommand && focused.name !== 'category' && focused.name !== 'chart') return;

    const raw = String(focused.value ?? '').trim().toLowerCase();
    await loadChartsCache().catch(() => {});

    const { charts } = getChartsCache();
    const chartList = Object.values(charts || {});

    const suggestions = [];
    const push = (name, value) => {
      if (!name || !value) return;
      if (suggestions.length >= 25) return;
      suggestions.push({ name: String(name).slice(0, 100), value: String(value).slice(0, 100) });
    };

    if (isChartsCommand) {
      // /charts query: suggest category/type/trigger tokens
      const categorySeen = new Set();
      for (const c of chartList.map((x) => x.category).filter(Boolean)) {
        const label = String(c);
        const key = normalizeCategoryKey(label);
        if (!key || categorySeen.has(key)) continue;
        categorySeen.add(key);
        if (!raw || label.toLowerCase().includes(raw)) {
          push(`Category: ${label}`, `cat:${key}`);
        }
      }

      for (const chart of chartList) {
        const typeTitle = String(chart.title ?? chart.key);
        const cat = String(chart.category ?? 'general');
        const triggers = Array.isArray(chart.triggers) ? chart.triggers : [];

        if (!raw || typeTitle.toLowerCase().includes(raw) || String(chart.key).toLowerCase().includes(raw)) {
          push(`${cat} — ${typeTitle}`, `type:${chart.key}`);
        }

        for (const t of triggers) {
          const trig = String(t);
          if (!raw || trig.toLowerCase().includes(raw)) {
            push(`Trigger: ${trig} → ${typeTitle}`, `trig:${trig}`);
          }
        }

        if (suggestions.length >= 25) break;
      }

      await interaction.respond(suggestions.slice(0, 25)).catch(() => {});
      return;
    }

    // /chart category/chart autocomplete
    if (focused.name === 'category') {
      const categorySeen = new Set();
      for (const c of chartList.map((x) => x.category).filter(Boolean)) {
        const label = String(c);
        const key = normalizeCategoryKey(label);
        if (!key || categorySeen.has(key)) continue;
        categorySeen.add(key);
        if (!raw || label.toLowerCase().includes(raw)) {
          push(label, key);
        }
      }
      await interaction.respond(suggestions.slice(0, 25)).catch(() => {});
      return;
    }

    // focused.name === 'chart'
    const categoryKey = String(interaction.options.getString('category') ?? '').trim().toLowerCase();
    const eligible = categoryKey
      ? chartList.filter((c) => normalizeCategoryKey(c.category) === categoryKey)
      : chartList;

    // Prefer type matches first.
    for (const chart of eligible) {
      const typeTitle = String(chart.title ?? chart.key);
      if (!raw || typeTitle.toLowerCase().includes(raw) || String(chart.key).toLowerCase().includes(raw)) {
        push(typeTitle, `type:${chart.key}`);
      }
      if (suggestions.length >= 25) break;
    }

    await interaction.respond(suggestions.slice(0, 25)).catch(() => {});
  } catch (err) {
    console.error('charts autocomplete failed:', err);
    await interaction.respond([]).catch(() => {});
  }
}

export async function handleChartsBrowseInteraction(interaction) {
  if (!interaction.isStringSelectMenu() && !interaction.isButton()) return false;
  const id = interaction.customId || '';
  if (!id.startsWith('chart_browse_')) return false;

  const parts = id.split('_'); // chart, browse, action, sessionId
  const action = parts[2];
  const sessionId = parts.slice(3).join('_');
  const session = browseSessions.get(sessionId);
  if (!session) {
    await interaction.reply({ content: 'Chart session expired.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (session.ownerId && session.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Not your chart session.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (interaction.isButton() && action === 'cancel') {
    browseSessions.delete(sessionId);
    await interaction.update({ content: 'Cancelled.', embeds: [], components: [] }).catch(() => {});
    return true;
  }

  if (interaction.isButton() && action === 'back') {
    if (session.step === 'variant') {
      session.step = 'type';
      session.typeKey = null;
      session.typeTitle = null;
    } else {
      session.step = 'category';
      session.category = null;
      session.categoryKey = null;
    }
    browseSessions.set(sessionId, session);
    await interaction.update({
      embeds: [buildBrowseEmbed(session)],
      components: await buildBrowseComponents(session, sessionId),
    });
    return true;
  }

  if (interaction.isStringSelectMenu() && action === 'cat') {
    const value = interaction.values?.[0];
    if (value === '__none__') {
      await interaction.reply({ content: 'No chart categories are configured yet.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }
    const categories = await listChartCategories().catch(() => []);
    const picked = categories.find((c) => normalizeCategoryKey(c) === value);
    if (!picked) {
      await interaction.reply({ content: 'Category not found.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    session.step = 'type';
    session.category = picked;
    session.categoryKey = normalizeCategoryKey(picked);
    session.typeKey = null;
    session.typeTitle = null;
    browseSessions.set(sessionId, session);

    await interaction.update({
      embeds: [buildBrowseEmbed(session)],
      components: await buildBrowseComponents(session, sessionId),
    });
    return true;
  }

  if (interaction.isStringSelectMenu() && action === 'type') {
    const typeKey = interaction.values?.[0];
    if (!typeKey || typeKey === '__none__') return true;

    const chart = await getChart(typeKey).catch(() => null);
    if (!chart) {
      await interaction.reply({ content: 'Chart type not found.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    const variants = Array.isArray(chart.variants) ? chart.variants : [];
    if (variants.length <= 1) {
      try {
        await postChartToChannel({ channel: interaction.channel, chartKey: chart.key, variantKey: variants[0]?.key, ownerId: interaction.user.id });
      } catch (e) {
        await interaction.reply({ content: e?.message || 'Failed to post chart.', flags: MessageFlags.Ephemeral }).catch(() => {});
        return true;
      }

      browseSessions.delete(sessionId);
      await interaction.update({ content: 'Posted.', embeds: [], components: [] }).catch(() => {});
      return true;
    }

    session.step = 'variant';
    session.typeKey = chart.key;
    session.typeTitle = chart.title;
    browseSessions.set(sessionId, session);

    await interaction.update({
      embeds: [buildBrowseEmbed(session)],
      components: await buildBrowseComponents(session, sessionId),
    });
    return true;
  }

  if (interaction.isStringSelectMenu() && action === 'variant') {
    const variantKey = interaction.values?.[0];
    if (!variantKey || variantKey === '__none__') return true;

    try {
      await postChartToChannel({ channel: interaction.channel, chartKey: session.typeKey, variantKey, ownerId: interaction.user.id });
    } catch (e) {
      await interaction.reply({ content: e?.message || 'Failed to post chart.', flags: MessageFlags.Ephemeral }).catch(() => {});
      return true;
    }

    browseSessions.delete(sessionId);
    await interaction.update({ content: 'Posted.', embeds: [], components: [] }).catch(() => {});
    return true;
  }

  return false;
}

export async function handleChartShowInteraction(interaction) {
  if (!interaction.isButton()) return false;
  const id = interaction.customId || '';
  if (!id.startsWith('chart_show_')) return false;

  const parts = id.split('_'); // chart, show, dir, ownerId, ts
  const dir = parts[2];
  const ownerId = parts[3];

  const session = showSessions.get(interaction.message.id);
  if (!session) {
    await interaction.reply({ content: 'Chart session expired.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  if (ownerId && ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'Only the requester can page this chart.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const chart = await getChart(session.typeKey).catch(() => null);
  if (!chart) {
    await interaction.reply({ content: 'Chart not found.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  const variant = (chart.variants || []).find((v) => v.key === session.variantKey) || chart.variants?.[0];
  const pages = Array.isArray(variant?.pages) ? variant.pages : [];
  const total = pages.length;
  if (!total) {
    await interaction.reply({ content: 'No images.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return true;
  }

  session.pageIndex = dir === 'next'
    ? Math.min(total - 1, session.pageIndex + 1)
    : Math.max(0, session.pageIndex - 1);
  showSessions.set(interaction.message.id, session);

  const row = buildNavRow({
    ownerId: session.ownerId,
    ts: session.ts,
    disabledPrev: session.pageIndex === 0,
    disabledNext: session.pageIndex === total - 1,
  });

  await interaction.update({ embeds: [buildChartEmbed(chart, session.variantKey, session.pageIndex)], components: [row] }).catch(() => {});
  return true;
}
