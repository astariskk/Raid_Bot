import { updateChart } from './Supabase/files.js';

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function clampDiscordContent(content) {
  return String(content ?? '').slice(0, 1900);
}

function normalizeTriggerWord(trigger) {
  const t = String(trigger ?? '').trim();
  if (!t) return '';
  return t.startsWith('!') || t.startsWith('/') ? t : `!${t}`;
}

function buildMentionLine(pingUserIds = []) {
  const ids = Array.isArray(pingUserIds) ? pingUserIds.filter(Boolean).map(String) : [];
  return ids.length ? ids.map((id) => `<@${id}>`).join(' ') : '';
}

function sanitizeThreadName(...parts) {
  const name = parts
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .join(' - ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 90);
  return name || 'Chart archive';
}

export function buildGifArchiveContent(row) {
  const triggerword = normalizeTriggerWord(row?.command ?? row?.triggerword ?? '');
  const lines = [triggerword || '(missing triggerword)'];

  if (String(row?.kind ?? '').trim().toLowerCase() === 'text') {
    const mentionLine = buildMentionLine(row?.ping_user_ids);
    const label = String(row?.text_label ?? '').trim();
    const textLine = [mentionLine, label ? `**${label}**` : ''].filter(Boolean).join(' ').trim();
    if (textLine) lines.push(textLine);
  }

  return lines.join('\n');
}

export function buildChartArchiveHeaderContent({ category, title, triggerword }) {
  const trigger = normalizeTriggerWord(triggerword);
  return [
    'Charts',
    `Category: ${String(category ?? 'general').trim() || 'general'}`,
    `Create Thread: ${String(title ?? 'Chart').trim() || 'Chart'}`,
    trigger ? `Triggerword: ${trigger}` : null,
    'within the thread',
  ].filter(Boolean).join('\n');
}

export function buildChartPageArchiveContent({ category, typeTitle, variant, page, pageNumber }) {
  const categoryLine = String(category ?? 'general').trim() || 'general';
  const typeName = String(typeTitle ?? '').trim();
  const variantName = String(variant?.name ?? variant?.title ?? typeName).trim() || typeName || 'Variant';
  const pageTitle = String(page?.title ?? '').trim();
  const variantLine = [typeName || variantName, pageTitle].filter(Boolean).join(' / ') || variantName;

  return [
    `Category: ${categoryLine}`,
    `Variant/Title/description: ${variantLine}`,
    `Page ${Math.max(1, Number(pageNumber) || 1)}`,
  ].join('\n');
}

export function getChartArchiveThreadId(chart) {
  const archiveChannelId = String(chart?.archived_channel_id ?? '').trim();
  const variants = Array.isArray(chart?.variants) ? chart.variants : [];
  for (const variant of variants) {
    for (const page of variant?.pages || []) {
      const pageChannelId = String(page?.archived_channel_id ?? '').trim();
      if (pageChannelId && pageChannelId !== archiveChannelId) return pageChannelId;
    }
  }
  return null;
}

const channelGuildCache = new Map();

function getDiscordToken() {
  const token = env('DISCORD_TOKEN');
  if (!token) throw new Error('DISCORD_TOKEN is not defined.');
  return token;
}

export function getArchiveChannelId(kind) {
  if (kind === 'chart') {
    return env('CHART_ARCHIVE_CHANNEL_ID') || env('MIGRATE_CHART_CHANNEL_ID') || '';
  }
  return env('GIF_ARCHIVE_CHANNEL_ID') || env('MIGRATE_GIF_CHANNEL_ID') || '';
}

export function buildDiscordMessageUrl({ guildId, channelId, messageId }) {
  const gid = String(guildId ?? '').trim() || '@me';
  return `https://discord.com/channels/${gid}/${channelId}/${messageId}`;
}

export function parseDiscordMessageUrl(value) {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^https?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/channels\/([^/]+)\/([^/]+)\/([^/?#]+)(?:[/?#].*)?$/i);
  if (!match) return null;
  return {
    guildId: match[1],
    channelId: match[2],
    messageId: match[3],
  };
}

async function discordRequestWithRetry(url, options, attempt = 0) {
  const response = await fetch(url, options);
  if (response.status !== 429) return response;

  const body = await response.json().catch(() => ({}));
  const retryAfterMs = Math.ceil(Number(body.retry_after ?? 1) * 1000) + 250;
  if (attempt > 4) return response;
  await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  return discordRequestWithRetry(url, options, attempt + 1);
}

async function fetchDiscordChannelGuildId(channelId) {
  if (channelGuildCache.has(channelId)) return channelGuildCache.get(channelId);

  const token = getDiscordToken();
  const response = await discordRequestWithRetry(`https://discord.com/api/v10/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!response.ok) return null;
  const body = await response.json().catch(() => ({}));
  const guildId = String(body.guild_id ?? '').trim() || null;
  channelGuildCache.set(channelId, guildId);
  return guildId;
}

export async function createDiscordTextMessage(channelId, content) {
  if (!channelId) throw new Error('channelId is required.');
  const token = getDiscordToken();
  const response = await discordRequestWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: clampDiscordContent(content) }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Failed to create Discord message in ${channelId}: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  }

  const guildId = await fetchDiscordChannelGuildId(channelId);
  return {
    channelId,
    guildId,
    messageId: body.id,
    messageUrl: buildDiscordMessageUrl({ guildId, channelId, messageId: body.id }),
  };
}

export async function createThreadFromMessage(channelId, messageId, name) {
  if (!channelId || !messageId) throw new Error('channelId and messageId are required.');
  const token = getDiscordToken();
  const response = await discordRequestWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: sanitizeThreadName(name),
      auto_archive_duration: 10080,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Failed to create thread for ${channelId}/${messageId}: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body;
}

export async function ensureChartArchiveThread(chart) {
  const existingThreadId = getChartArchiveThreadId(chart);
  if (existingThreadId) return existingThreadId;

  const channelId = getArchiveChannelId('chart');
  if (!channelId) {
    throw new Error('No chart archive channel configured. Set CHART_ARCHIVE_CHANNEL_ID or MIGRATE_CHART_CHANNEL_ID.');
  }

  const triggers = Array.isArray(chart?.triggers) ? chart.triggers : [];
  const headerContent = buildChartArchiveHeaderContent({
    category: chart?.category,
    title: chart?.title ?? chart?.key,
    triggerword: triggers[0] || chart?.key,
  });

  const headerMessage = await createDiscordTextMessage(channelId, headerContent);
  const thread = await createThreadFromMessage(
    channelId,
    headerMessage.messageId,
    sanitizeThreadName(chart?.category, chart?.title ?? chart?.key),
  );

  await updateChart(chart.key, {
    archived_message_url: headerMessage.messageUrl,
    archived_message_id: headerMessage.messageId,
    archived_channel_id: channelId,
  });

  return thread.id;
}

export async function uploadAttachmentToArchive({
  kind,
  attachment,
  fileName,
  message,
  channelId: targetChannelId = null,
}) {
  const channelId = targetChannelId || getArchiveChannelId(kind);
  if (!channelId) {
    throw new Error(`No archive channel configured for ${kind} media. Set ${kind === 'chart' ? 'CHART_ARCHIVE_CHANNEL_ID' : 'GIF_ARCHIVE_CHANNEL_ID'} or the matching MIGRATE_* env var.`);
  }

  const token = getDiscordToken();
  const sourceUrl = String(attachment?.url ?? attachment ?? '').trim();
  if (!sourceUrl) throw new Error('Attachment URL is missing.');

  const sourceResponse = await fetch(sourceUrl);
  if (!sourceResponse.ok) {
    const body = await sourceResponse.text().catch(() => '');
    throw new Error(`Failed to download attachment ${sourceUrl}: ${sourceResponse.status} ${body.slice(0, 200)}`);
  }

  const bytes = Buffer.from(await sourceResponse.arrayBuffer());
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: clampDiscordContent(message) }));
  form.append('files[0]', new Blob([bytes], { type: attachment?.contentType || sourceResponse.headers.get('content-type') || 'application/octet-stream' }), fileName);

  const response = await discordRequestWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}` },
    body: form,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Discord upload failed for ${fileName}: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  }

  const attachmentUrl = body?.attachments?.[0]?.url || body?.attachments?.[0]?.proxy_url || null;
  if (!attachmentUrl) {
    throw new Error(`Discord upload did not return an attachment URL for ${fileName}.`);
  }

  const guildId = await fetchDiscordChannelGuildId(channelId);
  return {
    channelId,
    guildId,
    messageId: body.id,
    messageUrl: buildDiscordMessageUrl({ guildId, channelId, messageId: body.id }),
    attachmentUrl,
  };
}

export async function fetchDiscordMessageAttachmentUrl({ channelId, messageId }) {
  const token = getDiscordToken();
  const response = await discordRequestWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Failed to fetch Discord message ${channelId}/${messageId}: ${response.status} ${body.slice(0, 200)}`);
  }
  const body = await response.json().catch(() => ({}));
  return body?.attachments?.[0]?.url || body?.attachments?.[0]?.proxy_url || null;
}

export async function resolveDiscordMediaReference({ attachmentUrl, messageUrl, channelId, messageId }) {
  if (attachmentUrl && /^https?:\/\//i.test(String(attachmentUrl))) return String(attachmentUrl).trim();
  const parsed = messageUrl ? parseDiscordMessageUrl(messageUrl) : null;
  const nextChannelId = channelId || parsed?.channelId;
  const nextMessageId = messageId || parsed?.messageId;
  if (!nextChannelId || !nextMessageId) return null;
  return fetchDiscordMessageAttachmentUrl({ channelId: nextChannelId, messageId: nextMessageId });
}

export async function uploadGifToArchive({ row, attachment, fileName }) {
  const message = buildGifArchiveContent(row);
  return uploadAttachmentToArchive({
    kind: 'gif',
    attachment,
    fileName,
    message,
  });
}

export async function uploadChartPageToArchive({ chart, variant, page, pageNumber, attachment, fileName }) {
  const threadId = await ensureChartArchiveThread(chart);
  const message = buildChartPageArchiveContent({
    category: chart?.category,
    typeTitle: chart?.title,
    variant,
    page,
    pageNumber,
  });

  return uploadAttachmentToArchive({
    kind: 'chart',
    attachment,
    fileName,
    message,
    channelId: threadId,
  });
}
