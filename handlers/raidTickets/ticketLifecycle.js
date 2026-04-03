import {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    MessageFlags
} from 'discord.js';

import {
    updateRaid,
    updateRaidLogEmbed,
    getRaidInfo
} from '../../activeRaidState.js';

import { DAILIES_LIST, EMBED_COLOR, GENERIC_TASKS_LIST, LEGION_LIST, ORIGINUL_LIST, OTHERS_FOUR_LIST, OTHERS_SEVEN_LIST, TEMPLESHRINE_LIST, WEEKLIES_LIST } from '../../config/constants.js';
import { validateAndResolveTaskList } from '../../utils/allowedTasks.js';
import { requireAuth } from './ticketUtils.js';
import { finalizeAdminReview } from './ticketReview.js';
import { consumeRaidWizardSession, createRaidWizardSession, getRaidWizardSession, updateRaidWizardSession } from './raidWizardSession.js';
import { getRaidWizardCategoryDef, getRaidWizardEditCategorySelectRow, getRaidWizardEditDetailsModal, getRaidWizardEditNavRow, getRaidWizardEditTasksSelectRow, getRaidWizardTaskOptionsCount } from '../../Embeds/raidTicketEmbeds.js';
import { parseRaidTasks } from '../../utils/raidMaps.js';

const EDIT_REQUEST_TTL_MS = 10 * 60 * 1000;
const editRequestSessions = new Map(); // sessionId -> { userId, channelId, kind, runsTasks, runsCount, createdAtMs, updatedAtMs }

function newEditRequestSessionId(userId) {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    return `er_${userId}_${ts}_${rand}`.slice(0, 95);
}

function getEditRequestSession(sessionId) {
    const s = editRequestSessions.get(sessionId);
    if (!s) return null;
    if (Date.now() - s.updatedAtMs > EDIT_REQUEST_TTL_MS) {
        editRequestSessions.delete(sessionId);
        return null;
    }
    return s;
}

function updateEditRequestSession(sessionId, patch) {
    const s = getEditRequestSession(sessionId);
    if (!s) return null;
    const next = { ...s, ...patch, updatedAtMs: Date.now() };
    editRequestSessions.set(sessionId, next);
    return next;
}

function consumeEditRequestSession(sessionId) {
    const s = getEditRequestSession(sessionId);
    editRequestSessions.delete(sessionId);
    return s;
}

function parseTaskRunsMap(taskString) {
    const parts = String(taskString ?? '').split(/\s*[+,]\s*/).map((x) => x.trim()).filter(Boolean);
    const order = [];
    const runsByTask = new Map();

    for (const p of parts) {
        const m = p.match(/^(.+?)\s*x\s*(\d+)$/i);
        const base = String((m ? m[1] : p) ?? '').trim().toLowerCase();
        if (!base) continue;
        const runs = m ? Math.max(1, parseInt(m[2], 10) || 1) : 1;
        if (!runsByTask.has(base)) order.push(base);
        runsByTask.set(base, runs);
    }

    return { order, runsByTask };
}

function formatTaskRunsString({ order, runsByTask }) {
    const out = [];
    for (const key of order) {
        const runs = runsByTask.get(key) ?? 1;
        out.push(runs > 1 ? `${key} x${runs}` : key);
    }
    return out.join(', ');
}

function inferCategoryKeysFromTasks(tasks) {
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
}

function inferRaidTypeFromCategoryKeys(categoryKeys) {
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
}

async function startEditTasksWizard(interaction, raidInfo) {
    const sessionId = createRaidWizardSession({ userId: interaction.user.id, guildId: interaction.guildId });

    const existingTokens = parseRaidTasks(raidInfo.task || '');
    const existingExpanded = [];
    for (const token of existingTokens) {
        if (token === 'dailies') existingExpanded.push(...DAILIES_LIST);
        else if (token === 'weeklies') existingExpanded.push(...WEEKLIES_LIST);
        else if (token === 'templeshrine') existingExpanded.push(...TEMPLESHRINE_LIST);
        else if (token === 'originul') existingExpanded.push(...ORIGINUL_LIST);
        else if (token === 'legion') existingExpanded.push(...LEGION_LIST);
        else existingExpanded.push(token);
    }

    const uniqueExpanded = [...new Set(existingExpanded.map((t) => String(t).toLowerCase()))].filter(Boolean);
    const categoryKeys = inferCategoryKeysFromTasks(uniqueExpanded);

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
        .setTitle('Edit Request')
        .setDescription('Page 1/2: Select a category.');

    if (categoryKeys.length) {
        const labels = categoryKeys.map((k) => getRaidWizardCategoryDef(k)?.label ?? k);
        embed.addFields({ name: 'Selected Categories', value: labels.map((l) => `• **${l}**`).join('\n').slice(0, 1024), inline: false });
    }

    await interaction.update({
        embeds: [embed],
        components: [
            getRaidWizardEditCategorySelectRow(sessionId, categoryKeys),
            getRaidWizardEditNavRow(sessionId, { step: 'category', canContinue: categoryKeys.length > 0 && getRaidWizardTaskOptionsCount(categoryKeys) <= 25 }),
        ],
    });
}

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

    // Load full raid info after auth (minimal raidInfo is passed from the router)
    const fullRaidInfo = await getRaidInfo(interaction.channel.id);
    if (fullRaidInfo) raidInfo = fullRaidInfo;

    /* ---------- EDIT REQUEST (START) ---------- */
    if (interaction.customId === "editRequest_btn" || interaction.customId === "editTask_btn") {
        const sessionId = newEditRequestSessionId(interaction.user.id);
        editRequestSessions.set(sessionId, {
            userId: interaction.user.id,
            channelId: interaction.channel.id,
            kind: null,
            runsTasks: [],
            runsCount: 3,
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
        });

        const embed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle('Edit Request')
            .setDescription('Step 1/2: Select what you want to edit.');

        const select = new StringSelectMenuBuilder()
            .setCustomId(`editRequest_kind_${sessionId}`)
            .setPlaceholder('Choose edit type...')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
                { label: 'Edit tasks', value: 'tasks', description: 'Category + task select (same flow as before)'.slice(0, 100) },
                { label: 'Multiple runs', value: 'runs', description: 'Add xN to selected tasks'.slice(0, 100) },
                { label: 'Edit details', value: 'details', description: 'Map/server/room/description modal'.slice(0, 100) },
            );

        const cancelBtn = new ButtonBuilder()
            .setCustomId(`editRequest_cancel_${sessionId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        await interaction.reply({
            embeds: [embed],
            components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(cancelBtn)],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    if (interaction.isButton?.() && interaction.customId.startsWith('editRequest_cancel_')) {
        const sessionId = interaction.customId.slice('editRequest_cancel_'.length);
        const session = consumeEditRequestSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This edit session expired. Press Edit Request again.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }
        await interaction.update({ content: 'Cancelled.', embeds: [], components: [] }).catch(() => {});
        return;
    }

    if (interaction.isStringSelectMenu?.() && interaction.customId.startsWith('editRequest_kind_')) {
        const sessionId = interaction.customId.slice('editRequest_kind_'.length);
        const session = getEditRequestSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This edit session expired. Press Edit Request again.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        const kind = interaction.values?.[0] ?? null;
        if (!kind) return;
        updateEditRequestSession(sessionId, { kind });

        if (kind === 'tasks') {
            await startEditTasksWizard(interaction, raidInfo);
            consumeEditRequestSession(sessionId);
            return;
        }

        if (kind === 'details') {
            const wizardSessionId = createRaidWizardSession({ userId: interaction.user.id, guildId: interaction.guildId });
            const { order } = parseTaskRunsMap(raidInfo.task || '');
            const categoryKeys = inferCategoryKeysFromTasks(order);

            updateRaidWizardSession(wizardSessionId, {
                mode: 'edit',
                channelId: interaction.channel.id,
                step: 'tasks',
                categoryKeys,
                tasks: order,
                defaults: {
                    mapName: raidInfo.mapName ?? '',
                    mapNumber: raidInfo.mapNumber ?? '',
                    server: raidInfo.server ?? '',
                    description: raidInfo.description ?? '',
                },
            });

            const raidType = inferRaidTypeFromCategoryKeys(categoryKeys);
            const mapNameRequired = (order || []).some((t) => GENERIC_TASKS_LIST.includes(t)) ?? false;
            const defaults = getRaidWizardSession(wizardSessionId)?.defaults ?? {};
            await interaction.showModal(getRaidWizardEditDetailsModal(wizardSessionId, raidType, { mapNameRequired, defaults }));
            consumeEditRequestSession(sessionId);
            return;
        }

        // kind === 'runs'
        const { order } = parseTaskRunsMap(raidInfo.task || '');
        const uniqueTasks = [...new Set(order.map((t) => String(t).toLowerCase()))].filter(Boolean);
        if (!uniqueTasks.length) {
            await interaction.reply({ content: 'No tasks found on this ticket.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        const embed = new EmbedBuilder()
            .setColor(EMBED_COLOR)
            .setTitle('Multiple Runs')
            .setDescription('Step 2/2: Select task(s) and a multiplier, then Save.');

        const tasksSelect = new StringSelectMenuBuilder()
            .setCustomId(`editRequest_runs_tasks_${sessionId}`)
            .setPlaceholder('Select tasks...')
            .setMinValues(1)
            .setMaxValues(Math.min(25, uniqueTasks.length))
            .addOptions(uniqueTasks.slice(0, 25).map((t) => ({ label: t.slice(0, 100), value: t })));

        const runsSelect = new StringSelectMenuBuilder()
            .setCustomId(`editRequest_runs_count_${sessionId}`)
            .setPlaceholder('Select runs...')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(
                { label: 'x1 (remove)', value: '1' },
                { label: 'x2', value: '2' },
                { label: 'x3', value: '3' },
                { label: 'x5', value: '5' },
                { label: 'x10', value: '10' },
            );

        const saveBtn = new ButtonBuilder()
            .setCustomId(`editRequest_runs_save_${sessionId}`)
            .setLabel('Save')
            .setStyle(ButtonStyle.Success)
            .setDisabled(true);

        const cancelBtn = new ButtonBuilder()
            .setCustomId(`editRequest_cancel_${sessionId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        await interaction.update({
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(tasksSelect),
                new ActionRowBuilder().addComponents(runsSelect),
                new ActionRowBuilder().addComponents(saveBtn, cancelBtn),
            ],
        });
        return;
    }

    if (interaction.isStringSelectMenu?.() && interaction.customId.startsWith('editRequest_runs_tasks_')) {
        const sessionId = interaction.customId.slice('editRequest_runs_tasks_'.length);
        const session = getEditRequestSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This edit session expired. Press Edit Request again.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }
        const runsTasks = (interaction.values || []).map((v) => String(v).toLowerCase()).filter(Boolean);
        const updated = updateEditRequestSession(sessionId, { runsTasks });

        // Enable Save when at least 1 task selected (runsCount always has a default).
        const saveBtn = new ButtonBuilder()
            .setCustomId(`editRequest_runs_save_${sessionId}`)
            .setLabel('Save')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!(updated.runsTasks?.length ?? 0));

        const cancelBtn = new ButtonBuilder()
            .setCustomId(`editRequest_cancel_${sessionId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        await interaction.update({
            components: [interaction.message.components[0], interaction.message.components[1], new ActionRowBuilder().addComponents(saveBtn, cancelBtn)],
        });
        return;
    }

    if (interaction.isStringSelectMenu?.() && interaction.customId.startsWith('editRequest_runs_count_')) {
        const sessionId = interaction.customId.slice('editRequest_runs_count_'.length);
        const session = getEditRequestSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This edit session expired. Press Edit Request again.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }
        const raw = interaction.values?.[0] ?? '3';
        const runsCount = Math.max(1, parseInt(raw, 10) || 1);
        updateEditRequestSession(sessionId, { runsCount });
        await interaction.update({ components: interaction.message.components }).catch(() => {});
        return;
    }

    if (interaction.isButton?.() && interaction.customId.startsWith('editRequest_runs_save_')) {
        const sessionId = interaction.customId.slice('editRequest_runs_save_'.length);
        const session = consumeEditRequestSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This edit session expired. Press Edit Request again.', flags: MessageFlags.Ephemeral }).catch(() => {});
            return;
        }

        const { order, runsByTask } = parseTaskRunsMap(raidInfo.task || '');
        const tasksToUpdate = (session.runsTasks || []).map((t) => String(t).toLowerCase()).filter(Boolean);
        const nextRuns = new Map(runsByTask);
        for (const t of tasksToUpdate) {
            if (!nextRuns.has(t)) order.push(t);
            nextRuns.set(t, session.runsCount ?? 3);
        }

        const updatedTaskString = formatTaskRunsString({ order, runsByTask: nextRuns });
        await updateRaid(interaction.channel.id, { task: updatedTaskString });

        await updateRaidLogEmbed(client, interaction.channel.id, {
            fields: [{ name: 'Task(s)', value: updatedTaskString }],
        });

        await interaction.update({
            embeds: [new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Edit Request').setDescription('Updated multiple runs.')],
            components: [],
        }).catch(() => {});
        return;
    }

    /* ---------- 1. EDIT TASK ---------- */
    if (interaction.customId === "editTask_btn") {
        const sessionId = createRaidWizardSession({ userId: interaction.user.id, guildId: interaction.guildId });

        const existingTokens = parseRaidTasks(raidInfo.task || '');
        const existingExpanded = [];
        for (const token of existingTokens) {
            // Old tickets may contain meta group names like "dailies".
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
            await interaction.reply({ content: 'This edit session expired. Press Edit Request again.', flags: MessageFlags.Ephemeral });
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

            const raidType = inferRaidType(session.categoryKeys) ?? 'other';
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
            await interaction.reply({ content: 'This edit session expired. Press Edit Request again.', flags: MessageFlags.Ephemeral });
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
            await interaction.reply({ content: 'Map Name is required for other tasks (`simple`, `moderate`, `difficult`).', flags: MessageFlags.Ephemeral });
            return;
        }

        const updates = {
            task: resolvedTasks.join(', '),
            mapName: mapName || 'Auto (based on task)',
            mapNumber,
            server,
            description,
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
            await interaction.reply({ content: 'This edit session expired. Press Edit Request again.', flags: MessageFlags.Ephemeral });
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
