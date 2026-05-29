# Raid ticket domain

Shared business logic for raid tickets (not Discord UI).

| Module | Responsibility |
|--------|----------------|
| `partialHelpers.js` | Partial helper records, embed lines, attach-task merge, time snapshot |
| `closePoints.js` | Close EXP map + EXP Lair thread breakdown |
| `index.js` | Re-exports for `raidTicketPresentation.js` |

**UI** lives under `handlers/raidTickets/embeds/` and `handlers/raidTickets/wizard/`. See `handlers/raidTickets/README.md`.
