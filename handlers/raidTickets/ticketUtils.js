import { MessageFlags } from "discord.js";
import { MODERATOR_ROLE_ID, OFFICER_ROLE_ID, RAID_MANAGER_ROLE_ID } from "../../config/constants.js";

export function isStaff(member) {
    if (!member) return false;
    return (
        member.roles.cache.has(MODERATOR_ROLE_ID) ||
        member.roles.cache.has(OFFICER_ROLE_ID) ||
        member.roles.cache.has(RAID_MANAGER_ROLE_ID)
    );
}

export function isRaidManager(interaction, raidInfo) {
    if (!raidInfo) return false;
    if (interaction.user.id === raidInfo.requesterId) return true;
    return isStaff(interaction.member);
}

export async function requireAuth(interaction, raidInfo, level = 'raid_manager') {
    let authorized = false;
    let message = "";

    if (level === 'staff') {
        authorized = isStaff(interaction.member);
        message = "Only staff members can perform this action.";
    } else {
        authorized = isRaidManager(interaction, raidInfo);
        message = "Only the raid requester or staff can perform this action.";
    }

    if (!authorized) {
        if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
        }
        return false;
    }
    return true;
}