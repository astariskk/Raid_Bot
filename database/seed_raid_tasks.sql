-- Raid task categories and tasks (2025 layout).
-- Safe to rerun. Run after database/tasks.sql.

-- Remove legacy merged category if present.
delete from public.raid_task_categories where key in ('spamming_unlisted', 'dailies', 'weeklies');

update public.raid_tasks set active = false where key in (
  'simple', 'moderate', 'difficult', 'spamming', 'lavarockshore'
);

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
set display_name = excluded.display_name, sort_order = excluded.sort_order;

insert into public.raid_tasks
  (key, display_name, points, category, active, description, map_names, aliases, sort_order)
values
  -- 4-Man Daily
  ('ezrajal', 'Ultra Ezrajal', 1000, 'four_man_daily', true, null, ARRAY['ultraezrajal']::text[], '{}'::text[], 10),
  ('warden', 'Ultra Warden', 1000, 'four_man_daily', true, null, ARRAY['ultrawarden']::text[], '{}'::text[], 20),
  ('engineer', 'Ultra Engineer', 1000, 'four_man_daily', true, null, ARRAY['ultraengineer']::text[], '{}'::text[], 30),
  ('tyndarius', 'Ultra Tyndarius', 1000, 'four_man_daily', true, null, ARRAY['ultratyndarius']::text[], '{}'::text[], 40),
  ('kala', 'Ultra Kala', 1000, 'four_man_daily', false, null, ARRAY['ultrakala']::text[], '{}'::text[], 50),
  ('iara', 'Ultra Iara', 1000, 'four_man_daily', false, null, ARRAY['ultraiara']::text[], '{}'::text[], 60),

  -- 4-Man Weekly
  ('dage', 'Ultra Dage', 2000, 'four_man_weekly', true, null, ARRAY['ultradage']::text[], '{}'::text[], 10),
  ('nulgath', 'Ultra Nulgath', 2000, 'four_man_weekly', true, null, ARRAY['ultranulgath']::text[], '{}'::text[], 20),
  ('drakath', 'Champion Drakath', 2000, 'four_man_weekly', true, null, ARRAY['championdrakath']::text[], '{}'::text[], 30),
  ('darkon', 'Ultra Darkon', 3000, 'four_man_weekly', true, null, ARRAY['ultradarkon']::text[], '{}'::text[], 40),
  ('drago', 'Ultra Drago', 1000, 'four_man_weekly', true, null, ARRAY['ultradrago']::text[], '{}'::text[], 50),
  ('speaker', 'Ultra Speaker', 4000, 'four_man_weekly', true, null, ARRAY['ultraspeaker']::text[], '{}'::text[], 60),
  ('gramiel', 'Ultra Gramiel', 3000, 'four_man_weekly', true, null, ARRAY['ultragramiel']::text[], '{}'::text[], 70),

  -- 7-Man Weekly
  ('mechabinky', 'Mechabinky', 5000, 'seven_man_weekly', true, null, ARRAY['grimchallenge']::text[], ARRAY['grim']::text[], 10),

  -- 7-Man Daily
  ('astralshrine', 'Astral Shrine', 3000, 'seven_man_daily', true, null, ARRAY['astralshrine']::text[], ARRAY['astral']::text[], 10),
  ('kathool', 'Kathool', 2000, 'seven_man_daily', true, null, ARRAY['kathooldepths']::text[], ARRAY['kath']::text[], 20),
  ('apexazalith', 'Apex Azalith', 1000, 'seven_man_daily', true, null, ARRAY['apexazalith']::text[], ARRAY['apex']::text[], 30),

  -- 2-Man Daily
  ('flameusurper', 'Flame Usurper', 2000, 'two_man_daily', true, null, ARRAY['flameusurper']::text[], ARRAY['flame']::text[], 10),

  -- Temple Shrine
  ('tsleft', 'Templeshrine Left', 1000, 'templeshrine', true, null, ARRAY['templeshrine']::text[], ARRAY['temple shrine left', 'templeshrineleft']::text[], 10),
  ('tsright', 'Templeshrine Right', 1000, 'templeshrine', true, null, ARRAY['templeshrine']::text[], ARRAY['temple shrine right', 'templeshrineright']::text[], 20),
  ('tsmid', 'Templeshrine Mid', 2000, 'templeshrine', true, null, ARRAY['templeshrine']::text[], ARRAY['temple shrine mid', 'templeshrinemid']::text[], 30),

  -- Void Aura Daily
  ('vanonmem', 'Void Aura Daily (Non-Mem)', 2000, 'void_aura_daily', true, null, ARRAY['voidflibbi', 'icewing', 'hydrachallenge']::text[], ARRAY['vanm']::text[], 10),
  ('vamem', 'Void Aura Daily (Mem)', 1000, 'void_aura_daily', true, null, ARRAY['ancienttrigoras', 'chaoskraken', 'gravechallenge']::text[], ARRAY['vam']::text[], 20),

  -- Originul
  ('voidflibbi', 'Void Flibbi', 1000, 'originul', true, null, ARRAY['voidflibbi']::text[], ARRAY['flibbi']::text[], 10),
  ('voidnightbane', 'Void Nightbane', 1000, 'originul', true, null, ARRAY['voidnightbane']::text[], ARRAY['nightbane']::text[], 20),
  ('voidxyfrag', 'Void Xyfrag', 1000, 'originul', true, null, ARRAY['voidxyfrag']::text[], ARRAY['xyfrag']::text[], 30),

  -- Legion
  ('deimos', 'Deimos', 500, 'legion', true, null, ARRAY['deimos']::text[], '{}'::text[], 10),
  ('beast', 'Beast', 500, 'legion', true, null, ARRAY['sevencircleswar']::text[], '{}'::text[], 20),
  ('lichlord', 'Lich Lord', 500, 'legion', true, null, ARRAY['frozenlair']::text[], ARRAY['lich']::text[], 30),

  -- Other 7-Man
  ('voidnerfkitten', 'Void Nerf Kitten', 1000, 'other_seven', true, null, ARRAY['voidnerfkitten']::text[], ARRAY['nerfkitten']::text[], 10),

  -- Generic room sizes (map names come from ticket modal)
  ('generic_2man', '2-Man room', 1000, 'generic', true, 'Generic task.', ARRAY[]::text[], ARRAY['generic2', 'generic2man']::text[], 10),
  ('generic_4man', '4-Man room', 1000, 'generic', true, 'Generic task.', ARRAY[]::text[], ARRAY['generic4', 'generic4man']::text[], 20),
  ('generic_5man', '5-Man room', 1000, 'generic', true, 'Generic task.', ARRAY[]::text[], ARRAY['generic5', 'generic5man']::text[], 30),
  ('generic_7man', '7-Man room', 1000, 'generic', true, 'Generic task.', ARRAY[]::text[], ARRAY['generic7', 'generic7man']::text[], 40),

  -- Spamming room sizes (map names come from ticket modal)
  ('spamming_2man', '2-Man room', 0, 'spamming', true, 'Time-based: 300 EXP/min, cap 10000.', ARRAY[]::text[], ARRAY['spamming2', 'spamming2man']::text[], 10),
  ('spamming_4man', '4-Man room', 0, 'spamming', true, 'Time-based: 300 EXP/min, cap 10000.', ARRAY[]::text[], ARRAY['spamming4', 'spamming4man']::text[], 20),
  ('spamming_5man', '5-Man room', 0, 'spamming', true, 'Time-based: 300 EXP/min, cap 10000.', ARRAY[]::text[], ARRAY['spamming5', 'spamming5man']::text[], 30),
  ('spamming_7man', '7-Man room', 0, 'spamming', true, 'Time-based: 300 EXP/min, cap 10000.', ARRAY[]::text[], ARRAY['spamming7', 'spamming7man']::text[], 40)
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
