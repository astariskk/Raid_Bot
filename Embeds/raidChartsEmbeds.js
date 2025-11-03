import { EmbedBuilder } from 'discord.js';

// --- Constants for Embed Colors ---
const color = 0x0099ff; // Blue for waiting

export const RAID_CHARTS = {
    '!1man': {
        title: '1-Man Speaker Chart',
        image: 'https://files.catbox.moe/u3huep.png',
        color: color
    },
    '!4man': {
        title: '4-Man Speaker Chart',
        image: 'https://files.catbox.moe/yi71zh.jpg',
        color: color
    },
    '!famischart': {
        title: 'Famis Goon',
        image: 'https://files.catbox.moe/bo3vri.png',
        color: color
    },
    '!gramielchart': {
        title: 'Gramiel Chart by Lilicht',
        image: 'https://files.catbox.moe/esowjk.png',
        color: color
    },
    '!gramiel': {
        title: 'Gramiel Chart by Lilicht',
        image: 'https://files.catbox.moe/esowjk.png',
        color: color
    },
};

// 2-man embeds (3 pages)
const twoManMain = new EmbedBuilder()
    .setColor(color)
    .setTitle('2-Man Speaker Chart')
    .setImage('https://files.catbox.moe/hvccl7.png')
    .setFooter({ text: "Page 1 of 3" });

const twoManLP = new EmbedBuilder()
    .setColor(color)
    .setTitle('2-Man LP Speakerchart')
    .setImage('https://files.catbox.moe/xfb923.png')
    .setFooter({ text: "Page 2 of 3" });

const twoManA = new EmbedBuilder()
    .setColor(color)
    .setTitle('2-Man Easier Version')
    .setImage('https://files.catbox.moe/txgrr6.png')
    .setFooter({ text: "Page 3 of 3" });

export const twoManEmbeds = [twoManMain, twoManLP, twoManA];

// 3-man embeds (2 pages)
const threeManA = new EmbedBuilder()
    .setColor(color)
    .setTitle('3-Man Speaker Chart')
    .setImage('https://files.catbox.moe/ci6veo.png')
    .setFooter({ text: "Page 1 of 3" });

const threeManB = new EmbedBuilder()
    .setColor(color)
    .setTitle('3-Man AP Chart')
    .setImage('https://files.catbox.moe/bqzx8t.png')
    .setFooter({ text: 'Page 2 of 3' });

const threeManC = new EmbedBuilder()
    .setColor(color)
    .setTitle('3-Man Detailed AP LOO  Chart')
    .setImage('https://files.catbox.moe/twyt8w.png')
    .setFooter({ text: 'Page 3 of 3' });

export const threeManEmbeds = [threeManA, threeManB, threeManC];