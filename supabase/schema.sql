-- after.hours — blind pool + sync (run in Supabase SQL editor or psql)
-- Vision: guests only ever load THEIR submission + room date/name.
-- Full list + draw live on server; host uses host_secret for admin reads + draw.

-- enable uuid generation
create extension if not exists "pgcrypto";

-- Rooms (one row per screening night)
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique,
  host_secret uuid not null default gen_random_uuid(),
  room_name text not null default '',
  event_dt timestamptz,
  yt_url text default '',
  winner_submission_id uuid,
  created_at timestamptz not null default now()
);

-- One submission per (room + participant token); token lives in visitor localStorage
create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  participant_token uuid not null,
  display_name text not null,
  tmdb_id int,
  title text not null,
  year text default '',
  poster_path text,
  created_at timestamptz not null default now(),
  unique (room_id, participant_token)
);

create index if not exists idx_submissions_room on public.submissions (room_id);

-- Foreign key from rooms.winner to submissions (optional, after submissions exist)
alter table public.rooms
  drop constraint if exists rooms_winner_fk;

alter table public.rooms
  add constraint rooms_winner_fk
  foreign key (winner_submission_id)
  references public.submissions (id)
  on delete set null;

-- -------- Next steps (you apply in Supabase): --------
-- 1. Turn off public read on tables; use Edge Functions or RPC with SECURITY DEFINER:
--    - join_room(code) -> room id + public fields only (no list of films)
--    - get_my_submission(room_id, participant_token) -> one row or null
--    - upsert_my_submission(...)
--    - host_list_submissions(join_code, host_secret) -> full pool
--    - host_draw_winner(join_code, host_secret) -> sets winner_submission_id
-- 2. Never expose a “list all submissions” REST policy to the anon role.
-- 3. App UI: remove “tonight’s pool” list for guests; host screen keeps full list + print/export.

comment on table public.rooms is 'Synced screening; join_code is guest-facing; host_secret is shown once to creator.';
comment on table public.submissions is 'Blind pool entries; guests only fetch their own row via token.';
