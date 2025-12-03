import {
    EmbedBuilder,
    ChannelType,
    MessageFlags,
    ButtonBuilder,
    ButtonStyle,
    ActionRowBuilder,
    UserSelectMenuBuilder,
    TextInputBuilder,
    TextInputStyle,
} from "discord.js";
import {
    EXP_LAIR_CHANNEL_ID,
    RAID_CATEGORY_ID,
    MODERATOR_ROLE_ID,
    OFFICER_ROLE_ID,
    RAID_MANAGER_ROLE_ID,
    RAID_HELPER_ROLE_ID,
    MAX_XP_PER_RAID,
} from "../config/constants.js";
import { updateLeaderboard } from "./leaderboardCore.js";
import {
    getEditTaskModal,
    updateRaidLogEmbed,
    getRaidInfo,
    updateRaid,
    deleteRaid
} from "../activeRaidState.js";
import { sendLeaderboardBackup } from "./backupHandler.js";
import { calculateTaskPointsWithMultiplier } from "../utils/taskCalculations.js";
import { validateAndResolveTasks } from '../utils/allowedTasks.js';

// --- Authorization Helpers (Stateless) ---
function isAdmin(source) {
    const member = source.member;
    if (!member) return false;
    return (
        member.roles.cache.has(MODERATOR_ROLE_ID) ||
        member.roles.cache.has(OFFICER_ROLE_ID) ||
        member.roles.cache.has(RAID_MANAGER_ROLE_ID)
    );
}

// Checks if the user is the requester OR a staff member (raid manager).
function isRaidManager(interaction, raidInfo) {
    if (!raidInfo) return false;
    const isRequester = interaction.user.id === raidInfo.requesterId;
    return isRequester || isAdmin(interaction);
}

// Checks if the user is staff (same as isAdmin, renamed for clarity in context).
function isStaff(interaction) {
    return isAdmin(interaction);
}

// --- Authorization Guard (Replies if unauthorized) ---
async function replyIfUnauthorized(interaction, raidInfo, requiredRole) {
    let isAuthorized = false;
    let message = "";

    if (requiredRole === 'raid_manager') {
        isAuthorized = isRaidManager(interaction, raidInfo);
        message = "Only the user who initiated this raid or a staff member can perform this action.";
    } else if (requiredRole === 'staff') {
        isAuthorized = isStaff(interaction);
        message = "Only staff members can perform this action.";
    }

    if (!isAuthorized) {
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
            } else {
                console.warn(`Unauthorized interaction attempt by ${interaction.user.id} on ${interaction.customId}, but interaction was already replied/deferred.`);
            }
        } catch (e) {
            console.error("Error sending unauthorized reply:", e);
        }
        return false;
    }
    return true;
}

// --- Finalization Core Logic ---
async function finalizeRaidForAdminReview(client, channel, raidInfo, pointsAwarded = {}, completionInitiatorId, reason = "completed", notes = "") {
    await updateRaid(channel.id, {status: "Awaiting_Completion"});
    const COLOR_INFO = 0x0099ff;

    try {
        const guild = channel.guild;
        const everyoneRole = guild.roles.everyone;
        const moderatorRole = guild.roles.cache.get(MODERATOR_ROLE_ID);
        const officerRole = guild.roles.cache.get(OFFICER_ROLE_ID);
        const raidManagerRole = guild.roles.cache.get(RAID_MANAGER_ROLE_ID);
        const requester = await guild.members.fetch(raidInfo.requesterId).catch(() => null);
        const requesterMember = requester;

        // 5 second delay and alert
        await channel.send("This Raid Will now Close.").catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Deny view for everyone and helpers
        await channel.permissionOverwrites.edit(everyoneRole, { ViewChannel: false, }).catch(() => {});
        await channel.permissionOverwrites.edit(RAID_HELPER_ROLE_ID, { ViewChannel: false, }).catch(() => {});

        // Deny view for requester unless they are also staff
        if (requester && !isAdmin({ member: requester })) {
            await channel.permissionOverwrites.edit(requester, { ViewChannel: false }).catch(() => {});
        }

        // Grant ViewChannel for admin roles (if they exist)
        if (moderatorRole) { await channel.permissionOverwrites.edit(moderatorRole, { ViewChannel: true }).catch(() => {}); }
        if (officerRole) { await channel.permissionOverwrites.edit(officerRole, { ViewChannel: true }).catch(() => {}); }
        if (raidManagerRole) { await channel.permissionOverwrites.edit(raidManagerRole, { ViewChannel: true }).catch(() => {}); }

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
                            `**Helpers:** ${helperMentions}\n` +
                            `**Description:** ${raidInfo.description || "No description provided."}`
                        )
                        .setTimestamp()
                        .setFooter({ text: "Raid Completion Details" });

                    if (raidInfo.proofImage) {
                        expEmbed.setImage(raidInfo.proofImage);
                    }                        

                    const sent = await expLairChannel.send({
                        content: `Raid completed for ${requesterMember ? requesterMember.displayName : `<@${raidInfo.requesterId}>`}.`,
                        embeds: [expEmbed]
                    }).catch(e => { console.error("Failed to send to EXP Lair:", e); return null; });

                    if (sent) {
                        expLairMessageLink = sent.url;
                        // Create thread with the detailed point breakdown
                        try {
                            const thread = await sent.startThread({
                                name: `Raid for ${requesterMember ? requesterMember.displayName : raidInfo.requesterId}`,
                                autoArchiveDuration: 60
                            });

                            let threadContent = `This thread contains the full details for the raid\n`;

                            threadContent += `**Task Initially Requested:** ${raidInfo.task}\n`;
                            
                            if (Object.keys(pointsAwarded).length > 0) {
                                
                                threadContent += `**Points Breakdown:**\n`;
                                
                                for (const uid of Object.keys(pointsAwarded)) {
                                    const member = await channel.guild.members.fetch(uid).catch(() => null);
                                    const userDisplay = member ? `* **${member.displayName}**` : `<@${uid}>`;
                                    const expTotal = pointsAwarded[uid];

                                    // Points Breakdown Line
                                    threadContent += `${userDisplay}: ${expTotal} EXP\n`;
                                }
                                
                                // Naughty Nice Event:
                                threadContent += "\n**Event Commands for mods: **\n"
                                for (const uid of Object.keys(pointsAwarded)) {
                                    threadContent += `\`\`\`$give <@${uid}> 10\`\`\`\n`;
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

        // Build admin review embed 
        const reviewDescriptionParts = [
            `This raid was ${reason} by <@${completionInitiatorId}>.`,
            `**Requester:** <@${raidInfo.requesterId}>`,
            `**Original Task(s):** ${raidInfo.task}`
        ];

        if (notes && notes.length > 0) {
            reviewDescriptionParts.push(`**Notes:** ${notes}`);
        }

        if (reason === "completed") {
            reviewDescriptionParts.push(`**EXP Lair Post:** ${expLairMessageLink !== "N/A (no post)" ? `[**Click Here**](${expLairMessageLink})` : expLairMessageLink}`);
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

        // Update DB: status admin_review, store points and expLairMessageLink 
        await updateRaid(channel.id, {
            status: "admin_review",
            isAwaitingCompletion: false, // <-- New state clear
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
        // Ensure status and boolean are reset on failure
        await channel.send("There was an error finalizing this raid. Please contact staff.").catch(() => null);
        await updateRaid(channel.id, { status: "active", isAwaitingCompletion: false }).catch(() => null);
    }
}

// --- Main event setup ---
export function setupExpLairHandlers(client) {
    client.on("interactionCreate", async (interaction) => {
        if (!interaction.isButton() && !interaction.isUserSelectMenu() && interaction.isModalSubmit()) {
            if (interaction.customId !== "editTaskModal") return;
        } else if (!interaction.isButton() && !interaction.isUserSelectMenu()) {
            return;
        }

        const raidInfo = interaction.channel ? await getRaidInfo(interaction.channel.id) : null;
        const isRaidTicketChannel = raidInfo && interaction.channel && interaction.channel.type === ChannelType.GuildText && interaction.channel.parentId === RAID_CATEGORY_ID;

        // Handle interactions outside of active raid tickets (mostly cleanup)
        if (!isRaidTicketChannel) {
            if (interaction.isButton() && interaction.customId === "deleteFinalizedRaidChannel") {
                if (!await replyIfUnauthorized(interaction, raidInfo, 'staff')) return;

                try {
                    // Send immediate reply instead of deferring
                    await interaction.reply({
                        content: "Deleting this finalized raid channel...",
                        ephemeral: true
                    });

                    const raidToDeleteInfo = await getRaidInfo(interaction.channel.id);
                    if (raidToDeleteInfo) {
                        await deleteRaid(interaction.channel.id).catch(() => {});
                    }

                    // Delete channel AFTER replying
                    await interaction.channel.delete(
                        'Admin manually deleted completed raid channel after review.'
                    );

                } catch (err) {
                    console.error(
                        `Error deleting finalized raid channel ${interaction.channel.id}:`,
                        err
                    );

                    // Try notifying user only if interaction is still valid
                    try {
                        await interaction.followUp({
                            content: "Error deleting channel. Check bot permissions.",
                            ephemeral: true
                        });
                    } catch (_) {}
                }
                return;
            }
        }

        // =========================================================================================
        // PRIORITY HANDLERS: These must run BEFORE the "Awaiting Completion" Global Lock
        // This prevents the "Closure is active" error when interacting with the closure UI itself
        // =========================================================================================


        if (interaction.isButton() && interaction.customId === "deleteFinalizedRaidChannel") {
            if (!await replyIfUnauthorized(interaction, raidInfo, 'staff')) return;
            
            try {
                await interaction.deferReply({ ephemeral: true }); 
                const raidToDeleteInfo = await getRaidInfo(interaction.channel.id);
                if (raidToDeleteInfo) await deleteRaid(interaction.channel.id).catch(() => {});
                
                await interaction.channel.delete('Admin manually deleted completed raid channel after review.');
                // Note: We can't editReply to a deleted channel, so we just catch potential errors silently
            } catch (err) {
                console.error(`Error deleting finalized raid channel ${interaction.channel.id}:`, err);
                // Try to alert if channel still exists
                if (interaction.channel) {
                    await interaction.editReply({ content: 'Error deleting channel. Check bot permissions.' }).catch(() => {});
                }
            }
            return;
        }

        if (interaction.isButton() && interaction.customId === "abortCloseRaid") {
            if (!await replyIfUnauthorized(interaction, raidInfo, 'raid_manager')) return; 
            
            try {
                // Modified: Only resets isAwaitingCompletion, keeps status as 'active' (or whatever it was)
                await updateRaid(interaction.channel.id, { 
                    isAwaitingCompletion: false 
                });
                await interaction.update({ content: "Raid closing process aborted.", components: [] });
            } catch (e) {
                console.error("Error in abortCloseRaid:", e);
            }
            return;
        }

        if (interaction.isUserSelectMenu() && interaction.customId === "closeRaid_SelectHelpers") {
            if (!await replyIfUnauthorized(interaction, raidInfo, 'raid_manager')) return;
            
            try {
                const maxHelpers = interaction.component.maxValues;
                
                const confirmButton = new ButtonBuilder()
                    .setCustomId("confirmCloseSelection")
                    .setLabel("Confirm Closing")
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(interaction.values.length === 0);
                
                const abortButton = new ButtonBuilder()
                    .setCustomId("abortCloseRaid")
                    .setLabel("Abort")
                    .setStyle(ButtonStyle.Secondary);

                const selectMenu = new UserSelectMenuBuilder()
                    .setCustomId("closeRaid_SelectHelpers")
                    .setPlaceholder("Select users who helped (Max: " + maxHelpers + ")")
                    .setMaxValues(maxHelpers)
                    .setMinValues(1);

                const proofButton = new ButtonBuilder()
                    .setCustomId("provideProof")
                    .setLabel("Proof")
                    .setStyle(ButtonStyle.Secondary);
                    
                const selectRow = new ActionRowBuilder().addComponents(selectMenu);
                const buttonRow = new ActionRowBuilder().addComponents(confirmButton, abortButton, proofButton );

                const mentions = interaction.values.map(id => `<@${id}>`).join(", ");
                const selectedCount = interaction.values.length;

                await interaction.update({
                    content: `Selected Helpers (${selectedCount} users): ${mentions || 'None selected.'}\nPress **Confirm Closing** to process points.`,
                    components: [selectRow, buttonRow],
                });
            } catch (e) {
                console.error("Error in closeRaid_SelectHelpers:", e);
            }
            return;
        }

        if (interaction.isButton() && interaction.customId === "confirmCloseSelection") {
            if (!await replyIfUnauthorized(interaction, raidInfo, 'raid_manager')) return;
            if (raidInfo.status === "Awaiting_Completion") {
                await interaction.reply({
                    content: "The raid closure confirmation is currently active. Please confirm or use the 'Abort' button.",
                    flags: MessageFlags.Ephemeral
                    }).catch(e => {
                        console.warn(`[Awaiting Comp] Failed to reply/followUp: ${e.code || e.message}`);
                    });
                return;
            }
            try {
                // Reply immediately to prevent timeout
                await interaction.reply({
                    content: "Processing raid closure...",
                    flags: MessageFlags.Ephemeral
                });

                const currentRaidInfo = await getRaidInfo(interaction.channel.id);
                let selectedUserIds = [];
                const msg = interaction.message;

                if (msg && msg.content) {
                    const matches = msg.content.match(/<@(\d+)>/g);
                    selectedUserIds = matches ? matches.map(m => m.replace(/<@|>/g, "")) : [];
                }

                if (selectedUserIds.length === 0) {
                    await interaction.followUp({
                        content: "Helper selection was lost or empty. Please restart the closing process.",
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                // Requester exclusion
                let requesterWarning = "";
                const requesterIndex = selectedUserIds.indexOf(currentRaidInfo.requesterId);

                if (requesterIndex !== -1) {
                    selectedUserIds.splice(requesterIndex, 1);
                    requesterWarning = `\n⚠️ Note: requester (<@${currentRaidInfo.requesterId}>) excluded from helper points.`;
                }

                if (selectedUserIds.length === 0) {
                    await interaction.followUp({
                        content: `No eligible helpers remained.${requesterWarning}`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                // Calculate points
                const { originalTotalCalculatedPoints: pointsPerUser, unknownTasks } =
                    calculateTaskPointsWithMultiplier(currentRaidInfo.task);

                if (unknownTasks?.length) {
                    await interaction.followUp({
                        content: `Could not calculate points: ${unknownTasks.join(", ")}`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const pointsAwarded = {};
                for (const uid of selectedUserIds) {
                    pointsAwarded[uid] = Math.min(pointsPerUser, MAX_XP_PER_RAID);
                }

                await finalizeRaidForAdminReview(
                    client,
                    interaction.channel,
                    currentRaidInfo,
                    pointsAwarded,
                    interaction.user.id,
                    "completed",
                    ""
                );
            } catch (e) {
                console.error("Error in confirmCloseSelection:", e);
                // Safe error reply
                try {
                    if (!interaction.replied) await interaction.reply({ content: "Error processing completion.", flags: MessageFlags.Ephemeral });
                    else await interaction.followUp({ content: "Error processing completion.", flags: MessageFlags.Ephemeral });
                } catch (ignore) {}
            }
            return;
        }

        if (interaction.isButton() && interaction.customId === "provideProof") {
        if (!await replyIfUnauthorized(interaction, raidInfo, 'raid_manager')) return;
        await interaction.reply({
            content: "Please send the screenshot/proof **in your next message**.",
            flags: MessageFlags.Ephemeral
        });
        const channel = interaction.channel;

        const filter = (m) =>
            m.author.id === interaction.user.id &&
            m.attachments.size > 0;

        try {
            const collected = await channel.awaitMessages({
                filter,
                max: 1,
                time: 30_000,
                errors: ["time"]
            });

            const msg = collected.first();
            const attachment = msg.attachments.first();

            if (!attachment) {
                await interaction.followUp({
                    content: "No attachment found. Please try again.",
                    flags: MessageFlags.Ephemeral
                });
                return;
            }

            await updateRaid(channel.id, {
                proofImage: attachment.url
            });

            await interaction.followUp({
                content: "Proof saved! It will be attached to the completion post.",
                flags: MessageFlags.Ephemeral
            });

        } catch (e) {
            await interaction.followUp({
                content: "Timed out. No proof received.",
                flags: MessageFlags.Ephemeral
            });
        }

        return;
    }

        // =========================================================================================
        // GLOBAL LOCK: Helper Selection UI Active
        // =========================================================================================
        if (raidInfo?.awaitingCompletion) {
            await interaction.reply({
                content: "The raid closure confirmation is currently active. Please confirm or use the 'Abort' button.",
                flags: MessageFlags.Ephemeral
            }).catch(e => {
                console.warn(`[Awaiting Comp] Failed to reply/followUp: ${e.code || e.message}`);
            });
            return;
        }

        // =========================================================================================
        // STANDARD HANDLERS
        // =========================================================================================

        if (interaction.isButton() && interaction.customId === "editTask_btn") {
            if (!await replyIfUnauthorized(interaction, raidInfo, 'raid_manager')) return; 

            const editModal = getEditTaskModal(raidInfo.task, raidInfo.mapName, raidInfo.mapNumber, raidInfo.server, raidInfo.size, raidInfo.description);
            try {
                await interaction.showModal(editModal);
            } catch (e) {
                console.error("Failed to show edit task modal:", e);
                await interaction.reply({ content: "Could not open edit task modal. Please try again.", flags: MessageFlags.Ephemeral });
            }
            return;
        }

        if (interaction.isButton() && interaction.customId === "closeRaidTicket") {
            if (!await replyIfUnauthorized(interaction, raidInfo, 'raid_manager')) return;
            
            try {
                await updateRaid(interaction.channel.id, {
                    isAwaitingCompletion: true,
                });

                const maxHelpers = raidInfo.size === "4-man" ? 3 : raidInfo.size === "7-man" ? 6 : 10;
                const userSelect = new UserSelectMenuBuilder()
                    .setCustomId("closeRaid_SelectHelpers")
                    .setPlaceholder("Select users who helped (Max: " + maxHelpers + ")")
                    .setMaxValues(maxHelpers)
                    .setMinValues(1);
                    
                const confirmButton = new ButtonBuilder()
                    .setCustomId("confirmCloseSelection")
                    .setLabel("Confirm Closing")
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true); 
                    
                const abortButton = new ButtonBuilder()
                    .setCustomId("abortCloseRaid")
                    .setLabel("Abort")
                    .setStyle(ButtonStyle.Secondary);

                const proofButton = new ButtonBuilder()
                    .setCustomId("provideProof")
                    .setLabel("Proof")
                    .setStyle(ButtonStyle.Secondary);                    

                const selectRow = new ActionRowBuilder().addComponents(userSelect);
                const buttonRow = new ActionRowBuilder().addComponents(confirmButton, abortButton, proofButton);

                await interaction.reply({
                    content: `Please select the users who successfully helped with the raid. (Max: ${maxHelpers})\n**Selected Helpers (0 users):** None selected.`,
                    components: [selectRow, buttonRow],
                });
            } catch (e) {
                console.error("Error in closeRaidTicket:", e);
            }
            return;
        }

        if (interaction.isButton() && interaction.customId === "cancelRaidTicket") {
            if (!await replyIfUnauthorized(interaction, raidInfo, 'raid_manager')) return;

            const confirmButton = new ButtonBuilder()
                .setCustomId("confirmCancelRaid")
                .setLabel("Cancel Raid")
                .setStyle(ButtonStyle.Danger);
            const cancelButton = new ButtonBuilder()
                .setCustomId("abortCancelRaid")
                .setLabel("Abort")
                .setStyle(ButtonStyle.Secondary);   
            const row = new ActionRowBuilder().addComponents(confirmButton, cancelButton);

            await interaction.reply({ content: "Are you sure you want to cancel this raid?", components: [row], flags: MessageFlags.Ephemeral });
            return;
        }

        if (["confirmCancelRaid", "abortCancelRaid"].includes(interaction.customId)) {
            if (!await replyIfUnauthorized(interaction, raidInfo, 'raid_manager')) return;

            try {
                if (interaction.customId === "abortCancelRaid") {
                    await interaction.update({ content: "Raid cancellation aborted.", components: [] });
                    return;
                }
                await interaction.update({ content: "Raid will now be cancelled. Closing channel for review...", components: [] });
                await finalizeRaidForAdminReview(client, interaction.channel, raidInfo, {}, interaction.user.id, "cancelled");
            } catch (e) {
                console.error("Error in cancel logic:", e);
            }
            return;
        }

        // ----- MODAL SUBMIT HANDLERS -----
        if (interaction.isModalSubmit() && interaction.customId === "editTaskModal") {
            if (!await replyIfUnauthorized(interaction, raidInfo, 'raid_manager')) return;

            try {
                const rawTasksInput = interaction.fields.getTextInputValue('editedTaskInput');
                const rawMapInput = interaction.fields.getTextInputValue('editedMapInput');
                const rawMapNumberInput = interaction.fields.getTextInputValue('editedMapNumberInput');
                const rawServerInput = interaction.fields.getTextInputValue('editedServerInput');
                const rawDescriptionInput = interaction.fields.getTextInputValue('editedDescriptionInput');
                const raidType = raidInfo.size;

                const { resolvedTasks, invalidTasks } = validateAndResolveTasks(rawTasksInput, raidType);

                if (invalidTasks.length > 0) {
                    await interaction.reply({
                        content: `Task(s) not allowed for ${raidType} raid:\n${invalidTasks.join(', ')}\n\nPlease edit and try again.`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const resolvedTaskString = resolvedTasks.join(', ');
                const finalDescription = rawDescriptionInput.trim() === "" ? "No description provided." : rawDescriptionInput;

                await updateRaid(interaction.channel.id, {
                    task: resolvedTaskString,
                    mapName: rawMapInput,
                    mapNumber: rawMapNumberInput, 
                    server: rawServerInput,
                    description: finalDescription
                });

                await updateRaidLogEmbed(client, interaction.channel.id, {
                    fields: [
                        { name: 'Task(s)', value: resolvedTaskString, inline: false },
                        { name: 'Map Name', value: rawMapInput, inline: false },
                        { name: 'Map Number', value: rawMapNumberInput, inline: false },
                        { name: 'Server', value: rawServerInput, inline: false },
                        { name: 'Description', value: finalDescription, inline: false }
                    ]
                });

                await interaction.reply({
                    content: `**Raid Successfully Updated**`,
                    flags: MessageFlags.Ephemeral
                });
            } catch (e) {
                console.error("Error in editTaskModal:", e);
            }
            return;
        }
    });
}