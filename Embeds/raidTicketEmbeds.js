import { 
    ActionRowBuilder, 
    ButtonBuilder, 
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle
} from 'discord.js';

export const closeTicketButton = new ButtonBuilder()
    .setCustomId("closeRaidTicket")
    .setLabel('🔒 Close Raid')
    .setStyle(ButtonStyle.Danger);

// Button to edit the tasks associated with a raid.
export const editTaskButton = new ButtonBuilder()
    .setCustomId("editTask_btn")
    .setLabel('✏️ Edit Task')
    .setStyle(ButtonStyle.Secondary);

export const cancelTicketButton = new ButtonBuilder()
    .setCustomId("cancelRaidTicket")
    .setLabel('❌ Cancel')
    .setStyle(ButtonStyle.Danger);

export const  raidmapsButton = new ButtonBuilder()
    .setCustomId("raidmapsButton")
    .setLabel('🗺️ Maps')
    .setStyle(ButtonStyle.Secondary)
    
export const threadActionRow = new ActionRowBuilder()
    .addComponents(closeTicketButton, cancelTicketButton, editTaskButton, raidmapsButton);

export function getRaidRequestModal(raidType) {
    const modal = new ModalBuilder()
        .setCustomId(`raidRequestModal_${raidType}`) // Store type in ID
        .setTitle(`Raid Assistance Request ${raidType}`);
    
    let taskPlaceHolder = ("Simple, Moderate, Hard, be specific in the description.");
    let mapPlaceHolder = ("hydrachallenge-1212, deleuzethundra-3434, etc.");
    switch(raidType) {
        case '4-man':
            taskPlaceHolder = "daily, dage, weeklies, templeshrine";
            mapPlaceHolder = "ultraspeaker, championdrakath, tyndarius etc.";
            break;
        case '7-man':
            taskPlaceHolder = "originul, astralshrine, kathooldepths";
            mapPlaceHolder = "voidflibbi, deimos, grimchallenge etc.";
            break;
        }
    // Input field for the task(s).
    const taskInput = new TextInputBuilder()
        .setCustomId('taskInput')
        .setLabel("Task(s): ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(taskPlaceHolder);

    // Input field for the map name.
    const mapNameInput = new TextInputBuilder()
        .setCustomId('mapNameInput')
        .setLabel("Map Name: ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder(mapPlaceHolder);

    // Input field for the server.
    const serverInput = new TextInputBuilder()
        .setCustomId('serverInput')
        .setLabel("Server: ")
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('e.g., Artix, Yorumi, Safiria');

    // Input field for description/notes.
    const descriptionInput = new TextInputBuilder()
        .setCustomId('descriptionInput')
        .setLabel("Description/Notes")
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setPlaceholder('Any specific details or requirements?');

    // Action rows to contain each text input component.
    const firstActionRow = new ActionRowBuilder().addComponents(taskInput);
    const secondActionRow = new ActionRowBuilder().addComponents(mapNameInput);
    const thirdActionRow = new ActionRowBuilder().addComponents(serverInput);
    const fourthActionRow = new ActionRowBuilder().addComponents(descriptionInput);

    // Add all action rows to the modal.
    modal.addComponents(firstActionRow, secondActionRow, thirdActionRow, fourthActionRow);
    return modal;
}    