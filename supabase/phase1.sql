-- After Hours Club — Phase 1 (run in Supabase SQL Editor)
-- WARNING: drops existing public.rooms / public.submissions if present.

drop table if exists public.submissions cascade;
drop table if exists public.rooms cascade;

-- Rooms (one row per screening night)
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  join_code text not null unique,
  host_secret uuid not null default gen_random_uuid(),
  room_name text not null default '',
  event_dt timestamptz,
  yt_url text default '',
  submissions_open_at timestamptz not null,
  submissions_close_at timestamptz not null,
  winner_submission_id uuid,
  created_at timestamptz not null default now()
);

-- One submission per member per room (auth.users)
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null,
  tmdb_id int,
  title text not null,
  year text default '',
  poster_path text,
  created_at timestamptz not null default now(),
  unique (room_id, user_id)
);

create index idx_submissions_room on public.submissions (room_id);

alter table public.rooms
  add constraint rooms_winner_fk
  foreign key (winner_submission_id)
  references public.submissions (id)
  on delete set null;

alter table public.rooms enable row level security;
alter table public.submissions enable row level security;
-- No policies: all access through SECURITY DEFINER RPCs or service_role.

-- Public room metadata (no host_secret)
create or replace function public.get_room_public(p_join_code text)
returns table (
  id uuid,
  join_code text,
  room_name text,
  event_dt timestamptz,
  yt_url text,
  submissions_open_at timestamptz,
  submissions_close_at timestamptz,
  winner_submission_id uuid,
  created_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  select
    r.id,
    r.join_code,
    r.room_name,
    r.event_dt,
    r.yt_url,
    r.submissions_open_at,
    r.submissions_close_at,
    r.winner_submission_id,
    r.created_at
  from public.rooms r
  where upper(trim(r.join_code)) = upper(trim(p_join_code))
  limit 1;
$$;

create or replace function public.get_my_submission(p_room_id uuid)
returns setof public.submissions
language sql
security definer
set search_path = public
stable
as $$
  select * from public.submissions s
  where s.room_id = p_room_id and s.user_id = auth.uid();
$$;

create or replace function public.delete_my_submission(p_room_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.submissions s
  where s.room_id = p_room_id and s.user_id = auth.uid();
$$;

create or replace function public.upsert_my_submission(
  p_room_id uuid,
  p_display_name text,
  p_tmdb_id int,
  p_title text,
  p_year text,
  p_poster_path text
)
returns public.submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rooms%rowtype;
  sub public.submissions%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select * into r from public.rooms where id = p_room_id;
  if not found then
    raise exception 'room not found';
  end if;

  if now() < r.submissions_open_at or now() > r.submissions_close_at then
    raise exception 'submissions are closed for this window';
  end if;

  insert into public.submissions (
    room_id, user_id, display_name, tmdb_id, title, year, poster_path
  ) values (
    p_room_id, auth.uid(), p_display_name, p_tmdb_id, p_title, coalesce(p_year, ''),
    p_poster_path
  )
  on conflict (room_id, user_id) do update set
    display_name = excluded.display_name,
    tmdb_id = excluded.tmdb_id,
    title = excluded.title,
    year = excluded.year,
    poster_path = excluded.poster_path
  returning * into sub;

  return sub;
end;
$$;

create or replace function public.host_list_submissions(
  p_room_id uuid,
  p_host_secret uuid
)
returns setof public.submissions
language sql
security definer
set search_path = public
stable
as $$
  select s.*
  from public.submissions s
  inner join public.rooms r on r.id = s.room_id
  where s.room_id = p_room_id and r.host_secret = p_host_secret
  order by s.created_at asc;
$$;

create or replace function public.host_draw_winner(
  p_room_id uuid,
  p_host_secret uuid
)
returns public.submissions
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rooms%rowtype;
  picked public.submissions%rowtype;
begin
  select * into r
  from public.rooms
  where id = p_room_id and host_secret = p_host_secret;

  if not found then
    raise exception 'unauthorized or room not found';
  end if;

  if now() < r.submissions_close_at then
    raise exception 'submissions are still open; close the window before drawing';
  end if;

  select * into picked
  from public.submissions
  where room_id = p_room_id
  order by random()
  limit 1;

  if not found then
    raise exception 'no submissions in pool';
  end if;

  update public.rooms
  set winner_submission_id = picked.id
  where id = p_room_id;

  return picked;
end;
$$;

grant execute on function public.get_room_public(text) to authenticated;
grant execute on function public.get_my_submission(uuid) to authenticated;
grant execute on function public.delete_my_submission(uuid) to authenticated;
grant execute on function public.upsert_my_submission(uuid, text, int, text, text, text) to authenticated;
grant execute on function public.host_list_submissions(uuid, uuid) to anon, authenticated;
grant execute on function public.host_draw_winner(uuid, uuid) to anon, authenticated;

comment on table public.rooms is 'After Hours screening; host_secret for host browser only.';
comment on table public.submissions is 'Blind pool; members only see own row via RPC.';
