# Raid Bot Guide

## Quick Start (Local)

1. Install dependencies:
   - `npm install`
2. Create a `.env` file (or set env vars in your host):
   - `DISCORD_TOKEN` = your bot token
   - `GUILD_ID` = guild/server ID where slash commands are registered
   - `SUPABASE_URL` = your Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = service role key
   - `SUPABASE_GIF_BUCKET` = storage bucket that holds the source media
   - `PORT` (optional) = health server port (defaults to `3000`)
3. Run:
   - `npm start`

Example `.env` values:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_GIF_BUCKET=images-storage
```

## Migrating Media References

Run:

- `npm run migrate:supabase-media:dry`
- `npm run migrate:supabase-media`

Default Discord archive channels:

- GIF/text commands: `1509062194212503603`
- Charts: `1509062095239385169`

`GUILD_ID` should stay as the main server ID for normal bot/slash-command behavior. If these archive channels are in a separate backup server, set `MIGRATE_BACKUP_GUILD_ID` to the backup server ID for migration-time validation.

## What Runs on Startup

- `index.js` is the only entrypoint.
- `bootstrap/` contains the bootstrapping modules:
  - `bootstrap/env.js` loads env vars with `dotenv`
  - `bootstrap/webServer.js` starts the `/` health check endpoint
  - `bootstrap/discordClient.js` creates the Discord client
  - `bootstrap/botReady.js` connects DB, registers slash commands, and wires handlers
  - `bootstrap/processHandlers.js` adds SIGINT/SIGTERM + global error handlers

## Server Configuration (IDs)

Server-specific IDs live in:
- `config/constants/server.js`

This includes:
- channel IDs (raid channel, leaderboard channel, etc.)
- role IDs (moderator, raid helper, raid manager, etc.)

If you copy this bot to a new guild, update the IDs in `config/constants/server.js`.

## Task / EXP Configuration

Raid tasks are stored in Supabase and can be managed in Discord with:
- `/modifytasks`
- `!managetasks`
- `!modifytasks`

The interactive manager lets staff select/create categories, add tasks, edit display names, points, task descriptions, availability, task category, and task order.

Task cache fallbacks and constants live in:
- `config/constants/tasks.js`

Key exports:
- `POINTS_CONFIG` task EXP values
- task category lists used by the raid wizard cache
- `MAX_XP_PER_RAID` raid EXP cap

## Map Join Prefixes

Task -> `/join` mapping lives in:
- `config/constants/maps.js`

Use this when a task's join prefix is not the same as its canonical key (example: `drakath` uses `championdrakath`).

## Handlers Layout

Handlers are organized like the raid ticket handler:
- `handlers/raidTickets/` (existing multi-file handler)
- `handlers/leaderboard/`
  - `handlers/leaderboard/core.js` (DB + embed helpers)
  - `handlers/leaderboard/setup.js` (event wiring)
- `handlers/generalCommands/`
  - `handlers/generalCommands/setup.js`
- `handlers/slashCommands/`
  - `handlers/slashCommands/commands.js` (command definitions)
  - `handlers/slashCommands/register.js` (register in guild)
  - `handlers/slashCommands/setup.js` (interaction router)
  - `handlers/slashCommands/utils.js` (helpers)
- `handlers/backup/`
  - `handlers/backup/index.js`

## Common Commands

### Text commands
- `!raidinfo` (posts raid help / UI)
- `!charts`
- `!raidrules`
- `!calculatetask <tasks...>`
- `!managetasks` / `!modifytasks` (staff task manager)

### Slash commands
- `/lb`
- `/ping`
- `/addxp users:<mentions> amount:<int>`
- `/removexp users:<mentions> amount:<int>`
- `/calculatetask tasks:<string>`
- `/modifytasks` (staff task manager)

### Staff (restore leaderboard totals)
- `!restorelb`
  - The bot will ask for a JSON file; upload it as your next message (within 2 minutes).
  - JSON format: an object mapping `"user_id": points`.
  - Rows with `0` are ignored (example: `"402460188638052355": 0`).
  - This restores `leaderboard_users.total_exp` only (daily history is not restored).

### Staff (raid tasks)
- `/modifytasks`
  - Select a category, or use `Create category...`.
  - Select a task, or use `Add task...`.
  - Use the task buttons to edit name, points, description, availability, category, or order.
  - Use `Manage Order` from a category to reorder tasks in that category.
- `!managetasks` / `!modifytasks`
  - Text-command shortcut for the same task manager.

## Spamming Raids

Spamming is a selectable raid task category. It adds time-based EXP on top of normal task EXP.

- Spamming EXP is `300 EXP` per joined minute.
- Spamming EXP is capped at `10000 EXP` per helper.
- Normal task EXP still applies normally.
- The total request cap remains `30000 EXP`.

Example:
- `drakath` is worth `2000 EXP`.
- A helper joins a spamming raid for 30 minutes.
- Spamming gives `9000 EXP`.
- The helper receives `11000 EXP` before the global cap is checked.

Helpers must press `Join Ticket` so the bot can record their join time. The `Maps` button replies privately and only works for users who joined the ticket.

### Staff Helper Cleanup

- `/removehelper user:<helper>`
  - Use inside a raid ticket.
  - Removes the helper from the joined helper list.
  - Updates the ticket embed.


### to do:

- add moderation role embed selector thing
- add which role to ping
- ping helper button only 30 minutes/rule, mods have no timer
