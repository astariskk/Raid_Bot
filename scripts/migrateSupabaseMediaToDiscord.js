import 'dotenv/config';
import {
  supabaseDownloadObject,
  supabaseSelect,
  supabaseUpsert,
} from '../utils/Supabase/client.js';
import {
  fetchDiscordMessageAttachmentUrl,
  parseDiscordMessageUrl,
  uploadAttachmentToArchive,
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
  if (!token || token === 'your_discord_bot_token') throw new Error('A real DISCORD_TOKEN is required to upload media to Discord.');
  getSupabaseBucketNames();
}

function fileNameFromPath(objectPath) {
  const name = String(objectPath ?? '').split('/').filter(Boolean).pop() || 'asset';
  return name.replace(/[^\w.\-()[\] ]/g, '_').slice(0, 120) || 'asset';
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? '').trim());
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

function buildGifArchiveContent(row) {
  const triggerword = String(row.command ?? '').trim();
  const mentionLine = buildMentionLine(row.ping_user_ids);
  const body = compactText(
    row.text_content,
    row.text_label ? [row.text_label, row.text_description].filter(Boolean).join(': ') : '',
    row.text_description,
    row.title,
    row.footer,
  );

  const lines = [triggerword || '!gif'];
  const secondLine = compactText(mentionLine, body);
  if (secondLine) lines.push(secondLine);
  return lines.join('\n');
}

function buildChartArchiveContent(row, variant, page) {
  const triggerword = String(row.key ?? '').trim();
  const variantName = String(variant?.name ?? variant?.title ?? '').trim();
  const pageBody = compactText(
    page?.text_content,
    page?.caption,
    page?.description,
    page?.text_label,
    page?.title,
    row.title,
    row.category,
    variantName,
  );

  const lines = [triggerword || '!chart'];
  if (pageBody) lines.push(pageBody);
  return lines.join('\n');
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

async function migrateMediaPath({ sourcePath, bucket, kind, content }) {
  if (!sourcePath) return null;
  const cacheKey = `${kind}:${sourcePath}`;
  if (mediaCache.has(cacheKey)) return mediaCache.get(cacheKey);

  if (DRY_RUN || SKIP_MEDIA) {
    console.log(`[media:${DRY_RUN ? 'dry' : 'skip'}] ${cacheKey}`);
    return {
      asset_path: sourcePath,
      image_path: sourcePath,
      attachment_url: sourcePath,
      message_url: null,
      message_id: null,
      channel_id: null,
    };
  }

  const asset = await downloadSourceAsset(sourcePath, bucket);
  const upload = await uploadAttachmentToArchive({
    kind,
    attachment: {
      url: `data:${asset.contentType};base64,${asset.bytes.toString('base64')}`,
      contentType: asset.contentType,
    },
    fileName: fileNameFromPath(sourcePath),
    message: content,
  });

  const mediaRef = {
    asset_path: upload.attachmentUrl,
    image_path: upload.attachmentUrl,
    attachment_url: upload.attachmentUrl,
    message_url: upload.messageUrl,
    message_id: upload.messageId,
    channel_id: upload.channelId,
  };
  mediaCache.set(cacheKey, mediaRef);
  console.log(`[media] ${cacheKey} -> ${upload.messageUrl}`);
  return mediaRef;
}

async function syncExistingArchiveMessage({ channelId, messageId, content }) {
  if (!channelId || !messageId) return null;
  await editDiscordMessage(channelId, messageId, content);
  return {
    channel_id: channelId,
    message_id: messageId,
    message_url: `https://discord.com/channels/${env('GUILD_ID') || DEFAULT_BACKUP_GUILD_ID}/${channelId}/${messageId}`,
  };
}

function normalizeGifRowForUpdate(row, mediaRef) {
  const attachmentUrl = typeof mediaRef === 'string' ? mediaRef : mediaRef?.attachment_url ?? null;
  return {
    ...row,
    image_path: attachmentUrl,
    asset_path: attachmentUrl,
    attachment_url: attachmentUrl,
    message_url: typeof mediaRef === 'string' ? row.message_url ?? null : mediaRef?.message_url ?? null,
    message_id: typeof mediaRef === 'string' ? row.message_id ?? null : mediaRef?.message_id ?? null,
    channel_id: typeof mediaRef === 'string' ? row.channel_id ?? null : mediaRef?.channel_id ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function migrateGifRow(row, channelId) {
  const assetPath = row.asset_path || row.image_path || row.attachment_url || row.message_url || null;
  const archiveSource = row.attachment_url || row.asset_path || row.image_path || null;
  const archiveContent = buildGifArchiveContent(row);

  if (
    String(row.channel_id ?? '') === String(channelId)
    && row.message_id
    && row.message_url
    && sameMediaSource(assetPath, archiveSource)
  ) {
    await editDiscordMessage(row.channel_id, row.message_id, archiveContent);
    const next = normalizeGifRowForUpdate(row, {
      attachment_url: row.attachment_url || archiveSource,
      message_url: row.message_url,
      message_id: row.message_id,
      channel_id: row.channel_id,
    });
    if (DRY_RUN) return next;
    await supabaseUpsert('gif_commands', next, { onConflict: 'command' });
    return next;
  }

  const mediaRef = await migrateMediaPath({
    sourcePath: assetPath,
    bucket: getSupabaseBucketNames().gifBucket,
    kind: 'gif',
    content: archiveContent,
  });

  const next = normalizeGifRowForUpdate(row, mediaRef);
  if (DRY_RUN) return next;
  await supabaseUpsert('gif_commands', next, { onConflict: 'command' });
  return next;
}

function walkChartPages(row) {
  const variants = Array.isArray(row.variants) && row.variants.length
    ? row.variants
    : [{ key: 'main', name: row.title || row.key, embed_title: null, pages: Array.isArray(row.pages) ? row.pages : [] }];

  return variants;
}

async function migrateChartRow(row, channelId) {
  const { chartsBucket } = getSupabaseBucketNames();
  const next = JSON.parse(JSON.stringify(row));
  next.variants = walkChartPages(next);

  for (const variant of next.variants) {
    const pages = Array.isArray(variant.pages) ? variant.pages : [];
    for (const page of pages) {
      const archiveContent = buildChartArchiveContent(row, variant, page);
      const assetPath = page?.asset_path || page?.attachment_url || page?.image_path || page?.message_url || null;
      const archiveSource = page?.attachment_url || page?.asset_path || page?.image_path || null;

      if (
        String(page.channel_id ?? '') === String(channelId)
        && page.message_id
        && page.message_url
        && sameMediaSource(assetPath, archiveSource)
      ) {
        await editDiscordMessage(page.channel_id, page.message_id, archiveContent);
        page.asset_path = archiveSource || page.asset_path || null;
        page.image_path = archiveSource || page.image_path || null;
        page.attachment_url = archiveSource || page.attachment_url || null;
        continue;
      }

      const sourcePath = assetPath;
      if (!sourcePath) continue;
      const mediaRef = await migrateMediaPath({
        sourcePath,
        bucket: chartsBucket,
        kind: 'chart',
        content: archiveContent,
      });
      const attachmentUrl = typeof mediaRef === 'string' ? mediaRef : mediaRef?.attachment_url ?? null;
      page.asset_path = attachmentUrl;
      page.image_path = attachmentUrl;
      page.attachment_url = attachmentUrl;
      page.message_url = typeof mediaRef === 'string' ? page.message_url ?? null : mediaRef?.message_url ?? null;
      page.message_id = typeof mediaRef === 'string' ? page.message_id ?? null : mediaRef?.message_id ?? null;
      page.channel_id = typeof mediaRef === 'string' ? page.channel_id ?? null : mediaRef?.channel_id ?? null;
    }
  }

  next.updated_at = new Date().toISOString();
  if (DRY_RUN) return next;
  await supabaseUpsert('charts', next, { onConflict: 'key' });
  return next;
}

async function main() {
  requireMediaEnv();

  const mainGuildId = env('GUILD_ID');
  const backupGuildId = env('MIGRATE_BACKUP_GUILD_ID', DEFAULT_BACKUP_GUILD_ID);
  const gifChannelId = env('GIF_ARCHIVE_CHANNEL_ID', env('MIGRATE_GIF_CHANNEL_ID', DEFAULT_GIF_CHANNEL_ID));
  const chartChannelId = env('CHART_ARCHIVE_CHANNEL_ID', env('MIGRATE_CHART_CHANNEL_ID', DEFAULT_CHART_CHANNEL_ID));

  console.log(`Main guild: ${mainGuildId || '(not set)'}`);
  console.log(`Archive guild: ${backupGuildId || '(not checked)'}`);
  console.log(`GIF archive channel: ${gifChannelId}`);
  console.log(`Chart archive channel: ${chartChannelId}`);
  if (DRY_RUN) console.log('Dry run enabled: no Discord uploads or Supabase writes.');
  if (SKIP_MEDIA) console.log('Media migration skipped: asset paths will be preserved.');

  await validateDiscordChannel(gifChannelId, backupGuildId, 'GIF archive');
  await validateDiscordChannel(chartChannelId, backupGuildId, 'Chart archive');

  const [gifRows, chartRows] = await Promise.all([
    supabaseSelect('gif_commands', { select: '*' }),
    supabaseSelect('charts', { select: '*' }),
  ]);

  let gifUpdated = 0;
  for (const row of gifRows ?? []) {
    await migrateGifRow(row, gifChannelId);
    gifUpdated += 1;
  }

  let chartUpdated = 0;
  for (const row of chartRows ?? []) {
    await migrateChartRow(row, chartChannelId);
    chartUpdated += 1;
  }

  console.log(`Migration complete. Processed ${gifUpdated} gif/text rows and ${chartUpdated} chart rows.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
