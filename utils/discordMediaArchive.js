function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
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

export async function uploadAttachmentToArchive({
  kind,
  attachment,
  fileName,
  message,
}) {
  const channelId = getArchiveChannelId(kind);
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
  form.append('payload_json', JSON.stringify({ content: String(message ?? '').slice(0, 1900) }));
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
