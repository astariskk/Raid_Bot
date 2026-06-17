-- Custom Charts (multi-page image sets) archived as Discord messages (trial: charts_table)

create table if not exists public.charts_table (
  key text primary key,
  category text not null default 'general',
  title text not null,

  triggers text[] not null default '{}'::text[],

  -- Stored as jsonb (variants/pages structure) like the original `charts` table expects.
  variants jsonb not null default '[]'::jsonb,
  pages jsonb not null default '[]'::jsonb,

  enabled boolean not null default true,

  -- Discord archive reference for the message posted for the chart page.
  archived_message_url text,
  archived_message_id text,
  archived_channel_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_charts_table_updated_at on public.charts_table;
create trigger trg_charts_table_updated_at
before update on public.charts_table
for each row
execute function public.set_updated_at();

