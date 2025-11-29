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

async function finalizeRaidForAdminReview(client, channel, raidInfo, pointsAwarded = {}, completionInitiatorId, reason = "completed", notes = "") {
    const COLOR_INFO = 0x0099ff;

    try {
        const guild = channel.guild;
        const everyoneRole = guild.roles.everyone;
        const moderatorRole = guild.roles.cache.get(MODERATOR_ROLE_ID);
        const officerRole = guild.roles.cache.get(OFFICER_ROLE_ID);
        const raidManagerRole = guild.roles.cache.get(RAID_MANAGER_ROLE_ID);
        const requester = await guild.members.fetch(raidInfo.requesterId).catch(() => null); 
        const requesterMember = requester; // Renamed for clarity, since requester is now the member object

        // 5 second delay and alert
        await channel.send("This Raid Will now Close."); 
        await new Promise(resolve => setTimeout(resolve, 5000));

        // Deny view for everyone and helpers
        await channel.permissionOverwrites.edit(everyoneRole, { ViewChannel: false, });
        await channel.permissionOverwrites.edit(RAID_HELPER_ROLE_ID, { ViewChannel: false, });

        // Deny view for requester unless they are also staff
        if (requester && !isAdmin({ member: requester })) {
            await channel.permissionOverwrites.edit(requester, { ViewChannel: false });
        }

        // Grant ViewChannel for admin roles (if they exist)
        if (moderatorRole) { await channel.permissionOverwrites.edit(moderatorRole, { ViewChannel: true }); }
        if (officerRole) { await channel.permissionOverwrites.edit(officerRole, { ViewChannel: true }); }
        if (raidManagerRole) { await channel.permissionOverwrites.edit(raidManagerRole, { ViewChannel: true }); }

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
        // Only handle buttons, select menus, and the one modal for Edit Task.
        if (!interaction.isButton() && !interaction.isUserSelectMenu() && interaction.isModalSubmit()) {
            if (interaction.customId !== "editTaskModal") return;
        } else if (!interaction.isButton() && !interaction.isUserSelectMenu()) {
            return;
        }

        const raidInfo = interaction.channel ? await getRaidInfo(interaction.channel.id) : null;
        const isRaidTicketChannel = raidInfo && interaction.channel && interaction.channel.type === ChannelType.GuildText && interaction.channel.parentId === RAID_CATEGORY_ID;

        // Basic Channel Validation and Orphan Channel Handling (kept for safety)
        if (!isRaidTicketChannel) {
            if (interaction.isButton() && interaction.customId === "deleteFinalizedRaidChannel" && !raidInfo) {
                // This handles the case where the delete button is pressed on a finalized channel, but the DB record is already gone.
                if (await isStaff(interaction)) {
                    await interaction.reply({ content: "Could not retrieve raid details. Attempting to delete channel.", flags: MessageFlags.Ephemeral });
                    try {
                        await interaction.channel.delete('Orphaned raid channel without DB entry, manually deleting.').catch(e => console.error("Failed to delete orphan channel:", e));
                    } catch (e) {
                        console.error("Error deleting orphan channel:", e);
                    }
                }
                return;
            } 
            return;
        }

        // ----- BUTTON HANDLERS -----

        if (interaction.isButton() && interaction.customId === "deleteFinalizedRaidChannel") {
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

        if (interaction.isButton()) {
            if (raidInfo.awaitingCompletion || raidInfo.status === "Awaiting_Completion") {
                    await interaction.reply({
                        content: "The raid is being closed, you cannot press any buttons",
                        ephemeral: true
                    });
                return;
            }
            
            if (interaction.customId === "closeRaidTicket") {
                if (!await isAuthorizedToManageRaid(interaction, raidInfo)) return;
                
                // --- User Select Menu & Buttons (Single Ephemeral Message) ---
                const maxHelpers = raidInfo.size === "4-man" ? 4 : raidInfo.size === "7-man" ? 7 : 10;

                const userSelect = new UserSelectMenuBuilder()
                    .setCustomId("closeRaid_SelectHelpers")
                    .setPlaceholder("Select users who helped (Max: " + maxHelpers + ")")
                    .setMaxValues(maxHelpers)
                    .setMinValues(1);
                    
                const confirmButton = new ButtonBuilder()
                    .setCustomId("confirmCloseSelection")
                    .setLabel("Confirm Closing")
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(true); // Disabled initially
                    
                const abortButton = new ButtonBuilder()
                    .setCustomId("abortCloseRaid")
                    .setLabel("Abort")
                    .setStyle(ButtonStyle.Secondary);

                const selectRow = new ActionRowBuilder().addComponents(userSelect);
                const buttonRow = new ActionRowBuilder().addComponents(confirmButton, abortButton);

                await interaction.reply({
                    content: `Please select the users who successfully helped with the raid. (Max: ${maxHelpers})`,
                    components: [selectRow, buttonRow],
                    flags: MessageFlags.Ephemeral 
                });
                return;
            }
            
            if (interaction.customId === "confirmCloseSelection") {

                // Always reply immediately to avoid 10062
                await interaction.reply({
                    content: "Processing raid closure...",
                    flags: 64
                });

                // Now it's safe to run slow logic
                if (!await isAuthorizedToManageRaid(interaction, raidInfo)) return;

                await updateRaid(interaction.channel.id, {
                    status: "Awaiting_Completion",
                    awaitingCompletion: true
                });

                let selectedUserIds = [];
                const msg = interaction.message;

                if (msg && msg.content) {
                    const matches = msg.content.match(/<@(\d+)>/g);
                    selectedUserIds = matches ? matches.map(m => m.replace(/<@|>/g, "")) : [];
                }

                if (selectedUserIds.length === 0) {
                    await interaction.followUp({
                        content: "Helper selection was lost or empty. Please restart the closing process.",
                        flags: 64
                    });
                    return;
                }

                // Requester exclusion
                let requesterWarning = "";
                const requesterIndex = selectedUserIds.indexOf(raidInfo.requesterId);

                if (requesterIndex !== -1) {
                    selectedUserIds.splice(requesterIndex, 1);
                    requesterWarning =
                        `\n⚠️ Note: requester (<@${raidInfo.requesterId}>) excluded from helper points.`;
                }

                if (selectedUserIds.length === 0) {
                    await interaction.followUp({
                        content: `No eligible helpers remained.${requesterWarning}`,
                        flags: 64
                    });
                    return;
                }

                // Calculate points
                const { originalTotalCalculatedPoints: pointsPerUser, unknownTasks } =
                    calculateTaskPointsWithMultiplier(raidInfo.task);

                if (unknownTasks?.length) {
                    await interaction.followUp({
                        content: `Could not calculate points: ${unknownTasks.join(", ")}`,
                        flags: 64
                    });
                    return;
                }

                // Cap points
                const pointsAwarded = {};
                for (const uid of selectedUserIds) {
                    pointsAwarded[uid] = Math.min(pointsPerUser, MAX_XP_PER_RAID);
                }

                await finalizeRaidForAdminReview(
                    client,
                    interaction.channel,
                    raidInfo,
                    pointsAwarded,
                    interaction.user.id,
                    "completed",
                    ""
                );
            }


            if (interaction.customId === "abortCloseRaid") {
                await interaction.update({ content: "Raid closing process aborted.", components: [] });
                return;
            }

            if (interaction.customId === "editTask_btn") {
                if (!await isAuthorizedToManageRaid(interaction, raidInfo)) return;

                const editModal = getEditTaskModal(raidInfo.task, raidInfo.mapName, raidInfo.server, raidInfo.size, raidInfo.description);
                try {
                    await interaction.showModal(editModal);
                } catch (e) {
                    console.error("Failed to show edit task modal:", e);
                    await interaction.reply({ content: "Could not open edit task modal. Please try again.", flags: MessageFlags.Ephemeral });
                }
                return;
            }   

            if (interaction.customId === "cancelRaidTicket") {
                if (!await isAuthorizedToManageRaid(interaction, raidInfo)) return;

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
                if (interaction.customId === "abortCancelRaid") {
                    await interaction.update({ content: "Raid cancellation aborted.", components: [] });
                    return;
                }
                if (!await isAuthorizedToManageRaid(interaction, raidInfo)) return;
                await interaction.update({ content: "Raid will now be cancelled.", components: [] });
                // Finalize raid as cancelled (no points awarded)
                await finalizeRaidForAdminReview(client, interaction.channel, raidInfo, {}, interaction.user.id, "cancelled");
                return;
            }
        }
        
        // ----- USER SELECT MENU HANDLERS -----
        if (interaction.isUserSelectMenu()) {
            if (interaction.customId === "closeRaid_SelectHelpers") {
                const maxHelpers = interaction.component.maxValues;
                
                // Re-enable/disable the confirm button based on selection size
                const confirmButton = new ButtonBuilder()
                    .setCustomId("confirmCloseSelection")
                    .setLabel("Confirm Closing")
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(interaction.values.length === 0); 
                
                const abortButton = new ButtonBuilder()
                    .setCustomId("abortCloseRaid")
                    .setLabel("Abort")
                    .setStyle(ButtonStyle.Secondary);
                    
                // Re-create the select menu component (Discord requires re-sending all components)
                const selectMenu = new UserSelectMenuBuilder()
                    .setCustomId("closeRaid_SelectHelpers")
                    .setPlaceholder("Select users who helped (Max: " + maxHelpers + ")")
                    .setMaxValues(maxHelpers)
                    .setMinValues(1);
                    
                const selectRow = new ActionRowBuilder().addComponents(selectMenu);
                const buttonRow = new ActionRowBuilder().addComponents(confirmButton, abortButton);

                // Use the selected user IDs to generate mentions for the content update
                const mentions = interaction.values.map(id => `<@${id}>`).join(", ");
                const selectedCount = interaction.values.length;

                // Update the ephemeral message content to explicitly show the selected users
                await interaction.update({
                    content: `**Selected Helpers (${selectedCount} users):** ${mentions || 'None selected.'}\nPress **Confirm Closing** to process points.`,
                    components: [selectRow, buttonRow],
                });
                return;
            }
        }

        // ----- MODAL SUBMIT HANDLERS -----
        if (interaction.isModalSubmit()) {
            // Edit Task modal (Only modal remaining)
            if (interaction.customId === "editTaskModal") {
                if (!await isAuthorizedToManageRaid(interaction, raidInfo)) return;

                // Collect modal inputs
                const rawTasksInput = interaction.fields.getTextInputValue('editedTaskInput');
                const rawMapInput = interaction.fields.getTextInputValue('editedMapInput');
                const rawServerInput = interaction.fields.getTextInputValue('editedServerInput');
                const rawDescriptionInput = interaction.fields.getTextInputValue('editedDescriptionInput');
                const raidType = raidInfo.size;

                // Validate tasks
                const { resolvedTasks, invalidTasks } = validateAndResolveTasks(rawTasksInput, raidType);

                if (invalidTasks.length > 0) {
                    await interaction.reply({
                        content: `Task(s) not allowed for ${raidType} raid:\n${invalidTasks.join(', ')}\n\nPlease edit and try again.`,
                        flags: MessageFlags.Ephemeral
                    });
                    return;
                }

                const resolvedTaskString = resolvedTasks.join(', ');
                const finalDescription = rawDescriptionInput.trim() === ""  ? "No description provided." : rawDescriptionInput;
                // Update DB
                await updateRaid(interaction.channel.id, {
                    task: resolvedTaskString,
                    mapName: rawMapInput,
                    server: rawServerInput,
                    description: finalDescription
                }).catch(e => console.error("Failed to update raid task:", e));
                
                // Update visible embed
                await updateRaidLogEmbed(client, interaction.channel.id, {
                    fields: [
                        { name: 'Task(s)', value: resolvedTaskString, inline: false },
                        { name: 'Map Name', value: rawMapInput, inline: false },
                        { name: 'Server', value: rawServerInput, inline: false },
                        { name: 'Description', value: finalDescription, inline: false }
                    ]
                }).catch(e => console.error("Failed to update raid log embed:", e));

                // Confirmation
                await interaction.reply({
                    content: `**Raid Successfuly updated**`,
                    flags: MessageFlags.Ephemeral
                });

                return;
            }
        }
    });
}