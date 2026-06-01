import 'dotenv/config';
import { Blob } from 'buffer';
import {
  supabaseDownloadObject,
  supabaseSelect,
  supabaseUpsert,
  supabaseStorageObjectUrl,
} from '../utils/Supabase/client.js';

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

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? ''));
}

function fileNameFromPath(objectPath) {
  const name = String(objectPath ?? '').split('/').filter(Boolean).pop() || 'asset';
  return name.replace(/[^\w.\-()[\] ]/g, '_').slice(0, 120) || 'asset';
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

async function validateDiscordChannel(channelId, expectedGuildId, label) {
  if (!expectedGuildId || DRY_RUN || SKIP_MEDIA) return;

  const token = env('DISCORD_TOKEN');
  const response = await discordRequestWithRetry(`https://discord.com/api/v10/channels/${channelId}`, {
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

async function uploadToDiscordChannel(channelId, { bytes, contentType, fileName, message }) {
  const token = env('DISCORD_TOKEN');
  const form = new FormData();
  form.append('payload_json', JSON.stringify({ content: message.slice(0, 1900) }));
  form.append('files[0]', new Blob([bytes], { type: contentType }), fileName);

  const response = await discordRequestWithRetry(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}` },
    body: form,
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Discord upload failed for ${fileName}: ${response.status} ${JSON.stringify(body).slice(0, 300)}`);
  }

  const attachmentUrl = body?.attachments?.[0]?.url || body?.attachments?.[0]?.proxy_url;
  if (!attachmentUrl) throw new Error(`Discord upload did not return an attachment URL for ${fileName}.`);
  return { attachmentUrl, messageId: body.id };
}

const mediaCache = new Map();

async function migrateMediaPath({ sourcePath, bucket, channelId, label }) {
  if (!sourcePath || isHttpUrl(sourcePath)) return sourcePath || null;
  const cacheKey = `${bucket}/${sourcePath}`;
  if (mediaCache.has(cacheKey)) return mediaCache.get(cacheKey);

  if (DRY_RUN || SKIP_MEDIA) {
    console.log(`[media:${DRY_RUN ? 'dry' : 'skip'}] ${cacheKey} -> ${channelId}`);
    return sourcePath;
  }

  const asset = await supabaseDownloadObject(bucket, sourcePath);
  const upload = await uploadToDiscordChannel(channelId, {
    ...asset,
    fileName: fileNameFromPath(sourcePath),
    message: `${label}\nSource: ${sourcePath}`,
  });

  mediaCache.set(cacheKey, upload.attachmentUrl);
  console.log(`[media] ${cacheKey} -> ${upload.attachmentUrl}`);
  return upload.attachmentUrl;
}

function normalizeGifRowForUpdate(row, assetPath) {
  return {
    ...row,
    image_path: assetPath,
    asset_path: assetPath,
    updated_at: new Date().toISOString(),
  };
}

async function migrateGifRow(row, channelId) {
  const assetPath = row.asset_path || row.image_path || null;
  const discordUrl = await migrateMediaPath({
    sourcePath: assetPath,
    bucket: getSupabaseBucketNames().gifBucket,
    channelId,
    label: `GIF/text command: ${row.command}`,
  });

  const next = normalizeGifRowForUpdate(row, discordUrl);
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
      if (!page?.asset_path) continue;
      page.asset_path = await migrateMediaPath({
        sourcePath: page.asset_path,
        bucket: chartsBucket,
        channelId,
        label: `Chart: ${row.category || row.key} / ${row.title || row.key}`,
      });
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
  const gifChannelId = env('MIGRATE_GIF_CHANNEL_ID', DEFAULT_GIF_CHANNEL_ID);
  const chartChannelId = env('MIGRATE_CHART_CHANNEL_ID', DEFAULT_CHART_CHANNEL_ID);

  console.log(`Main guild: ${mainGuildId || '(not set)'}`);
  console.log(`Backup/media guild: ${backupGuildId || '(not checked)'}`);
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
