// setupExpLairHandlers.js
import {
    EmbedBuilder,
    ChannelType,
    MessageFlags,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    InteractionType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    UserSelectMenuBuilder
} from "discord.js";
import { Routes } from "discord-api-types/v10";
import {
    EXP_LAIR_CHANNEL_ID,
    RAID_CATEGORY_ID,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RAID_MANAGER_ROLE_ID,
    RAID_HELPER_ROLE_ID,
    MAX_XP_PER_RAID,

    ALLOWED_TASK_FOUR,
    ALLOWED_TASK_SEVEN,
    ALLOWED_TASK_NAMES,
    GENERIC_TASKS_LIST
} from "../config/constants.js";
import { updateLeaderboard } from "./leaderboardCore.js";
import {
    updateRaidStatus,
    getEditTaskModal,
    updateRaidLogEmbed,
    getRaidInfo,
    updateRaid,
    deleteRaid
} from "../activeRaidState.js";
import { sendLeaderboardBackup } from "./backupHandler.js";
import { calculateTaskPointsWithMultiplier } from "../utils/taskCalculations.js";
import { getCombinedTasksAndPointsEmbed } from "../Embeds/generalCommandsEmbeds.js";
import { validateAndResolveTasks } from '../utils/allowedTasks.js';

// --- Helpers ---
function isAdmin(source) {
    const member = source.member;
    if (!member) return false;
    return (
        member.roles.cache.has(MODERATOR_ROLE_ID) ||
        member.roles.cache.has(OFFICER_ROLE_ID) ||
        member.roles.cache.has(RAID_MANAGER_ROLE_ID)
    );
}

async function isAuthorizedToManageRaid(interaction, raidInfo) {
    if (interaction.user.id === raidInfo.requesterId || isAdmin(interaction)) {
        return true;
    }
    await interaction.reply({
        content: "Only the user who initiated this raid or a staff member can perform this action.",
        flags: MessageFlags.Ephemeral
    });
    return false;
}

async function isStaff(interaction) {
    if (isAdmin(interaction)) return true;
    await interaction.reply({
        content: "Only staff members can perform this action.",
        flags: MessageFlags.Ephemeral
    });
    return false;
}

// --- Unified finalize function ---
// reason: "completed" or "cancelled"
async function finalizeRaidForAdminReview(client, channel, raidInfo, pointsAwarded = {}, completionInitiatorId, reason = "completed", notes = "") {
    const COLOR_INFO = 0x0099ff;

    try {
        const guild = channel.guild;
        const everyoneRole = guild.roles.everyone;
        const moderatorRole = guild.roles.cache.get(MODERATOR_ROLE_ID);
        const officerRole = guild.roles.cache.get(OFFICER_ROLE_ID);
        const raidManagerRole = guild.roles.cache.get(RAID_MANAGER_ROLE_ID);
        const requesterMember = await guild.members.fetch(raidInfo.requesterId).catch(() => null);

        // 5 second delay
        await channel.send("This Raid Will now Close.");        
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Lock channel: remove view for everyone & raid helper, then give it to admin roles
        await channel.permissionOverwrites.edit(everyoneRole, { ViewChannel: false });
        await channel.permissionOverwrites.edit(RAID_HELPER_ROLE_ID, { ViewChannel: false });

        if (requesterMember && !isAdmin({ member: requesterMember })) {
            await channel.permissionOverwrites.edit(requesterMember, { ViewChannel: false });
        }

        if (moderatorRole) await channel.permissionOverwrites.edit(moderatorRole, { ViewChannel: true });
        if (officerRole) await channel.permissionOverwrites.edit(officerRole, { ViewChannel: true });
        if (raidManagerRole) await channel.permissionOverwrites.edit(raidManagerRole, { ViewChannel: true });

        // Rename channel
        await channel.setName("Pending-raid-review").catch(() => null);

        // POST TO EXP LAIR ONLY FOR COMPLETIONS
        let expLairMessageLink = "N/A (no post)";
        if (reason === "completed") {
            try {
                const expLairChannel = await client.channels.fetch(EXP_LAIR_CHANNEL_ID);
                if (expLairChannel && expLairChannel.type === ChannelType.GuildText) {
                    const helperMentions = Object.keys(pointsAwarded).length > 0
                        ? Object.keys(pointsAwarded).map(id => `<@${id}>`).join(", ")
                        : "None";

                    const requesterDisplay = requesterMember ? requesterMember : `<@${raidInfo.requesterId}>`;

                    const expEmbed = new EmbedBuilder()
                        .setColor(COLOR_INFO)
                        .setTitle(`Raid Completed`)
                        .setDescription(
                            `**Raid requested by:** ${requesterDisplay}\n` +
                            `**Task(s):** ${raidInfo.task}\n` +
                            `**Helpers:** ${helperMentions}`
                        )
                        .setTimestamp()
                        .setFooter({ text: "Raid Completion Details" });

                    const sent = await expLairChannel.send({
                        content: `Raid completed for ${requesterMember ? requesterMember.displayName : `<@${raidInfo.requesterId}>`}.`,
                        embeds: [expEmbed]
                    }).catch(e => { console.error("Failed to send to EXP Lair:", e); return null; });

                    if (sent) {
                        expLairMessageLink = sent.url;
                        // Create thread with point breakdown
                        try {
                            const thread = await sent.startThread({
                                name: `Raid for ${requesterMember ? requesterMember.displayName : raidInfo.requesterId}`,
                                autoArchiveDuration: 60
                            });

                            let threadContent = `**Task(s):** ${raidInfo.task}\n\n**Points Awarded:**\n`;
                            if (Object.keys(pointsAwarded).length > 0) {
                                for (const uid of Object.keys(pointsAwarded)) {
                                    const member = await channel.guild.members.fetch(uid).catch(() => null);
                                    threadContent += `${member ? member.displayName : `<@${uid}>`}: ${pointsAwarded[uid]} EXP\n`;
                                }
                            } else {
                                threadContent += "No points awarded.";
                            }

                            await thread.send({ content: threadContent }).catch(e => console.error("Failed to send breakdown to thread:", e));
                        } catch (e) {
                            console.error("Failed to create thread on EXP Lair message:", e);
                        }
                    }
                } else {
                    console.warn("EXP_LAIR_CHANNEL_ID not found or not a text channel; skipping post.");
                }
            } catch (e) {
                console.error("Error posting to EXP Lair:", e);
            }
        }

        // Build admin review embed (for cancelled raids, we intentionally exclude exp-lair details)
        const reviewDescriptionParts = [
            `This raid was ${reason} by <@${completionInitiatorId}>.`,
            `**Requester:** <@${raidInfo.requesterId}>`,
            `**Original Task(s):** ${raidInfo.task}`
        ];

        if (notes && notes.length > 0) {
            reviewDescriptionParts.push(`**Notes:** ${notes}`);
        }

        if (reason === "completed") {
            reviewDescriptionParts.push(`**EXP Lair Post:** ${expLairMessageLink !== "N/A (no post)" ? `[Click Here](${expLairMessageLink})` : expLairMessageLink}`);
        }

        const reviewEmbed = new EmbedBuilder()
            .setColor(COLOR_INFO)
            .setTitle(`Raid ${reason === "cancelled" ? "Cancelled" : "Completed"} - Admin Review`)
            .setDescription(reviewDescriptionParts.join("\n"))
            .setTimestamp()
            .setFooter({ text: "Staff can delete this channel after review." });

        const deleteButton = new ButtonBuilder()
            .setCustomId("deleteFinalizedRaidChannel")
            .setLabel("Delete Channel After Review")
            .setStyle(ButtonStyle.Danger);

        const actionRow = new ActionRowBuilder().addComponents(deleteButton);

        await channel.send({ embeds: [reviewEmbed], components: [actionRow] }).catch(e => console.error("Failed to send admin review embed:", e));

        // Update DB: status admin_review, store points and expLairMessageLink (exp link only meaningful for completions)
        await updateRaid(channel.id, {
            status: "admin_review",
            awaitingCompletionRequesterId: null,
            pointsAwarded,
            expLairMessageLink: reason === "completed" ? expLairMessageLink : null
        }).catch(e => console.error("Failed to update raid record:", e));

        // Apply points + backup (only for completion)
        if (reason === "completed" && Object.keys(pointsAwarded).length > 0) {
            for (const uid of Object.keys(pointsAwarded)) {
                await updateLeaderboard(uid, pointsAwarded[uid]).catch(e => console.error("Failed to update leaderboard:", e));
            }
            await sendLeaderboardBackup(client).catch(e => console.error("Failed to send leaderboard backup:", e));
        }
    } catch (err) {
        console.error("Error in finalizeRaidForAdminReview:", err);
        await channel.send("There was an error finalizing this raid. Please contact staff.").catch(() => null);
        await updateRaid(channel.id, { status: "active", awaitingCompletion: false }).catch(() => null);
    }
}

// --- Main event setup ---
export function setupExpLairHandlers(client) {
    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isButton() && interaction.type !== InteractionType.ModalSubmit && !interaction.isUserSelectMenu()) {
            return;
        }

        const raidInfo = interaction.channel ? await getRaidInfo(interaction.channel.id) : null;
        const isRaidTicketChannel = raidInfo && interaction.channel && interaction.channel.type === ChannelType.GuildText && interaction.channel.parentId === RAID_CATEGORY_ID;

        if (!isRaidTicketChannel) {
            // Handle ephemerals outside raid channels
            if (interaction.isButton() && ["closeRaidTicket", "editTask_btn", "deleteFinalizedRaidChannel", "cancelRaidTicket"].includes(interaction.customId)) {
                await interaction.reply({ content: "This action can only be used in a raid ticket channel.", flags: MessageFlags.Ephemeral });
            } else if (interaction.type === InteractionType.ModalSubmit && interaction.customId === "editTaskModal") {
                await interaction.reply({ content: "This action can only be performed in a raid ticket channel.", flags: MessageFlags.Ephemeral });
            }
            return;
        }

        if (!raidInfo) {
            if (interaction.isButton() && interaction.customId === "deleteFinalizedRaidChannel") {
                await interaction.reply({ content: "Could not retrieve raid details. Attempting to delete channel if it still exists.", flags: MessageFlags.Ephemeral });
                try {
                    await interaction.channel.delete('Orphaned raid channel without DB entry, manually deleting.').catch(e => console.error("Failed to delete orphan channel:", e));
                } catch (e) {
                    console.error("Error deleting orphan channel:", e);
                }
                return;
            } else {
                await interaction.reply({ content: "Could not retrieve raid details. This raid might have been completed or cancelled already.", flags: MessageFlags.Ephemeral });
                return;
            }
        }

        // ----- BUTTON HANDLERS -----
        if (interaction.isButton()) {
            if (interaction.customId === "closeRaidTicket") {
                if (!await isAuthorizedToManageRaid(interaction, raidInfo)) return;
                const maxHelpers = raidInfo.size === "4-man" ? 4 : raidInfo.size === "7-man" ? 7 : 10;

                const modalPayload = {
                    type: 9, // InteractionCallbackType.MODAL
                    data: {
                        custom_id: "closeRaidModal",
                        title: "Close Raid",
                        components: [
                            {
                                type: 18, // ComponentType.LABEL
                                label: "Select Users Who Helped",
                                component: {
                                    type: 5, // USER_SELECT
                                    custom_id: "closeRaid_SelectHelpers",
                                    max_values: maxHelpers,
                                    min_values: 1
                                }
                            },
                            {
                                type: 18, // ComponentType.LABEL
                                label: "Closing Notes (optional)",
                                component: {
                                    type: 4, // ComponentType.TEXT_INPUT
                                    custom_id: "closeRaid_notesInput",
                                    style: 2, // Paragraph
                                    placeholder: "Optional notes about raid completion (e.g., someone left early)",
                                    required: false,
                                    min_length: 0,
                                    max_length: 200
                                }
                            }
                        ]
                    }
                };

                try {
                    await interaction.client.rest.post(
                        Routes.interactionCallback(interaction.id, interaction.token),
                        { body: modalPayload }
                    );
                } catch (err) {
                    console.error("Failed to show close-raid modal:", err);
                    await interaction.reply({ content: "Could not open the close raid modal. Please try again.", flags: MessageFlags.Ephemeral });
                }
                return;
            }

            // Edit Task button
            if (interaction.customId === "editTask_btn") {
                if (!await isAuthorizedToManageRaid(interaction, raidInfo)) return;

                const editModal = getEditTaskModal(raidInfo.task, raidInfo.mapName, raidInfo.server, raidInfo.size);
                try {
                    await interaction.showModal(editModal);
                } catch (e) {
                    console.error("Failed to show edit task modal:", e);
                    await interaction.reply({ content: "Could not open edit task modal. Please try again.", flags: MessageFlags.Ephemeral });
                }
                return;
            }

            // Cancel Raid button → ephemeral confirm/cancel
            if (interaction.customId === "cancelRaidTicket") {
                if (!await isAuthorizedToManageRaid(interaction, raidInfo)) return;

                const confirmButton = new ButtonBuilder()
                    .setCustomId("confirmCancelRaid")
                    .setLabel("Confirm Cancel")
                    .setStyle(ButtonStyle.Danger);
                const cancelButton = new ButtonBuilder()
                    .setCustomId("abortCancelRaid")
                    .setLabel("Abort")
                    .setStyle(ButtonStyle.Secondary);
                const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

                await interaction.reply({ content: "Are you sure you want to cancel this raid?", components: [row], flags: MessageFlags.Ephemeral });
                return;
            }

            // Confirm or abort cancel
            if (["confirmCancelRaid", "abortCancelRaid"].includes(interaction.customId)) {
                if (interaction.customId === "abortCancelRaid") {
                    await interaction.update({ content: "Raid cancellation aborted.", components: [] });
                    return;
                }
                if (!await isAuthorizedToManageRaid(interaction, raidInfo)) return;
                await interaction.update({ content: "Raid will now be cancelled.", components: [] });
                await finalizeRaidForAdminReview(client, interaction.channel, raidInfo, {}, interaction.user.id, "cancelled");
                return;
            }

            // Delete Finalized Raid Channel
            if (interaction.customId === "deleteFinalizedRaidChannel") {
                if (!await isStaff(interaction)) return;
                try {
                    const raidToDeleteInfo = await getRaidInfo(interaction.channel.id);
                    if (raidToDeleteInfo) await deleteRaid(interaction.channel.id).catch(() => {});
                    await interaction.channel.delete('Admin manually deleted completed raid channel after review.');
                } catch (err) {
                    console.error(`Error deleting finalized raid channel ${interaction.channel.id}:`, err);
                    await interaction.reply({ content: 'Error deleting channel. Check bot permissions.', flags: MessageFlags.Ephemeral });
                }
                return;
            }
        }

        // ----- MODAL SUBMIT HANDLERS -----
        if (interaction.type === InteractionType.ModalSubmit) {
            if (interaction.customId === "closeRaidModal") {
                const selectedUserIds = interaction.fields.getField("closeRaid_SelectHelpers")?.values || [];
                const closingNotes = interaction.fields.getTextInputValue("closeRaid_notesInput") || "";

                if (!selectedUserIds.length) {
                    await interaction.reply({ content: "No helpers were selected.", flags: MessageFlags.Ephemeral });
                    return;
                }

                const { originalTotalCalculatedPoints: pointsPerUser, unknownTasks } = calculateTaskPointsWithMultiplier(raidInfo.task);
                if (unknownTasks?.length) {
                    await interaction.reply({ content: `Could not calculate points due to unknown task(s): ${unknownTasks.join(", ")}`, flags: MessageFlags.Ephemeral });
                    return;
                }

                const pointsAwarded = {};
                selectedUserIds.forEach(uid => pointsAwarded[uid] = Math.min(pointsPerUser, MAX_XP_PER_RAID));

                // Finalize raid and include notes in admin review
                await finalizeRaidForAdminReview(client, interaction.channel, raidInfo, pointsAwarded, interaction.user.id, "completed", closingNotes);

                const mentions = selectedUserIds.map(id => `<@${id}>`).join(", ");
                await interaction.reply({
                    content: `Raid finalized.\n**Helpers:** ${mentions}\n**Notes:** ${closingNotes || "None"}\n**Points awarded:** ${pointsPerUser} EXP each.\nAdmins can now review and delete the channel.`,
                    flags: MessageFlags.Ephemeral
                });
            }

            // Edit Task modal
            if (interaction.customId === "editTaskModal") {
                if (!await isAuthorizedToManageRaid(interaction, raidInfo)) return;

                const rawTasksInput = interaction.fields.getTextInputValue('editedTaskInput');
                const raidType = raidInfo.size;

                const { resolvedTasks, invalidTasks } = validateAndResolveTasks(rawTasksInput, raidType);

                if (invalidTasks.length > 0) {
                    await interaction.reply({
                        content: `❌ Task(s) not allowed for ${raidType} raid: ${invalidTasks.join(', ')}`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const resolvedTaskString = resolvedTasks.join(', ');

                await updateRaid(interaction.channel.id, { task: resolvedTaskString }).catch(e => console.error("Failed to update raid task:", e));
                await updateRaidLogEmbed(client, interaction.channel.id, {
                    fields: [
                        { name: 'Task(s)', value: resolvedTaskString, inline: false }
                    ]
                }).catch(e => console.error("Failed to update raid log embed:", e));

                await interaction.reply({ content: `Tasks updated to: ${resolvedTaskString}`, flags: MessageFlags.Ephemeral });
                return;
            }
        }
    });
}
