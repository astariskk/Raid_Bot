-- Supabase schema for Raid_Bot (testing)

-- --------------------
-- Raid tickets / state
-- --------------------
create table if not exists public.raid_states (
  id text primary key,
  message_id text null,
  original_channel_id text null,
  requester_id text null,
  status text not null default 'active',
  original_name text null,
  is_awaiting_completion boolean not null default false,
  request jsonb not null default '{}'::jsonb,
  closing jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists raid_states_request_gin_idx
  on public.raid_states using gin (request);

create index if not exists raid_states_closing_gin_idx
  on public.raid_states using gin (closing);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_raid_states_updated_at on public.raid_states;
create trigger trg_raid_states_updated_at
before update on public.raid_states
for each row
execute function public.set_updated_at();

-- --------------------
-- Leaderboard
-- --------------------
create table if not exists public.leaderboard_users (
  user_id text primary key,
  total_exp bigint not null default 0
);

create index if not exists leaderboard_users_total_exp_idx
  on public.leaderboard_users (total_exp desc);

create table if not exists public.leaderboard_daily_points (
  date date not null,
  user_id text not null references public.leaderboard_users(user_id) on delete cascade,
  points bigint not null default 0,
  primary key (date, user_id)
);

create index if not exists leaderboard_daily_points_user_id_idx
  on public.leaderboard_daily_points (user_id);

create index if not exists leaderboard_daily_points_date_idx
  on public.leaderboard_daily_points (date);

create table if not exists public.leaderboard_metadata (
  id text primary key,
  last_reset_date timestamptz null,
  last_backup_message_id text null
);

insert into public.leaderboard_metadata (id)
values ('leaderboard_meta')
on conflict (id) do nothing;

-- Atomic EXP increment used by the bot.
create or replace function public.add_exp(p_user_id text, p_points bigint)
returns void
language plpgsql
security definer
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  insert into public.leaderboard_users (user_id, total_exp)
  values (p_user_id, p_points)
  on conflict (user_id) do update
    set total_exp = public.leaderboard_users.total_exp + excluded.total_exp;

  insert into public.leaderboard_daily_points (date, user_id, points)
  values (v_today, p_user_id, p_points)
  on conflict (date, user_id) do update
    set points = public.leaderboard_daily_points.points + excluded.points;
end;
$$;

-- --------------------
-- Custom GIF/Text commands (public bucket recommended)
-- --------------------
create table if not exists public.gif_commands (
  command text primary key,
  kind text not null check (kind in ('gif','text')),
  title text null,
  footer text null,
  image_path text null,
  text_content text null,
  color integer null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_gif_commands_updated_at on public.gif_commands;
create trigger trg_gif_commands_updated_at
before update on public.gif_commands
for each row
execute function public.set_updated_at();
