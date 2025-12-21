import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { updateRaidStatus } from '../../activeRaidState.js';
import { generateRaidMapsEmbed, parseRaidTasks } from '../../utils/raidMaps.js';
import { RAID_CHARTS, twoManEmbeds, threeManEmbeds, scamChartEmbeds } from '../../Embeds/raidChartsEmbeds.js';

// --- Constants ---
const COLORS = { WAITING: 0x0099ff, FULL: 0xdd2e44, ONGOING: 0x78b159 };
const activeChartSessions = new Map();

// --- Main Message Handler ---
export async function handleTicketMessages(message, client, raidInfo) {
    const content = message.content.toLowerCase().trim();

    // 1. Status Updates
    const statusMap = { '!waiting': ['Waiting', COLORS.WAITING], '!full': ['Full', COLORS.FULL], '!ongoing': ['Ongoing', COLORS.ONGOING] };
    if (statusMap[content]) {
        if (['awaiting_completion', 'completed'].includes(raidInfo.status)) return;
        try {
            await updateRaidStatus(client, message.channel.id, statusMap[content][0], statusMap[content][1]);
            await message.react('👍');
        } catch (e) { console.error(e); }
        return;
    }

    // 2. Chart Commands (!2man, !3man, !scams)
    if (content === '!2man') return startChartSession(message, twoManEmbeds, '2man');
    if (content === '!3man') return startChartSession(message, threeManEmbeds, '3man');
    if (['!scamcharts', '!scams'].includes(content)) return startChartSession(message, scamChartEmbeds, 'scam');

    // 3. Map Commands
    const mapMatch = content.match(/^!(raidmaps|maps)\s+(\d+)$/);
    if (mapMatch) {
        const embed = generateRaidMapsEmbed(parseRaidTasks(raidInfo.task), mapMatch[2]);
        return message.channel.send({ embeds: [embed] });
    }
    
    // 4. Single Charts (from RAID_CHARTS const)
    if (RAID_CHARTS[content]) {
        const data = RAID_CHARTS[content];
        return message.channel.send({ embeds: [new EmbedBuilder().setColor(data.color).setTitle(data.title).setImage(data.image)] });
    }
}

// --- Chart Session Logic (Simplified) ---
async function startChartSession(message, embeds, type) {
    const sessionData = { type, currentPage: 1, totalPages: embeds.length, embeds, requester: message.author.id, timestamp: Date.now() };
    const row = createNavRow(type, message.author.id, sessionData.timestamp);
    
    const sent = await message.channel.send({ embeds: [embeds[0]], components: embeds.length > 1 ? [row] : [] });
    activeChartSessions.set(sent.id, sessionData);
    
    // Auto-expire after 2 mins
    setTimeout(() => activeChartSessions.delete(sent.id), 120000);
}

function createNavRow(type, uid, ts, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`chart_${type}_prev_${uid}_${ts}`).setLabel('◀️').setStyle(ButtonStyle.Primary).setDisabled(disabled),
        new ButtonBuilder().setCustomId(`chart_${type}_next_${uid}_${ts}`).setLabel('▶️').setStyle(ButtonStyle.Primary).setDisabled(disabled)
    );
}

// --- Interaction Handler for Charts/Maps ---
export async function handleCommandInteractions(interaction, raidInfo) {
    if (interaction.customId === 'raidmapsButton') {
        if (!raidInfo.mapNumber) return interaction.reply({ content: "No map number set. Use `!raidmaps <number>`.", ephemeral: true });
        const embed = generateRaidMapsEmbed(parseRaidTasks(raidInfo.task), raidInfo.mapNumber);
        return interaction.reply({ embeds: [embed] });
    }

    // Handle Chart Pagination
    if (interaction.customId.startsWith('chart_')) {
        const parts = interaction.customId.split('_'); // chart, type, action, uid, ts
        const session = activeChartSessions.get(interaction.message.id);
        
        if (!session || interaction.user.id !== parts[3]) {
            return interaction.reply({ content: "Session expired or not yours.", ephemeral: true });
        }

        session.currentPage += (parts[2] === 'next' ? 1 : -1);
        session.currentPage = Math.max(1, Math.min(session.currentPage, session.totalPages));
        
        await interaction.update({ 
            embeds: [session.embeds[session.currentPage - 1]],
            components: [createNavRow(parts[1], parts[3], parts[4])]
        });
    }
}