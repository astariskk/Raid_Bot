import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    MessageFlags,
    ModalBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';

import { EMBED_COLOR, POINTS_CONFIG, RAID_TASK_CATEGORIES, TASK_DISPLAY_NAMES } from '../../../config/constants.js';

function buildRaidWizardDetailsModal({ customId, title, includeMapName = false, defaults }) {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title);

    const mapNumberInput = new TextInputBuilder()
        .setCustomId('mapNumberInput')
        .setLabel('Map Number:')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., 2323, 1212')
        .setValue(defaults.mapNumber ?? '');

    const serverInput = new TextInputBuilder()
        .setCustomId('serverInput')
        .setLabel('Server:')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., Artix, Yorumi, Safiria')
        .setValue(defaults.server ?? '');

    const descriptionInput = new TextInputBuilder()
        .setCustomId('descriptionInput')
        .setLabel('Description/Notes')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('Any specific details or requirements?')
        .setValue(defaults.description ?? '');

    const rows = [
        new ActionRowBuilder().addComponents(mapNumberInput),
        new ActionRowBuilder().addComponents(serverInput),
        new ActionRowBuilder().addComponents(descriptionInput),
    ];

    if (includeMapName) {
        const mapNameInput = new TextInputBuilder()
            .setCustomId('mapNameInput')
            .setLabel('Map Name (optional):')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('Comma-separated e.g., doomwood, necropolis')
            .setValue(defaults.mapName ?? '');
        rows.unshift(new ActionRowBuilder().addComponents(mapNameInput));
    }

    modal.addComponents(...rows);

    return modal;
}

function getRaidWizardEditDetailsModalFields(defaults = {}) {
    const mapNumberInput = new TextInputBuilder()
        .setCustomId('mapNumberInput')
        .setLabel('Map Number:')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., 2323, 1212')
        .setValue(defaults.mapNumber ?? '');

    const serverInput = new TextInputBuilder()
        .setCustomId('serverInput')
        .setLabel('Server:')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., Artix, Yorumi, Safiria')
        .setValue(defaults.server ?? '');

    const rows = [
        new ActionRowBuilder().addComponents(mapNumberInput),
        new ActionRowBuilder().addComponents(serverInput),
    ];

    return rows;
}

export function getRaidWizardDetailsModal(sessionId, { includeMapName = false, defaults = {} } = {}) {
    return buildRaidWizardDetailsModal({
        customId: `raidWizardDetailsModal_${sessionId}`,
        title: 'Raid Assistance Request',
        includeMapName,
        defaults,
    });
}

export function getRaidWizardEditDetailsModal(sessionId, { includeMapName = false, defaults = {} } = {}) {
    const rows = getRaidWizardEditDetailsModalFields(defaults);

    if (includeMapName) {
        const mapNameInput = new TextInputBuilder()
            .setCustomId('mapNameInput')
            .setLabel('Map Name (optional):')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setPlaceholder('Comma-separated e.g., doomwood, necropolis')
            .setValue(defaults.mapName ?? '');
        rows.unshift(new ActionRowBuilder().addComponents(mapNameInput));
    }

    return new ModalBuilder()
        .setCustomId(`raidWizardEditDetailsModal_${sessionId}`)
        .setTitle('Edit Server')
        .addComponents(...rows);
}

const CATEGORY_DEFS = RAID_TASK_CATEGORIES;

function formatCategoryTasksPreview(taskKeys = []) {
    const names = taskKeys
        .slice(0, 4)
        .map((taskKey) => TASK_DISPLAY_NAMES?.[taskKey] ?? taskKey);
    const preview = names.join(', ');
    return taskKeys.length > 4 ? `${preview}…` : preview;
}

export function getRaidWizardCategoryDef(categoryKey) {
    return CATEGORY_DEFS.find((c) => c.key === categoryKey) ?? null;
}

export function getRaidWizardTaskOptionsCount(categoryKeys) {
    const categories = (categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);
    const uniqueTaskKeys = [...new Set(categories.flatMap((c) => c.tasks))];

    // 1 global "all selected" + 1 per category "all ..." + each task.
    return 1 + categories.length + uniqueTaskKeys.length;
}

export function getRaidWizardCategorySelectRow(sessionId, selectedCategoryKeys = []) {
    const selectedSet = new Set(selectedCategoryKeys || []);

    const categorySelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`raidWizard_category_${sessionId}`)
        .setPlaceholder('Select a task category')
        .setMinValues(1)
        .setMaxValues(CATEGORY_DEFS.length)
        .addOptions(
            CATEGORY_DEFS.map((c) => ({
                label: c.label,
                value: c.key,
                description: formatCategoryTasksPreview(c.tasks).slice(0, 100),
                default: selectedSet.has(c.key),
            })),
        );

    return new ActionRowBuilder().addComponents(categorySelectMenu);
}

export function getRaidWizardEditCategorySelectRow(sessionId, selectedCategoryKeys = []) {
    const row = getRaidWizardCategorySelectRow(sessionId, selectedCategoryKeys);
    row.components[0].setCustomId(`raidWizardEdit_category_${sessionId}`);
    return row;
}

function describeTaskOption(taskKey) {
  if (Object.prototype.hasOwnProperty.call(POINTS_CONFIG, taskKey)) {
        const name = TASK_DISPLAY_NAMES?.[taskKey];
        const base = `${POINTS_CONFIG[taskKey]} EXP`;
        return (name ? `${base} — ${name}` : base).slice(0, 100);
  }

  return 'Task'.slice(0, 100);
}

function getTaskLabel(taskKey) {
    return String(TASK_DISPLAY_NAMES?.[taskKey] ?? taskKey).slice(0, 100);
}

export function getRaidWizardTasksSelectRow(sessionId, categoryKeys, selectedTasks = []) {
    const categories = (categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);
    const taskKeys = categories.flatMap((c) => c.tasks);
    const uniqueTaskKeys = [...new Set(taskKeys)];

    const selectedSet = new Set(selectedTasks || []);

    const perCategoryAllOptions = categories.map((c) => ({
        label: `All ${c.label}`.slice(0, 100),
        value: `__all__:${c.key}`,
        description: `Select everything in ${c.label}`.slice(0, 100),
        default: false,
    }));

    const options = [
        {
            label: 'All selected categories',
            value: '__all_selected__',
            description: 'Select everything from all selected categories'.slice(0, 100),
            default: false,
        },
        ...perCategoryAllOptions,
        ...uniqueTaskKeys.map((taskKey) => ({
            label: getTaskLabel(taskKey),
            value: taskKey,
            description: describeTaskOption(taskKey),
            default: selectedSet.has(taskKey),
        })),
    ].slice(0, 25);

    const tasksSelectMenu = new StringSelectMenuBuilder()
        .setCustomId(`raidWizard_tasks_${sessionId}`)
        .setPlaceholder('Select task(s)')
        .setMinValues(1)
        .setMaxValues(Math.max(1, options.length))
        .addOptions(options);

    return new ActionRowBuilder().addComponents(tasksSelectMenu);
}

export function getRaidWizardEditTasksSelectRow(sessionId, categoryKey, selectedTasks = []) {
    const row = getRaidWizardTasksSelectRow(sessionId, categoryKey, selectedTasks);
    row.components[0].setCustomId(`raidWizardEdit_tasks_${sessionId}`);
    return row;
}

export function getRaidWizardNavRow(sessionId, { step, canContinue }) {
    const backDisabled = step === 'category';
    const isSubmitStep = step === 'tasks';

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`raidWizard_back_${sessionId}`)
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(backDisabled),

        new ButtonBuilder()
            .setCustomId(`raidWizard_continue_${sessionId}`)
            .setLabel(isSubmitStep ? 'Submit' : 'Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!canContinue),

        new ButtonBuilder()
            .setCustomId(`raidWizard_cancel_${sessionId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger),
    );
}

export function getRaidWizardEditNavRow(sessionId, { step, canContinue }) {
    const row = getRaidWizardNavRow(sessionId, { step, canContinue });
    row.components[0].setCustomId(`raidWizardEdit_back_${sessionId}`);
    row.components[1].setCustomId(`raidWizardEdit_continue_${sessionId}`);
    row.components[2].setCustomId(`raidWizardEdit_cancel_${sessionId}`);
    return row;
}

function text(content) {
    return new TextDisplayBuilder().setContent(String(content || '\u200b').slice(0, 4000));
}

function separator() {
    return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
}

export function getRaidWizardEditCategoryV2(sessionId, categoryKeys, tasks) {
    const categories = (categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);
    const categoryText = categories.length ? categories.map((c) => `• **${c.label}**`).join('\n') : '*None*';
    const taskText = tasks.length ? tasks.map((t) => TASK_DISPLAY_NAMES?.[t] ?? t).join(', ') : '*None*';

    const optionCount = getRaidWizardTaskOptionsCount(categoryKeys);
    const canContinue = categoryKeys.length > 0 && optionCount <= 25;
    const taskCountText = canContinue
        ? `This selection will show **${optionCount}** options on Page 2.`
        : categoryKeys.length > 0
            ? `Too many tasks (**${optionCount}** options). Select fewer categories (max 25 options).`
            : '*Select categories to continue*';

    const container = new ContainerBuilder()
        .setAccentColor(EMBED_COLOR)
        .addTextDisplayComponents(text('### Edit Raid - Page 1/2'))
        .addTextDisplayComponents(text('Select a task category.'))
        .addTextDisplayComponents(text(`**Selected Categories**\n${categoryText}`))
        .addTextDisplayComponents(text(`**Current Tasks**\n${taskText}`))
        .addTextDisplayComponents(text(`You can scroll down for more options.`))   
        .addActionRowComponents(getRaidWizardEditCategorySelectRow(sessionId, categoryKeys))
        .addSeparatorComponents(separator())
        .addActionRowComponents(getRaidWizardEditNavRow(sessionId, { step: 'category', canContinue }));

    return container;
}

export function getRaidWizardEditTasksV2(sessionId, categoryKeys, tasks) {
    const categories = (categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);
    const categoryLabel = categories.length ? categories.map((c) => c.label).join(', ') : categoryKeys.join(', ');
    const taskText = tasks.length ? tasks.map((t) => TASK_DISPLAY_NAMES?.[t] ?? t).join(', ') : '*None*';

    const components = [
        text('### Edit Raid - Page 2/2'),
        text(`Select the tasks for **${categoryLabel || 'selected categories'}**.`),
        text(`**Selected Tasks**\n${taskText}`),
        text('You can scroll down for more options.'),
    ];

    if ((categoryKeys || []).some((key) => key === 'generic' || key === 'spamming')) {
        components.push(
            text('**Generic & Spamming**\n• **Generic** — choose a 2/4/5/7-man room task and enter map name(s) in the raid form.\n• **Spamming** — choose a 2/4/5/7-man spamming task and enter map name(s). EXP is time-based (300/min, cap 10,000).'),
        );
    }

    const container = new ContainerBuilder().setAccentColor(EMBED_COLOR);

    for (const c of components) {
        container.addTextDisplayComponents(c);
    }

    return container
        .addActionRowComponents(getRaidWizardEditTasksSelectRow(sessionId, categoryKeys, tasks))
        .addSeparatorComponents(separator())
        .addActionRowComponents(getRaidWizardEditNavRow(sessionId, { step: 'tasks', canContinue: tasks.length > 0 }));
}

