import 'dotenv/config';
import { Blob } from 'buffer';
import path from 'path';
import { readFile } from 'fs/promises';
import { connectMongo, closeMongo, getMongoDb } from '../utils/mongoClient.js';

const DATA_DIR = path.resolve(process.cwd(), 'DB_DATA');
const DEFAULT_BACKUP_GUILD_ID = '953464422377087046';
const DEFAULT_GIF_CHANNEL_ID = '1509062194212503603';
const DEFAULT_CHART_CHANNEL_ID = '1509062095239385169';

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const SKIP_MEDIA = args.has('--skip-media');

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function parseMaybeJson(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return fallback;
  }
}

function toDateOrValue(value) {
  if (!value) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date;
}

async function readRows(fileName, fallback = []) {
  try {
    const raw = await readFile(path.join(DATA_DIR, fileName), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

function getSupabaseConfig() {
  const url = env('SUPABASE_URL').replace(/\/$/, '');
  const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_ANON_KEY');
  const gifBucket = env('SUPABASE_GIF_BUCKET') || env('SUPABASE_STORAGE_BUCKET') || 'images-storage';
  const chartsBucket = env('SUPABASE_CHARTS_BUCKET') || gifBucket;
  return { url, key, gifBucket, chartsBucket };
}

function requireMediaEnv() {
  if (SKIP_MEDIA || DRY_RUN) return;
  const { url, key } = getSupabaseConfig();
  const token = env('DISCORD_TOKEN');
  if (!url) throw new Error('SUPABASE_URL is required to migrate media. Temporarily add the old value to .env.');
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required to migrate private Supabase media.');
  if (!token || token === 'your_discord_bot_token') throw new Error('A real DISCORD_TOKEN is required to upload media to Discord.');
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value ?? ''));
}

function fileNameFromPath(objectPath) {
  const name = String(objectPath ?? '').split('/').filter(Boolean).pop() || 'asset';
  return name.replace(/[^\w.\-()[\] ]/g, '_').slice(0, 120) || 'asset';
}

async function fetchSupabaseObject(bucket, objectPath) {
  const { url, key } = getSupabaseConfig();
  const encodedPath = String(objectPath).split('/').map(encodeURIComponent).join('/');
  const objectUrl = `${url}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;

  const response = await fetch(objectUrl, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Failed to download ${bucket}/${objectPath}: ${response.status} ${detail.slice(0, 200)}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  return {
    bytes: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
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

  const asset = await fetchSupabaseObject(bucket, sourcePath);
  const upload = await uploadToDiscordChannel(channelId, {
    ...asset,
    fileName: fileNameFromPath(sourcePath),
    message: `${label}\nSource: ${sourcePath}`,
  });

  mediaCache.set(cacheKey, upload.attachmentUrl);
  console.log(`[media] ${cacheKey} -> ${upload.attachmentUrl}`);
  return upload.attachmentUrl;
}

async function normalizeGifCommand(row, channelId) {
  const assetPath = row.asset_path || row.image_path || null;
  const discordUrl = await migrateMediaPath({
    sourcePath: assetPath,
    bucket: getSupabaseConfig().gifBucket,
    channelId,
    label: `GIF/text command: ${row.command}`,
  });

  return {
    command: String(row.command ?? '').trim().toLowerCase(),
    kind: row.kind ?? 'gif',
    title: row.title ?? null,
    footer: row.footer ?? null,
    image_path: discordUrl,
    asset_path: discordUrl,
    ping_user_ids: parseMaybeJson(row.ping_user_ids, []),
    text_label: row.text_label ?? null,
    text_description: row.text_description ?? '',
    text_content: row.text_content ?? null,
    color: row.color ?? null,
    enabled: row.enabled !== false,
    created_at: toDateOrValue(row.created_at),
    updated_at: toDateOrValue(row.updated_at) || new Date(),
  };
}

async function normalizeChart(row, channelId) {
  const variants = parseMaybeJson(row.variants, []);
  const legacyPages = parseMaybeJson(row.pages, []);
  const normalizedVariants = Array.isArray(variants) && variants.length
    ? variants
    : [{ key: 'main', name: row.title || row.key, embed_title: null, pages: Array.isArray(legacyPages) ? legacyPages : [] }];

  for (const variant of normalizedVariants) {
    const pages = Array.isArray(variant.pages) ? variant.pages : [];
    for (const page of pages) {
      if (!page?.asset_path) continue;
      page.asset_path = await migrateMediaPath({
        sourcePath: page.asset_path,
        bucket: getSupabaseConfig().chartsBucket,
        channelId,
        label: `Chart: ${row.category || row.key} / ${row.title || row.key}`,
      });
    }
  }

  return {
    key: String(row.key ?? '').trim().toLowerCase(),
    category: row.category ?? 'general',
    title: row.title ?? row.key,
    triggers: parseMaybeJson(row.triggers, []),
    variants: normalizedVariants,
    pages: [],
    enabled: row.enabled !== false,
    created_at: toDateOrValue(row.created_at),
    updated_at: toDateOrValue(row.updated_at) || new Date(),
  };
}

function normalizeTask(row) {
  return {
    key: row.key,
    display_name: row.display_name,
    points: Number(row.points ?? 0),
    category: row.category || 'generic',
    active: row.active !== false,
    description: row.description ?? null,
    map_names: parseMaybeJson(row.map_names, []),
    aliases: parseMaybeJson(row.aliases, []),
    sort_order: Number(row.sort_order ?? 0),
    created_at: toDateOrValue(row.created_at),
    updated_at: toDateOrValue(row.updated_at) || new Date(),
  };
}

function normalizeCategory(row) {
  return {
    key: row.key,
    display_name: row.display_name,
    sort_order: Number(row.sort_order ?? 0),
    created_at: toDateOrValue(row.created_at),
    updated_at: toDateOrValue(row.updated_at) || new Date(),
  };
}

async function replaceCollection(collection, docs, keyField) {
  if (DRY_RUN) {
    console.log(`[dry-run] ${collection}: ${docs.length} docs`);
    return;
  }

  const db = getMongoDb();
  if (!docs.length) return;
  const ops = docs
    .filter((doc) => doc?.[keyField])
    .map((doc) => ({
      updateOne: {
        filter: { [keyField]: doc[keyField] },
        update: { $set: doc },
        upsert: true,
      },
    }));

  if (ops.length) await db.collection(collection).bulkWrite(ops, { ordered: false });
  console.log(`[mongo] ${collection}: upserted ${ops.length}`);
}

async function seedLeaderboard() {
  const users = (await readRows('leaderboard_Users.json')).map((row) => ({
    user_id: String(row.user_id),
    total_exp: Number(row.total_exp ?? 0),
  }));
  const daily = (await readRows('leaderboard.json')).map((row) => ({
    date: String(row.date),
    user_id: String(row.user_id),
    points: Number(row.points ?? 0),
  }));
  const meta = (await readRows('leaderboard_metadata.json'))[0] || {};

  if (DRY_RUN) {
    console.log(`[dry-run] leaderboard_users: ${users.length} docs`);
    console.log(`[dry-run] leaderboard_daily_points: ${daily.length} docs`);
    console.log(`[dry-run] leaderboard_meta: ${meta.id ? 1 : 0} doc`);
    return;
  }

  const db = getMongoDb();
  await Promise.all([
    db.collection('leaderboard_users').deleteMany({}),
    db.collection('leaderboard_daily_points').deleteMany({}),
  ]);
  if (users.length) await db.collection('leaderboard_users').insertMany(users);
  if (daily.length) await db.collection('leaderboard_daily_points').insertMany(daily);
  await db.collection('leaderboard_meta').updateOne(
    { _id: 'leaderboard_meta' },
    {
      $set: {
        last_reset_date: meta.last_reset_date ?? null,
        last_backup_message_id: meta.last_backup_message_id ?? null,
      },
    },
    { upsert: true },
  );
  console.log(`[mongo] leaderboard: ${users.length} users, ${daily.length} daily rows`);
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
  if (DRY_RUN) console.log('Dry run enabled: no Discord uploads or Mongo writes.');
  if (SKIP_MEDIA) console.log('Media migration skipped: Supabase paths will be preserved.');

  await validateDiscordChannel(gifChannelId, backupGuildId, 'GIF archive');
  await validateDiscordChannel(chartChannelId, backupGuildId, 'Chart archive');

  if (!DRY_RUN) await connectMongo();

  const [taskRows, categoryRows, gifRows, chartRows] = await Promise.all([
    readRows('raid_tasks_rows.json'),
    readRows('raid_task_categories_rows.json'),
    readRows('gif_commands_rows.json'),
    readRows('charts_rows.json'),
  ]);

  await replaceCollection('raid_task_categories', categoryRows.map(normalizeCategory), 'key');
  await replaceCollection('raid_tasks', taskRows.map(normalizeTask), 'key');
  await seedLeaderboard();

  const gifDocs = [];
  for (const row of gifRows) {
    gifDocs.push(await normalizeGifCommand(row, gifChannelId));
  }
  await replaceCollection('gif_commands', gifDocs, 'command');

  const chartDocs = [];
  for (const row of chartRows) {
    chartDocs.push(await normalizeChart(row, chartChannelId));
  }
  await replaceCollection('charts', chartDocs, 'key');

  console.log('Migration complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeMongo().catch(() => {});
  });
