# CLAUDE.md — Project Map for AI Agents

Orientation for an agent planning work in this repo. **Read this first; read code
second.** It is deliberately high-level: modules, roles, boundaries and rules —
never line-level detail. Anything granular belongs in the code or `README.md`
(the human-facing product and setup doc, which stays the source of truth for
behaviour).

---

## 1. What this is

- In-house **prospecting** for Elevance Labs: sales as an agent with a UI, not
  a CRM. Sibling of `el-work`, `el-support` and `el-people`; `el-people` is
  its template (TypeScript, same shell and conventions).
- Built so far: **markets** (thesis, sources, dataset, runs), **accounts**
  (evidence, people, drafts, timeline), **pipeline**, **playbook** and
  lessons, the **collector library**, **runs**, **settings** (people,
  workers), and the **worker** that does the agent's jobs.
- Planned, not built: content calendar (the agency's screen), product ideas
  and their hand-over to Work, platform analytics.
- Stack: **React 19 + Vite + MUI + TypeScript**, **Supabase** (Postgres + RLS,
  Auth). One Edge Function (`set-password`, deployed by hand). The **worker**
  (`worker/`) is a Node program on a company computer that runs **Claude
  Code** under that person's subscription; no Anthropic API key anywhere.
- Deployed as a static SPA to **GitHub Pages**; `HashRouter`.

## 2. Ground rules an agent must not break

- **Security is enforced in the database, not the UI.** Every role check in
  the app (`isAdmin`, `isGrowth`, nav and route gating) is mirrored by RLS,
  column grants or a function. `test/sql/` proves it against a real Postgres.
- **The anon key is public.** Every table revokes `anon`; nothing is reachable
  without a bound, active profile.
- **Login is bound by email and sign-in method** (`bind_profile`): Google on
  the company domain, or a confirmed password user on an outside address.
  Only admins write profiles; the last active admin stays (`profiles_guard`).
- **Three kinds of caller.** People (`admin`, `growth`): RLS and RPCs. The
  **worker** (`agent`): no table access at all, only the `agent_*` RPCs, and
  each write only for the job it claimed and is still running (`agent_job`).
  Others (`member`, `agency`): sign in, match no policy.
- **Agents propose, people decide.** Agent output changes the record only
  through a person: `proposal_decide` (thesis, source, next step, lesson),
  `accounts_review` (collected candidates), `collector_decide` (admins).
  A research job writes facts, contacts and the score directly: they are
  evidence, and the person's decision is the stage move.
- **Some state changes only through RPCs.** Runs and jobs are made only by
  `run_start` and stopped by `run_cancel`. A stage moves only through
  `account_move` (lost and parked need a reason), an accepted next step, or
  a draft marked sent. Review, stage, score and the derived columns are not
  client-writable. A draft is marked copied or sent only by `draft_mark`. A
  fact is set aside only by `fact_reject` (kept, never deleted).
- **Evidence is checked by code, not the model.** `worker/tools.ts` saves an
  observed fact only after the worker has fetched the page itself and found
  the quoted words (`lib/verify.ts`): found → verified; page unreadable →
  saved unverified; page read and words absent → dropped. The database
  refuses an observed fact with no page and quote, and never lets an
  inference be verified. Do not add a path that lets the model set
  `verified`.
- **Model-written code runs only sandboxed, and for real only once approved.**
  A collector's code lives in `collectors`; the worker is handed it only
  while `approved` (`agent_job_context`); a changed collector is a new
  version, proposed again. `worker/collector.ts` runs it under Deno with
  network to its declared hosts only. Hosts are public DNS names
  (`valid_public_host`, mirrored in `worker/lib/hosts.ts`): never widen that.
- **Web content is untrusted, everywhere.** In prompts it sits inside `<data>`
  tags (`worker/prompts.ts`); the worker's own fetch refuses private
  addresses and re-checks redirects (`worker/fetch.ts`); the app renders
  stored text as text and makes links only through `safeUrl`.
- **Claude Code gets only the job's tools** (`worker/claude.ts`): the job's
  Grow tools by name, web search and fetch for jobs that read the web,
  `--strict-mcp-config`. Never the shell or files. The prompt goes in on
  stdin, never on a command line.
- **Nothing leaves the app.** No email, post or message is sent. LinkedIn is
  never read: the app only links to a search for a person to open.
- **One shell, four apps.** Theme, layout, switcher, splash, install and
  update prompt match Work, Support and People. A change to either belongs in
  all four.
- **Light, dark or system**; colours from the palette; a fixed hex is for
  brand or data only.
- **The built page locks itself down.** CSP added at build (`vite.config.ts`),
  refuses to run framed (`main.tsx`). A new external host is added to that
  policy; `script-src` is never widened. No `console` in `src/` (lint).
- **Column-level grants are the write allow-list.**

## 3. Layout

| Path | Role |
|---|---|
| `src/pages/` | One file per route. Fetches its own data, owns page state. |
| `src/components/` | Shared UI: app shell, `Agent.tsx` (runs, proposals, worker notice), common pieces. |
| `src/auth/` | `AuthProvider` — session, profile binding, role flags. |
| `src/lib/` | Supabase client, types, constants, the data hook, runs and accounts helpers. |
| `worker/` | The worker: main loop, Claude Code launcher, tool server, prompts, collector sandbox. |
| `worker/lib/` | Pure code, tested: cleaning rows, host rules, the quote check. |
| `worker/sandbox/` | `helpers.ts`: all a collector may import (runs under Deno). |
| `supabase/migrations/` | Ordered, timestamped changes, applied by `supabase db push`. |
| `supabase/functions/` | Edge Functions (Deno), deployed by hand. |
| `supabase/schema.sql` | The whole current database in one file. Kept in step with the migrations. |
| `scripts/` | `check-schema.sh`, `test-sql.sh`, `pg-sandbox.sh` (a throwaway Postgres). |
| `test/` | Behaviour tests (`vite-node`, jsdom, in-memory Supabase mock); `worker.test.ts`. |
| `test/sql/` | The database's own tests: RLS, grants, triggers and RPCs, as real people. |

## 4. Routes and pages

- No session → `Login` (Google; email and password with a reset link). A
  worker login is refused by the app.
- `/today` — growth: what waits for a decision (proposals, collectors to
  approve, candidates, researched accounts, drafts, quiet accounts, runs).
- `/markets` — growth: list, new market. `/markets/:id` — tabs in `?tab=`:
  *Thesis* (brief, thesis, market lessons), *Sources* (proposals, tick,
  build collector, collect), *Dataset* (`?review=`; accept / reject, research,
  draft outreach), *Runs*.
- `/accounts/:id` — growth: reason to talk, evidence, people, drafts,
  details, timeline; stage menu.
- `/pipeline` — growth: accepted accounts by stage (`?market=`).
- `/playbook` — growth: the six sections and general lessons.
- `/sources` — growth: collector library; approve / retire is admin only.
- `/runs` — growth: every run with its steps.
- `/settings` — admin: people, workers.
- `/welcome` — member and agency: nothing yet.
- Unknown paths redirect to `/today` (growth) or `/welcome`.
- Gating is by **not registering** routes in `src/App.tsx`; the nav in
  `components/Layout.tsx` hides the same items (`growthOnly`, `adminOnly`,
  `othersOnly`).

## 5. Shared state

| Provider | Supplies | Scope |
|---|---|---|
| `AuthProvider` | `loading`, `profile`, `error`, `isAdmin`, `isGrowth`, `recovering`, `endRecovery`, `signIn`, `signInWithPassword`, `signOut` | Whole app |

- A session alone is not a login: the provider calls `bind_profile`; no row
  back → error and signed out.
- No other global state. Pages load what they need with `useLoad`
  (`lib/data.ts`) and **poll only while a run is open**; no Realtime.

## 6. Modules

- `lib/supabase.ts` — the shared client (PKCE).
- `lib/types.ts` — row shapes. Update with any column change.
- `lib/constants.ts` — labels and colours for every enum, stages in board
  order, formatters, Postgres error messages.
- `lib/data.ts` — `useLoad` (load, reload, optional polling) and `POLL_MS`.
- `lib/runs.ts` — start and cancel a run, runs with their jobs (two reads, no
  embed), progress, the open job for a target, worker online / notice.
- `lib/accounts.ts` — place, score colour, `safeUrl`, the LinkedIn search
  link, standing facts and counts, awaits-decision and gone-quiet rules.
- `lib/suite.ts`, `lib/install.ts`, `lib/passwordLogin.ts` — as in People.
- `components/Agent.tsx` — job status chip, `WorkerNotice`, `SourceLink`,
  `RunList` / `RunDialog`, `ProposalCard` (accept, change and accept, reject).
- `components/Layout.tsx`, `AppSwitcher`, `ThemeModeSwitch`, `InstallApp`,
  `UpdatePrompt`, `common.tsx` — the shell, as in People.
- `worker/main.ts` — sign in, heartbeat, claim, run, finish; hands a job back
  on a usage limit or shutdown.
- `worker/claude.ts` — Claude Code's arguments, spawning it, reading its
  result (tokens, usage limit, signed out).
- `worker/mcp.ts` — the tool server Claude Code starts for a job.
- `worker/tools.ts` — the tools per job kind, the evidence check, how a job's
  outcome is decided.
- `worker/prompts.ts` — the brief per job kind.
- `worker/collector.ts` — the Deno sandbox run. `worker/fetch.ts` — the
  worker's own page read. `worker/config.ts` — `worker/.env`.

## 7. Data model (conceptual)

Full detail in `supabase/schema.sql`.

- **Roles** — `app_role` on the profile: `admin`, `growth`, `member`,
  `agency`, `agent`. `is_growth` = admin or growth.
- `profiles` — the person (or worker) and their login. `user_id` set only by
  `bind_profile`. `profile_directory` — names for growth (no emails).
- `playbook_sections` — six fixed sections (seeded); growth writes the text.
- `lessons` — one sentence each, general or one market's.
- `markets` — industry and region (unique), brief, thesis and its sources.
- `market_sources` — where a market's businesses are listed; ticked by a
  person; may link a collector.
- `collectors` — slug, hosts, terms note, code, version, status (`proposed`
  → `approved` / `retired`), sample, last run and health. No client writes.
- `accounts` — a business in a market. `review` (candidate → accepted /
  rejected), `stage`, fit score and reasons, hook, do-not-contact, deal
  fields. `dedupe_key` (name, city, state; `account_key`) unique per market.
  Added by hand → accepted at once.
- `contacts` — people at an account, with the page and words that name them.
- `account_facts` — observed (page, quote, context, verified) or inferred.
- `agent_runs` → `agent_jobs` → `agent_job_events` — what a person asked,
  the queue units, the steps. A run's status follows its jobs
  (`run_refresh`).
- `proposals` — agent output awaiting a decision; `final` keeps what a
  person changed.
- `drafts` — outreach to copy out; `original_body` keeps the agent's text.
- `activities` — the account's timeline; people write note / reply / call,
  the RPCs write the rest.
- `workers` — one heartbeat row per agent profile; optional owner.

## 8. How things connect

- Sign-in: Google or password → `bind_profile` → role flags.
- A run: page calls `run_start` → `agent_jobs` rows → the worker's
  `agent_claim` (oldest job it may do, with its whole context) → for
  `collect`, the approved script in the sandbox and `agent_save_candidates`;
  for the rest, Claude Code with the job's tools → `agent_finish` → the page,
  polling, sees the run move and reloads.
- A silent worker's job is requeued by the next `agent_claim` (three tries).
  A usage limit hands the job back (`agent_release`) and the worker waits.
- Evidence: `save_fact` tool → worker fetches the page → words found →
  `agent_save_fact` verified.
- Collector: `collector_build` job → `agent_propose_collector` (with the
  worker's own sample) → admin `collector_decide` → `collect` jobs.
- Timeline: a reply or call notes inserted → the page starts a `follow_up`
  run → `next_step` proposal → accepted → stage moves.
- Lessons: stage reasons and reviews → `lessons` run → proposals → accepted
  → read by every later job (`agent_job_context`).

## 9. Working in the repo

- **yarn** (v1) only.
- `yarn dev` · `yarn build` · `yarn lint` (warnings fail) · `yarn typecheck`
  (app, tests, worker) · `yarn test` · `yarn test:sql` · `yarn check:schema`
  · `yarn worker`.
- CI runs lint, typecheck, test and build. `test:sql` and `check:schema` are
  local (need Postgres binaries on `PATH`).
- The worker runs as plain Node (type stripping): **erasable TypeScript
  only**, relative imports with their `.ts` extension, `import type` for
  types. `worker/lib/` and `worker/sandbox/` stay free of Node APIs.
- Tests are **behavioural**: who is offered what, and exactly what is sent.
  `test/mockSupabase.ts` does not enforce RLS; `test/sql/` does. Add to both
  when changing a rule, a role boundary or a write.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SUITE_*_URL`
  (app); `worker/.env` (worker, see `worker/.env.example`).

## 10. Changing the database

Every schema change is **three edits in the same change**: a new migration
(never edit a shipped one), the same end state folded into
`supabase/schema.sql`, and `src/lib/types.ts`. Then `yarn check:schema` and
`yarn test:sql`. Per migration: grants for new columns, RLS on new tables
(revoke first), `set search_path = ''` and schema-qualified names, and
**revoke execute** on every new function, granting only what clients call
(a new `agent_*` function must start with `agent_job`). Mirror the change in
`test/mockSupabase.ts` and cover it in `test/` and `test/sql/`.

## 11. Keeping the docs current

`CLAUDE.md`, `README.md`, `supabase/schema.sql` and the tests ship in the same
change as the code they describe. Update `README.md` for anything a person
using, setting up or deploying would notice; update this file for routes,
roles, tables, functions, the worker's boundaries, commands, or how modules
connect. Keep it pointers, not prose; never paste code or column lists.
