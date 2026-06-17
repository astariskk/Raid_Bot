-- Custom GIF/Text commands archived as Discord messages (trial: gif_table)

create table if not exists public.gif_table (
  command text primary key,
  kind text not null check (kind in ('gif','text')),

  title text null,
  footer text null,

  -- Canonical Discord attachment URL for archived media.
  attachment_url text null,

  -- Legacy alias for attachment_url.
  image_path text null,

  -- Text-only command structure.
  ping_user_ids text[] null,
  text_label text null,
  text_description text null,
  text_content text null,

  color integer null,
  enabled boolean not null default true,

  -- Discord message reference where the archived media was posted.
  archived_message_url text,
  archived_message_id text,
  archived_channel_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_gif_table_updated_at on public.gif_table;
create trigger trg_gif_table_updated_at
before update on public.gif_table
for each row
execute function public.set_updated_at();

