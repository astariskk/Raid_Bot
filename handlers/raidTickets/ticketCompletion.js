import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    EmbedBuilder,
    MessageFlags,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    MentionableSelectMenuBuilder,
} from 'discord.js';

import { getRaidInfo, updateRaid } from '../../activeRaidState.js';
import { EMBED_COLOR, MAX_HELPERS, RAID_HELPER_ROLE_ID, RAID_STATUS, TASK_DISPLAY_NAMES } from '../../config/constants.js';
import {
  buildClosePartialTasksModal,
  CLOSE_PARTIAL_TASKS_MODAL_ID,
  getClosePartialTasksSelections,
} from '../../Embeds/raidTicket/closePartialTasksModal.js';
import {
  buildTaskHelpedModal,
  getTaskHelpedModalSelections,
} from '../../Embeds/raidTicket/taskHelpedModal.js';
import { parseRaidTasks } from '../../utils/raidMaps.js';
import { listRaidHelpers } from '../../utils/raidParticipationStore.js';
import { buildClosePointsMap } from './domain/closePoints.js';
import {
    getPartialHelpersMissingTasks,
    normalizePartialHelpers,
} from './domain/partialHelpers.js';
import { requireAuth } from './ticketUtils.js';
import { finalizeAdminReview } from './ticketReview.js';
import {
  getRaidHelperCapacity,
  getRaidStatusForHelpers,
  getRaidTaskFieldDisplay,
  isSpammingRaid,
  refreshRaidRequestMessage,
} from './raidTicketPresentation.js';
import {
    consumePartialHelperSession,
    createPartialHelperSession,
    getPartialHelperSession,
    updatePartialHelperSession,
} from './partialHelperSession.js';

/* -------------------- CLOSE UI HELPERS -------------------- */
function createHelperSelectRow(maxValues) {
    return new ActionRowBuilder().addComponents(
        new MentionableSelectMenuBuilder()
            .setCustomId('closeRaid_SelectHelpers')
            .setPlaceholder(`Select Warrior helpers (Max ${maxValues})`)
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

async function filterToWarriorHelperIds(interaction, selectedIds) {
    const guild = interaction.guild;
    if (!guild) return { filtered: [], warnings: ['This can only be used in a server.'] };

    const roleIds = new Set();
    const userIds = new Set();

    for (const id of selectedIds || []) {
        if (guild.roles.cache.has(id)) roleIds.add(id);
        else userIds.add(id);
    }

    const warnings = [];
    if (roleIds.size) warnings.push('Roles cannot be selected (users only).');

    const ids = [...userIds].filter((id) => id !== interaction.user.id);
    if (ids.length < userIds.size) warnings.push('You cannot select yourself as a helper.');

    const members = new Map();
    try {
        const fetched = await guild.members.fetch({ user: ids });
        for (const [id, member] of fetched) members.set(id, member);
    } catch {
        await Promise.all(
            ids.map(async (id) => {
                const member = await guild.members.fetch(id).catch(() => null);
                if (member) members.set(id, member);
            }),
        );
    }

    const filtered = [];
    const rejected = [];
    for (const id of ids) {
        const member = members.get(id);
        if (!member || !member.roles.cache.has(RAID_HELPER_ROLE_ID)) {
            rejected.push(id);
            continue;
        }
        filtered.push(id);
    }

    if (rejected.length) warnings.push(`Only Warriors can be selected (removed ${rejected.length}).`);

    return { filtered, warnings };
}

async function enrichPartialHelpersWithNames(interaction, helpers = []) {
    if (!helpers.length) return helpers;
    const guild = interaction.guild;
    return Promise.all(
        helpers.map(async (helper) => {
            const helperId = String(helper?.helperId ?? '').trim();
            let displayName = helperId;
            if (guild && helperId) {
                try {
                    const member = await guild.members.fetch(helperId).catch(() => null);
                    if (member?.displayName) displayName = member.displayName;
                } catch {
                    // ignore
                }
            }
            return { ...helper, displayName };
        }),
    );
}

function formatPartialHelpersForClose(raidInfo) {
    const partialHelpers = normalizePartialHelpers(raidInfo);
    if (!partialHelpers.length) return '';

    const lines = partialHelpers
        .map((e) => {
            const tasks = e.tasks?.length
                ? getRaidTaskFieldDisplay(e.tasks.join(', '))
                : 'No task helped';
            return `* <@${e.helperId}>: ${tasks}`;
        })
        .join('\n')
        .slice(0, 1500);

    return `**Partial Helpers**:\n${lines}\n`;
}

function buildTaskHelpedSelectRow(helperId, taskKeys, selectedTasks = []) {
    const selectedSet = new Set(selectedTasks);
    return new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(`taskHelpedSelect_${helperId}`)
            .setPlaceholder('Select tasks this helper covered…')
            .setMinValues(1)
            .setMaxValues(Math.max(1, Math.min(taskKeys.length, 25)))
            .addOptions(
                taskKeys.slice(0, 25).map((key) => ({
                    label: String(TASK_DISPLAY_NAMES?.[key] ?? key).slice(0, 100),
                    value: key,
                    default: selectedSet.has(key),
                })),
            ),
    );
}

function buildCloseMessagePayload(raidInfo) {
    const selectedIds = Array.isArray(raidInfo?.pendingHelperIds) ? raidInfo.pendingHelperIds : [];
    const maxHelpers = MAX_HELPERS;
    const selectRow = createHelperSelectRow(maxHelpers);
    const btnRow = createCloseButtonsRow({ isConfirmEnabled: selectedIds.length > 0, proofImageUrl: raidInfo?.proofImage });

    return {
        content:
            `**Selected helper${selectedIds.length === 1 ? '' : 's'}**: ${selectedIds.map((id) => `<@${id}>`).join(', ') || 'None'}\n` +
            `${formatPartialHelpersForClose(raidInfo)}` +
            `Select the helpers who helped in this raid:`,
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

async function safeDeferUpdate(interaction) {
    try {
        if (!interaction.deferred && !interaction.replied) {
            await interaction.deferUpdate();
        }
        return true;
    } catch {
        return false;
    }
}

async function safeEditComponentMessage(interaction, payload) {
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.editReply(payload);
            return true;
        }

        await interaction.update(payload);
        return true;
    } catch (err) {
        if (interaction.message?.edit) {
            await interaction.message.edit(payload).catch(() => {});
            return true;
        }

        console.error('Failed to update component message:', err);
        return false;
    }
}

/* -------------------- PARTIAL HELPER UI HELPERS -------------------- */
function getUniqueRaidTaskKeys(raidInfo) {
    const tokens = parseRaidTasks(raidInfo?.task || '')
        .map((t) => String(t).trim().toLowerCase())
        .filter(Boolean);
    return [...new Set(tokens)];
}

async function executeRaidClose(interaction, client, currentRaidInfo, joinedHelpers) {
    const selectedIds = currentRaidInfo.pendingHelperIds || [];
    const partialHelpers = normalizePartialHelpers(currentRaidInfo);
    const { pointsMap } = buildClosePointsMap(currentRaidInfo, joinedHelpers, selectedIds);

    const hasHelpers = Object.keys(pointsMap).length > 0;
    if (!hasHelpers) {
        const noHelpersPayload = { content: 'No helpers with tasks selected.', flags: MessageFlags.Ephemeral };
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp(noHelpersPayload).catch(() => interaction.editReply(noHelpersPayload).catch(() => {}));
        } else {
            await interaction.reply(noHelpersPayload).catch(() => {});
        }
        return false;
    }

    await finalizeAdminReview(client, interaction.channel, currentRaidInfo, pointsMap, interaction.user.id, 'completed');

    await updateRaid(interaction.channel.id, {
        isAwaitingCompletion: false,
        pendingHelperIds: null,
        previousStatus: null,
    });

    return true;
}

function formatPartialHelpersList(partialHelpers) {
    if (!partialHelpers.length) return '*None*';
    return partialHelpers
        .map((e) => {
            const tasks = e.tasks?.length ? e.tasks.map((t) => `\`${t}\``).join(', ') : 'No task helped';
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
        { label: 'No task helped', value: '__none__', description: 'This helper did not help with any tasks', default: false },
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
    const menu = new MentionableSelectMenuBuilder()
        .setCustomId(`partialHelper_user_${sessionId}`)
        .setPlaceholder('Select Warrior helper(s)')
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
    try {
    /* ---------- AUTH ---------- */
    if (!await requireAuth(interaction, raidInfo)) return;

    // Load full raid info after auth (minimal raidInfo is passed from the router)
    const fullRaidInfo = await getRaidInfo(interaction.channel.id);
    if (fullRaidInfo) raidInfo = fullRaidInfo;

    /* ---------- HARD LOCK: ADMIN REVIEW ---------- */
    if (raidInfo?.status === RAID_STATUS.ADMIN_REVIEW) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: 'The raid is already closed.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return;
    }

    /* ---------- TASK HELPED (per-helper partial credit) ---------- */
    if (interaction.isButton?.() && interaction.customId.startsWith('taskHelped_')) {
        const helperId = interaction.customId.slice('taskHelped_'.length);
        const taskKeys = getUniqueRaidTaskKeys(raidInfo);
        if (!helperId || !taskKeys.length) {
            await interaction.reply({ content: 'No tasks available to assign for this helper.', flags: MessageFlags.Ephemeral });
            return;
        }

        const existing = normalizePartialHelpers(raidInfo).find((entry) => entry.helperId === helperId);
        await interaction.showModal(buildTaskHelpedModal(helperId, taskKeys, existing?.tasks ?? []));
        return;
    }

    if (interaction.isModalSubmit?.() && interaction.customId === CLOSE_PARTIAL_TASKS_MODAL_ID) {
        const currentRaidInfo = await getRaidInfo(interaction.channel.id);
        const joinedHelpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true }).catch(() => []);
        const missingBefore = getPartialHelpersMissingTasks(currentRaidInfo, joinedHelpers);
        const helperIds = missingBefore.map((helper) => helper.helperId).slice(0, 4);
        const selections = getClosePartialTasksSelections(interaction, helperIds);

        let partialHelpers = normalizePartialHelpers(currentRaidInfo);
        for (const helperId of helperIds) {
            const rawSelected = (selections[helperId] || []);
            const hasNone = rawSelected.includes('__none__');
            const selectedTasks = hasNone
                ? []
                : [...new Set(rawSelected.map((task) => String(task).toLowerCase()).filter((task) => task !== '__none__'))];

            partialHelpers = partialHelpers.filter((entry) => entry.helperId !== helperId);
            partialHelpers.push({ helperId, tasks: selectedTasks });
        }

        await updateRaid(interaction.channel.id, { partialHelpers });

        const refreshedRaidInfo = { ...raidInfo, partialHelpers };
        const stillMissing = getPartialHelpersMissingTasks(refreshedRaidInfo, joinedHelpers);
        if (stillMissing.length > 0) {
            await interaction.reply({
                content: stillMissing.length > 4
                    ? `${stillMissing.length} partial helpers still need tasks. Use **Task Helped** on each, then press **Confirm Close** again.`
                    : 'Some partial helpers still need tasks. Press **Confirm Close** again to finish assigning them.',
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await executeRaidClose(interaction, client, refreshedRaidInfo, joinedHelpers);
        await interaction.editReply({ content: 'Raid closed successfully.' }).catch(() => {});
        return;
    }

    if (interaction.isModalSubmit?.() && interaction.customId.startsWith('taskHelpedModal_')) {
        const helperId = interaction.customId.slice('taskHelpedModal_'.length);
        const rawSelected = getTaskHelpedModalSelections(interaction);
        const hasNone = rawSelected.includes('__none__');
        const selectedTasks = hasNone ? [] : [...new Set(rawSelected.map((task) => String(task).toLowerCase()).filter((task) => task !== '__none__'))];
        const partialHelpers = normalizePartialHelpers(raidInfo);
        const next = partialHelpers.filter((entry) => entry.helperId !== helperId);
        next.push({ helperId, tasks: selectedTasks });
        await updateRaid(interaction.channel.id, { partialHelpers: next });

        const helpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true }).catch(() => []);
        await refreshRaidRequestMessage({
            client,
            channel: interaction.channel,
            raidInfo: { ...raidInfo, partialHelpers: next },
            helpers,
        });

        const label = getRaidTaskFieldDisplay(selectedTasks.join(', '));
        await interaction.reply({
            content: selectedTasks.length
                ? `Saved task credit for <@${helperId}>: **${label}**`
                : `Cleared task credit for <@${helperId}>.`,
            flags: MessageFlags.Ephemeral,
        });
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

            const afterList = next;
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
                        buildPartialHelperNavRow(sessionId, { step: 'tasks', canNext: true }),
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
                        buildPartialHelperNavRow(sessionId, { step: 'tasks', canNext: true }),
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
                        buildPartialHelperNavRow(sessionId, { step: 'tasks', canNext: true }),
                    ],
                });
                return;
            }

            if (session.step === 'tasks') {
                const updated = updatePartialHelperSession(sessionId, { step: 'user' });
                await interaction.update({
                    embeds: [buildPartialHelperEmbed({ step: 'user', partialHelpers, selectedTasks: updated.selectedTasks })],
                    components: [
                        buildPartialHelperUserRow(sessionId, { maxValues: MAX_HELPERS }),
                        buildPartialHelperNavRow(sessionId, { step: 'user', canSave: (updated.selectedHelperIds?.length ?? 0) > 0 }),
                    ],
                });
                return;
            }
        }

        if (saveId) {
            await safeDeferUpdate(interaction);
            if (session.step !== 'user') return;
            if (!session.selectedHelperIds?.length) {
                await interaction.followUp({ content: 'Select at least one helper first.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return;
            }

            const helperIds = [...new Set(session.selectedHelperIds.map(String))].filter(Boolean);
            if (helperIds.includes(freshRaidInfo.requesterId)) {
                await interaction.followUp({ content: 'The raid requester cannot be added as a helper.', flags: MessageFlags.Ephemeral }).catch(() => {});
                return;
            }

            const invalidIds = [];
            for (const hid of helperIds) {
                const member = await interaction.guild?.members?.fetch(hid).catch(() => null);
                if (!member || !member.roles.cache.has(RAID_HELPER_ROLE_ID)) invalidIds.push(hid);
            }
            if (invalidIds.length) {
                await interaction.followUp({
                    content: `These users must have the <@&${RAID_HELPER_ROLE_ID}> role: ${invalidIds.map((id) => `<@${id}>`).join(', ')}`,
                    flags: MessageFlags.Ephemeral,
                }).catch(() => {});
                return;
            }

            const tasks = [...new Set((session.selectedTasks || []).map((t) => String(t).toLowerCase()).filter((t) => t !== '__none__'))].filter(Boolean);
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

            await safeEditComponentMessage(interaction, {
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
        const hasNone = rawSelected.includes('__none__');
        const selectedTasks = hasNone
            ? []
            : rawSelected.includes('__all__') ? taskKeys : rawSelected.filter((v) => v !== '__all__' && v !== '__none__');
        const updated = updatePartialHelperSession(sessionId, { selectedTasks });

        await interaction.update({
            embeds: [buildPartialHelperEmbed({ step: 'tasks', partialHelpers, taskKeys, selectedTasks: updated.selectedTasks })],
            components: [
                buildPartialHelperTasksRow(sessionId, taskKeys, updated.selectedTasks),
                buildPartialHelperNavRow(sessionId, { step: 'tasks', canNext: true }),
            ],
        });
        return;
    }

    if (interaction.isMentionableSelectMenu?.() && interaction.customId.startsWith('partialHelper_user_')) {
        const sessionId = interaction.customId.slice('partialHelper_user_'.length);
        const session = getPartialHelperSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This partial helper session expired. Press Partial Helper again.', flags: MessageFlags.Ephemeral });
            return;
        }

        const { filtered: helperIds, warnings } = await filterToWarriorHelperIds(interaction, interaction.values || []);
        const updated = updatePartialHelperSession(sessionId, { selectedHelperIds: helperIds });

        const partialHelpers = normalizePartialHelpers(raidInfo);

        if (warnings.length) {
            await interaction.followUp({ content: `⚠️ ${warnings.join(' ')}`.slice(0, 2000), flags: MessageFlags.Ephemeral }).catch(() => {});
        }

        await interaction.update({
            embeds: [buildPartialHelperEmbed({ step: 'user', partialHelpers, selectedTasks: updated.selectedTasks })],
            components: [
                buildPartialHelperUserRow(sessionId, { maxValues: MAX_HELPERS }),
                buildPartialHelperNavRow(sessionId, { step: 'user', canSave: (updated.selectedHelperIds?.length ?? 0) > 0 }),
            ],
        });
        return;
    }

    /* ---------- UPDATE HELPER SELECTION ---------- */
    if (interaction.customId === 'closeRaid_SelectHelpers') {
        await safeDeferUpdate(interaction);
        const { filtered: selectedIds, warnings } = await filterToWarriorHelperIds(interaction, interaction.values || []);

        let warningPrefix = warnings.length ? `**Note:** ${warnings.join(' ')}\n\n` : '';
        if (!warningPrefix && selectedIds.length < interaction.values.length) {
            warningPrefix = '⚠️ **Note: You cannot select yourself as a helper.**\n\n';
        }

        await updateRaid(interaction.channel.id, { pendingHelperIds: selectedIds });

        const maxHelpers = MAX_HELPERS;
        const selectRow = createHelperSelectRow(maxHelpers);
        const btnRow = createCloseButtonsRow({ isConfirmEnabled: selectedIds.length > 0, proofImageUrl: raidInfo.proofImage });

        await interaction.message.edit({
            content:
                `${warningPrefix}` +
                `**Selected helpers**: ${selectedIds.map((id) => `<@${id}>`).join(', ') || 'None'}\n` +
                `${formatPartialHelpersForClose(raidInfo)}\n` +
                `Select the helpers who helped in this raid:`,                
            components: [selectRow, btnRow],
        });
        return;
    }

    /* ---------- PROVIDE PROOF ---------- */
    if (interaction.customId === 'provideProof') {
        const extractProofUrlFromMessage = (m) => {
            const attachment = m?.attachments?.first?.();
            if (attachment?.url) return String(attachment.url);

            const embedWithImage = Array.isArray(m?.embeds) ? m.embeds.find((e) => e?.image?.url || e?.thumbnail?.url) : null;
            const embedUrl = embedWithImage?.image?.url || embedWithImage?.thumbnail?.url;
            if (embedUrl) return String(embedUrl);

            const content = String(m?.content ?? '');
            const match = content.match(/https?:\/\/\S+/i);
            if (!match) return null;
            return match[0].replace(/[)>.,]+$/, '');
        };

        const proofPrompt = 'Send the proof image (upload) or a proof link in the same channel within 1 minute.';

        await interaction.reply({ content: proofPrompt, flags: MessageFlags.Ephemeral });

        try {
            const collected = await interaction.channel.awaitMessages({
                filter: (m) => {
                    if (m.author.id !== interaction.user.id) return false;
                    return Boolean(extractProofUrlFromMessage(m));
                },
                max: 1,
                time: 60000,
                errors: ['time'],
            });

            const proofUrl = extractProofUrlFromMessage(collected.first());
            if (!proofUrl) throw new Error('No proof image found.');
            await updateRaid(interaction.channel.id, { proofImage: proofUrl });

            const updatedRaid = { ...raidInfo, proofImage: proofUrl };
            const helpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true }).catch(() => []);
            await refreshRaidRequestMessage({
                client,
                channel: interaction.channel,
                raidInfo: updatedRaid,
                helpers,
            });

            await interaction.followUp({ content: 'Proof saved!', flags: MessageFlags.Ephemeral });
        } catch (err) {
            console.error('Proof capture failed:', err);
            await interaction.followUp({
                content: 'Timed out or no attachment/link received. Press `Attach Proof` again and upload the image in this channel.',
                flags: MessageFlags.Ephemeral
            });
        }
        return;
    }

    /* ---------- CONFIRM CLOSING ---------- */
    if (interaction.customId === 'confirmCloseSelection') {
        const joinedHelpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true }).catch(() => []);
        const missingPartialTasks = getPartialHelpersMissingTasks(raidInfo, joinedHelpers);

        if (missingPartialTasks.length > 4) {
            await interaction.reply({
                content: `${missingPartialTasks.length} partial helpers still need task assignments. Use **Task Helped** on each helper in the ticket, then press **Confirm Close** again.`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (missingPartialTasks.length > 0) {
            const helpersWithNames = await enrichPartialHelpersWithNames(interaction, missingPartialTasks);
            await interaction.showModal(
                buildClosePartialTasksModal(helpersWithNames, getUniqueRaidTaskKeys(raidInfo)),
            );
            return;
        }

        await safeDeferUpdate(interaction);
        await executeRaidClose(interaction, client, raidInfo, joinedHelpers);
        return;
    }

/* ---------- ABORT ---------- */
    if (interaction.customId === 'abortCloseRaid') {
        await safeDeferUpdate(interaction);
        const joinedHelpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true }).catch(() => []);
        const restoredStatus = raidInfo.previousStatus || (isSpammingRaid(raidInfo)
            ? getRaidStatusForHelpers({
                isSpamming: true,
                helperCount: joinedHelpers.filter((helper) => helper.helperId !== raidInfo.requesterId && !helper.removedAt).length,
                maxHelpers: getRaidHelperCapacity(raidInfo),
            })
            : RAID_STATUS.WAITING);
        await updateRaid(interaction.channel.id, {
            isAwaitingCompletion: false,
            pendingHelperIds: null,
            awaitingCompletionRequesterId: null,
            previousStatus: null,
            status: restoredStatus,
        });

        const updatedRaidInfo = { ...raidInfo, isAwaitingCompletion: false, pendingHelperIds: null, status: restoredStatus };
        await refreshRaidRequestMessage({
            client,
            channel: interaction.channel,
            raidInfo: updatedRaidInfo,
            helpers: joinedHelpers,
        });
        
        try {
            await interaction.editReply({ content: 'Closing cancelled.', embeds: [], components: [] });
        } catch {
            await interaction.followUp({ content: 'Closing cancelled.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        return;
    }

    /* ---------- START CLOSE PROCESS ---------- */
    if (interaction.customId === 'closeRaidTicket') {
        await interaction.deferUpdate().catch(() => {});
        const joinedHelpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true }).catch(() => []);
        const helperIds = joinedHelpers
            .filter((helper) => !helper.removedAt)
            .map((helper) => helper.helperId)
            .filter((id) => id && id !== raidInfo.requesterId)
            .slice(0, MAX_HELPERS);

        const updatedRaidInfo = {
            ...raidInfo,
            isAwaitingCompletion: true,
            pendingHelperIds: helperIds,
            previousStatus: raidInfo.status || RAID_STATUS.WAITING,
            status: RAID_STATUS.AWAITING_COMPLETION,
        };

        await updateRaid(interaction.channel.id, {
            isAwaitingCompletion: true,
            pendingHelperIds: helperIds,
            previousStatus: updatedRaidInfo.previousStatus,
            status: RAID_STATUS.AWAITING_COMPLETION,
        });

        await refreshRaidRequestMessage({
            client,
            channel: interaction.channel,
            raidInfo: updatedRaidInfo,
            helpers: joinedHelpers,
        });
        return;
    }
    } catch (err) {
        console.error('handleCompletionInteractions error:', err);
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
                content: 'Something went wrong handling that interaction. Please try again.',
                flags: MessageFlags.Ephemeral,
            }).catch(() => {});
        }
    }
}
