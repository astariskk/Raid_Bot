# Raid ticket domain

Shared business logic for raid tickets (not Discord UI).

| Module | Responsibility |
|--------|----------------|
| `partialHelpers.js` | Partial helper records, embed lines, attach-task merge, time snapshot |
| `closePoints.js` | Close EXP map + EXP Lair thread breakdown |
| `index.js` | Re-exports for `raidTicketPresentation.js` |

**UI / routing** (elsewhere):

- `Embeds/raidTicket/mainTicket.js` — v2 ticket layout
- `ticketCommands.js` — join, leave, kick, attach tasks
- `ticketCompletion.js` — close flow UI
- `ticketLifecycle.js` — edit/cancel wizard
- `ticketReview.js` — admin review + EXP Lair post
