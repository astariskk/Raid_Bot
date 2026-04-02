import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} from 'discord.js';

import {
    updateRaid,
    updateRaidLogEmbed
} from '../../activeRaidState.js';

import { DAILIES_LIST, EMBED_COLOR, GENERIC_TASKS_LIST, LEGION_LIST, ORIGINUL_LIST, OTHERS_FOUR_LIST, OTHERS_SEVEN_LIST, TEMPLESHRINE_LIST, WEEKLIES_LIST } from '../../config/constants.js';
import { validateAndResolveTaskList, validateAndResolveTasks } from '../../utils/allowedTasks.js';
import { requireAuth } from './ticketUtils.js';
import { finalizeAdminReview } from './ticketReview.js';
import { consumeRaidWizardSession, createRaidWizardSession, getRaidWizardSession, updateRaidWizardSession } from './raidWizardSession.js';
import { getRaidWizardCategoryDef, getRaidWizardEditCategorySelectRow, getRaidWizardEditDetailsModal, getRaidWizardEditNavRow, getRaidWizardEditTasksSelectRow, getRaidWizardTaskOptionsCount } from '../../Embeds/raidTicketEmbeds.js';
import { parseRaidTasks } from '../../utils/raidMaps.js';

/* -------------------- MAIN HANDLER -------------------- */
export async function handleLifecycleInteractions(interaction, raidInfo, client) {

    /* ---------- AWAITING COMPLETION LOCK ---------- */
    if (raidInfo?.isAwaitingCompletion) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: "The raid closure confirmation is currently active. Please confirm or use the 'Abort' button.",
                flags: MessageFlags.Ephemeral
            }).catch(() => {});
        }
        return;
    }

    /* ---------- AUTH ---------- */
    if (!await requireAuth(interaction, raidInfo)) return;

    /* ---------- 1. EDIT TASK ---------- */
    if (interaction.customId === "editTask_btn") {
        const sessionId = createRaidWizardSession({ userId: interaction.user.id, guildId: interaction.guildId });

        const existingTokens = parseRaidTasks(raidInfo.task || '');
        const existingExpanded = [];
        for (const token of existingTokens) {
            // Old tickets may contain meta group names like "dailies" or aliases.
            // Keep it simple: we only attempt to classify based on canonical task keys.
            if (token === 'dailies') existingExpanded.push(...DAILIES_LIST);
            else if (token === 'weeklies') existingExpanded.push(...WEEKLIES_LIST);
            else if (token === 'templeshrine') existingExpanded.push(...TEMPLESHRINE_LIST);
            else if (token === 'originul') existingExpanded.push(...ORIGINUL_LIST);
            else if (token === 'legion') existingExpanded.push(...LEGION_LIST);
            else existingExpanded.push(token);
        }

        const uniqueExpanded = [...new Set(existingExpanded.map((t) => String(t).toLowerCase()))].filter(Boolean);

        const inferCategoryKeys = (tasks) => {
            const keys = new Set();
            for (const t of tasks) {
                if (DAILIES_LIST.includes(t)) keys.add('dailies');
                else if (WEEKLIES_LIST.includes(t)) keys.add('weeklies');
                else if (TEMPLESHRINE_LIST.includes(t)) keys.add('templeshrine');
                else if (ORIGINUL_LIST.includes(t)) keys.add('originul');
                else if (LEGION_LIST.includes(t)) keys.add('legion');
                else if (OTHERS_FOUR_LIST.includes(t)) keys.add('other_four');
                else if (OTHERS_SEVEN_LIST.includes(t)) keys.add('other_seven');
                else if (GENERIC_TASKS_LIST.includes(t)) keys.add('generic');
            }
            return [...keys];
        };

        const categoryKeys = inferCategoryKeys(uniqueExpanded);

        updateRaidWizardSession(sessionId, {
            mode: 'edit',
            channelId: interaction.channel.id,
            step: 'category',
            categoryKeys,
            tasks: uniqueExpanded,
            defaults: {
                mapName: raidInfo.mapName ?? '',
                mapNumber: raidInfo.mapNumber ?? '',
                server: raidInfo.server ?? '',
                description: raidInfo.description ?? '',
            },
        });

        const embed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle('Edit Raid')
            .setDescription('Page 1/2: Select a category.');

        if (categoryKeys.length) {
            const labels = categoryKeys.map((k) => getRaidWizardCategoryDef(k)?.label ?? k);
            embed.addFields({ name: 'Selected Categories', value: labels.map((l) => `• **${l}**`).join('\n').slice(0, 1024), inline: false });
        }

        await interaction.reply({
            embeds: [embed],
            components: [
                getRaidWizardEditCategorySelectRow(sessionId, categoryKeys),
                getRaidWizardEditNavRow(sessionId, { step: 'category', canContinue: categoryKeys.length > 0 }),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    /* ---------- EDIT WIZARD (BUTTONS) ---------- */
    if (interaction.isButton() && interaction.customId.startsWith('raidWizardEdit_')) {
        const pick = (prefix) => (interaction.customId.startsWith(prefix) ? interaction.customId.slice(prefix.length) : null);

        const cancelSessionId = pick('raidWizardEdit_cancel_');
        const backSessionId = pick('raidWizardEdit_back_');
        const continueSessionId = pick('raidWizardEdit_continue_');

        const sessionId = cancelSessionId || backSessionId || continueSessionId;
        if (!sessionId) return;

        const session = getRaidWizardSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This edit session expired. Press Edit Task again.', flags: MessageFlags.Ephemeral });
            return;
        }

        const categories = (session.categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);

        if (cancelSessionId) {
            consumeRaidWizardSession(cancelSessionId);
            await interaction.update({ content: 'Edit cancelled.', embeds: [], components: [] });
            return;
        }

        if (backSessionId) {
            const updated = updateRaidWizardSession(backSessionId, { step: 'category' });
            const embed = new EmbedBuilder()
                .setColor(EMBED_COLOR)
                .setTitle('Edit Raid')
                .setDescription('Page 1/2: Select a category.');
            if (updated.categoryKeys?.length) {
                const labels = updated.categoryKeys.map((k) => getRaidWizardCategoryDef(k)?.label ?? k);
                embed.addFields({ name: 'Selected Categories', value: labels.map((l) => `• **${l}**`).join('\n').slice(0, 1024), inline: false });
            }

            await interaction.update({
                embeds: [embed],
                components: [
                    getRaidWizardEditCategorySelectRow(backSessionId, updated.categoryKeys),
                    getRaidWizardEditNavRow(backSessionId, { step: 'category', canContinue: (updated.categoryKeys?.length ?? 0) > 0 }),
                ],
            });
            return;
        }

        if (continueSessionId) {
            if (session.step === 'category') {
                if (!session.categoryKeys?.length) {
                    await interaction.reply({ content: 'Select at least one category first.', flags: MessageFlags.Ephemeral });
                    return;
                }

                const optionCount = getRaidWizardTaskOptionsCount(session.categoryKeys);
                if (optionCount > 25) {
                    await interaction.reply({ content: 'Too many tasks selected. Pick fewer categories (max 25 options).', flags: MessageFlags.Ephemeral });
                    return;
                }

                const updated = updateRaidWizardSession(continueSessionId, { step: 'tasks' });
                const label = (updated.categoryKeys || []).map((k) => getRaidWizardCategoryDef(k)?.label ?? k).join(', ');

                const embed = new EmbedBuilder()
                    .setColor(EMBED_COLOR)
                    .setTitle('Edit Raid')
                    .setDescription(`Page 2/2: Select task(s) for **${label || 'selected categories'}**.`)
                    .addFields({ name: 'Selected Tasks', value: updated.tasks?.length ? updated.tasks.map((t) => `\`${t}\``).join(', ') : '*None*', inline: false });

                await interaction.update({
                    embeds: [embed],
                    components: [
                        getRaidWizardEditTasksSelectRow(continueSessionId, updated.categoryKeys, updated.tasks),
                        getRaidWizardEditNavRow(continueSessionId, { step: 'tasks', canContinue: (updated.tasks?.length ?? 0) > 0 }),
                    ],
                });
                return;
            }

            if (!session.tasks?.length) {
                await interaction.reply({ content: 'Select at least one task first.', flags: MessageFlags.Ephemeral });
                return;
            }

            const inferRaidType = (categoryKeys) => {
                const keys = (categoryKeys || []).filter(Boolean);
                if (!keys.length) return 'other';
                const typeSet = new Set();
                for (const key of keys) {
                    if (['dailies', 'weeklies', 'templeshrine', 'other_four'].includes(key)) typeSet.add('4-man');
                    else if (['originul', 'legion', 'other_seven'].includes(key)) typeSet.add('7-man');
                    else typeSet.add('other');
                }
                if (typeSet.size === 1) return [...typeSet][0];
                return 'other';
            };

            const raidType = inferRaidType(session.categoryKeys) ?? raidInfo.size ?? 'other';
            const mapNameRequired = session.tasks?.some((t) => GENERIC_TASKS_LIST.includes(t)) ?? false;
            const defaults = session.defaults ?? {};

            await interaction.showModal(getRaidWizardEditDetailsModal(continueSessionId, raidType, { mapNameRequired, defaults }));
        }
        return;
    }

    /* ---------- EDIT WIZARD (MODAL SUBMIT) ---------- */
    if (interaction.isModalSubmit() && interaction.customId.startsWith('raidWizardEditDetailsModal_')) {
        const sessionId = interaction.customId.slice('raidWizardEditDetailsModal_'.length);
        const session = consumeRaidWizardSession(sessionId);

        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This edit session expired. Press Edit Task again.', flags: MessageFlags.Ephemeral });
            return;
        }

        const inferRaidType = (categoryKeys) => {
            const keys = (categoryKeys || []).filter(Boolean);
            if (!keys.length) return 'other';
            const typeSet = new Set();
            for (const key of keys) {
                if (['dailies', 'weeklies', 'templeshrine', 'other_four'].includes(key)) typeSet.add('4-man');
                else if (['originul', 'legion', 'other_seven'].includes(key)) typeSet.add('7-man');
                else typeSet.add('other');
            }
            if (typeSet.size === 1) return [...typeSet][0];
            return 'other';
        };

        const raidType = inferRaidType(session.categoryKeys);

        const { resolvedTasks, invalidTasks } = validateAndResolveTaskList(session.tasks, 'any');
        if (invalidTasks.length) {
            await interaction.reply({ content: `Invalid tasks: ${invalidTasks.join(', ')}`, flags: MessageFlags.Ephemeral });
            return;
        }

        const mapName = interaction.fields.getTextInputValue('mapNameInput');
        const mapNumber = interaction.fields.getTextInputValue('mapNumberInput');
        const server = interaction.fields.getTextInputValue('serverInput');
        const description = interaction.fields.getTextInputValue('descriptionInput') || 'No description.';

        const isMapNameRequired = resolvedTasks.some((t) => GENERIC_TASKS_LIST.includes(t));
        if (isMapNameRequired && !String(mapName ?? '').trim()) {
            await interaction.reply({ content: 'Map Name is required for generic tasks (`simple`, `moderate`, `hard`).', flags: MessageFlags.Ephemeral });
            return;
        }

        const updates = {
            task: resolvedTasks.join(', '),
            mapName: mapName || 'Auto (based on task)',
            mapNumber,
            server,
            description,
            size: raidType,
        };

        await updateRaid(interaction.channel.id, updates);

        await updateRaidLogEmbed(client, interaction.channel.id, {
            title: `${raidType} Raid Request`,
            fields: [
                { name: 'Task(s)', value: updates.task },
                { name: 'Map', value: `${updates.mapName}` },
                { name: 'Room Number', value: `${updates.mapNumber}`, inline: true },
                { name: 'Server', value: updates.server, inline: true },
                { name: 'Description', value: updates.description },
            ],
        });

        const updatedContent = 'Raid updated.';
        const updatedEmbed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle('Edit Raid')
            .setDescription(updatedContent);

        try {
            if (typeof interaction.isFromMessage === 'function' && interaction.isFromMessage() && interaction.message) {
                await interaction.update({ content: null, embeds: [updatedEmbed], components: [] });
            } else {
                await interaction.reply({ content: updatedContent, flags: MessageFlags.Ephemeral });
            }
        } catch (err) {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: updatedContent, flags: MessageFlags.Ephemeral }).catch(() => {});
            }
            console.error('Failed to update edit wizard message after modal submit:', err);
        }
        return;
    }

    /* ---------- EDIT WIZARD (SELECT MENUS) ---------- */
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raidWizardEdit_')) {
        const pick = (prefix) => (interaction.customId.startsWith(prefix) ? interaction.customId.slice(prefix.length) : null);
        const categorySessionId = pick('raidWizardEdit_category_');
        const tasksSessionId = pick('raidWizardEdit_tasks_');
        const sessionId = categorySessionId || tasksSessionId;
        if (!sessionId) return;

        const session = getRaidWizardSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This edit session expired. Press Edit Task again.', flags: MessageFlags.Ephemeral });
            return;
        }

        if (categorySessionId) {
            const categoryKeys = interaction.values || [];
            const updated = updateRaidWizardSession(sessionId, { categoryKeys, step: 'category', tasks: [] });
            const labels = updated.categoryKeys.map((k) => getRaidWizardCategoryDef(k)?.label ?? k);

            const embed = new EmbedBuilder()
                .setColor(EMBED_COLOR)
                .setTitle('Edit Raid')
                .setDescription('Page 1/2: Select a category.')
                .addFields({ name: 'Selected Categories', value: labels.length ? labels.map((l) => `• **${l}**`).join('\n').slice(0, 1024) : '*None*', inline: false });

            await interaction.update({
                embeds: [embed],
                components: [
                    getRaidWizardEditCategorySelectRow(sessionId, updated.categoryKeys),
                    getRaidWizardEditNavRow(sessionId, { step: 'category', canContinue: updated.categoryKeys.length > 0 && getRaidWizardTaskOptionsCount(updated.categoryKeys) <= 25 }),
                ],
            });
            return;
        }

        if (tasksSessionId) {
            const rawSelected = interaction.values || [];
            const categories = (session.categoryKeys || []).map(getRaidWizardCategoryDef).filter(Boolean);
            const allTasksForAllCategories = [...new Set(categories.flatMap((c) => c.tasks))];

            let tasks = [];
            if (rawSelected.includes('__all_selected__')) {
                tasks = allTasksForAllCategories;
            } else {
                const perCategoryAll = rawSelected
                    .filter((v) => v.startsWith('__all__:'))
                    .map((v) => v.slice('__all__:'.length));

                const expanded = perCategoryAll.flatMap((catKey) => getRaidWizardCategoryDef(catKey)?.tasks ?? []);
                const explicit = rawSelected.filter((v) => !v.startsWith('__all__:') && v !== '__all_selected__');
                tasks = [...new Set([...expanded, ...explicit])].filter(Boolean);
            }
            const updated = updateRaidWizardSession(sessionId, { tasks, step: 'tasks' });
            const label = (updated.categoryKeys || []).map((k) => getRaidWizardCategoryDef(k)?.label ?? k).join(', ');

            const embed = new EmbedBuilder()
                .setColor(EMBED_COLOR)
                .setTitle('Edit Raid')
                .setDescription(`Page 2/2: Select task(s) for **${label || 'selected categories'}**.`)
                .addFields({ name: 'Selected Tasks', value: tasks.length ? tasks.map((t) => `\`${t}\``).join(', ') : '*None*', inline: false });

            await interaction.update({
                embeds: [embed],
                components: [
                    getRaidWizardEditTasksSelectRow(sessionId, updated.categoryKeys, tasks),
                    getRaidWizardEditNavRow(sessionId, { step: 'tasks', canContinue: tasks.length > 0 }),
                ],
            });
        }
        return;
    }

    /* ---------- 2. EDIT TASK MODAL ---------- */
    if (interaction.isModalSubmit() && interaction.customId === "editTaskModal") {
        const rawTask = interaction.fields.getTextInputValue('editedTaskInput');
        const { resolvedTasks, invalidTasks } =
            validateAndResolveTasks(rawTask, raidInfo.size);

        if (invalidTasks.length) {
            await interaction.reply({
                content: `Invalid tasks: ${invalidTasks.join(", ")}`,
                flags: MessageFlags.Ephemeral
            });
            return;
        }

        const updates = {
            task: resolvedTasks.join(", "),
            mapName: interaction.fields.getTextInputValue('editedMapInput'),
            mapNumber: interaction.fields.getTextInputValue('editedMapNumberInput'),
            server: interaction.fields.getTextInputValue('editedServerInput'),
            description:
                interaction.fields.getTextInputValue('editedDescriptionInput') ||
                "No description."
        };

        await updateRaid(interaction.channel.id, updates);

        await updateRaidLogEmbed(client, interaction.channel.id, {
            fields: [
                { name: "Task(s)", value: updates.task },
                { name: "Map", value: `${updates.mapName}` },
                { name: "Server", value: updates.server },
                { name: "Description", value: updates.description }
            ]
        });

        await interaction.reply({
            content: "Raid updated.",
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    /* ---------- 3. CANCEL RAID ---------- */
    if (interaction.customId === "cancelRaidTicket") {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId("confirmCancelRaid")
                .setLabel("Confirm Cancel")
                .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
                .setCustomId("abortCancelRaid")
                .setLabel("Abort")
                .setStyle(ButtonStyle.Secondary)
        );

        await interaction.reply({
            content: "Cancel this raid?",
            components: [row],
            flags: MessageFlags.Ephemeral
        });
        return;
    }

    if (interaction.customId === "confirmCancelRaid") {
        await interaction.update({
            content: "Raid will now be cancelled.",
            components: []
        });

        await finalizeAdminReview(
            client,
            interaction.channel,
            raidInfo,
            {},
            interaction.user.id,
            "cancelled"
        );
        return;
    }

    if (interaction.customId === "abortCancelRaid") {
        await interaction.update({
            content: "Cancelled.",
            components: []
        });
        return;
    }
}
