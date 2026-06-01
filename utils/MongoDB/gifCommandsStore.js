import { EMBED_COLOR } from '../../config/constants.js';
import { connectMongo, getMongoDb } from './mongoClient.js';
import { resolveAssetUrl } from '../assetUrls.js';

const cache = {
  loadedAtMs: 0,
  gifCommands: {}, // command -> gifInfo or gifInfo[]
  textGifCommands: {}, // command -> string
};

export async function loadGifCommandsCache() {
  await connectMongo();
  const db = getMongoDb();
  const data = await db.collection('gif_commands').find({ enabled: true }).toArray();

  const gifCommands = {};
  const textGifCommands = {};

  for (const row of data ?? []) {
    const cmd = String(row.command ?? '').trim().toLowerCase();
    if (!cmd) continue;

    if (row.kind === 'text') {
      const maybePath = row.asset_path || row.image_path;
      const url = resolveAssetUrl(maybePath);

      const pingIds = Array.isArray(row.ping_user_ids) ? row.ping_user_ids.filter(Boolean).map(String) : [];
      const mentions = pingIds.length ? pingIds.map((id) => `<@${id}>`).join(' ') : '';
      const description = String(row.text_description ?? '').trim();
      const label = String(row.text_label ?? '').trim();

      if (url && label) {
        const prefix = mentions ? `${mentions} ` : '';
        const mid = description ? `${description} ` : '';
        textGifCommands[cmd] = `${prefix}${mid}[**${label}**](${url})`.trim();
      } else if (row.text_content) {
        textGifCommands[cmd] = String(row.text_content);
      }
      continue;
    }

    if (row.kind === 'gif') {
      let image = null;
      const maybePath = row.asset_path || row.image_path;
      if (maybePath) image = resolveAssetUrl(maybePath);

      const info = {
        title: row.title ?? cmd,
        image,
        footer: row.footer ?? '',
        color: row.color ?? EMBED_COLOR,
      };

      gifCommands[cmd] = info;
    }
  }

  cache.loadedAtMs = Date.now();
  cache.gifCommands = gifCommands;
  cache.textGifCommands = textGifCommands;

  return { gifCommands, textGifCommands };
}

export function getGifCommandsCache() {
  return {
    loadedAtMs: cache.loadedAtMs,
    gifCommands: cache.gifCommands,
    textGifCommands: cache.textGifCommands,
  };
}

export async function getGifCommand(command) {
  await connectMongo();
  const db = getMongoDb();
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  const data = await db.collection('gif_commands').findOne({ command: cmd }, { projection: { _id: 0 } });
  return data ?? null;
}

export async function upsertGifCommand({
  command,
  kind,
  title,
  footer,
  textContent,
  imagePath,
  assetPath,
  pingUserIds,
  textLabel,
  textDescription,
  color,
  enabled = true,
}) {
  await connectMongo();
  const db = getMongoDb();
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  const row = { command: cmd, enabled };
  if (kind !== undefined) row.kind = kind;
  if (title !== undefined) row.title = title;
  if (footer !== undefined) row.footer = footer;
  if (textContent !== undefined) row.text_content = textContent;
  if (imagePath !== undefined) row.image_path = imagePath;
  if (assetPath !== undefined) row.asset_path = assetPath;
  if (pingUserIds !== undefined) row.ping_user_ids = pingUserIds;
  if (textLabel !== undefined) row.text_label = textLabel;
  if (textDescription !== undefined) row.text_description = textDescription;
  if (color !== undefined) row.color = color;
  row.updated_at = new Date();

  await db.collection('gif_commands').updateOne(
    { command: cmd },
    { $set: row, $setOnInsert: { created_at: new Date() } },
    { upsert: true },
  );

  await loadGifCommandsCache();
}

export async function updateGifCommand(command, patch = {}) {
  await connectMongo();
  const db = getMongoDb();
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  await db.collection('gif_commands').updateOne({ command: cmd }, { $set: { ...patch, updated_at: new Date() } });

  await loadGifCommandsCache();
}

export async function deleteGifCommand(command) {
  await connectMongo();
  const db = getMongoDb();
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  await db.collection('gif_commands').deleteOne({ command: cmd });

  await loadGifCommandsCache();
}

export async function updateGifCommandImage(command, imagePath) {
  await connectMongo();
  const db = getMongoDb();
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  await db.collection('gif_commands').updateOne(
    { command: cmd },
    { $set: { asset_path: imagePath, image_path: imagePath, updated_at: new Date() } },
  );

  await loadGifCommandsCache();
}
