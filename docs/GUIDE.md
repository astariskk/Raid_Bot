# Raid Bot Guide

## Quick Start (Local)

1. Install dependencies:
   - `npm install`
2. Create a `.env` file (or set env vars in your host):
   - `DISCORD_TOKEN` = your bot token
   - `GUILD_ID` = guild/server ID where slash commands are registered
   - `MONGODB_URI` = Mongo connection string
   - `PORT` (optional) = health server port (defaults to `3000`)
3. Run:
   - `npm start`

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

Task points + allowed task inputs live in:
- `config/constants/tasks.js`

Key exports:
- `POINTS_CONFIG` task EXP values
- `TASK_ALIASES` synonyms (e.g. `ultradage` -> `dage`, `daily` -> `dailies`)
- `TASK_GROUPS` meta tasks that expand to multiple tasks (`dailies`, `weeklies`, etc.)
- `ALLOWED_TASK_FOUR` and `ALLOWED_TASK_SEVEN` input validation lists
- `MAX_XP_PER_RAID` raid EXP cap

## Map Join Prefixes

Task -> `/join` mapping lives in:
- `config/constants/maps.js`

Use this when a task’s join prefix is not the same as its canonical key (example: `drakath` uses `championdrakath`).

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

### Slash commands
- `/lb`
- `/ping`
- `/addxp users:<mentions> amount:<int>`
- `/removexp users:<mentions> amount:<int>`
- `/calculatetask tasks:<string>`
- `/taskalias tasks:<comma-separated>`
