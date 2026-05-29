import {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ContainerBuilder,
    EmbedBuilder,
    MessageFlags,
    ModalBuilder,
    SeparatorBuilder,
    SeparatorSpacingSize,
    StringSelectMenuBuilder,
    TextDisplayBuilder,
    TextInputBuilder,
    TextInputStyle,
} from 'discord.js';

function text(content) {
    return new TextDisplayBuilder().setContent(String(content || '\u200b').slice(0, 4000));
}

import {
    updateRaid,
    getRaidInfo,
    updateRaidStatus,
} from '../../activeRaidState.js';

import { EMBED_COLOR, TASK_CATEGORY_BY_TASK, TASK_DISPLAY_NAMES, raidNeedsModalMapName } from '../../config/constants.js';
import { computeRaidStatusFromHelpers, refreshRaidRequestMessage } from './raidTicketPresentation.js';
import { isSpammingRaid } from './raidTicketLogic.js';
import { buildCancelRaidConfirmModal, CANCEL_RAID_MODAL_ID } from './embeds/cancelRaidModal.js';
import { validateAndResolveTaskList } from '../../utils/allowedTasks.js';
import { inferCategoryKeysFromTasks } from '../../utils/raidRequest.js';
import { requireAuth } from './ticketUtils.js';
import { finalizeAdminReview } from './ticketReview.js';
import { consumeRaidWizardSession, createRaidWizardSession, getRaidWizardSession, updateRaidWizardSession } from './raidWizardSession.js';
import {
    getRaidWizardEditCategoryV2,
    getRaidWizardEditDetailsModal,
    getRaidWizardEditTasksV2,
} from './embeds/raidWizardUi.js';
import { WIZARD_MODE } from './wizard/constants.js';
import { handleRaidWizardNavButtons, handleRaidWizardTaskSelect } from './wizard/raidWizardFlow.js';
import { parseRaidTasks } from '../../utils/raidMaps.js';
import { normalizeRoomNumber } from '../../utils/roomNumber.js';
import { listRaidHelpers } from '../../utils/raidParticipationStore.js';

const EDIT_REQUEST_TTL_MS = 10 * 60 * 1000;
const editRequestSessions = new Map(); // sessionId -> { userId, channelId, kind, createdAtMs, updatedAtMs }

async function replyEphemeralSafe(interaction, payload) {
    const combinedFlags = payload.flags
        ? MessageFlags.Ephemeral | payload.flags
        : MessageFlags.Ephemeral;
    try {
        if (interaction.deferred || interaction.replied) {
            await interaction.followUp({ ...payload, flags: combinedFlags });
        } else {
            await interaction.reply({ ...payload, flags: combinedFlags });
        }
        return true;
    } catch (err) {
        console.error('Failed to reply ephemeral:', err);
        return false;
    }
}

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

function isRaidTicketMessage(interaction, raidInfo) {
    return Boolean(
        raidInfo?.messageId
        && interaction.message?.id
        && String(interaction.message.id) === String(raidInfo.messageId),
    );
}

async function refreshRaidTicketAfterEdit(client, channel, raidInfo, helpers) {
    const nextStatus = computeRaidStatusFromHelpers(raidInfo, helpers);
    let refreshedRaidInfo = { ...raidInfo };
    if (nextStatus !== raidInfo.status) {
        await updateRaidStatus(client, channel.id, nextStatus);
        refreshedRaidInfo = { ...raidInfo, status: nextStatus };
    }
    await refreshRaidRequestMessage({
        client,
        channel,
        raidInfo: refreshedRaidInfo,
        helpers,
    });
}

async function acknowledgeEditWizardComplete(interaction, raidInfo, message = 'Raid updated.') {
    if (interaction.message && !isRaidTicketMessage(interaction, raidInfo)) {
        await interaction.update({
            components: [text(message)],
            flags: MessageFlags.IsComponentsV2,
        }).catch(() => {});
        return;
    }

    if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    } else {
        await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => {});
    }
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



async function startEditTasksWizard(interaction, raidInfo, { reply = false } = {}) {
    const sessionId = createRaidWizardSession({ userId: interaction.user.id, guildId: interaction.guildId });

    const existingTokens = parseRaidTasks(raidInfo.task || '');
    const existingExpanded = existingTokens.map((token) => String(token).toLowerCase()).filter(Boolean);

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

    const payload = {
        components: [getRaidWizardEditCategoryV2(sessionId, categoryKeys, uniqueExpanded)],
        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    };

    if (reply) {
        await replyEphemeralSafe(interaction, payload);
    } else {
        await interaction.update(payload);
    }
}

async function showEditDetailsModal(interaction, raidInfo) {
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

    const includeMapName = raidNeedsModalMapName(order || []);
    const defaults = getRaidWizardSession(wizardSessionId)?.defaults ?? {};
    await interaction.showModal(getRaidWizardEditDetailsModal(wizardSessionId, { includeMapName, defaults }));
}

function getEditDescriptionModal(raidInfo) {
    return new ModalBuilder()
        .setCustomId('editRequestDescriptionModal')
        .setTitle('Edit Description')
        .addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('descriptionInput')
                    .setLabel('Description')
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(false)
                    .setValue(String(raidInfo?.description ?? '').slice(0, 4000)),
            ),
        );
}

/* -------------------- MAIN HANDLER -------------------- */
export async function handleLifecycleInteractions(interaction, raidInfo, client) {

    if (interaction.isModalSubmit() && interaction.customId === CANCEL_RAID_MODAL_ID) {
        if (!await requireAuth(interaction, raidInfo)) return;
        const fullRaidInfo = await getRaidInfo(interaction.channel.id);
        if (fullRaidInfo) raidInfo = fullRaidInfo;

        await interaction.reply({
            content: 'The raid ticket was cancelled. This channel will close shortly.',
            flags: MessageFlags.Ephemeral,
        }).catch(() => {});

        await finalizeAdminReview(client, interaction.channel, raidInfo, {}, interaction.user.id, 'cancelled');
        return;
    }

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
    if (interaction.customId === "editRequest_tasks_btn") {
        await startEditTasksWizard(interaction, raidInfo, { reply: true });
        return;
    }

    if (interaction.customId === "editRequest_details_btn") {
        await showEditDetailsModal(interaction, raidInfo);
        return;
    }

    if (interaction.customId === "editRequest_description_btn") {
        await interaction.showModal(getEditDescriptionModal(raidInfo));
        return;
    }

    if (interaction.customId === "editRequest_btn") {
        const sessionId = newEditRequestSessionId(interaction.user.id);
        editRequestSessions.set(sessionId, {
            userId: interaction.user.id,
            channelId: interaction.channel.id,
            kind: null,
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
                { label: 'Edit details', value: 'details', description: 'Map/server/room/description modal'.slice(0, 100) },
            );

        const cancelBtn = new ButtonBuilder()
            .setCustomId(`editRequest_cancel_${sessionId}`)
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary);

        const doneBtn = new ButtonBuilder()
            .setCustomId(`editRequest_done_${sessionId}`)
            .setLabel('Done')
            .setStyle(ButtonStyle.Primary);

        await replyEphemeralSafe(interaction, {
            embeds: [embed],
            components: [
                new ActionRowBuilder().addComponents(select),
                new ActionRowBuilder().addComponents(doneBtn, cancelBtn),
            ],
        });
        return;
    }

    if (interaction.isButton?.() && interaction.customId.startsWith('editRequest_done_')) {
        const sessionId = interaction.customId.slice('editRequest_done_'.length);
        const session = consumeEditRequestSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await replyEphemeralSafe(interaction, { content: 'This edit session expired. Press Edit Request again.' });
            return;
        }
        await interaction.update({ content: 'Closed.', embeds: [], components: [] }).catch(() => {});
        return;
    }

    if (interaction.isButton?.() && interaction.customId.startsWith('editRequest_cancel_')) {
        const sessionId = interaction.customId.slice('editRequest_cancel_'.length);
        const session = consumeEditRequestSession(sessionId);
        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await replyEphemeralSafe(interaction, { content: 'This edit session expired. Press Edit Request again.' });
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
            await showEditDetailsModal(interaction, raidInfo);
            consumeEditRequestSession(sessionId);
            return;
        }

        await interaction.update({ content: 'Unknown edit option.', embeds: [], components: [] }).catch(() => {});
        consumeEditRequestSession(sessionId);
        return;
    }

    /* ---------- EDIT WIZARD (BUTTONS) ---------- */
    if (interaction.isButton() && interaction.customId.startsWith('raidWizardEdit_')) {
        const handled = await handleRaidWizardNavButtons(interaction, WIZARD_MODE.EDIT, {
            getSession: getRaidWizardSession,
            validateSession: (session) =>
                session.userId === interaction.user.id && session.channelId === interaction.channel.id,
            onCancel: (sessionId) => { consumeRaidWizardSession(sessionId); },
            onBack: (sessionId, session) => updateRaidWizardSession(sessionId, { step: 'category' }) ?? session,
            onAdvanceToTasks: (sessionId) => updateRaidWizardSession(sessionId, { step: 'tasks' }),
            onContinueFromTasks: async (navInteraction, session) => {
                const { resolvedTasks, invalidTasks } = validateAndResolveTaskList(session.tasks, 'any');
                if (invalidTasks.length) {
                    await navInteraction.reply({
                        content: `Invalid tasks: ${invalidTasks.join(', ')}`,
                        flags: MessageFlags.Ephemeral,
                    });
                    return;
                }

                await updateRaid(interaction.channel.id, { task: resolvedTasks.join(', ') });
                const helpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true }).catch(() => []);
                const updatedRaidInfo = { ...raidInfo, task: resolvedTasks.join(', ') };
                await refreshRaidTicketAfterEdit(client, interaction.channel, updatedRaidInfo, helpers);
                consumeRaidWizardSession(session.sessionId);
                await acknowledgeEditWizardComplete(navInteraction, raidInfo);
            },
        });
        if (handled) return;
    }

    /* ---------- EDIT WIZARD (MODAL SUBMIT) ---------- */
    if (interaction.isModalSubmit() && interaction.customId.startsWith('raidWizardEditDetailsModal_')) {
        const sessionId = interaction.customId.slice('raidWizardEditDetailsModal_'.length);
        const session = consumeRaidWizardSession(sessionId);

        if (!session || session.userId !== interaction.user.id || session.channelId !== interaction.channel.id) {
            await interaction.reply({ content: 'This edit session expired. Press Edit Request again.', flags: MessageFlags.Ephemeral });
            return;
        }

        const { resolvedTasks, invalidTasks } = validateAndResolveTaskList(session.tasks, 'any');
        if (invalidTasks.length) {
            await interaction.reply({ content: `Invalid tasks: ${invalidTasks.join(', ')}`, flags: MessageFlags.Ephemeral });
            return;
        }

        let mapName = '';
        try {
            mapName = interaction.fields.getTextInputValue('mapNameInput');
        } catch {
            mapName = '';
        }
        const mapNumberRaw = interaction.fields.getTextInputValue('mapNumberInput');
        const mapNumber = normalizeRoomNumber(mapNumberRaw);
        const server = interaction.fields.getTextInputValue('serverInput');

        if (!mapNumber) {
            await interaction.reply({ content: 'Room Number must contain at least one digit.', flags: MessageFlags.Ephemeral });
            return;
        }

        const updates = {
            task: resolvedTasks.join(', '),
            mapName: mapName || 'Auto (based on task)',
            mapNumber,
            server,
        };
        if (!isSpammingRaid(updates.task)) {
            updates.partialHelpers = [];
        }

        await updateRaid(interaction.channel.id, updates);

        const helpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true }).catch(() => []);
        await refreshRaidTicketAfterEdit(client, interaction.channel, { ...raidInfo, ...updates }, helpers);

        await acknowledgeEditWizardComplete(interaction, raidInfo);
        return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'editRequestDescriptionModal') {
        const description = interaction.fields.getTextInputValue('descriptionInput') || 'No description.';
        await updateRaid(interaction.channel.id, { description });

        const helpers = await listRaidHelpers(interaction.channel.id, { includeRemoved: true }).catch(() => []);
        await refreshRaidRequestMessage({
            client,
            channel: interaction.channel,
            raidInfo: { ...raidInfo, description },
            helpers,
        });

        await interaction.reply({ content: 'Description updated.', flags: MessageFlags.Ephemeral });
        return;
    }

    /* ---------- EDIT WIZARD (SELECT MENUS) ---------- */
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('raidWizardEdit_')) {
        const handled = await handleRaidWizardTaskSelect(interaction, WIZARD_MODE.EDIT, {
            getSession: getRaidWizardSession,
            validateSession: (session) =>
                session.userId === interaction.user.id && session.channelId === interaction.channel.id,
            autoAdvanceOnValidCategory: false,
            updateCategoryKeys: (sessionId, categoryKeys) =>
                updateRaidWizardSession(sessionId, { categoryKeys, step: 'category', tasks: [] }),
            updateTasks: (sessionId, tasks) => updateRaidWizardSession(sessionId, { tasks, step: 'tasks' }),
        });
        if (handled) return;
    }

/* ---------- 3. CANCEL RAID ---------- */
    if (interaction.customId === 'cancelRaidTicket') {
        await interaction.showModal(buildCancelRaidConfirmModal());
        return;
    }
}