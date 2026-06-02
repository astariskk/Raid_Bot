# Raid_Bot
Vanaheim raid discord bot

## Setup (in Discord)
Run these once in the right channels so members can use the bot:

- In the raid channel: `!raidinfo` (posts the main help embed + buttons, including `Start Raid`)
- In the raid channel: `!raidrules` (posts raid rules)
- Anywhere: `!charts` (posts available charts)

## Useful commands

- `!raidrules` = shows the raid rules

- `!raidinfo` = shows the main raid info embed + buttons

- `Start Raid` button = guided raid ticket creation (pick room type + tasks, then fill map/server in a modal)

- In raid tickets: use `Partial Helper` to assign a helper to specific tasks (partial EXP), then `Close Raid` to award points

- `!modcommands` = shows the commands for mods, exp management and such

- `!lbcommands` = shows the leaderboard commands

- `!secretcommands` = commands for secret sussy gifs

- `!restorelb` = staff-only restore of leaderboard totals from a JSON file (the bot will prompt you to upload the file next)


# debugging issues:

on the service, press manual deploy and press deploy latest commit


# For copying the code/running it locally
# install the dependencies
npm install

# to run the command, type: 
nodemon index.js

or

node index.js

## Environment variables

- `DISCORD_TOKEN` = your bot token
- `SUPABASE_URL` = your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` = service role key for server-side table access
- `SUPABASE_GIF_BUCKET` = Supabase storage bucket that holds the source media
- `GUILD_ID` = guild/server ID where slash commands are registered
- `BACKUP_LEADERBOARD_CHANNEL_ID` = channel where leaderboard JSON backups are posted
- `PORT` = optional health server port, defaults to `3000`

Supabase setup:

1. Create a Supabase project.
2. Open the project settings and copy the `Project URL` and `service_role` key.
3. Create the storage bucket that contains your source media.
4. Put the values in `.env` and keep the service role key private.

Example `.env` section:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_GIF_BUCKET=images-storage
```

GIF/chart command definitions live in Supabase tables, while the uploaded images are stored as Discord attachment URLs. When adding or editing them, upload the image through the bot flow.

## Migrating media references

Run:

```bash
npm run migrate:supabase-media:dry
npm run migrate:supabase-media
```

By default, media is reposted to:

- GIF/text command archive: `1509062194212503603`
- Chart archive: `1509062095239385169`

The normal `GUILD_ID` remains the main Discord server for slash-command registration. The media archive channels can be in a separate backup server. Set `MIGRATE_BACKUP_GUILD_ID` to that backup server ID if you want the migration to verify the channels before uploading.

Override the archive channels with `MIGRATE_GIF_CHANNEL_ID` and `MIGRATE_CHART_CHANNEL_ID` if needed.

## GIF/Text commands

- Admin commands:
  - `!addgif <triggerword>` / `/addgif command:<triggerword>`: create a new GIF/Text command
  - `!editgif <triggerword>` / `/editgif command:<triggerword>`: edit an existing GIF/Text command
  - Use the buttons on the preview message: `Edit`, `Change Gif`, `Delete`, `Save and Close`.

## Leaderboard restore (`!restorelb`)

- Staff only (moderator/officer/raid manager roles).
- Usage:
  1. Send `!restorelb`
  2. Upload the JSON file as your next message (within 2 minutes)
- JSON file format (object mapping user ID -> points):
  - `"330781632103710741": 0,`
  - `"327400347381399554": 5000`
- Rows with `0` are ignored.
## Media Storage

GIF, text, and chart media are archived in Discord channels and the bot stores the message reference fields alongside the attachment URL.

Use these env vars for the archive targets:

```env
GIF_ARCHIVE_CHANNEL_ID=
CHART_ARCHIVE_CHANNEL_ID=
```

The migration script still accepts the older `MIGRATE_GIF_CHANNEL_ID` and `MIGRATE_CHART_CHANNEL_ID` names as fallback values.
