import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    ModalBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';

import { EMBED_COLOR, POINTS_CONFIG, RAID_TASK_CATEGORIES, TASK_DISPLAY_NAMES } from '../../../config/constants.js';
import { WIZARD_MODE, getWizardPageTitle, wizardCustomId } from '../wizard/constants.js';
import { GENERIC_SPAMMING_TASK_GUIDE } from './ticket/constants.js';

function buildRaidWizardDetailsModal({ customId, title, includeMapName = false, requireMapName = false, includeDescription = true, defaults }) {
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

    const rows = [
        new ActionRowBuilder().addComponents(mapNumberInput),
        new ActionRowBuilder().addComponents(serverInput),
    ];

    if (includeDescription) {
        const descriptionInput = new TextInputBuilder()
            .setCustomId('descriptionInput')
            .setLabel('Description/Notes')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setPlaceholder('Any specific details or requirements?')
            .setValue(defaults.description ?? '');
        rows.push(new ActionRowBuilder().addComponents(descriptionInput));
    }

    if (includeMapName) {
        const mapNameInput = new TextInputBuilder()
            .setCustomId('mapNameInput')
            .setLabel(requireMapName ? 'Map Name (required):' : 'Map Name (optional):')
            .setStyle(TextInputStyle.Short)
            .setRequired(requireMapName)
            .setPlaceholder('Comma-separated e.g., doomwood, necropolis')
            .setValue(defaults.mapName ?? '');
        rows.unshift(new ActionRowBuilder().addComponents(mapNameInput));
    }

    modal.addComponents(...rows);
    return modal;
}

export function getRaidWizardDetailsModal(sessionId, { includeMapName = false, requireMapName = false, defaults = {} } = {}) {
    return buildRaidWizardDetailsModal({
        customId: `raidWizardDetailsModal_${sessionId}`,
        title: 'Raid Assistance Request',
        includeMapName,
        requireMapName,
        includeDescription: true,
        defaults,
    });
}

export function getRaidWizardEditDetailsModal(sessionId, { includeMapName = false, defaults = {} } = {}) {
    return buildRaidWizardDetailsModal({
        customId: `raidWizardEditDetailsModal_${sessionId}`,
        title: 'Edit Server',
        includeMapName,
        requireMapName: false,
        includeDescription: false,
        defaults,
    });
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
    return 1 + categories.length + uniqueTaskKeys.length;
}

export function getRaidWizardCategorySelectRow(mode, sessionId, selectedCategoryKeys = []) {
    const selectedSet = new Set(selectedCategoryKeys || []);

    const categorySelectMenu = new StringSelectMenuBuilder()
        .setCustomId(wizardCustomId(mode, 'category', sessionId))
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

export function getRaidWizardTasksSelectRow(mode, sessionId, categoryKeys, selectedTasks = []) {
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
        .setCustomId(wizardCustomId(mode, 'tasks', sessionId))
        .setPlaceholder('Select task(s)')
        .setMinValues(1)
        .setMaxValues(Math.max(1, options.length))
        .addOptions(options);

    return new ActionRowBuilder().addComponents(tasksSelectMenu);
}

export function getRaidWizardNavRow(mode, sessionId, { step, canContinue }) {
    const backDisabled = step === 'category';
    const isSubmitStep = step === 'tasks';

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(wizardCustomId(mode, 'back', sessionId))
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(backDisabled),

        new ButtonBuilder()
            .setCustomId(wizardCustomId(mode, 'continue', sessionId))
            .setLabel(isSubmitStep ? 'Submit' : 'Next')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!canContinue),

        new ButtonBuilder()
            .setCustomId(wizardCustomId(mode, 'cancel', sessionId))
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Danger),
    );
}

function text(content) {
    return new TextDisplayBuilder().setContent(String(content || '\u200b').slice(0, 4000));
}

function separator() {
    return new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small).setDivider(true);
}

function hasGenericOrSpammingCategory(categoryKeys = []) {
    return categoryKeys.some((key) => key === 'generic' || key === 'spamming');
}

function getCategoryPageHint(mode, categoryKeys) {
    const optionCount = getRaidWizardTaskOptionsCount(categoryKeys);
    const canContinue = categoryKeys.length > 0 && optionCount <= 25;

    if (mode === WIZARD_MODE.EDIT) {
        if (canContinue) {
            return `This selection will show **${optionCount}** options on Page 2.`;
        }
        if (categoryKeys.length > 0) {
            return `Too many tasks (**${optionCount}** options). Select fewer categories (max 25 options).`;
        }
        return '*Select categories to continue*';
    }

    if (categoryKeys.length > 0 && optionCount > 25) {
        return `Too many tasks (**${optionCount}** options). Select fewer categories (max 25 options).`;
    }
    return 'Note: you can scroll down to see more options.';
}

/** Shared V2 wizard — Page 1 (category). */
export function getRaidWizardCategoryPage(mode, sessionId, categoryKeys, currentTasks = []) {
    const pageTitle = getWizardPageTitle(mode);
    const categories = (categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);
    const categoryText = categories.length ? categories.map((c) => `• **${c.label}**`).join('\n') : '*None*';
    const optionCount = getRaidWizardTaskOptionsCount(categoryKeys);
    const canContinue = categoryKeys.length > 0 && optionCount <= 25;

    const container = new ContainerBuilder()
        .setAccentColor(EMBED_COLOR)
        .addTextDisplayComponents(text(`### ${pageTitle} - Page 1/2`))
        .addTextDisplayComponents(text('Select a task category.'))
        .addTextDisplayComponents(text(`**Selected Categories**\n${categoryText}`));

    if (mode === WIZARD_MODE.EDIT) {
        const taskText = currentTasks.length
            ? currentTasks.map((t) => TASK_DISPLAY_NAMES?.[t] ?? t).join(', ')
            : '*None*';
        container.addTextDisplayComponents(text(`**Current Tasks**\n${taskText}`));
    }

    container
        .addTextDisplayComponents(text(getCategoryPageHint(mode, categoryKeys)))
        .addTextDisplayComponents(text('You can scroll down for more options.'))
        .addActionRowComponents(getRaidWizardCategorySelectRow(mode, sessionId, categoryKeys))
        .addSeparatorComponents(separator())
        .addActionRowComponents(getRaidWizardNavRow(mode, sessionId, { step: 'category', canContinue }));

    return container;
}

/** Shared V2 wizard — Page 2 (tasks). */
export function getRaidWizardTasksPage(mode, sessionId, categoryKeys, tasks = []) {
    const pageTitle = getWizardPageTitle(mode);
    const categories = (categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);
    const categoryLabel = categories.length ? categories.map((c) => c.label).join(', ') : categoryKeys.join(', ');
    const taskText = tasks.length ? tasks.map((t) => TASK_DISPLAY_NAMES?.[t] ?? t).join(', ') : '*None*';

    const components = [
        text(`### ${pageTitle} - Page 2/2`),
        text(
            mode === WIZARD_MODE.CREATE
                ? `Select task(s) for **${categoryLabel || 'selected categories'}**.`
                : `Select the tasks for **${categoryLabel || 'selected categories'}**.`,
        ),
        text(`**Selected Tasks**\n${taskText}`),
        text('You can scroll down for more options.'),
    ];

    if (hasGenericOrSpammingCategory(categoryKeys)) {
        components.push(text(GENERIC_SPAMMING_TASK_GUIDE));
    }

    const container = new ContainerBuilder().setAccentColor(EMBED_COLOR);
    for (const c of components) {
        container.addTextDisplayComponents(c);
    }

    return container
        .addActionRowComponents(getRaidWizardTasksSelectRow(mode, sessionId, categoryKeys, tasks))
        .addSeparatorComponents(separator())
        .addActionRowComponents(getRaidWizardNavRow(mode, sessionId, { step: 'tasks', canContinue: tasks.length > 0 }));
}

/** Start-raid wizard pages (create mode). */
export function getWizardCategoryV2(sessionId, categoryKeys, currentTasks = []) {
    return getRaidWizardCategoryPage(WIZARD_MODE.CREATE, sessionId, categoryKeys, currentTasks);
}

export function getWizardTasksV2(sessionId, categoryKeys, tasks = []) {
    return getRaidWizardTasksPage(WIZARD_MODE.CREATE, sessionId, categoryKeys, tasks);
}

/** Edit-raid wizard pages (edit mode). */
export function getRaidWizardEditCategoryV2(sessionId, categoryKeys, tasks = []) {
    return getRaidWizardCategoryPage(WIZARD_MODE.EDIT, sessionId, categoryKeys, tasks);
}

export function getRaidWizardEditTasksV2(sessionId, categoryKeys, tasks = []) {
    return getRaidWizardTasksPage(WIZARD_MODE.EDIT, sessionId, categoryKeys, tasks);
}
