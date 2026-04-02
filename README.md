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


# debugging issues:

if there are no Bot is online on Logs, Blame Discord banning render's IP

to fix. Either Create a new project on a new region or Wait


# For copying the code/running it locally
# install the dependencies
npm install

# to run the command, type: 
nodemon index.js

or

node index.js

## Environment variables

- `DISCORD_TOKEN` = your bot token
- `SUPABASE_URL` = Project Settings -> API -> Project URL
- `SUPABASE_SERVICE_ROLE_KEY` = Project Settings -> API -> Service role key (server-side secret)
- `SUPABASE_GIF_BUCKET` = (optional) storage bucket name for GIFs (default: `gif-commands`)

## GIF/Text commands

- Admin commands:
  - `!addgif <triggerword>` / `/addgif command:<triggerword>`: create a new GIF/Text command
  - `!editgif <triggerword>` / `/editgif command:<triggerword>`: edit an existing GIF/Text command
  - Use the buttons on the preview message: `Edit`, `Change Gif`, `Delete`, `Save and Close`.
