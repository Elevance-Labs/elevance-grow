-- ===========================================================================
-- Elevance Grow — complete database schema
--
-- The whole database as it stands after every file in supabase/migrations/:
-- types, tables, functions, triggers, privileges and row level security.
-- Read this to know the database; read the migrations to know how it got
-- here.
--
-- Kept in step with the migrations: a change to the database is a new
-- migration AND the matching edit here, in the same commit. Only the end
-- state lives here — one-off data moves (backfills, renames) stay in their
-- migration. The playbook's fixed sections are part of the end state.
--
-- Three kinds of caller:
--   people   (admin, growth)  read and decide, through RLS and the RPCs
--   worker   (agent)          no table access at all: only the agent_* RPCs,
--                             and only for the job it has claimed
--   others   (member, agency) sign in, see nothing here yet
--
-- Running it in the SQL editor of a fresh project gives the same database as
-- `supabase db push`. Use one or the other, not both: this file does not
-- record migration history, so a later `db push` would try to replay it.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'growth', 'member', 'agency', 'agent');
create type public.login_method as enum ('google', 'password');
create type public.market_status as enum ('draft', 'active', 'archived');
create type public.source_kind as enum ('register', 'directory', 'api', 'maps', 'press', 'other');
create type public.collector_status as enum ('proposed', 'approved', 'retired');
create type public.account_review as enum ('candidate', 'accepted', 'rejected');
create type public.account_stage as enum
  ('researching', 'qualified', 'contacted', 'talking', 'proposal', 'won', 'lost', 'parked');
create type public.fact_kind as enum ('observed', 'inferred');
create type public.run_kind as enum
  ('thesis', 'sources', 'collector_build', 'collect', 'enrich', 'draft', 'follow_up', 'lessons');
create type public.job_status as enum ('queued', 'running', 'done', 'failed', 'needs_person', 'cancelled');
create type public.proposal_kind as enum ('thesis', 'source', 'next_step', 'lesson');
create type public.proposal_decision as enum ('pending', 'accepted', 'rejected');
create type public.draft_channel as enum ('email', 'linkedin', 'call');
create type public.draft_status as enum ('draft', 'copied', 'sent');
create type public.activity_kind as enum ('note', 'reply', 'call', 'stage', 'draft_sent', 'review');
create type public.worker_state as enum ('idle', 'working', 'limit');

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

-- The profile is also the login: a Google user (or, for a password login, an
-- email user) is bound to the row with the same email and login_method (see
-- bind_profile). A worker is a profile too: role agent, always a password.
create table public.profiles (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid unique references auth.users (id) on delete set null,
  full_name    text not null check (length(trim(full_name)) > 0),
  email        text not null unique,
  login_method public.login_method not null default 'google',
  role         public.app_role not null default 'member',
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Company addresses always sign in with Google; anything else only by password.
  constraint profiles_email_check
    check (email = lower(email)
           and case login_method
                 when 'google' then email like '%@elevancelabs.com'
                 else email like '_%@_%._%' and email not like '%@elevancelabs.com'
               end),
  constraint profiles_agent_password check (role <> 'agent' or login_method = 'password')
);

-- ---------------------------------------------------------------------------
-- Playbook: what every prompt is grounded in
-- ---------------------------------------------------------------------------
create table public.playbook_sections (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique check (key ~ '^[a-z][a-z_]{1,39}$'),
  title      text not null,
  hint       text not null default '',
  body       text not null default '' check (length(body) <= 8000),
  sort_order integer not null default 0,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Markets, their sources, and the collectors that read them
-- ---------------------------------------------------------------------------
create table public.markets (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) between 2 and 120),
  region         text not null check (length(trim(region)) between 2 and 120),
  -- What we are after here, in the person's words.
  brief          text not null default '' check (length(brief) <= 2000),
  -- The approved industry brief (from an accepted thesis proposal, or typed).
  thesis         text check (thesis is null or length(thesis) <= 20000),
  thesis_sources jsonb not null default '[]'::jsonb,
  status         public.market_status not null default 'draft',
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index markets_name_region_key on public.markets (lower(trim(name)), lower(trim(region)));

-- A hostname a collector may call: a public DNS name. No addresses, no
-- single-label or private names, so model-written code can't be pointed at
-- the worker's own network.
create function public.valid_public_host(p_host text)
returns boolean language sql immutable set search_path = '' as $$
  select p_host is not null
     and p_host ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$'
     and p_host !~ '\.(local|localhost|internal|intranet|lan|home|corp|test|invalid|example)$';
$$;

create function public.valid_public_hosts(p_hosts text[])
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(cardinality(p_hosts), 0) between 1 and 5
     and not exists (select 1 from unnest(p_hosts) h where not public.valid_public_host(h));
$$;

-- A reusable script that pulls a list from one source. Written by the agent
-- (agent_propose_collector), run by the worker only once a person has
-- approved this version (collector_decide). No client writes.
create table public.collectors (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique check (slug ~ '^[a-z][a-z0-9-]{2,59}$'),
  name         text not null check (length(trim(name)) > 0),
  description  text not null default '',
  -- The only hosts the script may reach when run.
  hosts        text[] not null check (public.valid_public_hosts(hosts)),
  terms_note   text not null default '',
  code         text not null check (length(code) between 1 and 60000),
  version      integer not null default 1,
  status       public.collector_status not null default 'proposed',
  -- The first rows of the build's test run, shown at approval.
  sample       jsonb not null default '[]'::jsonb,
  decided_by   uuid references public.profiles (id) on delete set null,
  decided_at   timestamptz,
  decided_note text,
  last_run_at  timestamptz,
  last_rows    integer,
  health       text check (health in ('ok', 'empty', 'error')),
  last_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table public.market_sources (
  id           uuid primary key default gen_random_uuid(),
  market_id    uuid not null references public.markets (id) on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  url          text not null check (url ~* '^https?://[^\s]+$' and length(url) <= 2000),
  kind         public.source_kind not null default 'other',
  why          text not null default '',
  terms_note   text not null default '',
  collector_id uuid references public.collectors (id) on delete set null,
  -- Ticked by a person: use this source.
  selected     boolean not null default false,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create unique index market_sources_url_key on public.market_sources (market_id, lower(url));

-- ---------------------------------------------------------------------------
-- Accounts: the businesses, with their evidence
-- ---------------------------------------------------------------------------

-- The site's host, lower-cased, without "www.".
create function public.account_domain(p_website text)
returns text language sql immutable set search_path = '' as $$
  select nullif(lower(regexp_replace(
           regexp_replace(coalesce(p_website, ''), '^\s*(https?://)?(www\.)?', '', 'i'),
           '[/:?#\s].*$', '')), '');
$$;

-- What makes two collected rows the same business: the name without its
-- legal form or punctuation, with the city and state. Mirrored by
-- accountKey in worker/lib/clean.ts.
create function public.account_key(p_name text, p_city text, p_state text)
returns text language sql immutable set search_path = '' as $$
  select regexp_replace(
           regexp_replace(replace(lower(coalesce(p_name, '')), '.', ''),
                          '\m(inc|incorporated|llc|co|corp|corporation|company|ltd|limited|the)\M', '', 'g'),
           '[^a-z0-9]+', '', 'g')
         || '|' || regexp_replace(lower(coalesce(p_city, '')), '[^a-z0-9]+', '', 'g')
         || '|' || regexp_replace(lower(coalesce(p_state, '')), '[^a-z0-9]+', '', 'g');
$$;

create table public.accounts (
  id               uuid primary key default gen_random_uuid(),
  market_id        uuid not null references public.markets (id) on delete restrict,
  name             text not null check (length(trim(name)) between 1 and 200),
  website          text,
  domain           text,
  phone            text,
  address          text,
  city             text,
  state            text,
  country          text,
  -- A collected row is a candidate until a person accepts or rejects it.
  review           public.account_review not null default 'candidate',
  stage            public.account_stage not null default 'researching',
  fit_score        integer check (fit_score between 0 and 100),
  fit_reasons      text,
  -- The specific reason to talk to this business.
  hook             text,
  enriched_at      timestamptz,
  do_not_contact   boolean not null default false,
  service_line     text,
  est_value        numeric(12, 2) check (est_value >= 0),
  source_id        uuid references public.market_sources (id) on delete set null,
  source_url       text,
  -- The collected row as the source gave it.
  raw              jsonb,
  dedupe_key       text not null,
  stage_changed_at timestamptz not null default now(),
  last_activity_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint accounts_dedupe_key unique (market_id, dedupe_key)
);
create index accounts_market_idx on public.accounts (market_id, review, stage);

create table public.contacts (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.accounts (id) on delete cascade,
  full_name    text not null check (length(trim(full_name)) > 0),
  title        text,
  email        text,
  phone        text,
  linkedin_url text,
  -- Where the agent read this person's name, and the words that said so.
  source_url   text,
  quote        text,
  verified     boolean not null default false,
  job_id       uuid,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);
create index contacts_account_idx on public.contacts (account_id);

-- ---------------------------------------------------------------------------
-- The agent's queue
-- ---------------------------------------------------------------------------

-- One thing a person asked for ("enrich these 25"); its jobs do the work.
create table public.agent_runs (
  id          uuid primary key default gen_random_uuid(),
  kind        public.run_kind not null,
  market_id   uuid not null references public.markets (id) on delete cascade,
  goal        text not null,
  -- Follows its jobs (run_refresh).
  status      public.job_status not null default 'queued',
  started_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  finished_at timestamptz,
  tokens_in   bigint not null default 0,
  tokens_out  bigint not null default 0,
  cost_usd    numeric(10, 4) not null default 0
);
create index agent_runs_market_idx on public.agent_runs (market_id, created_at desc);

create table public.agent_jobs (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.agent_runs (id) on delete cascade,
  kind         public.run_kind not null,
  market_id    uuid not null references public.markets (id) on delete cascade,
  account_id   uuid references public.accounts (id) on delete cascade,
  source_id    uuid references public.market_sources (id) on delete set null,
  collector_id uuid references public.collectors (id) on delete set null,
  activity_id  uuid,
  input        jsonb not null default '{}'::jsonb,
  status       public.job_status not null default 'queued',
  -- The worker that claimed it.
  worker_id    uuid references public.profiles (id) on delete set null,
  attempts     integer not null default 0,
  claimed_at   timestamptz,
  heartbeat_at timestamptz,
  finished_at  timestamptz,
  summary      text,
  error        text,
  tokens_in    bigint not null default 0,
  tokens_out   bigint not null default 0,
  cost_usd     numeric(10, 4) not null default 0,
  created_at   timestamptz not null default now()
);
create index agent_jobs_queue_idx on public.agent_jobs (status, created_at);
create index agent_jobs_run_idx on public.agent_jobs (run_id);
create index agent_jobs_account_idx on public.agent_jobs (account_id);

-- What a job did, step by step, as the person watching sees it.
create table public.agent_job_events (
  id      bigint generated always as identity primary key,
  job_id  uuid not null references public.agent_jobs (id) on delete cascade,
  at      timestamptz not null default now(),
  kind    text not null default 'step' check (kind in ('step', 'tool', 'warn', 'error')),
  body    text not null check (length(body) <= 2000)
);
create index agent_job_events_job_idx on public.agent_job_events (job_id, id);

-- One sourced claim about an account. Written only by the worker
-- (agent_save_fact); `verified` is the worker's own re-read of the page, not
-- the model's word.
create table public.account_facts (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts (id) on delete cascade,
  job_id      uuid references public.agent_jobs (id) on delete set null,
  kind        public.fact_kind not null default 'observed',
  label       text not null check (length(trim(label)) between 1 and 80),
  claim       text not null check (length(trim(claim)) between 1 and 1000),
  source_url  text,
  quote       text,
  -- The page's words around the quote, kept so the evidence outlives the page.
  context     text,
  verified    boolean not null default false,
  read_at     timestamptz,
  rejected_at timestamptz,
  rejected_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- Something seen needs the place it was seen and the words; an inference
  -- is never "verified".
  constraint account_facts_evidence
    check (case kind when 'observed'
                     then coalesce(source_url ~* '^https?://' and length(trim(quote)) > 0, false)
                     else not verified end)
);
create index account_facts_account_idx on public.account_facts (account_id, created_at);

-- Agent output that changes the record only once a person accepts it
-- (proposal_decide).
create table public.proposals (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references public.agent_jobs (id) on delete set null,
  kind        public.proposal_kind not null,
  market_id   uuid not null references public.markets (id) on delete cascade,
  account_id  uuid references public.accounts (id) on delete cascade,
  summary     text not null default '',
  payload     jsonb not null,
  decision    public.proposal_decision not null default 'pending',
  -- What was accepted, when the person changed it first.
  final       jsonb,
  reason      text,
  decided_by  uuid references public.profiles (id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index proposals_pending_idx on public.proposals (decision, created_at);

-- What we learned, in a sentence each. General (no market) or one market's.
create table public.lessons (
  id         uuid primary key default gen_random_uuid(),
  market_id  uuid references public.markets (id) on delete cascade,
  body       text not null check (length(trim(body)) between 10 and 600),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Drafts and the account's timeline
-- ---------------------------------------------------------------------------

-- Outreach to copy out. The app never sends anything.
create table public.drafts (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references public.accounts (id) on delete cascade,
  contact_id    uuid references public.contacts (id) on delete set null,
  channel       public.draft_channel not null,
  subject       text,
  body          text not null check (length(trim(body)) between 1 and 10000),
  -- As the agent wrote it, to see what people change.
  original_body text,
  status        public.draft_status not null default 'draft',
  job_id        uuid references public.agent_jobs (id) on delete set null,
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create index drafts_account_idx on public.drafts (account_id, created_at desc);

create table public.activities (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  kind       public.activity_kind not null,
  body       text not null default '' check (length(body) <= 10000),
  meta       jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
create index activities_account_idx on public.activities (account_id, created_at desc);

-- A worker's heartbeat: one row per agent profile, kept by agent_heartbeat.
create table public.workers (
  profile_id   uuid primary key references public.profiles (id) on delete cascade,
  -- Whose jobs it does; null does anyone's.
  owner_id     uuid references public.profiles (id) on delete set null,
  state        public.worker_state not null default 'idle',
  info         jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Identity helpers (used by RLS)
-- ---------------------------------------------------------------------------
create function public.current_profile_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.profiles where user_id = (select auth.uid()) and active;
$$;

create function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where user_id = (select auth.uid()) and active;
$$;

create function public.is_admin()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.current_app_role() = 'admin', false);
$$;

-- Works on prospecting: admin or growth.
create function public.is_growth()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.current_app_role() in ('admin', 'growth'), false);
$$;

create function public.is_agent()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(public.current_app_role() = 'agent', false);
$$;

-- Called by the app right after sign-in. Binds the auth user to the profile
-- with the same email and sign-in method, if it is active. Returns the row,
-- or nothing when login must be refused.
create function public.bind_profile()
returns setof public.profiles
language plpgsql security definer set search_path = '' as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text := lower(auth.jwt() ->> 'email');
  v_provider text := coalesce(auth.jwt() -> 'app_metadata' ->> 'provider', '');
  v_method   public.login_method;
begin
  if v_uid is null or v_email is null then
    return;
  end if;
  -- The session's provider must match the row's method, so a Google account
  -- never claims a password row nor a password account a Google one.
  if v_provider = 'google' and v_email like '%@elevancelabs.com' then
    v_method := 'google';
  elsif v_provider = 'email'
        and exists (select 1 from auth.users u
                     where u.id = v_uid and u.email_confirmed_at is not null) then
    v_method := 'password';
  else
    return;
  end if;

  update public.profiles p
     set user_id = v_uid
   where p.email = v_email
     and p.login_method = v_method
     and p.user_id is null
     and p.active;

  return query
    select * from public.profiles p
     where p.user_id = v_uid
       and p.email = v_email
       and p.login_method = v_method
       and p.active;
end;
$$;

-- Optional hardening: enable as the "Before User Created" auth hook so that
-- people without a matching profile never get an auth user at all.
create function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(event -> 'user' ->> 'email');
begin
  if v_email is null or not exists (select 1 from public.profiles where email = v_email and active) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'No active profile found for this account.'));
  end if;
  return '{}'::jsonb;
end;
$$;

-- For the set-password Edge Function (service role only): the auth users with
-- this email, which it replaces with one that has the new password.
create function public.auth_user_ids_by_email(p_email text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select u.id from auth.users u where lower(u.email) = lower(p_email);
$$;

-- Names for the people the app mentions (who started a run, who decided).
-- Runs with owner rights, so it bypasses the profiles RLS on purpose; it
-- gives no emails and gates on the caller working on prospecting.
create view public.profile_directory with (security_invoker = false) as
  select p.id, p.full_name, p.role, p.active
    from public.profiles p
   where (select public.is_growth());

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Changing an email or method unbinds the login; the last active admin
-- stays. (Who may write profiles at all is RLS: admins.)
create function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if new.email is distinct from old.email or new.login_method is distinct from old.login_method then
      new.user_id := null; -- rebinds on next login with the new email / method
    end if;
    new.updated_at := now();
  end if;
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and not exists (select 1 from public.profiles p
                      where p.role = 'admin' and p.active and p.id <> old.id) then
    raise exception 'There must be at least one active admin.' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger profiles_guard
  before insert or update or delete on public.profiles
  for each row execute function public.profiles_guard();

create function public.playbook_sections_stamp()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_by := public.current_profile_id();
  new.updated_at := now();
  return new;
end;
$$;

create trigger playbook_sections_stamp
  before update on public.playbook_sections
  for each row execute function public.playbook_sections_stamp();

-- Stamps who made a row (markets, sources, lessons, contacts, drafts, activities).
create function public.stamp_created_by()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.created_by := public.current_profile_id();
  end if;
  return new;
end;
$$;

create function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger markets_stamp before insert on public.markets
  for each row execute function public.stamp_created_by();
create trigger markets_touch before update on public.markets
  for each row execute function public.touch_updated_at();
create trigger market_sources_stamp before insert on public.market_sources
  for each row execute function public.stamp_created_by();
create trigger lessons_stamp before insert on public.lessons
  for each row execute function public.stamp_created_by();
create trigger contacts_stamp before insert on public.contacts
  for each row execute function public.stamp_created_by();
create trigger drafts_stamp before insert on public.drafts
  for each row execute function public.stamp_created_by();
create trigger drafts_touch before update on public.drafts
  for each row execute function public.touch_updated_at();

-- Keeps the derived columns: the domain from the website and the key that
-- makes a collected row a duplicate. A business a person adds by hand is
-- theirs already, so it starts accepted.
create function public.accounts_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.domain := public.account_domain(new.website);
  new.dedupe_key := public.account_key(new.name, new.city, new.state);
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not public.is_agent() then
      new.review := 'accepted';
    end if;
  else
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger accounts_guard
  before insert or update on public.accounts
  for each row execute function public.accounts_guard();

-- A person writes notes, replies and call notes; the rest of the timeline is
-- written by the RPCs.
create function public.activities_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.created_by := public.current_profile_id();
  end if;
  update public.accounts set last_activity_at = now() where id = new.account_id;
  return new;
end;
$$;

create trigger activities_guard
  before insert on public.activities
  for each row execute function public.activities_guard();

-- ---------------------------------------------------------------------------
-- People's RPCs
-- ---------------------------------------------------------------------------

-- A run's status, finish time and token totals follow its jobs.
create function public.run_refresh(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_open    integer;
  v_started integer;
  v_done    integer;
  v_needs   integer;
  v_failed  integer;
begin
  select count(*) filter (where status in ('queued', 'running')),
         count(*) filter (where status <> 'queued'),
         count(*) filter (where status = 'done'),
         count(*) filter (where status = 'needs_person'),
         count(*) filter (where status = 'failed')
    into v_open, v_started, v_done, v_needs, v_failed
    from public.agent_jobs where run_id = p_run_id;

  update public.agent_runs r
     set status = (case when v_open > 0 and v_started > 0 then 'running'
                        when v_open > 0 then 'queued'
                        when v_done > 0 then 'done'
                        when v_needs > 0 then 'needs_person'
                        when v_failed > 0 then 'failed'
                        else 'cancelled' end)::public.job_status,
         finished_at = case when v_open > 0 then null else coalesce(r.finished_at, now()) end,
         tokens_in = t.tokens_in, tokens_out = t.tokens_out, cost_usd = t.cost_usd
    from (select coalesce(sum(tokens_in), 0) as tokens_in, coalesce(sum(tokens_out), 0) as tokens_out,
                 coalesce(sum(cost_usd), 0) as cost_usd
            from public.agent_jobs where run_id = p_run_id) t
   where r.id = p_run_id;
end;
$$;

-- Starts a run: the only way jobs are made. Checks the caller, what the kind
-- needs, and leaves out accounts that already have that job waiting.
create function public.run_start(
  p_kind        public.run_kind,
  p_market_id   uuid,
  p_account_ids uuid[] default null,
  p_source_id   uuid default null,
  p_input       jsonb default '{}'::jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_market    public.markets;
  v_source    public.market_sources;
  v_collector public.collectors;
  v_ids       uuid[];
  v_run_id    uuid;
  v_goal      text;
  v_input     jsonb := coalesce(p_input, '{}'::jsonb);
  v_activity  uuid;
begin
  if not public.is_growth() then
    raise exception 'Only the growth team can start a run.' using errcode = '42501';
  end if;
  select * into v_market from public.markets where id = p_market_id;
  if not found then
    raise exception 'No such market.' using errcode = 'P0002';
  end if;
  if v_market.status = 'archived' then
    raise exception 'This market is archived.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.agent_jobs where status in ('queued', 'running')) >= 300 then
    raise exception 'There are already 300 jobs waiting. Let some finish first.' using errcode = 'P0001';
  end if;

  if p_kind in ('thesis', 'sources', 'lessons') then
    if p_kind = 'sources' and v_market.thesis is null then
      raise exception 'Approve a thesis first: sources are found from it.' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.agent_jobs
                where kind = p_kind and market_id = p_market_id and status in ('queued', 'running')) then
      raise exception 'That is already running for this market.' using errcode = 'P0001';
    end if;
    v_goal := case p_kind when 'thesis' then 'Write the thesis for '
                          when 'sources' then 'Find sources for '
                          else 'Suggest lessons from ' end || v_market.name || ', ' || v_market.region;

  elsif p_kind in ('collector_build', 'collect') then
    select * into v_source from public.market_sources where id = p_source_id and market_id = p_market_id;
    if not found then
      raise exception 'No such source in this market.' using errcode = 'P0002';
    end if;
    if exists (select 1 from public.agent_jobs
                where kind = p_kind and source_id = p_source_id and status in ('queued', 'running')) then
      raise exception 'That is already running for this source.' using errcode = 'P0001';
    end if;
    if p_kind = 'collect' then
      select * into v_collector from public.collectors where id = v_source.collector_id;
      if not found or v_collector.status <> 'approved' then
        raise exception 'This source has no approved collector yet.' using errcode = 'P0001';
      end if;
      v_goal := 'Collect from ' || v_source.name;
    else
      v_goal := 'Build a collector for ' || v_source.name;
    end if;

  elsif p_kind in ('enrich', 'draft', 'follow_up') then
    if coalesce(cardinality(p_account_ids), 0) = 0 then
      raise exception 'Choose at least one account.' using errcode = 'P0001';
    end if;
    if cardinality(p_account_ids) > 50 then
      raise exception 'At most 50 accounts in one run.' using errcode = 'P0001';
    end if;
    if p_kind = 'follow_up' and cardinality(p_account_ids) <> 1 then
      raise exception 'A follow-up is for one account.' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(p_account_ids) x
                where not exists (select 1 from public.accounts a
                                   where a.id = x and a.market_id = p_market_id and a.review = 'accepted')) then
      raise exception 'Every account must be an accepted one in this market.' using errcode = 'P0001';
    end if;
    if p_kind = 'draft' then
      if (v_input ->> 'channel') is null
         or (v_input ->> 'channel') not in ('email', 'linkedin', 'call') then
        raise exception 'Choose a channel: email, linkedin or call.' using errcode = 'P0001';
      end if;
      if exists (select 1 from public.accounts a where a.id = any (p_account_ids) and a.do_not_contact) then
        raise exception 'An account marked do not contact gets no drafts.' using errcode = 'P0001';
      end if;
      if exists (select 1 from public.accounts a where a.id = any (p_account_ids) and a.hook is null) then
        raise exception 'Enrich an account before drafting to it: a draft is built on its reason to talk.'
          using errcode = 'P0001';
      end if;
    end if;
    if p_kind = 'follow_up' then
      v_activity := nullif(v_input ->> 'activity_id', '')::uuid;
      if v_activity is null or not exists (select 1 from public.activities x
                                            where x.id = v_activity and x.account_id = p_account_ids[1]
                                              and x.kind in ('note', 'reply', 'call')) then
        raise exception 'A follow-up needs the reply or notes it follows.' using errcode = 'P0001';
      end if;
    end if;
    -- Leave out accounts with the same job already waiting.
    select array_agg(distinct x) into v_ids
      from unnest(p_account_ids) x
     where not exists (select 1 from public.agent_jobs j
                        where j.kind = p_kind and j.account_id = x and j.status in ('queued', 'running'));
    if v_ids is null then
      raise exception 'That is already running for these accounts.' using errcode = 'P0001';
    end if;
    v_goal := case p_kind when 'enrich' then 'Research ' when 'draft' then 'Draft outreach to '
                          else 'Suggest the next step for ' end
              || cardinality(v_ids) || case when cardinality(v_ids) = 1 then ' account' else ' accounts' end
              || ' in ' || v_market.name;
  end if;

  insert into public.agent_runs (kind, market_id, goal, started_by)
  values (p_kind, p_market_id, v_goal, public.current_profile_id())
  returning id into v_run_id;

  if v_ids is not null then
    insert into public.agent_jobs (run_id, kind, market_id, account_id, activity_id, input)
    select v_run_id, p_kind, p_market_id, x, v_activity, v_input from unnest(v_ids) x;
  else
    insert into public.agent_jobs (run_id, kind, market_id, source_id, collector_id, input)
    values (v_run_id, p_kind, p_market_id, v_source.id,
            case when p_kind = 'collect' then v_collector.id end, v_input);
  end if;
  return v_run_id;
end;
$$;

-- Stops a run: jobs not finished are cancelled. A worker mid-job finds its
-- next write refused and gives up.
create function public.run_cancel(p_run_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_growth() then
    raise exception 'Only the growth team can cancel a run.' using errcode = '42501';
  end if;
  update public.agent_jobs
     set status = 'cancelled', finished_at = now()
   where run_id = p_run_id and status in ('queued', 'running');
  perform public.run_refresh(p_run_id);
end;
$$;

-- Accept or reject collected candidates, many at once.
create function public.accounts_review(p_ids uuid[], p_decision public.account_review)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if not public.is_growth() then
    raise exception 'Only the growth team can review accounts.' using errcode = '42501';
  end if;
  if p_decision = 'candidate' then
    raise exception 'Accept or reject.' using errcode = 'P0001';
  end if;
  with changed as (
    update public.accounts a set review = p_decision
     where a.id = any (p_ids) and a.review <> p_decision
    returning a.id
  ), logged as (
    insert into public.activities (account_id, kind, body, meta)
    select id, 'review', '', jsonb_build_object('decision', p_decision) from changed
    returning 1
  )
  select count(*) into v_count from logged;
  return v_count;
end;
$$;

-- The one place a stage changes; writes the timeline.
create function public.account_set_stage(p_account_id uuid, p_stage public.account_stage, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_from public.account_stage;
begin
  select stage into v_from from public.accounts where id = p_account_id for update;
  if v_from = p_stage then
    return;
  end if;
  update public.accounts set stage = p_stage, stage_changed_at = now() where id = p_account_id;
  insert into public.activities (account_id, kind, body, meta)
  values (p_account_id, 'stage', coalesce(trim(p_note), ''), jsonb_build_object('from', v_from, 'to', p_stage));
end;
$$;

-- Moves an account along the pipeline. Losing or parking one needs a reason:
-- those reasons are what the lessons are drawn from.
create function public.account_move(p_id uuid, p_stage public.account_stage, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_growth() then
    raise exception 'Only the growth team can move an account.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.accounts where id = p_id and review = 'accepted') then
    raise exception 'Only an accepted account is in the pipeline.' using errcode = 'P0001';
  end if;
  if p_stage in ('lost', 'parked') and length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'Say why: a reason is needed to mark an account lost or parked.' using errcode = 'P0001';
  end if;
  perform public.account_set_stage(p_id, p_stage, p_note);
end;
$$;

-- Sets a wrong fact aside (or brings it back). Rejected facts are kept: they
-- count against the source that gave them.
create function public.fact_reject(p_id uuid, p_rejected boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_growth() then
    raise exception 'Only the growth team can reject a fact.' using errcode = '42501';
  end if;
  update public.account_facts
     set rejected_at = case when p_rejected then now() end,
         rejected_by = case when p_rejected then public.current_profile_id() end
   where id = p_id;
end;
$$;

-- What each kind of proposal must carry. Used when the agent proposes and
-- again on what the person accepts.
create function public.proposal_check(p_kind public.proposal_kind, p_payload jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'A proposal is an object.' using errcode = '22023';
  end if;
  if p_kind = 'thesis' then
    if length(trim(coalesce(p_payload ->> 'text', ''))) not between 200 and 20000 then
      raise exception 'A thesis is 200 to 20,000 characters.' using errcode = '22023';
    end if;
    if jsonb_typeof(coalesce(p_payload -> 'sources', '[]'::jsonb)) <> 'array' then
      raise exception 'A thesis lists its sources.' using errcode = '22023';
    end if;
  elsif p_kind = 'source' then
    if length(trim(coalesce(p_payload ->> 'name', ''))) = 0
       or coalesce(p_payload ->> 'url', '') !~* '^https?://[^\s]+$'
       or coalesce(p_payload ->> 'kind', 'other') not in ('register', 'directory', 'api', 'maps', 'press', 'other') then
      raise exception 'A source needs a name, a web address and a kind.' using errcode = '22023';
    end if;
  elsif p_kind = 'next_step' then
    if length(trim(coalesce(p_payload ->> 'note', ''))) = 0 then
      raise exception 'A next step says what to do.' using errcode = '22023';
    end if;
    if (p_payload ->> 'stage') is not null
       and (p_payload ->> 'stage') not in ('researching', 'qualified', 'contacted', 'talking', 'proposal', 'won', 'lost', 'parked') then
      raise exception 'Not a pipeline stage.' using errcode = '22023';
    end if;
  elsif p_kind = 'lesson' then
    if length(trim(coalesce(p_payload ->> 'body', ''))) not between 10 and 600 then
      raise exception 'A lesson is 10 to 600 characters.' using errcode = '22023';
    end if;
  end if;
end;
$$;

-- Accept (as proposed, or as the person changed it) or reject a proposal.
-- Accepting is what writes the record.
create function public.proposal_decide(
  p_id     uuid,
  p_accept boolean,
  p_final  jsonb default null,
  p_reason text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.proposals;
  v_final jsonb;
begin
  if not public.is_growth() then
    raise exception 'Only the growth team can decide a proposal.' using errcode = '42501';
  end if;
  select * into v from public.proposals where id = p_id for update;
  if not found then
    raise exception 'No such proposal.' using errcode = 'P0002';
  end if;
  if v.decision <> 'pending' then
    raise exception 'This proposal was already decided.' using errcode = 'P0001';
  end if;

  if not p_accept then
    update public.proposals
       set decision = 'rejected', reason = nullif(trim(coalesce(p_reason, '')), ''),
           decided_by = public.current_profile_id(), decided_at = now()
     where id = p_id;
    return;
  end if;

  v_final := coalesce(p_final, v.payload);
  perform public.proposal_check(v.kind, v_final);

  if v.kind = 'thesis' then
    update public.markets
       set thesis = trim(v_final ->> 'text'),
           thesis_sources = coalesce(v_final -> 'sources', '[]'::jsonb),
           status = case when status = 'draft' then 'active' else status end
     where id = v.market_id;
  elsif v.kind = 'source' then
    insert into public.market_sources (market_id, name, url, kind, why, terms_note, selected)
    values (v.market_id, trim(v_final ->> 'name'), trim(v_final ->> 'url'),
            coalesce(v_final ->> 'kind', 'other')::public.source_kind,
            coalesce(v_final ->> 'why', ''), coalesce(v_final ->> 'terms_note', ''), true)
    on conflict (market_id, lower(url)) do update set selected = true;
  elsif v.kind = 'next_step' then
    if (v_final ->> 'stage') is not null then
      perform public.account_set_stage(v.account_id, (v_final ->> 'stage')::public.account_stage,
                                       v_final ->> 'note');
    end if;
  elsif v.kind = 'lesson' then
    insert into public.lessons (market_id, body)
    values (case when coalesce((v_final ->> 'general')::boolean, false) then null else v.market_id end,
            trim(v_final ->> 'body'));
  end if;

  update public.proposals
     set decision = 'accepted', final = case when p_final is null then null else v_final end,
         decided_by = public.current_profile_id(), decided_at = now()
   where id = p_id;
end;
$$;

-- Approve, send back or retire a collector. Admins only: this is the gate
-- that lets model-written code run on the worker.
create function public.collector_decide(p_id uuid, p_status public.collector_status, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can approve or retire a collector.' using errcode = '42501';
  end if;
  if p_status = 'proposed' then
    raise exception 'Approve or retire.' using errcode = 'P0001';
  end if;
  update public.collectors
     set status = p_status, decided_by = public.current_profile_id(), decided_at = now(),
         decided_note = nullif(trim(coalesce(p_note, '')), ''), updated_at = now()
   where id = p_id;
  if not found then
    raise exception 'No such collector.' using errcode = 'P0002';
  end if;
end;
$$;

-- Marks a draft copied or sent. Sent writes the timeline and, for an account
-- not yet contacted, moves it to contacted.
create function public.draft_mark(p_id uuid, p_status public.draft_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.drafts;
  v_account public.accounts;
begin
  if not public.is_growth() then
    raise exception 'Only the growth team can mark a draft.' using errcode = '42501';
  end if;
  select * into v from public.drafts where id = p_id for update;
  if not found then
    raise exception 'No such draft.' using errcode = 'P0002';
  end if;
  select * into v_account from public.accounts where id = v.account_id;
  if p_status = 'sent' and v_account.do_not_contact then
    raise exception 'This account is marked do not contact.' using errcode = 'P0001';
  end if;
  if v.status = 'sent' then
    raise exception 'This draft was already sent.' using errcode = 'P0001';
  end if;
  update public.drafts
     set status = p_status, sent_at = case when p_status = 'sent' then now() end
   where id = p_id;
  if p_status = 'sent' then
    insert into public.activities (account_id, kind, body, meta)
    values (v.account_id, 'draft_sent', coalesce(v.subject, ''),
            jsonb_build_object('draft_id', v.id, 'channel', v.channel));
    if v_account.stage in ('researching', 'qualified') then
      perform public.account_set_stage(v.account_id, 'contacted', null);
    end if;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The worker's RPCs. A worker has no table access; these are all it can do,
-- and each write is for the job it has claimed and is still running.
-- ---------------------------------------------------------------------------

-- The caller's claimed, running job, or an error.
create function public.agent_job(p_job_id uuid)
returns public.agent_jobs language plpgsql stable security definer set search_path = '' as $$
declare
  v public.agent_jobs;
begin
  if not public.is_agent() then
    raise exception 'Only a worker can do this.' using errcode = '42501';
  end if;
  select * into v from public.agent_jobs
   where id = p_job_id and worker_id = public.current_profile_id() and status = 'running';
  if not found then
    raise exception 'This job is not yours, or is no longer running.' using errcode = '42501';
  end if;
  return v;
end;
$$;

-- Everything a job needs to know, in one object: the worker reads nothing else.
create function public.agent_job_context(p_job_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'job', jsonb_build_object('id', j.id, 'kind', j.kind, 'input', j.input, 'attempts', j.attempts,
                              'run_id', j.run_id),
    'market', (select jsonb_build_object('id', m.id, 'name', m.name, 'region', m.region,
                                         'brief', m.brief, 'thesis', m.thesis)
                 from public.markets m where m.id = j.market_id),
    'playbook', (select coalesce(jsonb_agg(jsonb_build_object('key', s.key, 'title', s.title, 'body', s.body)
                                           order by s.sort_order, s.key), '[]'::jsonb)
                   from public.playbook_sections s where length(trim(s.body)) > 0),
    'lessons', (select coalesce(jsonb_agg(l.body order by l.created_at), '[]'::jsonb)
                  from public.lessons l where l.market_id is null or l.market_id = j.market_id),
    'account', (select jsonb_build_object(
                  'id', a.id, 'name', a.name, 'website', a.website, 'phone', a.phone, 'address', a.address,
                  'city', a.city, 'state', a.state, 'country', a.country, 'stage', a.stage,
                  'fit_score', a.fit_score, 'fit_reasons', a.fit_reasons, 'hook', a.hook,
                  'source_url', a.source_url, 'raw', a.raw,
                  'facts', (select coalesce(jsonb_agg(jsonb_build_object(
                              'kind', f.kind, 'label', f.label, 'claim', f.claim, 'source_url', f.source_url,
                              'quote', f.quote, 'verified', f.verified) order by f.created_at), '[]'::jsonb)
                              from public.account_facts f
                             where f.account_id = a.id and f.rejected_at is null),
                  'contacts', (select coalesce(jsonb_agg(jsonb_build_object(
                                 'id', c.id, 'full_name', c.full_name, 'title', c.title, 'email', c.email,
                                 'phone', c.phone) order by c.created_at), '[]'::jsonb)
                                 from public.contacts c where c.account_id = a.id),
                  'timeline', (select coalesce(jsonb_agg(t.entry order by t.created_at), '[]'::jsonb)
                                 from (select jsonb_build_object('kind', x.kind, 'body', x.body, 'meta', x.meta,
                                                                 'at', x.created_at) as entry, x.created_at
                                         from public.activities x where x.account_id = a.id
                                        order by x.created_at desc limit 20) t))
                  from public.accounts a where a.id = j.account_id),
    'source', (select jsonb_build_object('id', s.id, 'name', s.name, 'url', s.url, 'kind', s.kind,
                                         'why', s.why, 'terms_note', s.terms_note)
                 from public.market_sources s where s.id = j.source_id),
    -- Code is handed over only for a version a person approved.
    'collector', (select jsonb_build_object('id', c.id, 'slug', c.slug, 'hosts', c.hosts, 'code', c.code,
                                            'version', c.version)
                    from public.collectors c where c.id = j.collector_id and c.status = 'approved'),
    'known_sources', (select coalesce(jsonb_agg(s.url), '[]'::jsonb)
                        from public.market_sources s where s.market_id = j.market_id),
    'activity', (select jsonb_build_object('kind', x.kind, 'body', x.body)
                   from public.activities x where x.id = j.activity_id),
    'decisions', case when j.kind = 'lessons' then
                   (select coalesce(jsonb_agg(d.entry), '[]'::jsonb)
                      from (select jsonb_build_object(
                                     'name', a.name, 'review', a.review, 'stage', a.stage,
                                     'fit_score', a.fit_score, 'hook', a.hook,
                                     'reasons', (select coalesce(jsonb_agg(x.body), '[]'::jsonb)
                                                   from public.activities x
                                                  where x.account_id = a.id and x.kind = 'stage'
                                                    and length(x.body) > 0)) as entry
                              from public.accounts a
                             where a.market_id = j.market_id and a.review <> 'candidate'
                             order by a.updated_at desc limit 150) d)
                 end)
    from public.agent_jobs j where j.id = p_job_id;
$$;

-- "I am here": keeps the worker's row and its running jobs fresh.
create function public.agent_heartbeat(p_state public.worker_state, p_info jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.current_profile_id();
begin
  if not public.is_agent() then
    raise exception 'Only a worker can do this.' using errcode = '42501';
  end if;
  insert into public.workers (profile_id, state, info, last_seen_at)
  values (v_me, p_state, coalesce(p_info, '{}'::jsonb), now())
  on conflict (profile_id) do update
    set state = excluded.state, info = excluded.info, last_seen_at = now();
  update public.agent_jobs set heartbeat_at = now() where worker_id = v_me and status = 'running';
end;
$$;

-- Takes the oldest waiting job this worker may do and returns its context,
-- or null when there is none. Jobs whose worker went silent are put back
-- first (three tries, then failed).
create function public.agent_claim()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := public.current_profile_id();
  v_owner  uuid;
  v_job_id uuid;
  v_run_id uuid;
begin
  if not public.is_agent() then
    raise exception 'Only a worker can claim jobs.' using errcode = '42501';
  end if;

  for v_run_id in
    update public.agent_jobs j
       set status = (case when j.attempts >= 3 then 'failed' else 'queued' end)::public.job_status,
           error = case when j.attempts >= 3 then 'Gave up after three tries: the worker stopped each time.' end,
           finished_at = case when j.attempts >= 3 then now() end,
           worker_id = null
     where j.status = 'running'
       and coalesce(j.heartbeat_at, j.claimed_at) < now() - interval '10 minutes'
    returning j.run_id
  loop
    perform public.run_refresh(v_run_id);
  end loop;

  select w.owner_id into v_owner from public.workers w where w.profile_id = v_me;

  select j.id, j.run_id into v_job_id, v_run_id
    from public.agent_jobs j
    join public.agent_runs r on r.id = j.run_id
   where j.status = 'queued' and (v_owner is null or r.started_by = v_owner)
   order by j.created_at, j.id
   limit 1
     for update of j skip locked;
  if v_job_id is null then
    return null;
  end if;

  update public.agent_jobs
     set status = 'running', worker_id = v_me, claimed_at = now(), heartbeat_at = now(),
         attempts = attempts + 1, error = null
   where id = v_job_id;
  perform public.run_refresh(v_run_id);
  return public.agent_job_context(v_job_id);
end;
$$;

create function public.agent_event(p_job_id uuid, p_kind text, p_body text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.agent_job(p_job_id);
  insert into public.agent_job_events (job_id, kind, body)
  values (p_job_id, p_kind, left(coalesce(p_body, ''), 2000));
  update public.agent_jobs set heartbeat_at = now() where id = p_job_id;
end;
$$;

-- One fact about the job's account. p_verified is the worker's own re-read
-- of the page; the database only refuses what cannot be evidence at all.
create function public.agent_save_fact(
  p_job_id     uuid,
  p_kind       public.fact_kind,
  p_label      text,
  p_claim      text,
  p_source_url text default null,
  p_quote      text default null,
  p_context    text default null,
  p_verified   boolean default false
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_job public.agent_jobs := public.agent_job(p_job_id);
  v_id  uuid;
begin
  if v_job.kind <> 'enrich' then
    raise exception 'Facts are saved by a research job.' using errcode = 'P0001';
  end if;
  -- A job run again (after a usage limit, say) finds what it already saved.
  select f.id into v_id from public.account_facts f
   where f.account_id = v_job.account_id and f.rejected_at is null and f.kind = p_kind
     and lower(f.label) = lower(trim(p_label)) and f.claim = trim(p_claim)
     and f.source_url is not distinct from p_source_url;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.account_facts (account_id, job_id, kind, label, claim, source_url, quote, context,
                                    verified, read_at)
  values (v_job.account_id, p_job_id, p_kind, trim(p_label), trim(p_claim), p_source_url, p_quote,
          left(p_context, 2000), p_kind = 'observed' and coalesce(p_verified, false),
          case when p_kind = 'observed' then now() end)
  returning id into v_id;
  return v_id;
end;
$$;

-- A person at the job's account, in their business role, as publicly listed.
create function public.agent_save_contact(
  p_job_id     uuid,
  p_full_name  text,
  p_title      text default null,
  p_email      text default null,
  p_phone      text default null,
  p_source_url text default null,
  p_quote      text default null,
  p_verified   boolean default false
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_job public.agent_jobs := public.agent_job(p_job_id);
  v_id  uuid;
begin
  if v_job.kind <> 'enrich' then
    raise exception 'Contacts are saved by a research job.' using errcode = 'P0001';
  end if;
  if coalesce(p_source_url, '') !~* '^https?://' or length(trim(coalesce(p_quote, ''))) = 0 then
    raise exception 'A contact needs the page that names them and the words that do.' using errcode = '22023';
  end if;
  select c.id into v_id from public.contacts c
   where c.account_id = v_job.account_id and lower(trim(c.full_name)) = lower(trim(p_full_name));
  if v_id is not null then
    update public.contacts
       set title = coalesce(title, p_title), email = coalesce(email, p_email), phone = coalesce(phone, p_phone)
     where id = v_id;
    return v_id;
  end if;
  insert into public.contacts (account_id, full_name, title, email, phone, source_url, quote, verified, job_id)
  values (v_job.account_id, trim(p_full_name), p_title, p_email, p_phone, p_source_url, p_quote,
          coalesce(p_verified, false), p_job_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- The job's verdict on its account: score, reasons, the reason to talk, and
-- any blank contact details it can fill. What a person typed is kept.
create function public.agent_save_enrichment(
  p_job_id      uuid,
  p_fit_score   integer,
  p_fit_reasons text,
  p_hook        text,
  p_fields      jsonb default '{}'::jsonb
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_job public.agent_jobs := public.agent_job(p_job_id);
  v_f   jsonb := coalesce(p_fields, '{}'::jsonb);
begin
  if v_job.kind <> 'enrich' then
    raise exception 'Only a research job scores an account.' using errcode = 'P0001';
  end if;
  if length(trim(coalesce(p_hook, ''))) = 0 or length(trim(coalesce(p_fit_reasons, ''))) = 0 then
    raise exception 'A score comes with its reasons and the reason to talk.' using errcode = '22023';
  end if;
  update public.accounts
     set fit_score = p_fit_score, fit_reasons = trim(p_fit_reasons), hook = trim(p_hook), enriched_at = now(),
         website = coalesce(website, nullif(trim(v_f ->> 'website'), '')),
         phone = coalesce(phone, nullif(trim(v_f ->> 'phone'), '')),
         address = coalesce(address, nullif(trim(v_f ->> 'address'), '')),
         country = coalesce(country, nullif(trim(v_f ->> 'country'), ''))
   where id = v_job.account_id;
end;
$$;

-- A proposal from the job, of the kind that job makes.
create function public.agent_propose(
  p_job_id  uuid,
  p_kind    public.proposal_kind,
  p_summary text,
  p_payload jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_job public.agent_jobs := public.agent_job(p_job_id);
  v_id  uuid;
begin
  if (v_job.kind, p_kind) not in (('thesis', 'thesis'), ('sources', 'source'),
                                  ('follow_up', 'next_step'), ('lessons', 'lesson')) then
    raise exception 'This job does not make that kind of proposal.' using errcode = 'P0001';
  end if;
  perform public.proposal_check(p_kind, p_payload);
  if p_kind = 'source' and exists (select 1 from public.market_sources s
                                    where s.market_id = v_job.market_id
                                      and lower(s.url) = lower(trim(p_payload ->> 'url'))) then
    raise exception 'That source is already on this market.' using errcode = '23505';
  end if;
  -- A thesis or next step replaces the one this job proposed before.
  if p_kind in ('thesis', 'next_step') then
    delete from public.proposals where job_id = p_job_id and kind = p_kind and decision = 'pending';
  end if;
  if (select count(*) from public.proposals where job_id = p_job_id) >= 25 then
    raise exception 'A job makes at most 25 proposals.' using errcode = 'P0001';
  end if;
  insert into public.proposals (job_id, kind, market_id, account_id, summary, payload)
  values (p_job_id, p_kind, v_job.market_id, v_job.account_id, left(coalesce(p_summary, ''), 500), p_payload)
  returning id into v_id;
  return v_id;
end;
$$;

-- A collector for the job's source: new, or a new version of the one with
-- this slug. Either way it waits for a person before it can run.
create function public.agent_propose_collector(
  p_job_id      uuid,
  p_slug        text,
  p_name        text,
  p_description text,
  p_hosts       text[],
  p_terms_note  text,
  p_code        text,
  p_sample      jsonb default '[]'::jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_job public.agent_jobs := public.agent_job(p_job_id);
  v_id  uuid;
begin
  if v_job.kind <> 'collector_build' then
    raise exception 'Only a collector build proposes a collector.' using errcode = 'P0001';
  end if;
  insert into public.collectors (slug, name, description, hosts, terms_note, code, sample)
  values (p_slug, trim(p_name), coalesce(p_description, ''), p_hosts, coalesce(p_terms_note, ''), p_code,
          coalesce(p_sample, '[]'::jsonb))
  on conflict (slug) do update
    set name = excluded.name, description = excluded.description, hosts = excluded.hosts,
        terms_note = excluded.terms_note, code = excluded.code, sample = excluded.sample,
        version = public.collectors.version + 1, status = 'proposed',
        decided_by = null, decided_at = null, decided_note = null, updated_at = now()
  returning id into v_id;
  update public.market_sources set collector_id = v_id where id = v_job.source_id;
  return v_id;
end;
$$;

-- The rows a collect job read, as candidates. A row already in the market
-- (same name, city and state) is left alone. Returns how many were new.
create function public.agent_save_candidates(p_job_id uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job      public.agent_jobs := public.agent_job(p_job_id);
  v_total    integer;
  v_inserted integer;
begin
  if v_job.kind <> 'collect' then
    raise exception 'Only a collect job saves candidates.' using errcode = 'P0001';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Send up to 2,000 rows at a time.' using errcode = '22023';
  end if;
  v_total := jsonb_array_length(p_rows);
  with rows as (
    select distinct on (public.account_key(r ->> 'name', r ->> 'city', r ->> 'state')) r
      from jsonb_array_elements(p_rows) r
     where length(trim(coalesce(r ->> 'name', ''))) between 1 and 200
  ), added as (
    insert into public.accounts (market_id, name, website, phone, address, city, state, country,
                                 source_id, source_url, raw)
    select v_job.market_id, trim(r ->> 'name'), nullif(trim(r ->> 'website'), ''), nullif(trim(r ->> 'phone'), ''),
           nullif(trim(r ->> 'address'), ''), nullif(trim(r ->> 'city'), ''), nullif(trim(r ->> 'state'), ''),
           nullif(trim(r ->> 'country'), ''), v_job.source_id, nullif(trim(r ->> 'source_url'), ''),
           jsonb_build_object('text', left(r ->> 'raw', 2000))
      from rows
    on conflict (market_id, dedupe_key) do nothing
    returning 1
  )
  select count(*) into v_inserted from added;

  update public.collectors
     set last_run_at = now(), last_rows = v_total,
         health = case when v_total = 0 then 'empty' else 'ok' end, last_error = null
   where id = v_job.collector_id;
  return jsonb_build_object('received', v_total, 'new', v_inserted, 'already_known', v_total - v_inserted);
end;
$$;

create function public.agent_save_draft(
  p_job_id     uuid,
  p_channel    public.draft_channel,
  p_subject    text,
  p_body       text,
  p_contact_id uuid default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_job public.agent_jobs := public.agent_job(p_job_id);
  v_id  uuid;
begin
  if v_job.kind <> 'draft' then
    raise exception 'Only a draft job writes a draft.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.accounts where id = v_job.account_id and do_not_contact) then
    raise exception 'This account is marked do not contact.' using errcode = 'P0001';
  end if;
  if p_contact_id is not null and not exists (select 1 from public.contacts
                                               where id = p_contact_id and account_id = v_job.account_id) then
    raise exception 'That contact is not at this account.' using errcode = 'P0001';
  end if;
  insert into public.drafts (account_id, contact_id, channel, subject, body, original_body, job_id)
  values (v_job.account_id, p_contact_id, p_channel, nullif(trim(coalesce(p_subject, '')), ''),
          trim(p_body), trim(p_body), p_job_id)
  returning id into v_id;
  return v_id;
end;
$$;

-- Ends the job: done, failed, or needs a person (a bot check, a login wall).
create function public.agent_finish(
  p_job_id     uuid,
  p_status     public.job_status,
  p_summary    text default null,
  p_error      text default null,
  p_tokens_in  bigint default 0,
  p_tokens_out bigint default 0,
  p_cost_usd   numeric default 0
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_job public.agent_jobs := public.agent_job(p_job_id);
begin
  if p_status not in ('done', 'failed', 'needs_person') then
    raise exception 'A job ends done, failed or needing a person.' using errcode = 'P0001';
  end if;
  update public.agent_jobs
     set status = p_status, finished_at = now(), summary = left(p_summary, 2000), error = left(p_error, 2000),
         tokens_in = greatest(coalesce(p_tokens_in, 0), 0), tokens_out = greatest(coalesce(p_tokens_out, 0), 0),
         cost_usd = greatest(coalesce(p_cost_usd, 0), 0)
   where id = p_job_id;
  if v_job.kind = 'collect' and p_status <> 'done' then
    update public.collectors
       set last_run_at = now(), health = 'error', last_error = left(p_error, 2000)
     where id = v_job.collector_id;
  end if;
  perform public.run_refresh(v_job.run_id);
end;
$$;

-- Hands a job back untouched: the worker hit its Claude usage limit, or is
-- shutting down. It waits again, and the try is not counted.
create function public.agent_release(p_job_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_job public.agent_jobs := public.agent_job(p_job_id);
begin
  insert into public.agent_job_events (job_id, kind, body)
  values (p_job_id, 'warn', left(coalesce(nullif(trim(p_reason), ''), 'Handed back by the worker.'), 2000));
  update public.agent_jobs
     set status = 'queued', worker_id = null, claimed_at = null, heartbeat_at = null,
         attempts = greatest(attempts - 1, 0)
   where id = p_job_id;
  perform public.run_refresh(v_job.run_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant select, delete on public.profiles to authenticated;
-- user_id is deliberately not writable by clients.
grant insert (full_name, email, login_method, role, active),
      update (full_name, email, login_method, role, active) on public.profiles to authenticated;
grant select on public.profile_directory to authenticated;

grant select on public.playbook_sections to authenticated;
grant update (body) on public.playbook_sections to authenticated;

grant select, delete on public.markets to authenticated;
grant insert (name, region, brief), update (name, region, brief, thesis, status) on public.markets to authenticated;

grant select on public.collectors to authenticated;

grant select, delete on public.market_sources to authenticated;
grant insert (market_id, name, url, kind, why, terms_note),
      update (name, kind, why, terms_note, selected) on public.market_sources to authenticated;

-- review, stage, the score and the derived columns are not client-writable.
grant select on public.accounts to authenticated;
grant insert (market_id, name, website, phone, address, city, state, country),
      update (name, website, phone, address, city, state, country, hook, do_not_contact, service_line, est_value)
  on public.accounts to authenticated;

grant select, delete on public.contacts to authenticated;
grant insert (account_id, full_name, title, email, phone, linkedin_url),
      update (full_name, title, email, phone, linkedin_url) on public.contacts to authenticated;

grant select on public.agent_runs, public.agent_jobs, public.agent_job_events, public.account_facts,
                public.proposals to authenticated;

grant select, delete on public.lessons to authenticated;
grant insert (market_id, body) on public.lessons to authenticated;

grant select, delete on public.drafts to authenticated;
grant insert (account_id, contact_id, channel, subject, body),
      update (contact_id, subject, body) on public.drafts to authenticated;

grant select on public.activities to authenticated;
grant insert (account_id, kind, body) on public.activities to authenticated;

grant select on public.workers to authenticated;
grant update (owner_id) on public.workers to authenticated;

-- Helpers the policies call, and the RPCs. Trigger functions, run_refresh,
-- account_set_stage, proposal_check, agent_job and agent_job_context are
-- internal: no one is granted them.
grant execute on function
  public.current_profile_id(), public.current_app_role(), public.is_admin(), public.is_growth(),
  public.is_agent(), public.bind_profile(),
  public.valid_public_host(text), public.valid_public_hosts(text[]),
  public.account_domain(text), public.account_key(text, text, text),
  public.run_start(public.run_kind, uuid, uuid[], uuid, jsonb), public.run_cancel(uuid),
  public.accounts_review(uuid[], public.account_review),
  public.account_move(uuid, public.account_stage, text),
  public.fact_reject(uuid, boolean),
  public.proposal_decide(uuid, boolean, jsonb, text),
  public.collector_decide(uuid, public.collector_status, text),
  public.draft_mark(uuid, public.draft_status),
  public.agent_heartbeat(public.worker_state, jsonb), public.agent_claim(),
  public.agent_event(uuid, text, text),
  public.agent_save_fact(uuid, public.fact_kind, text, text, text, text, text, boolean),
  public.agent_save_contact(uuid, text, text, text, text, text, text, boolean),
  public.agent_save_enrichment(uuid, integer, text, text, jsonb),
  public.agent_propose(uuid, public.proposal_kind, text, jsonb),
  public.agent_propose_collector(uuid, text, text, text, text[], text, text, jsonb),
  public.agent_save_candidates(uuid, jsonb),
  public.agent_save_draft(uuid, public.draft_channel, text, text, uuid),
  public.agent_finish(uuid, public.job_status, text, text, bigint, bigint, numeric),
  public.agent_release(uuid, text)
  to authenticated;

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant execute on function public.auth_user_ids_by_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.playbook_sections enable row level security;
alter table public.markets enable row level security;
alter table public.collectors enable row level security;
alter table public.market_sources enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_jobs enable row level security;
alter table public.agent_job_events enable row level security;
alter table public.account_facts enable row level security;
alter table public.proposals enable row level security;
alter table public.lessons enable row level security;
alter table public.drafts enable row level security;
alter table public.activities enable row level security;
alter table public.workers enable row level security;

-- Profiles: admins see and edit all; everyone else sees only themselves.
create policy profiles_select on public.profiles for select to authenticated
  using ((select public.is_admin()) or id = (select public.current_profile_id()));
create policy profiles_insert on public.profiles for insert to authenticated
  with check ((select public.is_admin()));
create policy profiles_update on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy profiles_delete on public.profiles for delete to authenticated
  using ((select public.is_admin()) and id <> (select public.current_profile_id()));

-- Everything about prospecting is the growth team's (admin or growth). A
-- worker, a member and the agency match none of these.
create policy playbook_sections_select on public.playbook_sections for select to authenticated
  using ((select public.is_growth()));
create policy playbook_sections_update on public.playbook_sections for update to authenticated
  using ((select public.is_growth())) with check ((select public.is_growth()));

create policy markets_select on public.markets for select to authenticated
  using ((select public.is_growth()));
create policy markets_insert on public.markets for insert to authenticated
  with check ((select public.is_growth()));
create policy markets_update on public.markets for update to authenticated
  using ((select public.is_growth())) with check ((select public.is_growth()));
-- Refused by the accounts foreign key once the market has any.
create policy markets_delete on public.markets for delete to authenticated
  using ((select public.is_admin()));

create policy collectors_select on public.collectors for select to authenticated
  using ((select public.is_growth()));

create policy market_sources_select on public.market_sources for select to authenticated
  using ((select public.is_growth()));
create policy market_sources_insert on public.market_sources for insert to authenticated
  with check ((select public.is_growth()));
create policy market_sources_update on public.market_sources for update to authenticated
  using ((select public.is_growth())) with check ((select public.is_growth()));
create policy market_sources_delete on public.market_sources for delete to authenticated
  using ((select public.is_growth()));

create policy accounts_select on public.accounts for select to authenticated
  using ((select public.is_growth()));
create policy accounts_insert on public.accounts for insert to authenticated
  with check ((select public.is_growth()));
create policy accounts_update on public.accounts for update to authenticated
  using ((select public.is_growth())) with check ((select public.is_growth()));

create policy contacts_select on public.contacts for select to authenticated
  using ((select public.is_growth()));
create policy contacts_insert on public.contacts for insert to authenticated
  with check ((select public.is_growth()));
create policy contacts_update on public.contacts for update to authenticated
  using ((select public.is_growth())) with check ((select public.is_growth()));
create policy contacts_delete on public.contacts for delete to authenticated
  using ((select public.is_growth()));

create policy agent_runs_select on public.agent_runs for select to authenticated
  using ((select public.is_growth()));
create policy agent_jobs_select on public.agent_jobs for select to authenticated
  using ((select public.is_growth()));
create policy agent_job_events_select on public.agent_job_events for select to authenticated
  using ((select public.is_growth()));
create policy account_facts_select on public.account_facts for select to authenticated
  using ((select public.is_growth()));
create policy proposals_select on public.proposals for select to authenticated
  using ((select public.is_growth()));

create policy lessons_select on public.lessons for select to authenticated
  using ((select public.is_growth()));
create policy lessons_insert on public.lessons for insert to authenticated
  with check ((select public.is_growth()));
create policy lessons_delete on public.lessons for delete to authenticated
  using ((select public.is_growth()));

create policy drafts_select on public.drafts for select to authenticated
  using ((select public.is_growth()));
create policy drafts_insert on public.drafts for insert to authenticated
  with check ((select public.is_growth()));
-- A sent draft is the record of what went out.
create policy drafts_update on public.drafts for update to authenticated
  using ((select public.is_growth()) and status <> 'sent') with check ((select public.is_growth()));
create policy drafts_delete on public.drafts for delete to authenticated
  using ((select public.is_growth()) and status <> 'sent');

create policy activities_select on public.activities for select to authenticated
  using ((select public.is_growth()));
-- The timeline's other kinds (stage, draft sent, review) come from the RPCs.
create policy activities_insert on public.activities for insert to authenticated
  with check ((select public.is_growth()) and kind in ('note', 'reply', 'call'));

create policy workers_select on public.workers for select to authenticated
  using ((select public.is_growth()));
create policy workers_update on public.workers for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- The playbook's sections (fixed; people fill in the text)
-- ---------------------------------------------------------------------------
insert into public.playbook_sections (key, title, hint, sort_order, body) values
  ('positioning', 'Who we are',
   'One or two sentences a stranger would understand. What Elevance Labs is and who it is for.', 10,
   'Elevance Labs is a software team. We are an easy-to-work-with, trusted transformation partner for neglected, traditional, family-run businesses: the industries most software companies pass over.'),
  ('directions', 'Where we are going',
   'The directions the company is building in. The agent uses these to judge fit.', 20,
   E'1. Transformation partner to neglected, traditional and old family businesses.\n2. Product lab: one or two small products a quarter, to show our work and earn credibility.'),
  ('service_lines', 'What we sell',
   'The service lines, in plain words, with who each is for. Leave out what we do not want to sell.', 30, ''),
  ('proof', 'Proof',
   'Work we can point to: clients (only those we may name), products shipped, results with numbers. Drafts quote from here and nowhere else.', 40,
   'We are the offshore software team for a self-service auto recycling business in the United States.'),
  ('voice', 'How we sound',
   'Tone for outreach: length, formality, words we like. An example line or two helps.', 50,
   'Plain and short. Written by one person to another. No buzzwords, no hype, no pressure.'),
  ('never_say', 'Never say',
   'Claims, words and promises that must not appear in a draft.', 60, '');
