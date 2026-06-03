ALTER TABLE IF EXISTS public.gif_commands
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS message_url text,
  ADD COLUMN IF NOT EXISTS message_id text,
  ADD COLUMN IF NOT EXISTS channel_id text;

ALTER TABLE IF EXISTS public.charts
  ADD COLUMN IF NOT EXISTS archived_message_url text,
  ADD COLUMN IF NOT EXISTS archived_message_id text,
  ADD COLUMN IF NOT EXISTS archived_channel_id text;

COMMENT ON COLUMN public.gif_commands.asset_path IS 'Discord attachment URL for the archived media.';
COMMENT ON COLUMN public.gif_commands.image_path IS 'Legacy alias for the archived Discord attachment URL.';
COMMENT ON COLUMN public.gif_commands.attachment_url IS 'Discord attachment URL for the archived media.';
COMMENT ON COLUMN public.gif_commands.message_url IS 'Discord message URL where the archived media was posted.';
COMMENT ON COLUMN public.gif_commands.message_id IS 'Discord message ID for the archived media post.';
COMMENT ON COLUMN public.gif_commands.channel_id IS 'Discord channel ID containing the archived media post.';

COMMENT ON COLUMN public.charts.archived_message_url IS 'Discord message URL where the chart page media was posted.';
COMMENT ON COLUMN public.charts.archived_message_id IS 'Discord message ID where the chart page media was posted.';
COMMENT ON COLUMN public.charts.archived_channel_id IS 'Discord channel ID containing the chart page media post.';
