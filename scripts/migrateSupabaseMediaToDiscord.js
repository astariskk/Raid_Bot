import 'dotenv/config';
import {
  supabaseDownloadObject,
  supabaseSelect,
  supabaseUpsert,
} from '../utils/Supabase/client.js';
import {
  fetchDiscordMessageAttachmentUrl,
  buildDiscordMessageUrl,
  parseDiscordMessageUrl,
} from '../utils/discordMediaArchive.js';

const DEFAULT_BACKUP_GUILD_ID = '953464422377087046';
const DEFAULT_GIF_CHANNEL_ID = '1509062194212503603';
const DEFAULT_CHART_CHANNEL_ID = '1509062095239385169';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SKIP_MEDIA = args.has('--skip-media');

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function getSupabaseBucketNames() {
  const gifBucket = env('SUPABASE_GIF_BUCKET') || 'images-storage';
  const chartsBucket = env('SUPABASE_CHARTS_BUCKET') || gifBucket;
  return { gifBucket, chartsBucket };
}

function requireMediaEnv() {
  if (SKIP_MEDIA || DRY_RUN) return;
  const token = env('DISCORD_TOKEN');
  if (!token || token === 'your_discord_bot_token') {
    throw new Error('A real DISCORD_TOKEN is required to upload media to Discord.');
  }
  getSupabaseBucketNames();
}

function fileNameFromPath(objectPath) {
  const name = String(objectPath ?? '').split('/').filter(Boolean).pop() || 'asset';
  return name.replace(/[^\w.\-()[\] ]/g, '_').slice(0, 120) || 'asset';
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
}

function extractFirstUrl(value) {
  const raw = String(value ?? '');
  const markdownMatch = raw.match(/\[[^\]]*]\((https?:\/\/[^)\s]+)\)/i);
  if (markdownMatch) return markdownMatch[1];
  const plainMatch = raw.match(/https?:\/\/[^\s>)]+/i);
  return plainMatch ? plainMatch[0] : null;
}

function replaceFirstUrl(value, nextUrl) {
  if (!value || !nextUrl) return value;
  const currentUrl = extractFirstUrl(value);
  if (!currentUrl) return value;
  return String(value).replace(currentUrl, nextUrl);
}

function stripMarkdownMediaLinks(value) {
  return String(value ?? '')
    .replace(/\[([^\]]+)]\(https?:\/\/[^)\s]+\)/gi, '$1')
    .replace(/https?:\/\/[^\s>)]+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sameMediaSource(left, right) {
  const a = String(left ?? '').trim();
  const b = String(right ?? '').trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (isHttpUrl(a) && isHttpUrl(b)) {
    const stripQuery = (value) => value.replace(/[?#].*$/, '');
    return stripQuery(a) === stripQuery(b);
  }
  return false;
}

function buildMentionLine(pingUserIds = []) {
  const ids = Array.isArray(pingUserIds) ? pingUserIds.filter(Boolean).map(String) : [];
  return ids.length ? ids.map((id) => `<@${id}>`).join(' ') : '';
}

function compactText(...parts) {
  return parts
    .flatMap((part) => String(part ?? '').split(/\r?\n+/g))
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' ');
}

// Per your requirement:
// GIF backup message should include:
// triggerword
// (Mention if any) + (**TEXT**)
// downloaded Media file
function buildGifArchiveContent(row, downloadedFileName = '') {
  const triggerword = String(row.command ?? '').trim();
  const mentionLine = buildMentionLine(row.ping_user_ids);

  const textLine = compactText(
    mentionLine,
    stripMarkdownMediaLinks(row.text_content),
    row.text_label ? String(row.text_label ?? '').trim() : null,
  );

  const mediaFileLine = downloadedFileName
    ? `downloaded Media file: ${downloadedFileName}`
    : 'downloaded Media file: (unknown)';

  const lines = [
    triggerword || '(missing triggerword)',
    textLine || '(no message)',
    mediaFileLine,
  ].filter(Boolean);

  return lines.join('\n');
}

// Per your requirement for chart backup messages:
// triggerword
// Category
// Variant/Title/description
// Media File
function buildChartThreadArchiveContent(row, variant, page, downloadedFileName = '') {
  const triggerword = String(row.command ?? row.triggerword ?? '').trim();
  const category = String(row.category ?? 'general').trim() || 'general';
  const variantName = String(variant?.name ?? variant?.title ?? '').trim() || String(row.key ?? 'Chart').trim();

  const titleOrDescription = [
    page?.title,
    page?.description,
  ].filter(Boolean).join(' - ');

  const variantLine = [
    variantName,
    titleOrDescription,
  ].filter(Boolean).join(' / ');

  const mediaFileLine = downloadedFileName
    ? `Media File: ${downloadedFileName}`
    : 'Media File: (unknown)';

  // Keep also the thread structure labels requested.
  // This content is for the message created inside the archive thread header.
  return [
    triggerword || '(missing triggerword)',
    `Category: ${category}`,
    `Variant/Title/description: ${variantLine || '(missing variant/title/description)'}`,
    mediaFileLine,
  ].join('\n');
}

async function editDiscordMessage(channelId, messageId, content) {
  if (DRY_RUN || SKIP_MEDIA) {
    console.log(`[message:${DRY_RUN ? 'dry' : 'skip'}] edit ${channelId}/${messageId}`);
    return null;
  }
  const token = env('DISCORD_TOKEN');
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Failed to edit Discord message ${channelId}/${messageId}: ${response.status} ${detail.slice(0, 200)}`);
  }
  return response.json().catch(() => null);
}

async function validateDiscordChannel(channelId, expectedGuildId, label) {
  if (!expectedGuildId || DRY_RUN || SKIP_MEDIA) return;
  const token = env('DISCORD_TOKEN');
  const response = await fetch(`https://discord.com/api/v10/channels/${channelId}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Could not access ${label} channel ${channelId}: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  }
  if (String(body.guild_id ?? '') !== String(expectedGuildId)) {
    throw new Error(`${label} channel ${channelId} is in guild ${body.guild_id}, not expected backup guild ${expectedGuildId}.`);
  }
}

const mediaCache = new Map();

async function discordRequestWithRetry(url, options, attempt = 0) {
  const response = await fetch(url, options);
  if (response.status !== 429) return response;

  const body = await response.json().catch(() => ({}));
  const retryAfterMs = Math.ceil(Number(body.retry_after ?? 1) * 1000) + 250;
  if (attempt > 4) return response;
  await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  return discordRequestWithRetry(url, options, attempt + 1);
}

function getDiscordToken() {
  const token = env('DISCORD_TOKEN');
  if (!token || token === 'your_discord_bot_token') throw new Error('A real DISCORD_TOKEN is required.');
  return token;
}

function clampDiscordContent(content) {
  return String(content ?? '').slice(0, 1900);
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

async function createDiscordMessage(channelId, content) {
  if (DRY_RUN || SKIP_MEDIA) {
    console.log(`[message:${DRY_RUN ? 'dry' : 'skip'}] create ${channelId}: ${String(content ?? '').split(/\r?\n/)[0]}`);
    return { channelId, messageId: null, messageUrl: null };
  }

  const response = await discordRequestWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${getDiscordToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: clampDiscordContent(content) }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Failed to create Discord message in ${channelId}: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  }

  const guildId = body.guild_id || env('MIGRATE_BACKUP_GUILD_ID', DEFAULT_BACKUP_GUILD_ID);
  return {
    channelId,
    messageId: body.id,
    messageUrl: buildDiscordMessageUrl({ guildId, channelId, messageId: body.id }),
  };
}

async function createThreadFromMessage(channelId, messageId, name) {
  if (DRY_RUN || SKIP_MEDIA) {
    console.log(`[thread:${DRY_RUN ? 'dry' : 'skip'}] create ${channelId}/${messageId}: ${name}`);
    return { id: `dry-thread-${channelId}`, name };
  }

  const response = await discordRequestWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/threads`, {
    method: 'POST',
    headers: {
      Authorization: `Bot ${getDiscordToken()}`,
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

async function uploadDownloadedAssetToDiscord({ channelId, guildId, asset, fileName, message }) {
  if (DRY_RUN || SKIP_MEDIA) {
    console.log(`[media:${DRY_RUN ? 'dry' : 'skip'}] upload ${fileName} -> ${channelId}`);
    return { guildId, messageId: null, messageUrl: null, attachmentUrl: null };
  }

  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: clampDiscordContent(message) }));
  form.append('files[0]', new Blob([asset.bytes], { type: asset.contentType || 'application/octet-stream' }), fileName);

  const response = await discordRequestWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${getDiscordToken()}` },
    body: form,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Discord upload failed for ${fileName}: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  }

  const attachmentUrl = body?.attachments?.[0]?.url || body?.attachments?.[0]?.proxy_url || null;
  if (!attachmentUrl) throw new Error(`Discord upload did not return an attachment URL for ${fileName}.`);

  const resolvedGuildId = guildId || body.guild_id || env('MIGRATE_BACKUP_GUILD_ID', DEFAULT_BACKUP_GUILD_ID);
  return {
    channelId,
    guildId: resolvedGuildId,
    messageId: body.id,
    messageUrl: buildDiscordMessageUrl({ guildId: resolvedGuildId, channelId, messageId: body.id }),
    attachmentUrl,
  };
}

async function downloadSourceAsset(sourcePath, bucket) {
  const raw = String(sourcePath ?? '').trim();
  if (!raw) throw new Error('sourcePath is required');

  if (/^https?:\/\//i.test(raw)) {
    const parsed = parseDiscordMessageUrl(raw);
    const mediaUrl = parsed
      ? await fetchDiscordMessageAttachmentUrl({ channelId: parsed.channelId, messageId: parsed.messageId })
      : raw;

    const response = await fetch(mediaUrl);
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Failed to download remote asset ${mediaUrl}: ${response.status} ${detail.slice(0, 200)}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return {
      bytes: Buffer.from(arrayBuffer),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      sourceKind: parsed ? 'discord-message' : 'discord-cdn',
      sourceUrl: mediaUrl,
    };
  }

  const asset = await supabaseDownloadObject(bucket, raw);
  return {
    ...asset,
    sourceKind: 'supabase-object',
    sourceUrl: raw,
  };
}

async function migrateMediaPath({ sourcePath, bucket, kind, content, channelId, guildId }) {
  if (!sourcePath) return null;
  const targetChannelId = channelId || (kind === 'chart'
    ? env('MIGRATE_CHART_CHANNEL_ID', DEFAULT_CHART_CHANNEL_ID)
    : env('MIGRATE_GIF_CHANNEL_ID', DEFAULT_GIF_CHANNEL_ID));

  const cacheKey = `${kind}:${targetChannelId}:${sourcePath}`;
  if (mediaCache.has(cacheKey)) return mediaCache.get(cacheKey);

  if (DRY_RUN || SKIP_MEDIA) {
    console.log(`[media:${DRY_RUN ? 'dry' : 'skip'}] ${cacheKey}`);
    return { asset_path: sourcePath, image_path: sourcePath, attachment_url: sourcePath, message_url: null, message_id: null };
  }

  const asset = await downloadSourceAsset(sourcePath, bucket);
  let upload;
  try {
    upload = await uploadDownloadedAssetToDiscord({
      channelId: targetChannelId,
      guildId,
      asset,
      fileName: fileNameFromPath(sourcePath),
      message: content,
    });
  } catch (error) {
    throw error;
  }

  const mediaRef = {
    asset_path: upload.attachmentUrl,
    image_path: upload.attachmentUrl,
    attachment_url: upload.attachmentUrl,
    message_url: upload.messageUrl,
    message_id: upload.messageId,
  };

  mediaCache.set(cacheKey, mediaRef);
  console.log(`[media] ${cacheKey} -> ${upload.messageUrl}`);
  return mediaRef;
}

function walkChartPages(row) {
  const variants = Array.isArray(row.variants) && row.variants.length
    ? row.variants
    : [{ key: 'main', name: row.title || row.key, embed_title: null, pages: Array.isArray(row.pages) ? row.pages : [] }];
  return variants;
}

async function migrateGifRow(row, channelId) {
  const assetPath = row.asset_path || row.image_path || row.attachment_url || row.message_url || extractFirstUrl(row.text_content) || null;
  const archiveSource = row.attachment_url || row.asset_path || row.image_path || null;
  const downloadedFileName = assetPath ? fileNameFromPath(assetPath) : '';
  const archiveContent = buildGifArchiveContent(row, downloadedFileName);

  if (
    String(row.channel_id ?? '') === String(channelId)
    && row.message_id
    && row.message_url
    && sameMediaSource(assetPath, archiveSource)
  ) {
    await editDiscordMessage(row.channel_id, row.message_id, archiveContent);
    return;
  }

  const result = await migrateMediaPath({
    sourcePath: assetPath,
    bucket: getSupabaseBucketNames().gifBucket,
    kind: 'gif',
    content: archiveContent,
    channelId,
    guildId: env('MIGRATE_BACKUP_GUILD_ID', DEFAULT_BACKUP_GUILD_ID),
  });
  
  if (result && row.command && !DRY_RUN && !SKIP_MEDIA) {
    await supabaseUpsert('gif_table', {
      command: String(row.command ?? '').trim().toLowerCase(),
      kind: row.kind ?? 'gif',
      title: row.title ?? null,
      footer: row.footer ?? null,

      attachment_url: result.attachment_url,
      image_path: result.attachment_url,

      ping_user_ids: row.ping_user_ids ?? null,
      text_label: row.text_label ?? null,
      text_description: row.text_description ?? null,
      text_content: row.text_content ?? null,

      color: row.color ?? null,
      enabled: row.enabled ?? true,

      archived_message_url: result.messageUrl,
      archived_message_id: result.messageId,
      archived_channel_id: channelId,
    }, { onConflict: 'command' });
  }
}

async function migrateChartRow(row, channelId) {
  const { chartsBucket } = getSupabaseBucketNames();
  const next = JSON.parse(JSON.stringify(row));
  next.variants = walkChartPages(next);

  const guildId = env('MIGRATE_BACKUP_GUILD_ID', DEFAULT_BACKUP_GUILD_ID);
  let thread = null;

  for (const variant of next.variants) {
    const pages = Array.isArray(variant.pages) ? variant.pages : [];

    for (const page of pages) {
      const assetPath = page?.asset_path
        || page?.attachment_url
        || page?.image_path
        || page?.message_url
        || page?.image
        || page?.url
        || extractFirstUrl(page?.text_content)
        || extractFirstUrl(page?.description)
        || null;

      const archiveSource = page?.attachment_url || page?.asset_path || page?.image_path || null;
      const downloadedFileName = assetPath ? fileNameFromPath(assetPath) : '';
      const archiveContent = buildChartThreadArchiveContent(row, variant, page, downloadedFileName);

      if (
        page.channel_id
        && page.message_id
        && page.message_url
        && sameMediaSource(assetPath, archiveSource)
      ) {
        await editDiscordMessage(page.channel_id, page.message_id, archiveContent);
        continue;
      }

      const sourcePath = assetPath;
      if (!sourcePath) continue;

      if (!thread) {
        const headerMessage = await createDiscordMessage(channelId, [
          `Charts`,
          `Category: ${String(row.category ?? 'general').trim() || 'general'}`,
          `Create Thread: ${String(row.title ?? row.key ?? 'Chart').trim() || 'Chart'}`,
          `within the thread`,
        ].join('\n'));

        thread = await createThreadFromMessage(
          channelId,
          headerMessage.messageId,
          sanitizeThreadName(row.category, row.title || row.key),
        );
      }

      await migrateMediaPath({
        sourcePath,
        bucket: chartsBucket,
        kind: 'chart',
        content: archiveContent,
        channelId: thread.id,
        guildId,
      });
    }
  }

  // No DB overwrite/update in archive migration mode.
  return next;
}

async function main() {
  // This script migrates legacy `gif_commands` / `charts` entries into:
  // - public.gif_table
  // - public.charts_table

  requireMediaEnv();

  const mainGuildId = env('GUILD_ID');
  const backupGuildId = env('MIGRATE_BACKUP_GUILD_ID', DEFAULT_BACKUP_GUILD_ID);
  const gifChannelId = env('GIF_ARCHIVE_CHANNEL_ID', env('MIGRATE_GIF_CHANNEL_ID', DEFAULT_GIF_CHANNEL_ID));

  console.log(`Main guild: ${mainGuildId || '(not set)'}`);
  console.log(`Archive guild: ${backupGuildId || '(not checked)'}`);
  console.log(`GIF archive channel: ${gifChannelId}`);
  if (DRY_RUN) console.log('Dry run enabled: no Discord uploads or Supabase writes.');
  if (SKIP_MEDIA) console.log('Media migration skipped: asset paths will be preserved.');

  await validateDiscordChannel(gifChannelId, backupGuildId, 'GIF archive');

  const gifRows = await supabaseSelect('gif_commands', { select: '*' });


  let gifUpdated = 0;
  for (const row of gifRows ?? []) {
    await migrateGifRow(row, gifChannelId);
    gifUpdated += 1;
  }

  console.log(`Migration complete. Processed ${gifUpdated} gif/text rows.`);
}



main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

