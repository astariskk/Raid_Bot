-- Legacy SQL schema kept only for old exports. The bot now uses MongoDB Atlas.
-- After running this file, run database/seed_raid_tasks.sql to load categories and tasks.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.raid_tasks (
  key text primary key,
  display_name text not null,
  points integer not null default 0 check (points >= 0),
  category text not null default 'generic',
  active boolean not null default true,
  description text null,
  map_names text[] not null default '{}'::text[],
  aliases text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.raid_task_categories (
  key text primary key,
  display_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.raid_tasks add column if not exists display_name text;
alter table public.raid_tasks add column if not exists points integer not null default 0;
alter table public.raid_tasks add column if not exists category text not null default 'generic';
alter table public.raid_tasks add column if not exists active boolean not null default true;
alter table public.raid_tasks add column if not exists description text null;
alter table public.raid_tasks add column if not exists map_names text[] not null default '{}'::text[];
alter table public.raid_tasks add column if not exists aliases text[] not null default '{}'::text[];
alter table public.raid_tasks add column if not exists sort_order integer not null default 0;

alter table public.raid_task_categories add column if not exists display_name text;
alter table public.raid_task_categories add column if not exists sort_order integer not null default 0;
alter table public.raid_task_categories drop column if exists description;

update public.raid_tasks
set category = 'generic', active = false
where category = 'other_four';

alter table public.raid_tasks drop constraint if exists raid_tasks_category_check;

create index if not exists raid_tasks_category_idx
  on public.raid_tasks (category, sort_order, key);

create index if not exists raid_tasks_active_idx
  on public.raid_tasks (active);

create index if not exists raid_task_categories_sort_idx
  on public.raid_task_categories (sort_order, display_name, key);

create index if not exists raid_tasks_map_names_gin_idx
  on public.raid_tasks using gin (map_names);

create index if not exists raid_tasks_aliases_gin_idx
  on public.raid_tasks using gin (aliases);

drop trigger if exists trg_raid_tasks_updated_at on public.raid_tasks;
create trigger trg_raid_tasks_updated_at
before update on public.raid_tasks
for each row
execute function public.set_updated_at();

drop trigger if exists trg_raid_task_categories_updated_at on public.raid_task_categories;
create trigger trg_raid_task_categories_updated_at
before update on public.raid_task_categories
for each row
execute function public.set_updated_at();

-- Categories (full task rows are in seed_raid_tasks.sql)
insert into public.raid_task_categories (key, display_name, sort_order)
values
  ('four_man_daily', '4-Man Daily', 10),
  ('four_man_weekly', '4-Man Weekly', 20),
  ('seven_man_weekly', '7-Man Weekly', 30),
  ('seven_man_daily', '7-Man Daily', 40),
  ('two_man_daily', '2-Man Daily', 50),
  ('templeshrine', 'Temple Shrine', 60),
  ('void_aura_daily', 'Void Aura Daily', 70),
  ('originul', 'Originul', 80),
  ('legion', 'Legion', 90),
  ('other_seven', 'Other 7-Man', 100),
  ('generic', 'Generic', 110),
  ('spamming', 'Spamming', 120)
on conflict (key) do update
set
  display_name = excluded.display_name,
  sort_order = excluded.sort_order;
