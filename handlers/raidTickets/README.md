# Raid tickets (`handlers/raidTickets`)

Raid ticket routing, domain logic, UI builders, and wizards.

## Layout

| Path | Role |
|------|------|
| `index.js` | Interaction router (`setupRaidHandlers`) |
| `ticketCommands.js` | Join / leave / kick / attach / ping / maps |
| `ticketCompletion.js` | Close flow |
| `ticketLifecycle.js` | Edit / cancel |
| `ticketCreation.js` | Create ticket from Start Raid modal |
| `ticketReview.js` | Admin review + EXP Lair |
| `raidTicketLogic.js` | Task labels, capacity, status helpers |
| `raidTicketPresentation.js` | Public facade (re-exports domain + ticket UI) |
| `raidWizardSession.js` | Ephemeral wizard session store |
| `embeds/raidWizardUi.js` | **Shared** Start + Edit raid task wizard (V2 components) |
| `embeds/ticket/` | Pinned ticket V2 layout + modals |
| `embeds/cancelRaidModal.js` | Cancel confirmation |
| `wizard/` | Wizard mode IDs, task selection expansion, shared nav/select handlers |
| `domain/` | Points, partial helpers (no Discord UI) |
| `buttons/threadButtons.js` | Ticket action buttons |

## Start vs Edit raid tasks

Both flows use the same UI from `embeds/raidWizardUi.js` (`getRaidWizardCategoryPage` / `getRaidWizardTasksPage`) and shared handlers in `wizard/raidWizardFlow.js`. Create mode auto-advances to page 2 when categories are valid; edit mode stays on page 1 until **Next**.

Legacy imports under `Embeds/raidTicket/` re-export from `embeds/ticket/` for compatibility.
