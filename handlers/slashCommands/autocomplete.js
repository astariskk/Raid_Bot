import { getGifCommandsCache, loadGifCommandsCache } from '../../utils/gifCommandsStore.js';
import { listRaidTasks } from '../../utils/raidTasksStore.js';

function normalizeQuery(value) {
  return String(value ?? '').trim().replace(/^\//, '').toLowerCase();
}

export async function handleEditGifAutocompleteInteraction(interaction) {
  try {
    const focused = interaction.options.getFocused(true);
    if (!focused || focused.name !== 'command') {
      await interaction.respond([]).catch(() => {});
      return;
    }

    const query = normalizeQuery(focused.value);

    let cache = getGifCommandsCache();
    if (!cache.loadedAtMs) {
      await loadGifCommandsCache().catch(() => {});
      cache = getGifCommandsCache();
    }

    const keys = [
      ...Object.keys(cache.gifCommands || {}),
      ...Object.keys(cache.textGifCommands || {}),
    ];

    const unique = [...new Set(keys)].sort((a, b) => a.localeCompare(b));

    const filtered = query
      ? unique.filter((k) => k.startsWith(query) || k.includes(query))
      : unique;

    const choices = filtered.slice(0, 25).map((k) => {
      const kind = cache.gifCommands?.[k] ? 'gif' : 'text';
      return { name: `${k} (${kind})`.slice(0, 100), value: k };
    });

    await interaction.respond(choices).catch(() => {});
  } catch (err) {
    console.error('editgif autocomplete error:', err);
    await interaction.respond([]).catch(() => {});
  }
}

export async function handleEditTaskAutocompleteInteraction(interaction) {
  try {
    const focused = interaction.options.getFocused(true);
    if (!focused || focused.name !== 'task') {
      await interaction.respond([]).catch(() => {});
      return;
    }

    const query = normalizeQuery(focused.value);
    const tasks = await listRaidTasks({ includeInactive: true }).catch(() => []);

    const filtered = query
      ? tasks.filter((task) => {
          const key = String(task.key ?? '').toLowerCase();
          const display = String(task.display_name ?? '').toLowerCase();
          return key.includes(query) || display.includes(query);
        })
      : tasks;

    const choices = filtered.slice(0, 25).map((task) => {
      const status = task.active ? '' : ' (inactive)';
      const display = String(task.display_name || task.key);
      const key = String(task.key || display);
      return {
        name: `${display} [${key}]${status}`.slice(0, 100),
        value: display.slice(0, 100),
      };
    });

    await interaction.respond(choices).catch(() => {});
  } catch (err) {
    console.error('edittask autocomplete error:', err);
    await interaction.respond([]).catch(() => {});
  }
}
