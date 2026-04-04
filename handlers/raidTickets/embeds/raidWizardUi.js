import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    StringSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';

import { POINTS_CONFIG, RAID_TASK_CATEGORIES } from '../../../config/constants.js';

function buildRaidWizardDetailsModal({ customId, title, mapNameRequired, defaults }) {
    const modal = new ModalBuilder()
        .setCustomId(customId)
        .setTitle(title);

    const mapNameInput = new TextInputBuilder()
        .setCustomId('mapNameInput')
        .setLabel(mapNameRequired ? 'Map Name:' : 'Map Name (optional):')
        .setStyle(TextInputStyle.Short)
        .setRequired(mapNameRequired)
        .setPlaceholder('If you have a specific order in mind or need to specify a map.')
        .setValue(defaults.mapName ?? '');

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

    modal.addComponents(
        new ActionRowBuilder().addComponents(mapNameInput),
        new ActionRowBuilder().addComponents(mapNumberInput),
        new ActionRowBuilder().addComponents(serverInput),
        new ActionRowBuilder().addComponents(descriptionInput),
    );

    return modal;
}

export function getRaidWizardDetailsModal(sessionId, { mapNameRequired = false, defaults = {} } = {}) {
    return buildRaidWizardDetailsModal({
        customId: `raidWizardDetailsModal_${sessionId}`,
        title: 'Raid Assistance Request',
        mapNameRequired,
        defaults,
    });
}

export function getRaidWizardEditDetailsModal(sessionId, { mapNameRequired = false, defaults = {} } = {}) {
    return buildRaidWizardDetailsModal({
        customId: `raidWizardEditDetailsModal_${sessionId}`,
        title: 'Edit Raid Request',
        mapNameRequired,
        defaults,
    });
}

const CATEGORY_DEFS = RAID_TASK_CATEGORIES;

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
                description: `Tasks: ${c.tasks.slice(0, 4).join(', ')}${c.tasks.length > 4 ? '…' : ''}`.slice(0, 100),
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
        return `${POINTS_CONFIG[taskKey]} EXP`.slice(0, 100);
    }

    return 'Task'.slice(0, 100);
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
            label: taskKey,
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

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`raidWizard_back_${sessionId}`)
            .setLabel('Back')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(backDisabled),

        new ButtonBuilder()
            .setCustomId(`raidWizard_continue_${sessionId}`)
            .setLabel('Next')
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

