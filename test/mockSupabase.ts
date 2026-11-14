// Stands in for src/lib/supabase in every test (see test/vite.config.ts).
//
// An in-memory database the pages read and write like the real one: filters
// are applied, writes change the rows, and a reload sees them. Every call is
// recorded in `captured` — failed ones too — so a test can assert what the
// app asked for, and `failNext` makes the next matching call fail the way
// Postgres would, so the error paths can be driven too.
//
// What it cannot do is enforce RLS, grants or triggers. Those are the
// database's job, and test/sql/ proves them against a real Postgres; these
// tests prove the app asks for the right things and handles the answers.
import type { AppRole, Profile } from '../src/lib/types'

type Row = Record<string, unknown>
export interface PgError {
  code?: string
  message: string
}
interface Result {
  data: unknown
  error: PgError | null
  count?: number
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()
const DAY = 60 * 24

function person(id: string, full_name: string, email: string, role: AppRole, extra: Partial<Profile> = {}): Profile {
  return {
    id, user_id: `auth-${id}`, full_name, email, role, active: true,
    login_method: email.endsWith('@elevancelabs.com') ? 'google' : 'password',
    created_at: ago(90 * DAY), updated_at: ago(90 * DAY), ...extra,
  }
}

export const PEOPLE = {
  admin: person('p-amna', 'Amna Khan', 'amna@elevancelabs.com', 'admin'),
  growth: person('p-sara', 'Sara Iqbal', 'sara@elevancelabs.com', 'growth'),
  member: person('p-omar', 'Omar Farooq', 'omar@elevancelabs.com', 'member'),
  agency: person('p-kim', 'Kim Lee', 'kim@brightagency.co', 'agency'),
}
export const WORKER = person('p-pc', 'Home PC', 'home-pc@grow-worker.dev', 'agent')

const PLAYBOOK: Row[] = [
  ['positioning', 'Who we are', 'What Elevance Labs is and who it is for.', 'We are a software team for family-run businesses.'],
  ['directions', 'Where we are going', 'The directions the company is building in.', 'Transformation partner; product lab.'],
  ['service_lines', 'What we sell', 'The service lines, in plain words.', ''],
  ['proof', 'Proof', 'Work we can point to.', 'We run the software for a self-service auto recycler.'],
  ['voice', 'How we sound', 'Tone for outreach.', 'Plain and short.'],
  ['never_say', 'Never say', 'Claims that must not appear in a draft.', ''],
].map(([key, title, hint, body], i) => ({
  id: `pb-${key}`, key, title, hint, body, sort_order: (i + 1) * 10, updated_by: null, updated_at: ago(30 * DAY),
}))

const THESIS = 'Self-service scrap yards buy end-of-life vehicles and let customers pull their own parts. Most are family owned.'

const MARKETS: Row[] = [
  { id: 'm-scrap', name: 'Scrap yards', region: 'Ohio', brief: 'Family-run, no online inventory', thesis: THESIS,
    thesis_sources: [{ url: 'https://a-r-a.org/about', title: 'ARA' }], status: 'active', created_by: 'p-sara', created_at: ago(20 * DAY), updated_at: ago(20 * DAY) },
  { id: 'm-tow', name: 'Towing', region: 'Texas', brief: '', thesis: null, thesis_sources: [], status: 'draft',
    created_by: 'p-sara', created_at: ago(2 * DAY), updated_at: ago(2 * DAY) },
]

const COLLECTORS: Row[] = [
  { id: 'c-bmv', slug: 'ohio-bmv', name: 'Ohio BMV salvage dealers', description: 'Reads the public dealer list.', hosts: ['bmv.ohio.gov'],
    terms_note: 'Public record.', code: 'export default async function collect() { return [] }', version: 1, status: 'approved',
    sample: [{ name: 'Buckeye Pick-n-Pull', city: 'Dayton', state: 'OH' }], decided_by: 'p-amna', decided_at: ago(10 * DAY), decided_note: null,
    last_run_at: ago(9 * DAY), last_rows: 212, health: 'ok', last_error: null, created_at: ago(11 * DAY), updated_at: ago(10 * DAY) },
  { id: 'c-ara', slug: 'ara-members', name: 'ARA member directory', description: 'Reads the member directory pages.', hosts: ['a-r-a.org', 'cdn.a-r-a.org'],
    terms_note: 'Robots file allows the directory.', code: "import { getText } from './helpers.ts'\nexport default async function collect() { return [] }", version: 2, status: 'proposed',
    sample: [{ name: 'Miller & Sons Salvage', city: 'Lima', state: 'OH', source_url: 'https://a-r-a.org/members?p=1' }], decided_by: null, decided_at: null,
    decided_note: null, last_run_at: null, last_rows: null, health: null, last_error: null, created_at: ago(DAY), updated_at: ago(DAY) },
]

const SOURCES: Row[] = [
  { id: 's-bmv', market_id: 'm-scrap', name: 'Ohio BMV salvage dealers', url: 'https://bmv.ohio.gov/dealers', kind: 'register', why: 'Every licensed yard.',
    terms_note: 'Public record.', collector_id: 'c-bmv', selected: true, created_by: 'p-sara', created_at: ago(12 * DAY) },
  { id: 's-ara', market_id: 'm-scrap', name: 'ARA member directory', url: 'https://a-r-a.org/members', kind: 'directory', why: 'Association members.',
    terms_note: '', collector_id: 'c-ara', selected: true, created_by: 'p-sara', created_at: ago(11 * DAY) },
  { id: 's-oatra', market_id: 'm-scrap', name: 'OATRA members', url: 'https://oatra.org/members', kind: 'directory', why: 'State association.',
    terms_note: '', collector_id: null, selected: true, created_by: 'p-sara', created_at: ago(10 * DAY) },
]

function account(id: string, name: string, city: string, extra: Row = {}): Row {
  return {
    id, market_id: 'm-scrap', name, website: null, domain: null, phone: null, address: null, city, state: 'OH', country: null,
    review: 'accepted', stage: 'researching', fit_score: null, fit_reasons: null, hook: null, enriched_at: null, do_not_contact: false,
    service_line: null, est_value: null, source_id: 's-bmv', source_url: 'https://bmv.ohio.gov/dealers?p=1', raw: { text: `${name.toUpperCase()} ${city.toUpperCase()}` },
    dedupe_key: `${name.toLowerCase()}|${city.toLowerCase()}|oh`, stage_changed_at: ago(8 * DAY), last_activity_at: null,
    created_at: ago(9 * DAY), updated_at: ago(9 * DAY), ...extra,
  }
}

const ACCOUNTS: Row[] = [
  account('a-buckeye', 'Buckeye Pick-n-Pull', 'Dayton', {
    website: 'https://buckeyepnp.com', domain: 'buckeyepnp.com', phone: '937-555-0100', fit_score: 82,
    fit_reasons: 'Family owned, dated site, phone only.', hook: 'Their site has not changed since 2014 and has no inventory search.', enriched_at: ago(3 * DAY) }),
  account('a-bobs', "Bob's Auto Parts", 'Toledo'),
  account('a-talk', 'Lakeside U-Pull', 'Sandusky', { stage: 'talking', fit_score: 74, hook: 'Two yards, one phone line.', enriched_at: ago(15 * DAY),
    stage_changed_at: ago(12 * DAY), last_activity_at: ago(10 * DAY), est_value: 40000 }),
  account('a-dnc', 'Quiet Acres Salvage', 'Marion', { fit_score: 55, hook: 'Runs on paper tickets.', enriched_at: ago(4 * DAY), do_not_contact: true }),
  account('a-miller', 'Miller & Sons Salvage', 'Lima', { review: 'candidate' }),
  account('a-lima', 'Lima Auto Wrecking', 'Lima', { review: 'candidate', website: 'https://limawrecking.com', domain: 'limawrecking.com' }),
  account('a-no', 'Mega Chain Parts #41', 'Columbus', { review: 'rejected' }),
]

const FACTS: Row[] = [
  { id: 'f-1', account_id: 'a-buckeye', job_id: 'j-done', kind: 'observed', label: 'Site last updated', claim: 'The site footer says 2014.',
    source_url: 'https://buckeyepnp.com', quote: '© 2014 Buckeye Pick-n-Pull', context: '… All rights reserved © 2014 Buckeye Pick-n-Pull. Call us …',
    verified: true, read_at: ago(3 * DAY), rejected_at: null, rejected_by: null, created_at: ago(3 * DAY) },
  { id: 'f-2', account_id: 'a-buckeye', job_id: 'j-done', kind: 'observed', label: 'How to reach them', claim: 'Parts enquiries are by phone only.',
    source_url: 'https://buckeyepnp.com/contact', quote: 'Call the yard for parts availability', context: null,
    verified: false, read_at: ago(3 * DAY), rejected_at: null, rejected_by: null, created_at: ago(3 * DAY - 1) },
  { id: 'f-3', account_id: 'a-buckeye', job_id: 'j-done', kind: 'inferred', label: 'Online inventory', claim: 'Likely none: the site has no search.',
    source_url: null, quote: null, context: null, verified: false, read_at: null, rejected_at: null, rejected_by: null, created_at: ago(3 * DAY - 2) },
  { id: 'f-4', account_id: 'a-buckeye', job_id: 'j-done', kind: 'observed', label: 'Locations', claim: 'Has three yards.',
    source_url: 'https://buckeyepnp.com/about', quote: 'three convenient locations', context: null,
    verified: true, read_at: ago(3 * DAY), rejected_at: ago(2 * DAY), rejected_by: 'p-sara', created_at: ago(3 * DAY - 3) },
]

const CONTACTS: Row[] = [
  { id: 'ct-dale', account_id: 'a-buckeye', full_name: 'Dale Buck', title: 'Owner', email: null, phone: '937-555-0100', linkedin_url: null,
    source_url: 'https://buckeyepnp.com/about', quote: 'owned by Dale Buck since 1988', verified: true, job_id: 'j-done', created_by: null, created_at: ago(3 * DAY) },
]

const DRAFTS: Row[] = [
  { id: 'd-1', account_id: 'a-buckeye', contact_id: 'ct-dale', channel: 'email', subject: 'Your 2014 website', body: 'Hi Dale, I noticed your site has no inventory search.',
    original_body: 'Hi Dale, I noticed your site has no inventory search.', status: 'draft', job_id: null, created_by: null,
    created_at: ago(2 * DAY), updated_at: ago(2 * DAY), sent_at: null },
]

const ACTIVITIES: Row[] = [
  { id: 'act-1', account_id: 'a-talk', kind: 'stage', body: '', meta: { from: 'contacted', to: 'talking' }, created_by: 'p-sara', created_at: ago(12 * DAY) },
  { id: 'act-2', account_id: 'a-talk', kind: 'call', body: 'Spoke to the owner; wants a quote in the new year.', meta: {}, created_by: 'p-sara', created_at: ago(10 * DAY) },
]

const PROPOSALS: Row[] = [
  { id: 'pr-source', job_id: null, kind: 'source', market_id: 'm-scrap', account_id: null, summary: 'County auditor list',
    payload: { name: 'County auditor salvage licences', url: 'https://auditor.example.org/salvage', kind: 'register', why: 'About 60 yards.', terms_note: 'Open data licence.' },
    decision: 'pending', final: null, reason: null, decided_by: null, decided_at: null, created_at: ago(120) },
  { id: 'pr-lesson', job_id: null, kind: 'lesson', market_id: 'm-scrap', account_id: null, summary: 'Lesson',
    payload: { body: 'Owners answer the phone themselves; call before emailing.' },
    decision: 'pending', final: null, reason: null, decided_by: null, decided_at: null, created_at: ago(100) },
  { id: 'pr-next', job_id: null, kind: 'next_step', market_id: 'm-scrap', account_id: 'a-talk', summary: 'Next step',
    payload: { note: 'Send the quote he asked for and call on Thursday.', stage: 'proposal' },
    decision: 'pending', final: null, reason: null, decided_by: null, decided_at: null, created_at: ago(90) },
  { id: 'pr-thesis', job_id: null, kind: 'thesis', market_id: 'm-tow', account_id: null, summary: 'Industry thesis',
    payload: { text: 'Towing operators in Texas are licensed by the TDLR. '.repeat(6).trim(), sources: [{ url: 'https://www.tdlr.texas.gov/towing', title: 'TDLR towing' }] },
    decision: 'pending', final: null, reason: null, decided_by: null, decided_at: null, created_at: ago(60) },
]

const LESSONS: Row[] = [
  { id: 'l-1', market_id: 'm-scrap', body: 'Chains with more than five yards are not a fit.', created_by: 'p-sara', created_at: ago(5 * DAY) },
  { id: 'l-2', market_id: null, body: 'Lead with what we noticed, not with who we are.', created_by: 'p-amna', created_at: ago(6 * DAY) },
]

const RUNS: Row[] = [
  { id: 'r-done', kind: 'enrich', market_id: 'm-scrap', goal: 'Research 1 account in Scrap yards', status: 'done', started_by: 'p-sara',
    created_at: ago(3 * DAY + 5), finished_at: ago(3 * DAY), tokens_in: 48000, tokens_out: 3100, cost_usd: 0.42 },
]
const JOBS: Row[] = [
  { id: 'j-done', run_id: 'r-done', kind: 'enrich', market_id: 'm-scrap', account_id: 'a-buckeye', source_id: null, collector_id: null, activity_id: null,
    input: {}, status: 'done', worker_id: 'p-pc', attempts: 1, claimed_at: ago(3 * DAY + 4), heartbeat_at: ago(3 * DAY), finished_at: ago(3 * DAY),
    summary: 'Read the site and the state listing.\n\nFacts: 2 checked against the page, 1 not checked, 1 inferred.', error: null,
    tokens_in: 48000, tokens_out: 3100, cost_usd: 0.42, created_at: ago(3 * DAY + 5) },
]
const EVENTS: Row[] = [
  { id: 1, job_id: 'j-done', at: ago(3 * DAY + 3), kind: 'step', body: 'Reading buckeyepnp.com' },
  { id: 2, job_id: 'j-done', at: ago(3 * DAY + 2), kind: 'tool', body: 'Fact: Site last updated (checked against the page)' },
  { id: 3, job_id: 'j-done', at: ago(3 * DAY + 1), kind: 'warn', body: 'Dropped "Founded": the quoted words are not on https://buckeyepnp.com/about' },
]

const WORKERS: Row[] = [
  { profile_id: 'p-pc', owner_id: null, state: 'idle', info: { host: 'HOME-PC', version: '1', claude: '2.1.3' }, last_seen_at: ago(0) },
]

const FIXTURES = {
  profiles: [...Object.values(PEOPLE), WORKER] as unknown as Row[],
  playbook_sections: PLAYBOOK,
  markets: MARKETS,
  collectors: COLLECTORS,
  market_sources: SOURCES,
  accounts: ACCOUNTS,
  contacts: CONTACTS,
  account_facts: FACTS,
  agent_runs: RUNS,
  agent_jobs: JOBS,
  agent_job_events: EVENTS,
  proposals: PROPOSALS,
  lessons: LESSONS,
  drafts: DRAFTS,
  activities: ACTIVITIES,
  workers: WORKERS,
}
type Table = keyof typeof FIXTURES | 'profile_directory'

let db: Record<string, Row[]>
const rowsIn = (name: string) => (db[name] ??= [])
const find = (table: string, id: unknown) => rowsIn(table).find((r) => r.id === id)

function rowsOf(table: Table): Row[] {
  if (table === 'profile_directory') {
    return rowsIn('profiles').map(({ id, full_name, role, active }) => ({ id, full_name, role, active }))
  }
  return rowsIn(table)
}

let nextId = 1

// ---------------------------------------------------------------------------
// Recording and failure injection
// ---------------------------------------------------------------------------
type Op = 'select' | 'insert' | 'update' | 'delete'
type FilterOp = 'eq' | 'neq' | 'is' | 'in'
export type Filter = [col: string, op: FilterOp, value: unknown]

export const captured = {
  reads: [] as string[],
  inserts: [] as { table: string; rows: Row[] }[],
  updates: [] as { table: string; values: Row; filters: Filter[] }[],
  deletes: [] as { table: string; filters: Filter[] }[],
  rpcs: [] as { name: string; args: Row | undefined }[],
  auth: [] as { call: string; options?: unknown }[],
  functions: [] as { name: string; body: unknown }[],
  // Every database call, in order — for asserting sequence.
  calls: [] as string[],
}

const failures = new Map<string, PgError>()

/**
 * Make the next call matching `key` fail with `error`. Keys look like
 * `markets.insert`, `drafts.update`, `rpc.run_start`, `functions.set-password`.
 */
export function failNext(key: string, error: PgError) {
  failures.set(key, error)
}

function takeFailure(key: string) {
  const error = failures.get(key)
  if (error) failures.delete(key)
  return error ?? null
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
type Session = { user: { id: string } } | null
type Listener = (event: string, session: Session) => void

export const authState = {
  session: null as Session,
  // What `bind_profile` hands back: the profile, or null to refuse.
  bound: null as Profile | null,
  recovery: false,
}
const listeners = new Set<Listener>()

/** Sign in as this person, before mounting. `null` = signed in but refused. */
export function signInAs(who: Profile | null) {
  authState.session = { user: { id: `auth-${who?.id ?? 'stranger'}` } }
  authState.bound = who
}

/** Reset every table, recording and auth to the fixtures. Call before each test. */
export function reset() {
  db = Object.fromEntries(Object.entries(FIXTURES).map(([name, rows]) => [name, structuredClone(rows)]))
  for (const list of Object.values(captured)) list.length = 0
  failures.clear()
  authState.session = null
  authState.bound = null
  authState.recovery = false
  listeners.clear()
}
reset()

/** A table as it now stands, after the app's writes. Push to it to add rows. */
export const table = (name: Table) => rowsOf(name)

/** The last call to this RPC, for asserting exactly what was sent. */
export const lastRpc = (name: string) => captured.rpcs.filter((r) => r.name === name).at(-1)?.args

// ---------------------------------------------------------------------------
// Query builder
// ---------------------------------------------------------------------------
const matches = (row: Row, [col, op, value]: Filter) => {
  const v = (row[col] ?? null) as unknown
  if (op === 'in') return (value as unknown[]).includes(v)
  return op === 'neq' ? v !== value : v === value
}

class Query implements PromiseLike<Result> {
  private filters: Filter[] = []
  private sorts: { col: string; ascending: boolean; nullsFirst: boolean }[] = []
  private max: number | null = null
  private mode: 'many' | 'single' | 'maybeSingle' = 'many'
  private returning = false

  constructor(
    private readonly name: Table,
    private readonly op: Op,
    private readonly payload?: Row | Row[],
  ) {}

  select(_columns = '*') {
    this.returning = true
    return this
  }
  private where(col: string, op: FilterOp, value: unknown) {
    this.filters.push([col, op, value])
    return this
  }
  eq = (col: string, value: unknown) => this.where(col, 'eq', value)
  neq = (col: string, value: unknown) => this.where(col, 'neq', value)
  is = (col: string, value: null) => this.where(col, 'is', value)
  'in' = (col: string, values: unknown[]) => this.where(col, 'in', values)
  order(col: string, { ascending = true, nullsFirst }: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    // Postgres' own default: nulls last ascending, first descending.
    this.sorts.push({ col, ascending, nullsFirst: nullsFirst ?? !ascending })
    return this
  }
  limit(count: number) {
    this.max = count
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybeSingle'
    return this
  }

  private hit = (row: Row) => this.filters.every((f) => matches(row, f))

  private execute(): Result {
    const key = `${this.name}.${this.op}`
    const input = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}]
    // Recorded before any injected failure: a refused request was still sent.
    captured.calls.push(key)
    if (this.op === 'select') captured.reads.push(this.name)
    if (this.op === 'insert') captured.inserts.push({ table: this.name, rows: input })
    if (this.op === 'update') captured.updates.push({ table: this.name, values: input[0], filters: this.filters })
    if (this.op === 'delete') captured.deletes.push({ table: this.name, filters: this.filters })
    const error = takeFailure(key)
    if (error) return { data: null, error }

    let rows: Row[]
    switch (this.op) {
      case 'select':
        rows = rowsOf(this.name).filter(this.hit)
        break
      case 'insert':
        rows = input.map((r) => ({ id: `new-${nextId++}`, created_at: new Date().toISOString(), ...r }))
        rowsIn(this.name).push(...rows)
        break
      case 'update':
        rows = rowsIn(this.name).filter(this.hit)
        for (const r of rows) Object.assign(r, input[0])
        break
      case 'delete':
        rows = rowsIn(this.name).filter(this.hit)
        db[this.name] = rowsIn(this.name).filter((r) => !this.hit(r))
        break
    }

    if (this.sorts.length) {
      rows = [...rows].sort((a, b) => {
        for (const { col, ascending, nullsFirst } of this.sorts) {
          const x = (a[col] ?? null) as string | number | null, y = (b[col] ?? null) as string | number | null
          if (x === y) continue
          if (x === null) return nullsFirst ? -1 : 1
          if (y === null) return nullsFirst ? 1 : -1
          return (x < y ? -1 : 1) * (ascending ? 1 : -1)
        }
        return 0
      })
    }
    if (this.max !== null) rows = rows.slice(0, this.max)
    // Copies, as rows over the wire are: a page never holds the table's own objects.
    const data = this.op === 'select' || this.returning ? structuredClone(rows) : null
    if (this.mode === 'many') return { data, error: null }
    if (this.mode === 'maybeSingle') return { data: data?.[0] ?? null, error: null }
    return rows.length === 1
      ? { data: data![0], error: null }
      : { data: null, error: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' } }
  }

  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.execute()).then(onfulfilled, onrejected)
  }
}

// ---------------------------------------------------------------------------
// RPCs: stand-ins that do what the SQL does to the rows, as far as the pages
// can tell. The rules themselves (who may, what is refused) are the SQL's.
// ---------------------------------------------------------------------------
const now = () => new Date().toISOString()
const me = () => authState.bound?.id ?? null

function setStage(accountId: unknown, stage: unknown, note: unknown) {
  const account = find('accounts', accountId)
  if (!account || account.stage === stage) return
  rowsIn('activities').push({ id: `new-${nextId++}`, account_id: accountId, kind: 'stage', body: (note as string | null) ?? '',
    meta: { from: account.stage, to: stage }, created_by: me(), created_at: now() })
  Object.assign(account, { stage, stage_changed_at: now(), last_activity_at: now() })
}

const RPCS: Record<string, (args: Row) => unknown> = {
  bind_profile: () => authState.bound,

  run_start: ({ p_kind, p_market_id, p_account_ids, p_source_id, p_input }) => {
    const id = `run-${nextId++}`
    const targets = (p_account_ids as string[] | null) ?? [null]
    rowsIn('agent_runs').push({ id, kind: p_kind, market_id: p_market_id, goal: `A ${String(p_kind)} run`, status: 'queued', started_by: me(),
      created_at: now(), finished_at: null, tokens_in: 0, tokens_out: 0, cost_usd: 0 })
    for (const accountId of targets) {
      rowsIn('agent_jobs').push({ id: `job-${nextId++}`, run_id: id, kind: p_kind, market_id: p_market_id, account_id: accountId,
        source_id: p_source_id ?? null, collector_id: null, activity_id: (p_input as Row | null)?.activity_id ?? null, input: p_input ?? {},
        status: 'queued', worker_id: null, attempts: 0, claimed_at: null, heartbeat_at: null, finished_at: null, summary: null, error: null,
        tokens_in: 0, tokens_out: 0, cost_usd: 0, created_at: now() })
    }
    return id
  },

  run_cancel: ({ p_run_id }) => {
    for (const job of rowsIn('agent_jobs')) {
      if (job.run_id === p_run_id && (job.status === 'queued' || job.status === 'running')) Object.assign(job, { status: 'cancelled', finished_at: now() })
    }
    Object.assign(find('agent_runs', p_run_id) ?? {}, { status: 'cancelled', finished_at: now() })
    return null
  },

  accounts_review: ({ p_ids, p_decision }) => {
    const changed = rowsIn('accounts').filter((a) => (p_ids as string[]).includes(a.id as string) && a.review !== p_decision)
    for (const a of changed) a.review = p_decision
    return changed.length
  },

  account_move: ({ p_id, p_stage, p_note }) => {
    setStage(p_id, p_stage, p_note)
    return null
  },

  fact_reject: ({ p_id, p_rejected }) => {
    Object.assign(find('account_facts', p_id) ?? {}, { rejected_at: p_rejected ? now() : null, rejected_by: p_rejected ? me() : null })
    return null
  },

  proposal_decide: ({ p_id, p_accept, p_final, p_reason }) => {
    const proposal = find('proposals', p_id)
    if (!proposal) return null
    if (p_accept) {
      const final = (p_final ?? proposal.payload) as Row
      if (proposal.kind === 'thesis') {
        Object.assign(find('markets', proposal.market_id) ?? {}, { thesis: final.text, thesis_sources: final.sources ?? [], status: 'active' })
      } else if (proposal.kind === 'source') {
        rowsIn('market_sources').push({ id: `new-${nextId++}`, market_id: proposal.market_id, name: final.name, url: final.url, kind: final.kind ?? 'other',
          why: final.why ?? '', terms_note: final.terms_note ?? '', collector_id: null, selected: true, created_by: me(), created_at: now() })
      } else if (proposal.kind === 'next_step') {
        if (final.stage) setStage(proposal.account_id, final.stage, final.note)
      } else {
        rowsIn('lessons').push({ id: `new-${nextId++}`, market_id: final.general ? null : proposal.market_id, body: final.body, created_by: me(), created_at: now() })
      }
    }
    Object.assign(proposal, { decision: p_accept ? 'accepted' : 'rejected', final: p_accept ? (p_final ?? null) : null,
      reason: p_accept ? null : (p_reason ?? null), decided_by: me(), decided_at: now() })
    return null
  },

  collector_decide: ({ p_id, p_status, p_note }) => {
    Object.assign(find('collectors', p_id) ?? {}, { status: p_status, decided_by: me(), decided_at: now(), decided_note: p_note ?? null })
    return null
  },

  draft_mark: ({ p_id, p_status }) => {
    const draft = find('drafts', p_id)
    if (!draft) return null
    Object.assign(draft, { status: p_status, sent_at: p_status === 'sent' ? now() : null })
    if (p_status === 'sent') {
      rowsIn('activities').push({ id: `new-${nextId++}`, account_id: draft.account_id, kind: 'draft_sent', body: draft.subject ?? '',
        meta: { draft_id: draft.id, channel: draft.channel }, created_by: me(), created_at: now() })
      const account = find('accounts', draft.account_id)
      if (account && ['researching', 'qualified'].includes(account.stage as string)) setStage(account.id, 'contacted', null)
    }
    return null
  },
}

function rpc(name: string, args?: Row) {
  const run = (): Result => {
    captured.rpcs.push({ name, args })
    captured.calls.push(`rpc.${name}`)
    const error = takeFailure(`rpc.${name}`)
    if (error) return { data: null, error }
    const fn = RPCS[name]
    return fn ? { data: fn(args ?? {}), error: null } : { data: null, error: { message: `unknown rpc ${name}` } }
  }
  const promise = Promise.resolve().then(run)
  return Object.assign(promise, { maybeSingle: () => promise })
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------
export const supabase = {
  from: (name: Table) => ({
    select: (columns?: string) => new Query(name, 'select').select(columns),
    insert: (payload: Row | Row[]) => new Query(name, 'insert', payload),
    update: (payload: Row) => new Query(name, 'update', payload),
    delete: () => new Query(name, 'delete'),
  }),
  rpc,
  // Edge Functions. `failNext('functions.<name>', …)` fails one the way
  // supabase-js does: a generic error whose context is the function's reply.
  functions: {
    async invoke(name: string, options?: { body?: unknown }) {
      captured.calls.push(`functions.${name}`)
      captured.functions.push({ name, body: options?.body })
      const error = takeFailure(`functions.${name}`)
      if (!error) return { data: { ok: true }, error: null }
      const context = new Response(JSON.stringify({ error: error.message }), { status: 400 })
      return { data: null, error: Object.assign(new Error('Edge Function returned a non-2xx status code'), { context }) }
    },
  },
  auth: {
    onAuthStateChange(listener: Listener) {
      listeners.add(listener)
      setTimeout(() => {
        listener('INITIAL_SESSION', authState.session)
        if (authState.recovery) listener('PASSWORD_RECOVERY', authState.session)
      }, 0)
      return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }
    },
    async signInWithOAuth(options: unknown) {
      captured.auth.push({ call: 'signInWithOAuth', options })
      return { data: {}, error: null }
    },
    // Signs in whoever `authState.bound` is; `failNext('auth.signInWithPassword')` refuses.
    async signInWithPassword(options: unknown) {
      captured.auth.push({ call: 'signInWithPassword', options })
      const error = takeFailure('auth.signInWithPassword')
      if (error) return { data: { session: null }, error }
      authState.session = { user: { id: `auth-${authState.bound?.id ?? 'stranger'}` } }
      for (const l of listeners) l('SIGNED_IN', authState.session)
      return { data: { session: authState.session }, error: null }
    },
    async resetPasswordForEmail(email: string, options: unknown) {
      captured.auth.push({ call: 'resetPasswordForEmail', options: { email, ...(options as object) } })
      return { data: {}, error: takeFailure('auth.resetPasswordForEmail') }
    },
    async updateUser(attributes: unknown) {
      captured.auth.push({ call: 'updateUser', options: attributes })
      const error = takeFailure('auth.updateUser')
      return { data: { user: error ? null : authState.session?.user }, error }
    },
    async signOut() {
      captured.auth.push({ call: 'signOut' })
      authState.session = null
      for (const l of listeners) l('SIGNED_OUT', null)
      return { error: null }
    },
  },
}
