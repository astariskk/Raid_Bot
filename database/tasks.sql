-- Supabase schema for editable raid tasks.

-- Reuse the shared updated_at trigger helper when this file is run by itself.
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

-- Safe alters for existing installs.
alter table public.raid_tasks add column if not exists display_name text;
alter table public.raid_tasks add column if not exists points integer not null default 0;
alter table public.raid_tasks add column if not exists category text not null default 'generic';
alter table public.raid_tasks add column if not exists active boolean not null default true;
alter table public.raid_tasks add column if not exists description text null;
alter table public.raid_tasks add column if not exists map_names text[] not null default '{}'::text[];
alter table public.raid_tasks add column if not exists aliases text[] not null default '{}'::text[];
alter table public.raid_tasks add column if not exists sort_order integer not null default 0;

update public.raid_tasks
set category = 'generic', active = false
where category = 'other_four';

alter table public.raid_tasks drop constraint if exists raid_tasks_category_check;

create index if not exists raid_tasks_category_idx
  on public.raid_tasks (category, sort_order, key);

create index if not exists raid_tasks_active_idx
  on public.raid_tasks (active);

create index if not exists raid_tasks_map_names_gin_idx
  on public.raid_tasks using gin (map_names);

create index if not exists raid_tasks_aliases_gin_idx
  on public.raid_tasks using gin (aliases);

drop trigger if exists trg_raid_tasks_updated_at on public.raid_tasks;
create trigger trg_raid_tasks_updated_at
before update on public.raid_tasks
for each row
execute function public.set_updated_at();

-- Seed current built-in tasks. Safe to rerun; existing rows are updated.
insert into public.raid_tasks
  (key, display_name, points, category, active, description, map_names, aliases, sort_order)
values
  -- Dailies
  ('ezrajal', 'Ultra Ezrajal', 1000, 'dailies', true, null, ARRAY['ultraezrajal']::text[], '{}'::text[], 10),
  ('warden', 'Ultra Warden', 1000, 'dailies', true, null, ARRAY['ultrawarden']::text[], '{}'::text[], 20),
  ('engineer', 'Ultra Engineer', 1000, 'dailies', true, null, ARRAY['ultraengineer']::text[], '{}'::text[], 30),
  ('tyndarius', 'Ultra Tyndarius', 1000, 'dailies', true, null, ARRAY['ultratyndarius']::text[], '{}'::text[], 40),

  -- Weeklies
  ('nulgath', 'Ultra Nulgath', 2000, 'weeklies', true, null, ARRAY['ultranulgath']::text[], '{}'::text[], 10),
  ('dage', 'Ultra Dage', 2000, 'weeklies', true, null, ARRAY['ultradage']::text[], '{}'::text[], 20),
  ('drakath', 'Champion Drakath', 2000, 'weeklies', true, null, ARRAY['championdrakath']::text[], '{}'::text[], 30),
  ('darkon', 'Ultra Darkon', 3000, 'weeklies', true, null, ARRAY['ultradarkon']::text[], '{}'::text[], 40),
  ('drago', 'Ultra Drago', 1000, 'weeklies', true, null, ARRAY['ultradrago']::text[], '{}'::text[], 50),
  ('speaker', 'Ultra Speaker', 4000, 'weeklies', true, null, ARRAY['ultraspeaker']::text[], '{}'::text[], 60),
  ('gramiel', 'Ultra Gramiel', 3000, 'weeklies', true, null, ARRAY['ultragramiel']::text[], '{}'::text[], 70),

  -- Temple Shrine
  ('tsleft', 'Templeshrine Left', 1000, 'templeshrine', true, null, ARRAY['templeshrine']::text[], ARRAY['temple shrine left', 'temple shrine (left)', 'templeshrineleft']::text[], 10),
  ('tsmid', 'Templeshrine Mid', 2000, 'templeshrine', true, null, ARRAY['templeshrine']::text[], ARRAY['temple shrine mid', 'temple shrine (mid)', 'templeshrinemid']::text[], 20),
  ('tsright', 'Templeshrine Right', 1000, 'templeshrine', true, null, ARRAY['templeshrine']::text[], ARRAY['temple shrine right', 'temple shrine (right)', 'templeshrineright']::text[], 30),

  -- Originul
  ('voidflibbi', 'Void Flibbi', 1000, 'originul', true, null, ARRAY['voidflibbi']::text[], ARRAY['flibbi']::text[], 10),
  ('voidnightbane', 'Void Nightbane', 1000, 'originul', true, null, ARRAY['voidnightbane']::text[], ARRAY['nightbane']::text[], 20),
  ('voidxyfrag', 'Void Xyfrag', 1000, 'originul', true, null, ARRAY['voidxyfrag']::text[], ARRAY['xyfrag']::text[], 30),

  -- Legion
  ('deimos', 'Deimos', 500, 'legion', true, null, ARRAY['deimos']::text[], '{}'::text[], 10),
  ('beast', 'Beast', 500, 'legion', true, null, ARRAY['sevencircleswar']::text[], '{}'::text[], 20),
  ('lichlord', 'Lich Lord', 500, 'legion', true, null, ARRAY['frozenlair']::text[], ARRAY['lich']::text[], 30),

  -- Seasonal tasks, hidden by default
  ('kala', 'Ultra Kala', 1000, 'generic', false, null, ARRAY['ultrakala']::text[], '{}'::text[], 10),
  ('iara', 'Ultra Iara', 1000, 'generic', false, null, ARRAY['ultraiara']::text[], '{}'::text[], 20),

  -- Other 7-man
  ('mechabinky', 'Mechabinky', 5000, 'other_seven', true, null, ARRAY['grimchallenge']::text[], ARRAY['grim']::text[], 10),
  ('kathool', 'Kathool', 2000, 'other_seven', true, null, ARRAY['kathooldepths']::text[], ARRAY['kath']::text[], 20),
  ('astralshrine', 'Astral Shrine', 3000, 'other_seven', true, null, ARRAY['astralshrine']::text[], ARRAY['astral']::text[], 30),
  ('voidnerfkitten', 'Void Nerf Kitten', 1000, 'other_seven', true, null, ARRAY['voidnerfkitten']::text[], ARRAY['nerfkitten']::text[], 40),
  ('lavarockshore', 'Lavarockshore', 1000, 'other_seven', true, null, ARRAY['lavarockshore']::text[], ARRAY['lava', 'lavarock', 'rockshore']::text[], 50),
  ('apexazalith', 'Apex Azalith', 1000, 'other_seven', true, null, ARRAY['apexazalith']::text[], ARRAY['apex']::text[], 60),
  ('vamem', 'Void Aura Daily (Mem)', 1000, 'other_seven', true, null, ARRAY['ancienttrigoras', 'chaoskraken', 'gravechallenge']::text[], ARRAY['vam']::text[], 70),
  ('vanonmem', 'Void Aura Daily (Non-Mem)', 2000, 'other_seven', true, null, ARRAY['voidflibbi', 'icewing', 'hydrachallenge']::text[], ARRAY['vanm']::text[], 80),

  -- Generic custom tasks
  ('simple', 'Simple', 1000, 'generic', true, 'Generic custom task.', '{}'::text[], ARRAY['easy']::text[], 10),
  ('moderate', 'Moderate', 5000, 'generic', true, 'Generic custom task.', '{}'::text[], ARRAY['medium']::text[], 20),
  ('difficult', 'Difficult', 10000, 'generic', true, 'Generic custom task.', '{}'::text[], ARRAY['hard']::text[], 30)
on conflict (key) do update
set
  display_name = excluded.display_name,
  points = excluded.points,
  category = excluded.category,
  active = excluded.active,
  description = excluded.description,
  map_names = excluded.map_names,
  aliases = excluded.aliases,
  sort_order = excluded.sort_order;
