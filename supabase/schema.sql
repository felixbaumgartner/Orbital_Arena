-- Orbital Arena / Dutch Village Flight: pilot profiles and the leaderboard.
-- Run once in the Supabase SQL editor (free tier is plenty), then set
-- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the game server (Vercel
-- project environment variables). Browsers never talk to this table: the
-- game server reads and writes it with the service role key.

create table if not exists public.pilots (
  id            uuid primary key,
  secret_hash   text        not null,          -- sha256 of the pilot's secret
  name          text        not null default 'Pilot',
  xp            integer     not null default 0,
  level         integer     not null default 1,
  matches       integer     not null default 0,
  wins          integer     not null default 0,
  kills         integer     not null default 0,
  deaths        integer     not null default 0,
  missile_kills integer     not null default 0,
  bomb_kills    integer     not null default 0,
  captures      integer     not null default 0,
  rounds_won    integer     not null default 0,
  best_streak   integer     not null default 0,
  challenge_day text,                            -- daily-challenge XP allowance (UTC day)
  challenge_xp  integer     not null default 0,
  updated_at    timestamptz not null default now()
);

create index if not exists pilots_xp_idx on public.pilots (xp desc);

-- Row level security on, and no policies: the anon and authenticated roles
-- can do nothing; only the service role (the game server) bypasses RLS.
alter table public.pilots enable row level security;
