-- WriteItOut — Postgres schema
--
-- Apply with:  psql "$DATABASE_URL" -f schema.sql
-- The store also applies it on first use when DATABASE_AUTO_MIGRATE=1 (default).
--
-- Rules of the house:
--   * user_sub is Google's stable account id; it is the only identity key.
--   * Answer text (poi) is null unless the deployment's storage mode is `full`
--     AND the delegate has not opted out. Everything else is aggregate-safe.
--   * Nothing here stores IPs; analytics keeps a salted hash only.

create table if not exists delegates (
  user_sub             text primary key,
  email                text,
  display_name         text,
  picture_url          text,
  -- The delegate's own "save my answers" switch. The server enforces it: a rep is
  -- persisted with poi = null when this is false, whatever the client sends.
  store_answers        boolean not null default true,
  created_at           timestamptz not null default now(),
  last_seen_at         timestamptz not null default now(),
  total_reps           integer not null default 0,
  score_sum            numeric not null default 0,
  best_score           numeric(3,1),
  streak_days          integer not null default 0,
  longest_streak       integer not null default 0,
  last_practice_on     date,
  total_active_seconds bigint not null default 0
);

-- One Play press → Exit / completion. Time spent lives here and in activity_ticks.
create table if not exists practice_sessions (
  id              uuid primary key,
  user_sub        text not null references delegates(user_sub) on delete cascade,
  started_at      timestamptz not null default now(),
  ended_at        timestamptz,
  reps_target     integer not null,
  reps_done       integer not null default 0,
  seconds_per_rep integer not null default 0,
  active_seconds  integer not null default 0,
  avg_score       numeric(3,1),
  completed       boolean not null default false,
  -- The topic(s) the session covered, written when it is closed out. It lives on
  -- the session so the history list is one row per session, not a join over reps.
  topic           text,
  -- The one-tap verdict from the completion card: 1 useful, 0 not yet. Null means
  -- the delegate left without answering, which is not the same as "no".
  rating          smallint
);

-- Databases created before `topic` existed need it added: `create table if not
-- exists` is a no-op on an existing table, so this is the migration.
alter table practice_sessions add column if not exists topic text;
alter table practice_sessions add column if not exists rating smallint;

-- One graded POI. The id comes from the client so a retried request cannot
-- double-count a rep.
--
-- The text columns are everything needed to replay the rep later: the prompt
-- that was on screen, the answer, and the chair's verdict. They follow the same
-- redaction rule as `poi` — null unless the deployment stores answers and the
-- delegate has not opted out — so a replay can never outlive the opt-out.
create table if not exists reps (
  id                uuid primary key,
  session_id        uuid not null references practice_sessions(id) on delete cascade,
  user_sub          text not null references delegates(user_sub) on delete cascade,
  drill_id          text not null,
  topic             text,
  mode              text not null check (mode in ('full', 'single')),
  score             numeric(3,1) not null,
  timed_out         boolean not null default false,
  poi               text,
  poi_chars         integer not null default 0,
  prompt_text       text,
  grade_label       text,
  reasoning         text,
  constructive_feedback text,
  rewritten_poi     text,
  rewrite_explanation text,
  -- How long the delegate had the speech on screen before submitting, measured
  -- by the browser. This is the practice-time signal: against seconds_per_rep it
  -- says how much of the clock was used, and without a clock it is simply how
  -- long one written POI takes. The grader's own speed is `latency_ms`.
  write_ms          integer,
  latency_ms        integer,
  prompt_tokens     integer,
  completion_tokens integer,
  model             text,
  created_at        timestamptz not null default now()
);

-- Reps graded before the session replay existed carry only their score, and a
-- database created by an older version needs the new columns added: `create
-- table if not exists` is a no-op on an existing table, so these are the
-- migrations. Each one is idempotent.
alter table reps add column if not exists prompt_text text;
alter table reps add column if not exists grade_label text;
alter table reps add column if not exists reasoning text;
alter table reps add column if not exists constructive_feedback text;
alter table reps add column if not exists rewritten_poi text;
alter table reps add column if not exists rewrite_explanation text;
alter table reps add column if not exists write_ms integer;
-- The developer view can take one run out of every aggregate without deleting it
-- (a test run, a joke answer, a duplicate). Excluded rows stay readable in God
-- Mode so they can be put back; `store.py` filters every aggregate with it.
alter table reps add column if not exists excluded boolean not null default false;

-- Product analytics. Written by the batched ingest endpoint; rolled up nightly.
create table if not exists events (
  id          bigserial primary key,
  user_sub    text,
  name        text not null,
  props       jsonb not null default '{}'::jsonb,
  ip_hash     text,
  created_at  timestamptz not null default now()
);

-- One tick per visible minute. This is how "time on the app" survives a tab left
-- open overnight: gaps longer than the heartbeat are simply not counted.
create table if not exists activity_ticks (
  id          bigserial primary key,
  user_sub    text not null,
  session_id  uuid,
  created_at  timestamptz not null default now()
);

-- Admin-controlled switches (answer storage mode, feature flags), edited from
-- /admin so a policy change does not need a redeploy.
create table if not exists app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- Trial mode: when it is on, a visitor who is not signed in gets one practice.
-- `visitor` is the id the browser keeps in its own cookie (so it is first-party
-- and survives the modern cookie rules); `ip` is recorded beside it so the
-- developer view can see where a trial came from, and so a browser with no
-- cookie at all can still be counted.
create table if not exists trial_visits (
  visitor    text primary key,
  ip         text,
  practices  integer not null default 0,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists trial_visits_ip_idx on trial_visits (ip);

-- Which addresses an account has used, so the developer view can tie a person to
-- where they practised from. One row per (account, address); the request counter
-- is what makes a shared school network readable as "this is the same building".
-- This is the one place an address is kept — everything else stores a hash.
create table if not exists user_ips (
  user_sub   text not null,
  ip         text not null,
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  requests   integer not null default 1,
  primary key (user_sub, ip)
);
create index if not exists user_ips_seen_idx on user_ips (last_seen desc);

-- Nightly rollup the dashboard reads instead of scanning the tables above.
create table if not exists daily_metrics (
  day                 date primary key,
  users_active        integer not null default 0,
  users_new           integer not null default 0,
  sessions_started    integer not null default 0,
  sessions_completed  integer not null default 0,
  reps_graded         integer not null default 0,
  avg_score           numeric(4,2),
  timed_out_reps      integer not null default 0,
  active_seconds      bigint not null default 0,
  prompt_tokens       bigint not null default 0,
  completion_tokens   bigint not null default 0,
  cost_usd            numeric(10,4) not null default 0,
  errors              integer not null default 0,
  rate_limited        integer not null default 0,
  updated_at          timestamptz not null default now()
);

create index if not exists reps_user_created_idx on reps (user_sub, created_at desc);
create index if not exists reps_session_idx on reps (session_id);
create index if not exists reps_created_idx on reps (created_at desc);
create index if not exists sessions_user_started_idx on practice_sessions (user_sub, started_at desc);
create index if not exists events_created_idx on events (created_at desc);
create index if not exists events_name_created_idx on events (name, created_at desc);
create index if not exists ticks_created_idx on activity_ticks (created_at desc);
create index if not exists ticks_user_created_idx on activity_ticks (user_sub, created_at desc);

-- Repair: a session whose close request never arrived (the browser dropped every
-- PATCH before CORS allowed it) still has its reps, so the summary can be
-- rebuilt from them. Idempotent — once topic is filled the row is skipped.
update practice_sessions s
set topic = coalesce(s.topic, (
        select r.topic from reps r
        where r.session_id = s.id and r.topic is not null
        order by r.created_at limit 1
    )),
    avg_score = coalesce(s.avg_score, (
        select round(avg(r.score)::numeric, 1) from reps r where r.session_id = s.id
    )),
    reps_done = case
        when s.reps_done = 0 then (select count(*) from reps r where r.session_id = s.id)
        else s.reps_done
    end,
    ended_at = coalesce(s.ended_at, now())
where s.topic is null
  and exists (select 1 from reps r where r.session_id = s.id);
