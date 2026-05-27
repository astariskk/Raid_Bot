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
- `MONGODB_URI` = MongoDB Atlas connection string
- `MONGODB_DB` = database name to use, for example `raid_bot`
- `GUILD_ID` = guild/server ID where slash commands are registered
- `PORT` = optional health server port, defaults to `3000`

MongoDB Atlas setup:

1. Create a free Atlas cluster at `cloud.mongodb.com`.
2. In **Database Access**, create a database user with read/write access.
3. In **Network Access**, add your host IP. For many bot hosts, use `0.0.0.0/0` only if you understand that it allows any IP to attempt a login.
4. Click **Connect** -> **Drivers** and copy the Node.js connection string.
5. Put the URI in `.env`, replacing `<db_password>` with the database user's password. Keep `MONGODB_DB=raid_bot` unless you want a different database name.

Example `.env` database section:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=raid_bot
MONGODB_DNS_SERVERS=8.8.8.8,8.8.4.4
```

GIF/chart images are stored as Discord attachment URLs in MongoDB. When adding or editing them, upload the image through the bot flow.

If `mongodb+srv://` fails with a `_mongodb._tcp...` DNS error, set `MONGODB_DNS_SERVERS` as shown above or use Atlas's non-SRV `mongodb://host1,host2,host3/...` connection string.

## Migrating old Supabase JSON exports

Place the exported files in `DB_DATA/`, then run:

```bash
npm run migrate:db-data:dry
npm run migrate:db-data
```

The real migration needs these temporary old Supabase values so it can download private storage objects before uploading them to Discord:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_old_service_role_key
SUPABASE_GIF_BUCKET=images-storage
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
