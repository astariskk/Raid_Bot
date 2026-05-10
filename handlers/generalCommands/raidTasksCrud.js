import { MODERATOR_ROLE_ID, OFFICER_ROLE_ID, RAID_MANAGER_ROLE_ID } from '../../config/constants.js';
import { formatRaidTaskSummary, parseBooleanInput, updateRaidTask, upsertRaidTask } from '../../utils/raidTasksStore.js';

function isStaffMember(member) {
  if (!member) return false;
  return (
    member.roles.cache.has(MODERATOR_ROLE_ID) ||
    member.roles.cache.has(OFFICER_ROLE_ID) ||
    member.roles.cache.has(RAID_MANAGER_ROLE_ID)
  );
}

function parseKeyValueArgs(text) {
  const values = {};
  const pattern = /(\w+)=("([^"]*)"|'([^']*)'|[^\s]+)/g;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const key = String(match[1] ?? '').trim().toLowerCase();
    const value = match[3] ?? match[4] ?? match[2] ?? '';
    if (key) values[key] = String(value).trim();
  }

  return values;
}

function buildTaskPatch(fields) {
  const patch = {};

  if (fields.display !== undefined || fields.display_name !== undefined) patch.displayName = fields.display ?? fields.display_name;
  if (fields.points !== undefined) patch.points = Number(fields.points);
  if (fields.available !== undefined) patch.available = parseBooleanInput(fields.available);
  if (fields.active !== undefined) patch.active = parseBooleanInput(fields.active);
  if (fields.map !== undefined || fields.map_name !== undefined || fields.maps !== undefined) {
    patch.mapName = fields.map ?? fields.map_name ?? fields.maps;
  }
  if (fields.alias !== undefined || fields.aliases !== undefined || fields.task_alias !== undefined) {
    patch.taskAlias = fields.alias ?? fields.aliases ?? fields.task_alias;
  }
  if (fields.category !== undefined) patch.category = fields.category;
  if (fields.description !== undefined || fields.desc !== undefined) patch.description = fields.description ?? fields.desc;
  if (fields.sort !== undefined || fields.sort_order !== undefined) patch.sortOrder = Number(fields.sort ?? fields.sort_order);

  return patch;
}

function getUsage(command) {
  return [
    `Usage: \`${command} display="Display Name" points=1000 category=weeklies available=true map=ultradage aliases=dave,david description="Short help text"\``,
    `Edit example: \`!edittask display="Dage" points=2500 available=false map=ultradage aliases="dave,david"\``,
  ].join('\n');
}

export async function maybeHandleRaidTaskCrudMessage(message) {
  const content = String(message.content ?? '').trim();
  const match = content.match(/^!(addtask|edittask)\b\s*(.*)$/i);
  if (!match) return false;

  if (!message.guild) return true;
  if (!isStaffMember(message.member)) {
    await message.reply({ content: 'You do not have permission to manage raid tasks.' });
    return true;
  }

  const command = `!${match[1].toLowerCase()}`;
  const rest = String(match[2] ?? '').trim();
  const fields = parseKeyValueArgs(rest);
  const patch = buildTaskPatch(fields);
  const displayName = patch.displayName;

  try {
    if (command === '!addtask') {
      const missing = [];
      if (!displayName) missing.push('display');
      if (patch.points === undefined || Number.isNaN(patch.points)) missing.push('points');
      if (!patch.category) missing.push('category');

      if (missing.length) {
        await message.reply({ content: `Missing required field(s): ${missing.join(', ')}.\n${getUsage(command)}` });
        return true;
      }

      const task = await upsertRaidTask(patch);
      await message.reply({ content: `Task saved.\n${formatRaidTaskSummary(task)}` });
      return true;
    }

    if (!displayName) {
      await message.reply({ content: `Missing required field: display.\n${getUsage(command)}` });
      return true;
    }

    delete patch.displayName;
    const task = await updateRaidTask(displayName, patch);
    await message.reply({ content: `Task updated.\n${formatRaidTaskSummary(task)}` });
  } catch (error) {
    console.error(`Error handling ${command}:`, error);
    await message.reply({ content: error?.message || 'Failed to save task.' });
  }

  return true;
}
