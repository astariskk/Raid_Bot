import { MessageFlags, TextDisplayBuilder } from 'discord.js';

import {
    getRaidWizardCategoryPage,
    getRaidWizardTaskOptionsCount,
    getRaidWizardTasksPage,
} from '../embeds/raidWizardUi.js';
import { getWizardComponentPrefix, getWizardSessionExpiredMessage, WIZARD_MODE } from './constants.js';
import { expandWizardTaskSelection } from './taskSelection.js';

function text(content) {
    return new TextDisplayBuilder().setContent(String(content || '\u200b').slice(0, 4000));
}

function pickSessionIdFromNavCustomId(customId, mode) {
    const prefix = getWizardComponentPrefix(mode);
    for (const part of ['cancel', 'back', 'continue']) {
        const full = `${prefix}_${part}_`;
        if (customId.startsWith(full)) {
            return customId.slice(full.length);
        }
    }
    return null;
}

/**
 * Handles Back / Next|Submit / Cancel for create or edit task wizards.
 * @param {import('discord.js').ButtonInteraction} interaction
 * @param {import('./constants.js').RaidWizardMode} mode
 * @param {{
 *   getSession: (sessionId: string) => object | null,
 *   validateSession: (session: object) => boolean,
 *   onCancelMessage?: string,
 *   onContinueFromTasks: (interaction: object, session: object) => Promise<void>,
 * }} handlers
 */
export async function handleRaidWizardNavButtons(interaction, mode, handlers) {
    if (!interaction.isButton()) return false;

    const prefix = getWizardComponentPrefix(mode);
    if (!interaction.customId.startsWith(`${prefix}_`)) return false;

    const sessionId = pickSessionIdFromNavCustomId(interaction.customId, mode);
    if (!sessionId) return false;

    const session = handlers.getSession(sessionId);
    if (!session || !handlers.validateSession(session)) {
        await interaction.reply({
            content: getWizardSessionExpiredMessage(mode),
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    const cancelId = `${prefix}_cancel_${sessionId}`;
    const backId = `${prefix}_back_${sessionId}`;
    const continueId = `${prefix}_continue_${sessionId}`;

    if (interaction.customId === cancelId) {
        handlers.onCancel?.(sessionId);
        await interaction.update({
            components: [text(handlers.onCancelMessage ?? (mode === WIZARD_MODE.EDIT ? 'Edit cancelled.' : 'Raid creation cancelled.'))],
            flags: MessageFlags.IsComponentsV2,
        });
        return true;
    }

    if (interaction.customId === backId) {
        const updated = handlers.onBack?.(sessionId, session) ?? session;
        const currentTasks = updated.tasks ?? session.tasks ?? [];
        await interaction.update({
            components: [getRaidWizardCategoryPage(mode, sessionId, updated.categoryKeys ?? session.categoryKeys, currentTasks)],
            flags: MessageFlags.IsComponentsV2,
        });
        return true;
    }

    if (interaction.customId === continueId) {
        if (session.step === 'category') {
            if (!session.categoryKeys?.length) {
                await interaction.reply({ content: 'Select at least one category first.', flags: MessageFlags.Ephemeral });
                return true;
            }

            const optionCount = getRaidWizardTaskOptionsCount(session.categoryKeys);
            if (optionCount > 25) {
                await interaction.reply({
                    content: 'Too many tasks selected. Pick fewer categories (max 25 options).',
                    flags: MessageFlags.Ephemeral,
                });
                return true;
            }

            const updated = handlers.onAdvanceToTasks?.(sessionId, session) ?? session;
            await interaction.update({
                components: [getRaidWizardTasksPage(mode, sessionId, updated.categoryKeys, updated.tasks ?? [])],
                flags: MessageFlags.IsComponentsV2,
            });
            return true;
        }

        if (!session.tasks?.length) {
            await interaction.reply({ content: 'Select at least one task first.', flags: MessageFlags.Ephemeral });
            return true;
        }

        await handlers.onContinueFromTasks(interaction, session);
        return true;
    }

    return false;
}

/**
 * @param {import('discord.js').StringSelectMenuInteraction} interaction
 * @param {import('./constants.js').RaidWizardMode} mode
 * @param {{
 *   getSession: (sessionId: string) => object | null,
 *   validateSession: (session: object) => boolean,
 *   updateCategoryKeys: (sessionId: string, categoryKeys: string[], opts?: { autoAdvance?: boolean }) => object | null,
 *   updateTasks: (sessionId: string, tasks: string[]) => object | null,
 *   autoAdvanceOnValidCategory?: boolean,
 * }} handlers
 */
export async function handleRaidWizardTaskSelect(interaction, mode, handlers) {
    if (!interaction.isStringSelectMenu()) return false;

    const prefix = getWizardComponentPrefix(mode);
    const categoryPrefix = `${prefix}_category_`;
    const tasksPrefix = `${prefix}_tasks_`;

    let sessionId = null;
    let kind = null;

    if (interaction.customId.startsWith(categoryPrefix)) {
        sessionId = interaction.customId.slice(categoryPrefix.length);
        kind = 'category';
    } else if (interaction.customId.startsWith(tasksPrefix)) {
        sessionId = interaction.customId.slice(tasksPrefix.length);
        kind = 'tasks';
    } else {
        return false;
    }

    const session = handlers.getSession(sessionId);
    if (!session || !handlers.validateSession(session)) {
        await interaction.reply({
            content: getWizardSessionExpiredMessage(mode),
            flags: MessageFlags.Ephemeral,
        });
        return true;
    }

    if (kind === 'category') {
        const categoryKeys = interaction.values || [];
        const optionCount = getRaidWizardTaskOptionsCount(categoryKeys);
        const canContinue = categoryKeys.length > 0 && optionCount <= 25;
        const autoAdvance = handlers.autoAdvanceOnValidCategory && canContinue;

        const updated = handlers.updateCategoryKeys(sessionId, categoryKeys, { autoAdvance });
        if (!updated) return true;

        if (autoAdvance) {
            await interaction.update({
                components: [getRaidWizardTasksPage(mode, sessionId, updated.categoryKeys, updated.tasks ?? [])],
                flags: MessageFlags.IsComponentsV2,
            });
            return true;
        }

        await interaction.update({
            components: [getRaidWizardCategoryPage(mode, sessionId, updated.categoryKeys, updated.tasks ?? [])],
            flags: MessageFlags.IsComponentsV2,
        });
        return true;
    }

    const tasks = expandWizardTaskSelection(interaction.values || [], session.categoryKeys);
    const updated = handlers.updateTasks(sessionId, tasks);
    if (!updated) return true;

    await interaction.update({
        components: [getRaidWizardTasksPage(mode, sessionId, updated.categoryKeys, tasks)],
        flags: MessageFlags.IsComponentsV2,
    });
    return true;
}
