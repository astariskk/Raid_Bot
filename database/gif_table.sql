-- Custom GIF/Text commands archived as Discord messages

create table if not exists public.gif_table (
  command text primary key,
  kind text not null check (kind in ('gif','text')),

  title text null,
  footer text null,

  -- Direct Discord attachment/CDN URL for the archived image/gif itself.
  attachment_url text null,

  -- Discord message reference containing the attachment/content.
  archived_message_url text null,
  archived_message_id text null,
  archived_channel_id text null,

  ping_user_ids text[] null,
  text_label text null,
  text_description text null,
  text_content text null,
  color integer null,
  enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_gif_table_updated_at on public.gif_table;
create trigger trg_gif_table_updated_at
before update on public.gif_table
for each row
execute function public.set_updated_at();


