import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    MessageFlags,
    StringSelectMenuBuilder,
    UserSelectMenuBuilder,
} from 'discord.js';

import { getRaidInfo, updateRaid } from '../../activeRaidState.js';
import { EMBED_COLOR, MAX_XP_PER_RAID, RAID_HELPER_ROLE_ID } from '../../config/constants.js';
import { parseRaidTasks } from '../../utils/raidMaps.js';
import { calculateTaskPointsWithMultiplier } from '../../utils/taskCalculations.js';
import { requireAuth } from './ticketUtils.js';
import { finalizeAdminReview } from './ticketReview.js';
import {
    consumePartialHelperSession,
    createPartialHelperSession,
    getPartialHelperSession,
    updatePartialHelperSession,
} from './partialHelperSession.js';

/* -------------------- CLOSE UI HELPERS -------------------- */
function createHelperSelectRow(maxValues) {
    return new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
            .setCustomId('closeRaid_SelectHelpers')
            .setPlaceholder(`Select Helpers (Max ${maxValues})`)
            .setMaxValues(maxValues)
            .setMinValues(1),
    );
}

function createCloseButtonsRow({ isConfirmEnabled, proofImageUrl }) {
    const hasProof = Boolean(proofImageUrl);

    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('confirmCloseSelection')
            .setLabel('Confirm')
            .setStyle(ButtonStyle.Success)
            .setDisabled(!isConfirmEnabled),

        new ButtonBuilder()
            .setCustomId('partialHelper_btn')
            .setLabel('Partial Helper')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('provideProof')
            .setLabel(hasProof ? 'Proof Attached ✓' : 'Attach Proof')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId('abortCloseRaid')
            .setLabel('Abort')
            .setStyle(ButtonStyle.Secondary),
    );
}

function getMaxHelpersForRaidSize(raidSize) {
    return raidSize === '4-man' ? 3 : raidSize === '7-man' ? 6 : 10;
}

function formatPartialHelpersForClose(raidInfo) {
    const partialHelpers = normalizePartialHelpers(raidInfo);
    if (!partialHelpers.length) return '';

    const lines = partialHelpers
        .map((e) => {
            const tasks = e.tasks?.length ? e.tasks.join(', ') : 'No tasks';
            return `<@${e.helperId}>: ${tasks}`;
        })
        .join('\n')
        .slice(0, 1500);

    return `Partial Helpers:\n${lines}\n\n`;
}

function buildCloseMessagePayload(raidInfo) {
    const selectedIds = Array.isArray(raidInfo?.pendingHelperIds) ? raidInfo.pendingHelperIds : [];
    const maxHelpers = getMaxHelpersForRaidSize(raidInfo?.size);
    const selectRow = createHelperSelectRow(maxHelpers);
    const btnRow = createCloseButtonsRow({ isConfirmEnabled: selectedIds.length > 0, proofImageUrl: raidInfo?.proofImage });

    return {
        content:
            `${formatPartialHelpersForClose(raidInfo)}` +
            `Select the helpers who helped in this raid:\n` +
            `Selected helpers: ${selectedIds.map((id) => `<@${id}>`).join(', ') || 'None'}`,
        components: [selectRow, btnRow],
    };
}

async function refreshCloseMessageIfPossible({ channel, parentMessageId }) {
    if (!channel || !parentMessageId) return;

    try {
        const latest = await getRaidInfo(channel.id);
        if (!latest) return;
        const message = await channel.messages.fetch(parentMessageId).catch(() => null);
        if (!message) return;
        await message.edit(buildCloseMessagePayload(latest));
    } catch (err) {
        console.error('Failed to refresh close message after partial helper update:', err);
    }
}

/* -------------------- PARTIAL HELPER UI HELPERS -------------------- */
function getUniqueRaidTaskKeys(raidInfo) {
    const tokens = parseRaidTasks(raidInfo?.task || '')
        .map((t) => String(t).trim().toLowerCase())
        .filter(Boolean);
    return [...new Set(tokens)];
}

function normalizePartialHelpers(raidInfo) {
    const raw = Array.isArray(raidInfo?.partialHelpers) ? raidInfo.partialHelpers : [];
    return raw
        .map((e) => ({
            helperId: e?.helperId ? String(e.helperId) : null,
            tasks: Array.isArray(e?.tasks) ? e.tasks.map((t) => String(t).toLowerCase()).filter(Boolean) : [],
        }))
        .filter((e) => e.helperId);
}

function formatPartialHelpersList(partialHelpers) {
    if (!partialHelpers.length) return '*None*';
    return partialHelpers
        .map((e) => {
            const tasks = e.tasks?.length ? e.tasks.map((t) => `\`${t}\``).join(', ') : '*No tasks*';
            return `- <@${e.helperId}>: ${tasks}`.slice(0, 1024);
        })
        .join('\n')
        .slice(0, 1024);
}

async function buildPartialHelperEntryOptions(interaction, partialHelpers) {
    const options = [
        { label: 'Add new partial helper', value: '__new__', description: 'Create a new partial helper entry'.slice(0, 100) },
    ];

    for (const entry of partialHelpers) {
        const helperId = entry.helperId;
        let label = `Helper: ${helperId}`.slice(0, 100);

        try {
            const member =
                interaction.guild?.members?.cache?.get(helperId) ??
                (await interaction.guild?.members?.fetch(helperId).catch(() => null));
            if (member) label = `Helper: ${member.displayName}`.slice(0, 100);
        } catch {
            // ignore
        }

        options.push({ label, value: helperId, description: 'Edit this partial helper'.slice(0, 100) });
    }

    return options.slice(0, 25);
}

function buildPartialHelperEmbed({ step, partialHelpers, taskKeys, selectedTasks }) {
    const embed = new EmbedBuilder().setColor(EMBED_COLOR).setTitle('Partial Helpers');

    if (step === 'entry') {
        embed.setDescription(formatPartialHelpersList(partialHelpers));
        return embed;
    }

    if (step === 'tasks') {
        const tasksList = (taskKeys || []).map((t) => `• \`${t}\``).join('\n').slice(0, 3500);
        embed.setDescription(
            `Select the tasks the partial helper helped with.\n\nAvailable tasks in this ticket:\n${tasksList || '*None*'}\n\n` +
            `Selected: ${selectedTasks?.length ? selectedTasks.map((t) => `\`${t}\``).join(', ') : '*None*'}`,
        );
        return embed;
    }

    embed.setDescription(
        `Select the helper(s) to assign to these tasks.\n\n` +
        `Selected tasks: ${selectedTasks?.length ? selectedTasks.map((t) => `\`${t}\``).join(', ') : '*None*'}`,
    );
    return embed;
}

function buildPartialHelperEntryRow(sessionId, options, selectedValue) {
    const selectedSet = new Set(selectedValue ? [selectedValue] : []);

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`partialHelper_entry_${sessionId}`)
        .setPlaceholder('Select a partial helper entry')
        .setMinValues(1)
        .setMaxValues(1)
        .addOptions(options.map((o) => ({ ...o, default: selectedSet.has(o.value) })));

    return new ActionRowBuilder().addComponents(menu);
}

function buildPartialHelperTasksRow(sessionId, taskKeys, selectedTasks) {
    const selectedSet = new Set(selectedTasks || []);
    const options = [
        { label: 'All tasks', value: '__all__', description: 'Select all tasks in this ticket'.slice(0, 100), default: false },
        ...taskKeys.map((t) => ({
            label: t.slice(0, 100),
            value: t,
            description: 'Task'.slice(0, 100),
            default: selectedSet.has(t),
        })),
    ].slice(0, 25);

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`partialHelper_tasks_${sessionId}`)
        .setPlaceholder('Select task(s)')
        .setMinValues(1)
        .setMaxValues(Math.max(1, options.length))
        .addOptions(options);

    return new ActionRowBuilder().addComponents(menu);
}

function buildPartialHelperUserRow(sessionId, { maxValues }) {
    const menu = new UserSelectMenuBuilder()
        .setCustomId(`partialHelper_user_${sessionId}`)
        .setPlaceholder('Select a helper')
        .setMinValues(1)
        .setMaxValues(Math.max(1, maxValues ?? 1));

    return new ActionRowBuilder().addComponents(menu);
}

function buildPartialHelperNavRow(sessionId, { step, canNext, canSave, canRemove }) {
    const row = new ActionRowBuilder();

    if (step === 'entry') {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`partialHelper_remove_${sessionId}`)
                .setLabel('Remove')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!canRemove),
            new ButtonBuilder()
                .setCustomId(`partialHelper_next_${sessionId}`)
                .setLabel('Next')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!canNext),
            new ButtonBuilder()
                .setCustomId(`partialHelper_cancel_${sessionId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Danger),
        );
        return row;
    }

    if (step === 'tasks') {
        row.addComponents(
            new ButtonBuilder().setCustomId(`partialHelper_back_${sessionId}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
                .setCustomId(`partialHelper_next_${sessionId}`)
                .setLabel('Next')
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(!canNext),
            new ButtonBuilder()
                .setCustomId(`partialHelper_cancel_${sessionId}`)
                .setLabel('Cancel')
                .setStyle(ButtonStyle.Danger),
        );
        return row;
    }

    row.addComponents(
        new ButtonBuilder().setCustomId(`partialHelper_back_${sessionId}`).setLabel('Back').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(`partialHelper_save_${sessionId}`)
            .setLabel('Save')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(!canSave),
        new ButtonBuilder().setCustomId(`partialHelper_cancel_${sessionId}`).setLabel('Cancel').setStyle(ButtonStyle.Danger),
    );

    return row;
}

/* -------------------- MAIN HANDLER -------------------- */
export async function handleCompletionInteractions(interaction, raidInfo, client) {
    /* ---------- AUTH ---------- */
    if (!await requireAuth(interaction, raidInfo)) return;

    /* ---------- HARD LOCK: ADMIN REVIEW ---------- */
    if (raidInfo?.status === 'admin_review') {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'The raid is already closed.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return;
    }

    /* ---------- PARTIAL HELPER WIZARD (START) ---------- */
    if (interaction.isButton?.() && interaction.customId === 'partialHelper_btn') {
        const sessionId = createPartialHelperSession({
            userId: interaction.user.id,
            guildId: interaction.guildId,
            channelId: interaction.channel.id,
        });
        updatePartialHelperSession(sessionId, { parentMessageId: interaction.message?.id ?? null });

        const taskKeys = getUniqueRaidTaskKeys(raidInfo);
        if (!taskKeys.length) {
            await interaction.reply({ content: 'No tasks found on this ticket to assign partial helpers.', flags: MessageFlags.Ephemeral });
            return;
        }

        const partialHelpers = normalizePartialHelpers(raidInfo);
        if (!partialHelpers.length) {
            updatePartialHelperSession(sessionId, { step: 'tasks', selectedEntryHelperId: '__new__' });
            await interaction.reply({
                embeds: [buildPartialHelperEmbed({ step: 'tasks', partialHelpers, taskKeys, selectedTasks: [] })],
                components: [
                    buildPartialHelperTasksRow(sessionId, taskKeys, []),
                    buildPartialHelperNavRow(sessionId, { step: 'tasks', canNext: false }),
                ],
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const options = await buildPartialHelperEntryOptions(interaction, partialHelpers);
        await interaction.reply({
            embeds: [buildPartialHelperEmbed({ step: 'entry', partialHelpers })],
            components: [
                buildPartialHelperEntryRow(sessionId, options, null),
                buildPartialHelperNavRow(sessionId, { step: 'entry', canNext: false, canRemove: false }),
            ],
            flags: MessageFlags.Ephemeral,
        });
        return;
    }

    /* ---------- PARTIAL HELPER WIZARD (NAV BUTTONS) ---------- */
    if (interaction.isButton?.() && interaction.customId.startsWith('partialHelper_')) {
        const pick = (prefix) => (interaction.customId.startsWith(prefix) ? interaction.customId.slice(prefix.length) : null);

        const cancelId = pick('partialHelper_cancel_');
        const backId = pick('partialHelper_back_');
        const nextId = pick('partialHelper_next_');
        const saveId = pick('partialHelper_save_');
        const removeId = pick('partialHelper_remove_');
        const sessionId = cancelId || backId || nextId || saveId || removeId;
        if (!sessionId) return;

        const session = getPartialHelperSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({
                content: 'This partial helper session expired. Press Partial Helper again.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        const freshRaidInfo = await getRaidInfo(interaction.channel.id);
        const partialHelpers = normalizePartialHelpers(freshRaidInfo);
        const taskKeys = getUniqueRaidTaskKeys(freshRaidInfo);
        if (!taskKeys.length) {
            consumePartialHelperSession(sessionId);
            await interaction.update({ content: 'No tasks found on this ticket.', embeds: [], components: [] });
            return;
        }

        if (cancelId) {
            const parentMessageId = session.parentMessageId;
            consumePartialHelperSession(sessionId);
            await interaction.update({ content: 'Partial helper cancelled.', embeds: [], components: [] });
            await refreshCloseMessageIfPossible({ channel: interaction.channel, parentMessageId });
            return;
        }

        if (removeId) {
            const helperId = session.selectedEntryHelperId;
            if (!helperId || helperId === '__new__') {
                await interaction.reply({ content: 'Select an existing partial helper entry to remove.', flags: MessageFlags.Ephemeral });
                return;
            }

            const next = partialHelpers.filter((e) => e.helperId !== helperId);
            await updateRaid(interaction.channel.id, { partialHelpers: next });
            await refreshCloseMessageIfPossible({ channel: interaction.channel, parentMessageId: session.parentMessageId });

            const afterRemove = await getRaidInfo(interaction.channel.id);
            const afterList = normalizePartialHelpers(afterRemove);
            const options = await buildPartialHelperEntryOptions(interaction, afterList);
            updatePartialHelperSession(sessionId, { step: afterList.length ? 'entry' : 'tasks', selectedEntryHelperId: null, selectedTasks: [], selectedHelperIds: [] });

            if (!afterList.length) {
                await interaction.update({
                    embeds: [buildPartialHelperEmbed({ step: 'tasks', partialHelpers: [], taskKeys, selectedTasks: [] })],
                    components: [
                        buildPartialHelperTasksRow(sessionId, taskKeys, []),
                        buildPartialHelperNavRow(sessionId, { step: 'tasks', canNext: false }),
                    ],
                });
                return;
            }

            await interaction.update({
                embeds: [buildPartialHelperEmbed({ step: 'entry', partialHelpers: afterList })],
                components: [
                    buildPartialHelperEntryRow(sessionId, options, null),
                    buildPartialHelperNavRow(sessionId, { step: 'entry', canNext: false, canRemove: false }),
                ],
            });
            return;
        }

        if (backId) {
            if (session.step === 'user') {
                const updated = updatePartialHelperSession(sessionId, { step: 'tasks' });
                await interaction.update({
                    embeds: [buildPartialHelperEmbed({ step: 'tasks', partialHelpers, taskKeys, selectedTasks: updated.selectedTasks })],
                    components: [
                        buildPartialHelperTasksRow(sessionId, taskKeys, updated.selectedTasks),
                        buildPartialHelperNavRow(sessionId, { step: 'tasks', canNext: (updated.selectedTasks?.length ?? 0) > 0 }),
                    ],
                });
                return;
            }

            if (!partialHelpers.length) {
                const updated = updatePartialHelperSession(sessionId, { step: 'tasks' });
                await interaction.update({
                    embeds: [buildPartialHelperEmbed({ step: 'tasks', partialHelpers, taskKeys, selectedTasks: updated.selectedTasks })],
                    components: [
                        buildPartialHelperTasksRow(sessionId, taskKeys, updated.selectedTasks),
                        buildPartialHelperNavRow(sessionId, { step: 'tasks', canNext: (updated.selectedTasks?.length ?? 0) > 0 }),
                    ],
                });
                return;
            }

            const options = await buildPartialHelperEntryOptions(interaction, partialHelpers);
            const updated = updatePartialHelperSession(sessionId, { step: 'entry' });
            await interaction.update({
                embeds: [buildPartialHelperEmbed({ step: 'entry', partialHelpers })],
                components: [
                    buildPartialHelperEntryRow(sessionId, options, updated.selectedEntryHelperId),
                    buildPartialHelperNavRow(sessionId, {
                        step: 'entry',
                        canNext: Boolean(updated.selectedEntryHelperId),
                        canRemove: Boolean(updated.selectedEntryHelperId) && updated.selectedEntryHelperId !== '__new__',
                    }),
                ],
            });
            return;
        }

        if (nextId) {
            if (session.step === 'entry') {
                if (!session.selectedEntryHelperId) {
                    await interaction.reply({ content: 'Select an entry first.', flags: MessageFlags.Ephemeral });
                    return;
                }

                const updated = updatePartialHelperSession(sessionId, { step: 'tasks' });
                await interaction.update({
                    embeds: [buildPartialHelperEmbed({ step: 'tasks', partialHelpers, taskKeys, selectedTasks: updated.selectedTasks })],
                    components: [
                        buildPartialHelperTasksRow(sessionId, taskKeys, updated.selectedTasks),
                        buildPartialHelperNavRow(sessionId, { step: 'tasks', canNext: (updated.selectedTasks?.length ?? 0) > 0 }),
                    ],
                });
                return;
            }

            if (session.step === 'tasks') {
                if (!session.selectedTasks?.length) {
                    await interaction.reply({ content: 'Select at least one task first.', flags: MessageFlags.Ephemeral });
                    return;
                }

                const updated = updatePartialHelperSession(sessionId, { step: 'user' });
                await interaction.update({
                    embeds: [buildPartialHelperEmbed({ step: 'user', partialHelpers, selectedTasks: updated.selectedTasks })],
                    components: [
                        buildPartialHelperUserRow(sessionId, { maxValues: getMaxHelpersForRaidSize(freshRaidInfo.size) }),
                        buildPartialHelperNavRow(sessionId, { step: 'user', canSave: (updated.selectedHelperIds?.length ?? 0) > 0 }),
                    ],
                });
                return;
            }
        }

        if (saveId) {
            if (session.step !== 'user') return;
            if (!session.selectedHelperIds?.length) {
                await interaction.reply({ content: 'Select at least one helper first.', flags: MessageFlags.Ephemeral });
                return;
            }
            if (!session.selectedTasks?.length) {
                await interaction.reply({ content: 'Select at least one task first.', flags: MessageFlags.Ephemeral });
                return;
            }

            const helperIds = [...new Set(session.selectedHelperIds.map(String))].filter(Boolean);
            if (helperIds.includes(freshRaidInfo.requesterId)) {
                await interaction.reply({ content: 'The raid requester cannot be added as a helper.', flags: MessageFlags.Ephemeral });
                return;
            }

            const invalidIds = [];
            for (const hid of helperIds) {
                const member = await interaction.guild?.members?.fetch(hid).catch(() => null);
                if (!member || !member.roles.cache.has(RAID_HELPER_ROLE_ID)) invalidIds.push(hid);
            }
            if (invalidIds.length) {
                await interaction.reply({
                    content: `These users must have the <@&${RAID_HELPER_ROLE_ID}> role: ${invalidIds.map((id) => `<@${id}>`).join(', ')}`,
                    flags: MessageFlags.Ephemeral,
                });
                return;
            }

            const tasks = [...new Set(session.selectedTasks.map((t) => String(t).toLowerCase()))].filter(Boolean);
            const originalHelperId = session.selectedEntryHelperId && session.selectedEntryHelperId !== '__new__' ? session.selectedEntryHelperId : null;

            const next = partialHelpers.filter(
                (e) =>
                    !helperIds.includes(e.helperId) &&
                    (!originalHelperId || e.helperId !== originalHelperId),
            );
            for (const hid of helperIds) next.push({ helperId: hid, tasks });

            await updateRaid(interaction.channel.id, { partialHelpers: next });
            await refreshCloseMessageIfPossible({ channel: interaction.channel, parentMessageId: session.parentMessageId });
            consumePartialHelperSession(sessionId);

            await interaction.update({
                embeds: [
                    new EmbedBuilder()
                        .setColor(EMBED_COLOR)
                        .setTitle('Partial Helper Saved')
                        .setDescription(`Saved partial helper for ${helperIds.map((id) => `<@${id}>`).join(', ')}.`),
                ],
                components: [],
            });
            return;
        }
    }

    /* ---------- PARTIAL HELPER WIZARD (SELECT MENUS) ---------- */
    if (interaction.isStringSelectMenu?.() && interaction.customId.startsWith('partialHelper_entry_')) {
        const sessionId = interaction.customId.slice('partialHelper_entry_'.length);
        const session = getPartialHelperSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This partial helper session expired. Press Partial Helper again.', flags: MessageFlags.Ephemeral });
            return;
        }

        const freshRaidInfo = await getRaidInfo(interaction.channel.id);
        const partialHelpers = normalizePartialHelpers(freshRaidInfo);
        const selected = interaction.values?.[0] ?? null;

        if (selected && selected !== '__new__') {
            const entry = partialHelpers.find((e) => e.helperId === selected) ?? null;
            updatePartialHelperSession(sessionId, {
                selectedEntryHelperId: selected,
                selectedTasks: entry?.tasks ?? [],
                selectedHelperIds: [selected],
            });
        } else {
            updatePartialHelperSession(sessionId, { selectedEntryHelperId: '__new__', selectedTasks: [], selectedHelperIds: [] });
        }

        const updated = getPartialHelperSession(sessionId);
        const options = await buildPartialHelperEntryOptions(interaction, partialHelpers);

        await interaction.update({
            embeds: [buildPartialHelperEmbed({ step: 'entry', partialHelpers })],
            components: [
                buildPartialHelperEntryRow(sessionId, options, updated.selectedEntryHelperId),
                buildPartialHelperNavRow(sessionId, {
                    step: 'entry',
                    canNext: Boolean(updated.selectedEntryHelperId),
                    canRemove: Boolean(updated.selectedEntryHelperId) && updated.selectedEntryHelperId !== '__new__',
                }),
            ],
        });
        return;
    }

    if (interaction.isStringSelectMenu?.() && interaction.customId.startsWith('partialHelper_tasks_')) {
        const sessionId = interaction.customId.slice('partialHelper_tasks_'.length);
        const session = getPartialHelperSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This partial helper session expired. Press Partial Helper again.', flags: MessageFlags.Ephemeral });
            return;
        }

        const freshRaidInfo = await getRaidInfo(interaction.channel.id);
        const partialHelpers = normalizePartialHelpers(freshRaidInfo);
        const taskKeys = getUniqueRaidTaskKeys(freshRaidInfo);
        if (!taskKeys.length) {
            await interaction.reply({ content: 'No tasks found on this ticket.', flags: MessageFlags.Ephemeral });
            return;
        }

        const rawSelected = interaction.values || [];
        const selectedTasks = rawSelected.includes('__all__') ? taskKeys : rawSelected.filter((v) => v !== '__all__');
        const updated = updatePartialHelperSession(sessionId, { selectedTasks });

        await interaction.update({
            embeds: [buildPartialHelperEmbed({ step: 'tasks', partialHelpers, taskKeys, selectedTasks: updated.selectedTasks })],
            components: [
                buildPartialHelperTasksRow(sessionId, taskKeys, updated.selectedTasks),
                buildPartialHelperNavRow(sessionId, { step: 'tasks', canNext: (updated.selectedTasks?.length ?? 0) > 0 }),
            ],
        });
        return;
    }

    if (interaction.isUserSelectMenu?.() && interaction.customId.startsWith('partialHelper_user_')) {
        const sessionId = interaction.customId.slice('partialHelper_user_'.length);
        const session = getPartialHelperSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This partial helper session expired. Press Partial Helper again.', flags: MessageFlags.Ephemeral });
            return;
        }

        const helperIds = interaction.values || [];
        const updated = updatePartialHelperSession(sessionId, { selectedHelperIds: helperIds });

        const freshRaidInfo = await getRaidInfo(interaction.channel.id);
        const partialHelpers = normalizePartialHelpers(freshRaidInfo);

        await interaction.update({
            embeds: [buildPartialHelperEmbed({ step: 'user', partialHelpers, selectedTasks: updated.selectedTasks })],
            components: [
                buildPartialHelperUserRow(sessionId, { maxValues: getMaxHelpersForRaidSize(freshRaidInfo.size) }),
                buildPartialHelperNavRow(sessionId, { step: 'user', canSave: (updated.selectedHelperIds?.length ?? 0) > 0 }),
            ],
        });
        return;
    }

    /* ---------- UPDATE HELPER SELECTION ---------- */
    if (interaction.customId === 'closeRaid_SelectHelpers') {
        const selectedIds = interaction.values.filter((id) => id !== interaction.user.id);

        let warningPrefix = '';
        if (selectedIds.length < interaction.values.length) {
            warningPrefix = '⚠️ **Note: You cannot select yourself as a helper.**\n\n';
        }

        await updateRaid(interaction.channel.id, { pendingHelperIds: selectedIds });

        const maxHelpers = getMaxHelpersForRaidSize(raidInfo.size);
        const selectRow = createHelperSelectRow(maxHelpers);
        const btnRow = createCloseButtonsRow({ isConfirmEnabled: selectedIds.length > 0, proofImageUrl: raidInfo.proofImage });

        await interaction.update({
            content:
                `${formatPartialHelpersForClose(raidInfo)}` +
                `${warningPrefix}` +
                `Select the helpers who helped in this raid:\n` +
                `Selected helpers: ${selectedIds.map((id) => `<@${id}>`).join(', ') || 'None'}`,
            components: [selectRow, btnRow],
        });
        return;
    }

    /* ---------- PROVIDE PROOF ---------- */
    if (interaction.customId === 'provideProof') {
        await interaction.reply({ content: 'Send the proof image in the next message.', flags: MessageFlags.Ephemeral });

        try {
            const collected = await interaction.channel.awaitMessages({
                filter: (m) => m.author.id === interaction.user.id && m.attachments.size > 0,
                max: 1,
                time: 30000,
                errors: ['time'],
            });

            const proofUrl = collected.first().attachments.first().url;
            await updateRaid(interaction.channel.id, { proofImage: proofUrl });

            const updatedRaid = await getRaidInfo(interaction.channel.id);
            const selectedIds = updatedRaid.pendingHelperIds || [];
            const maxHelpers = getMaxHelpersForRaidSize(updatedRaid.size);

            const selectRow = createHelperSelectRow(maxHelpers);
            const btnRow = createCloseButtonsRow({ isConfirmEnabled: selectedIds.length > 0, proofImageUrl: proofUrl });

            await interaction.message.edit({ components: [selectRow, btnRow] });
            await interaction.followUp({ content: 'Proof saved!', flags: MessageFlags.Ephemeral });
        } catch {
            await interaction.followUp({ content: 'Timed out or no attachment received.', flags: MessageFlags.Ephemeral });
        }
        return;
    }

    /* ---------- CONFIRM CLOSING ---------- */
    if (interaction.customId === 'confirmCloseSelection') {
        const currentRaidInfo = await getRaidInfo(interaction.channel.id);
        const selectedIds = currentRaidInfo.pendingHelperIds || [];

        await interaction.update({
            content: `Selected Raid Helpers: ${selectedIds.map((id) => `<@${id}>`).join(', ')}\nRaid marked for completion.`,
            components: [],
        });

        if (!selectedIds.length) {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'No helpers selected.', flags: MessageFlags.Ephemeral });
            }
            return;
        }

        const { originalTotalCalculatedPoints } = calculateTaskPointsWithMultiplier(currentRaidInfo.task);
        const partialHelpers = normalizePartialHelpers(currentRaidInfo);

        const pointsMap = {};
        for (const uid of selectedIds) {
            const partial = partialHelpers.find((e) => e.helperId === uid);
            if (partial?.tasks?.length) {
                const subset = partial.tasks.join(', ');
                const { originalTotalCalculatedPoints: subsetPoints } = calculateTaskPointsWithMultiplier(subset);
                pointsMap[uid] = Math.min(subsetPoints, MAX_XP_PER_RAID);
            } else {
                pointsMap[uid] = Math.min(originalTotalCalculatedPoints, MAX_XP_PER_RAID);
            }
        }

        await finalizeAdminReview(client, interaction.channel, currentRaidInfo, pointsMap, interaction.user.id, 'completed');

        await updateRaid(interaction.channel.id, {
            isAwaitingCompletion: false,
            pendingHelperIds: null,
        });

        return;
    }

    /* ---------- ABORT ---------- */
    if (interaction.customId === 'abortCloseRaid') {
        await updateRaid(interaction.channel.id, { isAwaitingCompletion: false, pendingHelperIds: null });
        await interaction.update({ content: 'Closing aborted.', components: [] });
        return;
    }

    /* ---------- START CLOSE PROCESS ---------- */
    if (interaction.customId === 'closeRaidTicket') {
        await updateRaid(interaction.channel.id, { isAwaitingCompletion: true, pendingHelperIds: [] });

        const maxHelpers = getMaxHelpersForRaidSize(raidInfo.size);
        const selectRow = createHelperSelectRow(maxHelpers);
        const btnRow = createCloseButtonsRow({ isConfirmEnabled: false, proofImageUrl: raidInfo.proofImage });

        await interaction.reply({
            content: `${formatPartialHelpersForClose(raidInfo)}Select the helpers who helped in this raid:`,
            components: [selectRow, btnRow],
        });
    }
}
