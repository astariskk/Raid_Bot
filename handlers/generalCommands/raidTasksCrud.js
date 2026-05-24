import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

import { EMBED_COLOR, MODERATOR_ROLE_ID, OFFICER_ROLE_ID, RAID_MANAGER_ROLE_ID } from '../../config/constants.js';
import {
  deleteRaidTask,
  deleteRaidTaskCategory,
  getRaidTask,
  getRaidTaskCategory,
  listRaidTaskCategories,
  listRaidTasksByCategory,
  reorderRaidTasks,
  updateRaidTask,
  updateRaidTaskCategory,
  upsertRaidTask,
  upsertRaidTaskCategory,
} from '../../utils/raidTasksStore.js';

const sessions = new Map(); // messageId -> session

function isStaffMember(member) {
  if (!member) return false;
  return (
    member.roles.cache.has(MODERATOR_ROLE_ID) ||
    member.roles.cache.has(OFFICER_ROLE_ID) ||
    member.roles.cache.has(RAID_MANAGER_ROLE_ID)
  );
}

function newCustomId(prefix, messageId) {
  return `taskmgr_${prefix}_${messageId}`;
}

async function getSessionTasks(session) {
  if (!session?.categoryKey) return [];
  return listRaidTasksByCategory(session.categoryKey, { includeInactive: true });
}

async function buildCategoryEmbed(session) {
  const categories = await listRaidTaskCategories();
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle('Task Manager')
    .setDescription('Select a category, or create a new one.');

  if (categories.length) {
    embed.addFields({
      name: 'Categories',
      value: categories
        .slice(0, 20)
        .map((c) => `- **${c.display_name || c.key}** \`${c.key}\``)
        .join('\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  if (session?.notice) embed.setFooter({ text: session.notice.slice(0, 2048) });
  return embed;
}

async function buildTaskListEmbed(session) {
  const category = await getRaidTaskCategory(session.categoryKey);
  const tasks = await getSessionTasks(session);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(category.display_name || category.key)
    .setDescription('Select a task to edit it, or add a new task.');

  embed.addFields({
    name: 'Tasks',
    value: tasks.length
      ? tasks
          .map((task, index) => {
            const state = task.active ? '' : ' (inactive)';
            return `${index + 1}. **${task.display_name}** - ${task.points} EXP${state}`;
          })
          .join('\n')
          .slice(0, 1024)
      : 'No tasks in this category yet.',
    inline: false,
  });

  if (session?.notice) embed.setFooter({ text: session.notice.slice(0, 2048) });
  return embed;
}

async function buildTaskEmbed(session) {
  const task = await getRaidTask(session.taskKey);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(task?.display_name || 'Task')
    .setDescription(task?.description || 'No description set.');

  if (!task) {
    embed.setDescription('This task no longer exists.');
    return embed;
  }

  embed.addFields(
    { name: 'Display name', value: task.display_name, inline: true },
    { name: 'Points', value: String(task.points), inline: true },
    { name: 'Available', value: task.active ? 'Yes' : 'No', inline: true },
    { name: 'Category', value: `\`${task.category}\``, inline: true },
    { name: 'Order', value: String(task.sort_order), inline: true },
  );

  if (session?.notice) embed.setFooter({ text: session.notice.slice(0, 2048) });
  return embed;
}

async function buildOrderEmbed(session) {
  const category = await getRaidTaskCategory(session.categoryKey);
  const tasks = await getSessionTasks(session);
  const embed = new EmbedBuilder()
    .setColor(EMBED_COLOR)
    .setTitle(`Manage Order: ${category.display_name || category.key}`)
    .setDescription('Pick a task, then move it up or down.');

  embed.addFields({
    name: 'Current Order',
    value: tasks.length
      ? tasks
          .map((task, index) => `${index + 1}. ${task.key === session.taskKey ? '**' : ''}${task.display_name}${task.key === session.taskKey ? '**' : ''}`)
          .join('\n')
          .slice(0, 1024)
      : 'No tasks in this category yet.',
    inline: false,
  });

  if (session.orderKeys?.length) {
    const labels = tasks
      .filter((task) => session.orderKeys.includes(task.key))
      .sort((a, b) => session.orderKeys.indexOf(a.key) - session.orderKeys.indexOf(b.key))
      .map((task, index) => `${index + 1}. ${task.display_name}`);

    embed.addFields({
      name: 'Selected Order',
      value: labels.join('\n').slice(0, 1024) || 'None selected.',
      inline: false,
    });
  }

  if (session?.notice) embed.setFooter({ text: session.notice.slice(0, 2048) });
  return embed;
}

async function buildCategorySelect(messageId, session) {
  const categories = await listRaidTaskCategories();
  const options = categories.slice(0, 24).map((category) => ({
    label: String(category.display_name || category.key).slice(0, 100),
    value: category.key,
    description: category.key.slice(0, 100),
    default: category.key === session?.categoryKey,
  }));

  options.push({ label: 'Create category...', value: '__new__', description: 'Add a new task category' });

  const select = new StringSelectMenuBuilder()
    .setCustomId(newCustomId('category', messageId))
    .setPlaceholder('Select category...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

async function buildMoveCategorySelect(messageId, session) {
  const categories = await listRaidTaskCategories();
  const options = categories.slice(0, 24).map((category) => ({
    label: String(category.display_name || category.key).slice(0, 100),
    value: category.key,
    description: category.key.slice(0, 100),
    default: category.key === session?.categoryKey,
  }));
  options.push({ label: 'Create category...', value: '__new__', description: 'Add a new category and move this task there' });

  const select = new StringSelectMenuBuilder()
    .setCustomId(newCustomId('taskcat', messageId))
    .setPlaceholder('Move task to category...')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(options.length ? options : [{ label: 'No categories available', value: '__none__' }]);

  return new ActionRowBuilder().addComponents(select);
}

async function buildTaskSelect(messageId, session, { forOrder = false } = {}) {
  const tasks = await getSessionTasks(session);
  const options = tasks.slice(0, 24).map((task, index) => ({
    label: `${index + 1}. ${task.display_name}`.slice(0, 100),
    value: task.key,
    description: `${task.points} EXP${task.active ? '' : ' - inactive'}`.slice(0, 100),
    default: forOrder ? (session?.orderKeys || []).includes(task.key) : task.key === session?.taskKey,
  }));

  if (!forOrder) options.push({ label: 'Add task...', value: '__new__', description: 'Create a task in this category' });
  if (!options.length) options.push({ label: 'Add task...', value: '__new__', description: 'Create a task in this category' });

  const select = new StringSelectMenuBuilder()
    .setCustomId(newCustomId(forOrder ? 'ordertask' : 'task', messageId))
    .setPlaceholder(forOrder ? 'Select task to reorder...' : 'Select task...')
    .setMinValues(1)
    .setMaxValues(forOrder ? Math.max(1, Math.min(25, options.length)) : 1)
    .addOptions(options);

  return new ActionRowBuilder().addComponents(select);
}

function buildCloseRow(messageId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(newCustomId('close', messageId)).setLabel('Save and Close').setStyle(ButtonStyle.Success),
  );
}

function buildTaskListButtons(messageId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(newCustomId('catmodal', messageId)).setLabel('Edit Category').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(newCustomId('order', messageId)).setLabel('Manage Order').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(newCustomId('deletecat', messageId)).setLabel('Delete Category').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(newCustomId('backcats', messageId)).setLabel('Back').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(newCustomId('close', messageId)).setLabel('Save and Close').setStyle(ButtonStyle.Success),
    ),
  ];
}

function buildTaskButtons(messageId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(newCustomId('editname', messageId)).setLabel('Edit Name').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(newCustomId('editpoints', messageId)).setLabel('Edit Points').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(newCustomId('editdesc', messageId)).setLabel('Edit Description').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(newCustomId('toggle', messageId)).setLabel('Toggle Available').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(newCustomId('changecat', messageId)).setLabel('Change Category').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(newCustomId('moveup', messageId)).setLabel('Move Up').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(newCustomId('movedown', messageId)).setLabel('Move Down').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(newCustomId('delete', messageId)).setLabel('Delete').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(newCustomId('backtasks', messageId)).setLabel('Back').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(newCustomId('close', messageId)).setLabel('Save and Close').setStyle(ButtonStyle.Success),
    ),
  ];
}

function buildOrderButtons(messageId, selected) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(newCustomId('applyorder', messageId)).setLabel('Apply Selected Order').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(newCustomId('moveup', messageId)).setLabel('Move Up').setStyle(ButtonStyle.Secondary).setDisabled(!selected),
      new ButtonBuilder().setCustomId(newCustomId('movedown', messageId)).setLabel('Move Down').setStyle(ButtonStyle.Secondary).setDisabled(!selected),
      new ButtonBuilder().setCustomId(newCustomId('backtasks', messageId)).setLabel('Back').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(newCustomId('close', messageId)).setLabel('Save and Close').setStyle(ButtonStyle.Success),
    ),
  ];
}

async function buildPayload(messageId, session) {
  if (session.view === 'tasks') {
    return {
      embeds: [await buildTaskListEmbed(session)],
      components: [await buildTaskSelect(messageId, session), ...buildTaskListButtons(messageId)],
    };
  }

  if (session.view === 'task') {
    return { embeds: [await buildTaskEmbed(session)], components: buildTaskButtons(messageId) };
  }

  if (session.view === 'order') {
    return {
      embeds: [await buildOrderEmbed(session)],
      components: [await buildTaskSelect(messageId, session, { forOrder: true }), ...buildOrderButtons(messageId, Boolean(session.taskKey))],
    };
  }

  return {
    embeds: [await buildCategoryEmbed(session)],
    components: [await buildCategorySelect(messageId, session), buildCloseRow(messageId)],
  };
}

async function refreshInteraction(interaction, messageId, session) {
  sessions.set(messageId, { ...session, notice: null });
  const payload = await buildPayload(messageId, session);
  await interaction.update(payload).catch(async () => {
    await interaction.editReply(payload).catch(async () => {
      await interaction.reply({ content: 'Updated.', flags: MessageFlags.Ephemeral }).catch(() => {});
    });
  });
}

function buildCategoryModal(messageId, category = null) {
  const modal = new ModalBuilder().setCustomId(newCustomId('categorymodal', messageId)).setTitle(category ? 'Edit Category' : 'Create Category');
  const name = new TextInputBuilder().setCustomId('name').setLabel('Category name').setStyle(TextInputStyle.Short).setRequired(true);
  const order = new TextInputBuilder().setCustomId('sort_order').setLabel('Category order').setStyle(TextInputStyle.Short).setRequired(false);

  if (category?.display_name) name.setValue(String(category.display_name));
  if (category?.sort_order !== undefined) order.setValue(String(category.sort_order));

  return modal.addComponents(
    new ActionRowBuilder().addComponents(name),
    new ActionRowBuilder().addComponents(order),
  );
}

function buildAddTaskModal(messageId) {
  return new ModalBuilder()
    .setCustomId(newCustomId('addtaskmodal', messageId))
    .setTitle('Add Task')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Display name').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('points').setLabel('Points').setStyle(TextInputStyle.Short).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Description').setStyle(TextInputStyle.Paragraph).setRequired(false)),
    );
}

function buildFieldModal(messageId, field, task) {
  const labels = {
    name: ['Display name', TextInputStyle.Short, task.display_name],
    points: ['Points', TextInputStyle.Short, String(task.points ?? 0)],
    desc: ['Description', TextInputStyle.Paragraph, task.description || ''],
  };
  const [label, style, value] = labels[field] || labels.name;
  const input = new TextInputBuilder().setCustomId('value').setLabel(label).setStyle(style).setRequired(field !== 'desc');
  if (value) input.setValue(String(value).slice(0, style === TextInputStyle.Paragraph ? 4000 : 1000));

  return new ModalBuilder()
    .setCustomId(newCustomId(`fieldmodal_${field}`, messageId))
    .setTitle(label)
    .addComponents(new ActionRowBuilder().addComponents(input));
}

async function moveTask(taskKey, direction) {
  const task = await getRaidTask(taskKey);
  if (!task) throw new Error('Task not found.');

  const tasks = await listRaidTasksByCategory(task.category, { includeInactive: true });
  const index = tasks.findIndex((item) => item.key === task.key);
  const targetIndex = direction === 'up' ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= tasks.length) return task;

  const currentOrder = tasks[index].sort_order;
  const targetOrder = tasks[targetIndex].sort_order;
  await updateRaidTask(tasks[index].key, { sortOrder: targetOrder });
  await updateRaidTask(tasks[targetIndex].key, { sortOrder: currentOrder });
  return getRaidTask(task.key);
}

export async function startRaidTaskManagerInteraction(interaction) {
  if (!interaction.guild || !interaction.member) throw new Error('This can only be used in a server.');
  if (!isStaffMember(interaction.member)) throw new Error('You do not have permission to manage raid tasks.');

  const session = {
    ownerId: interaction.user.id,
    view: 'categories',
    categoryKey: null,
    taskKey: null,
    categoryModalMode: null,
    notice: null,
  };

  await interaction.reply({ embeds: [await buildCategoryEmbed(session)], components: [], flags: MessageFlags.Ephemeral });
  const msg = await interaction.fetchReply();
  sessions.set(msg.id, session);
  await interaction.editReply(await buildPayload(msg.id, session));
}

export async function maybeHandleRaidTaskCrudMessage(message) {
  const content = String(message.content ?? '').trim().toLowerCase();
  if (!['!task', '!tasks', '!managetask', '!managetasks', '!modifytask', '!modifytasks'].includes(content)) return false;

  if (!message.guild) return true;
  if (!isStaffMember(message.member)) {
    await message.reply({ content: 'You do not have permission to manage raid tasks.' });
    return true;
  }

  const sent = await message.channel.send({ embeds: [await buildCategoryEmbed({})], components: [] });
  const session = { ownerId: message.author.id, view: 'categories', categoryKey: null, taskKey: null, categoryModalMode: null, notice: null };
  sessions.set(sent.id, session);
  await sent.edit(await buildPayload(sent.id, session));
  return true;
}

export async function handleRaidTaskCrudInteraction(interaction) {
  if (!interaction.isButton() && !interaction.isStringSelectMenu() && !interaction.isModalSubmit()) return false;
  const id = interaction.customId || '';
  if (!id.startsWith('taskmgr_')) return false;

  const parts = id.split('_');
  const action = parts[1];
  const field = action === 'fieldmodal' ? parts[2] : null;
  const messageId = parts.slice(action === 'fieldmodal' ? 3 : 2).join('_');
  const session = sessions.get(messageId);

  if (!session) {
    await interaction.reply({ content: 'This task manager session expired. Run `/modifytasks` again.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (session.ownerId && session.ownerId !== interaction.user.id) {
    await interaction.reply({ content: 'This task manager session is not yours.', flags: MessageFlags.Ephemeral });
    return true;
  }
  if (!isStaffMember(interaction.member)) {
    await interaction.reply({ content: 'You do not have permission to manage raid tasks.', flags: MessageFlags.Ephemeral });
    return true;
  }

  if (interaction.isStringSelectMenu() && action === 'category') {
    const selected = interaction.values?.[0];
    if (selected === '__new__') {
      session.categoryModalMode = 'create';
      sessions.set(messageId, session);
      await interaction.showModal(buildCategoryModal(messageId));
      return true;
    }
    session.categoryKey = selected;
    session.taskKey = null;
    session.view = 'tasks';
    await refreshInteraction(interaction, messageId, session);
    return true;
  }

  if (interaction.isStringSelectMenu() && action === 'task') {
    const selected = interaction.values?.[0];
    if (selected === '__new__') {
      await interaction.showModal(buildAddTaskModal(messageId));
      return true;
    }
    session.taskKey = selected;
    session.view = 'task';
    await refreshInteraction(interaction, messageId, session);
    return true;
  }

  if (interaction.isStringSelectMenu() && action === 'ordertask') {
    session.orderKeys = interaction.values || [];
    session.taskKey = session.orderKeys[0] || null;
    session.view = 'order';
    await refreshInteraction(interaction, messageId, session);
    return true;
  }

  if (interaction.isStringSelectMenu() && action === 'taskcat') {
    const category = interaction.values?.[0];
    if (category === '__new__') {
      session.categoryModalMode = 'createForTask';
      sessions.set(messageId, session);
      await interaction.showModal(buildCategoryModal(messageId));
      return true;
    }
    if (!category || category === '__none__' || !session.taskKey) return true;
    await updateRaidTask(session.taskKey, { category });
    session.categoryKey = category;
    session.view = 'task';
    session.notice = 'Task category updated.';
    await refreshInteraction(interaction, messageId, session);
    return true;
  }

  if (interaction.isButton()) {
    if (action === 'close') {
      sessions.delete(messageId);
      await interaction.update({ content: 'Saved.', embeds: [], components: [] }).catch(() => {});
      return true;
    }

    if (action === 'backcats') {
      session.view = 'categories';
      session.categoryKey = null;
      session.taskKey = null;
      await refreshInteraction(interaction, messageId, session);
      return true;
    }

    if (action === 'backtasks') {
      session.view = 'tasks';
      session.taskKey = null;
      await refreshInteraction(interaction, messageId, session);
      return true;
    }

    if (action === 'catmodal') {
      const category = await getRaidTaskCategory(session.categoryKey);
      session.categoryModalMode = 'edit';
      sessions.set(messageId, session);
      await interaction.showModal(buildCategoryModal(messageId, category));
      return true;
    }

    if (action === 'order') {
      session.view = 'order';
      session.taskKey = null;
      session.orderKeys = [];
      await refreshInteraction(interaction, messageId, session);
      return true;
    }

    if (action === 'applyorder') {
      if (!session.orderKeys?.length) {
        await interaction.reply({ content: 'Select tasks in the order you want first.', flags: MessageFlags.Ephemeral });
        return true;
      }
      await reorderRaidTasks(session.categoryKey, session.orderKeys);
      session.notice = 'Task order updated.';
      await refreshInteraction(interaction, messageId, session);
      return true;
    }

    if (action === 'deletecat') {
      if (session.categoryKey === 'generic') {
        await interaction.reply({ content: 'Generic cannot be deleted because it is the fallback category.', flags: MessageFlags.Ephemeral });
        return true;
      }
      const deleted = await deleteRaidTaskCategory(session.categoryKey, { deleteTasks: false });
      session.view = 'categories';
      session.categoryKey = null;
      session.taskKey = null;
      session.notice = `Deleted ${deleted.display_name}. Existing tasks were moved to Generic.`;
      await refreshInteraction(interaction, messageId, session);
      return true;
    }

    if (action === 'changecat') {
      const row = await buildMoveCategorySelect(messageId, session);
      await interaction.reply({ content: 'Select the new category:', components: [row], flags: MessageFlags.Ephemeral });
      return true;
    }

    if (action === 'toggle') {
      const task = await getRaidTask(session.taskKey);
      await updateRaidTask(session.taskKey, { active: !task.active });
      session.notice = 'Availability updated.';
      await refreshInteraction(interaction, messageId, session);
      return true;
    }

    if (action === 'moveup' || action === 'movedown') {
      if (!session.taskKey) {
        await interaction.reply({ content: 'Select a task first.', flags: MessageFlags.Ephemeral });
        return true;
      }
      await moveTask(session.taskKey, action === 'moveup' ? 'up' : 'down');
      session.notice = 'Order updated.';
      await refreshInteraction(interaction, messageId, session);
      return true;
    }

    if (action === 'delete') {
      const deleted = await deleteRaidTask(session.taskKey);
      session.view = 'tasks';
      session.taskKey = null;
      session.notice = `Deleted ${deleted.display_name}.`;
      await refreshInteraction(interaction, messageId, session);
      return true;
    }

    if (action.startsWith('edit')) {
      const task = await getRaidTask(session.taskKey);
      const modalField = action.replace('edit', '');
      await interaction.showModal(buildFieldModal(messageId, modalField, task));
      return true;
    }
  }

  if (interaction.isModalSubmit() && action === 'categorymodal') {
    const name = interaction.fields.getTextInputValue('name');
    const sortOrderRaw = interaction.fields.getTextInputValue('sort_order');
    const sortOrder = sortOrderRaw ? Number(sortOrderRaw) : undefined;
    if (sortOrder !== undefined && !Number.isFinite(sortOrder)) {
      await interaction.reply({ content: 'Category order must be a number.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const mode = session.categoryModalMode || (session.categoryKey ? 'edit' : 'create');
    session.categoryModalMode = null;

    if (mode === 'edit' && session.categoryKey) {
      const updated = await updateRaidTaskCategory(session.categoryKey, { displayName: name, sortOrder });
      session.categoryKey = updated.key;
      session.view = 'tasks';
      session.notice = 'Category updated.';
    } else {
      const existing = await listRaidTaskCategories();
      const created = await upsertRaidTaskCategory({
        displayName: name,
        sortOrder: sortOrder ?? (existing.length + 1) * 10,
      });
      if (mode === 'createForTask' && session.taskKey) {
        await updateRaidTask(session.taskKey, { category: created.key });
      }
      session.categoryKey = created.key;
      session.view = mode === 'createForTask' && session.taskKey ? 'task' : 'tasks';
      session.notice = 'Category created.';
    }

    await refreshInteraction(interaction, messageId, session);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'addtaskmodal') {
    const tasks = await listRaidTasksByCategory(session.categoryKey, { includeInactive: true });
    const points = Number(interaction.fields.getTextInputValue('points'));
    if (!Number.isFinite(points) || points < 0) {
      await interaction.reply({ content: 'Points must be a non-negative number.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const task = await upsertRaidTask({
      displayName: interaction.fields.getTextInputValue('name'),
      points,
      category: session.categoryKey,
      available: true,
      description: interaction.fields.getTextInputValue('description'),
      sortOrder: (tasks.length + 1) * 10,
    });

    session.taskKey = task.key;
    session.view = 'task';
    session.notice = 'Task created.';
    await refreshInteraction(interaction, messageId, session);
    return true;
  }

  if (interaction.isModalSubmit() && action === 'fieldmodal') {
    const value = interaction.fields.getTextInputValue('value');
    const patch = {};
    if (field === 'name') patch.displayName = value;
    if (field === 'points') {
      const points = Number(value);
      if (!Number.isFinite(points) || points < 0) {
        await interaction.reply({ content: 'Points must be a non-negative number.', flags: MessageFlags.Ephemeral });
        return true;
      }
      patch.points = points;
    }
    if (field === 'desc') patch.description = value;

    await updateRaidTask(session.taskKey, patch);
    session.notice = 'Task updated.';
    await refreshInteraction(interaction, messageId, session);
    return true;
  }

  return true;
}
