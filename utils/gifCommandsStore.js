import { EMBED_COLOR } from '../config/constants.js';
import { getSupabase } from './supabaseClient.js';

const cache = {
  loadedAtMs: 0,
  gifCommands: {}, // command -> gifInfo or gifInfo[]
  textGifCommands: {}, // command -> string
};

export async function loadGifCommandsCache() {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from('gif_commands')
    .select('command,kind,title,footer,image_path,text_content,color,enabled')
    .eq('enabled', true);

  if (error) throw error;

  const bucket = process.env.SUPABASE_GIF_BUCKET || 'gif-commands';

  const gifCommands = {};
  const textGifCommands = {};

  for (const row of data ?? []) {
    const cmd = String(row.command ?? '').trim().toLowerCase();
    if (!cmd) continue;

    if (row.kind === 'text') {
      if (row.text_content) textGifCommands[cmd] = String(row.text_content);
      continue;
    }

    if (row.kind === 'gif') {
      let image = null;
      if (row.image_path) {
        const { data: publicData } = supabase.storage.from(bucket).getPublicUrl(String(row.image_path));
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
    .select('command,kind,title,footer,image_path,text_content,color,enabled')
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
  color,
  enabled = true,
}) {
  const supabase = getSupabase();
  const cmd = String(command ?? '').trim().toLowerCase();
  if (!cmd) throw new Error('command is required');

  const row = {
    command: cmd,
    kind,
    title: title ?? null,
    footer: footer ?? null,
    text_content: textContent ?? null,
    image_path: imagePath ?? null,
    color: color ?? null,
    enabled,
  };

  const { error } = await supabase.from('gif_commands').upsert(row, { onConflict: 'command' });
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

  const { error } = await supabase.from('gif_commands').update({ image_path: imagePath }).eq('command', cmd);
  if (error) throw error;

  await loadGifCommandsCache();
}
