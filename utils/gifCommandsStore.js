import { getSupabase } from './supabaseClient.js';
import { EMBED_COLOR } from '../config/constants.js';

const cache = {
  loadedAtMs: 0,
  gifCommands: {}, // command -> gifInfo or gifInfo[]
  textGifCommands: {}, // command -> string
};

export async function loadGifCommandsCache() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('gif_commands')
    .select('command,kind,title,footer,asset_path,image_path,ping_user_ids,text_label,text_description,text_content,color,enabled')
    .eq('enabled', true);

  if (error) throw error;

  const bucket = process.env.SUPABASE_GIF_BUCKET || 'gif-commands';

  const gifCommands = {};
  const textGifCommands = {};

  for (const row of data ?? []) {
    const cmd = String(row.command ?? '').trim().toLowerCase();
    if (!cmd) continue;

    if (row.kind === 'text') {
      const maybePath = row.asset_path || row.image_path;
      let url = null;
      if (maybePath) {
        const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(String(maybePath));
        url = publicData?.publicUrl ?? null;
      }

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
      if (maybePath) {
        const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(String(maybePath));
        image = publicData?.publicUrl ?? null;
      }

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
  const supabase = getSupabase();
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  const { data, error } = await supabase
    .from('gif_commands')
    .select('command,kind,title,footer,asset_path,image_path,ping_user_ids,text_label,text_description,text_content,color,enabled')
    .eq('command', cmd)
    .maybeSingle();

  if (error) throw error;
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
  const supabase = getSupabase();
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

  const { error } = await supabase.from('gif_commands').upsert(row, { onConflict: 'command' });
  if (error) throw error;

  await loadGifCommandsCache();
}

export async function updateGifCommand(command, patch = {}) {
  const supabase = getSupabase();
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  const { error } = await supabase.from('gif_commands').update(patch).eq('command', cmd);
  if (error) throw error;

  await loadGifCommandsCache();
}

export async function deleteGifCommand(command) {
  const supabase = getSupabase();
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  const { error } = await supabase.from('gif_commands').delete().eq('command', cmd);
  if (error) throw error;

  await loadGifCommandsCache();
}

export async function updateGifCommandImage(command, imagePath) {
  const supabase = getSupabase();
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  const { error } = await supabase.from('gif_commands').update({ asset_path: imagePath, image_path: imagePath }).eq('command', cmd);
  if (error) throw error;

  await loadGifCommandsCache();
}
