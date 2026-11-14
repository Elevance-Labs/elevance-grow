// Row shapes for the tables and the directory view. Keep in step with
// supabase/schema.sql.

export type AppRole = 'admin' | 'growth' | 'member' | 'agency' | 'agent'
export type LoginMethod = 'google' | 'password'
export type MarketStatus = 'draft' | 'active' | 'archived'
export type SourceKind = 'register' | 'directory' | 'api' | 'maps' | 'press' | 'other'
export type CollectorStatus = 'proposed' | 'approved' | 'retired'
export type AccountReview = 'candidate' | 'accepted' | 'rejected'
export type AccountStage =
  | 'researching' | 'qualified' | 'contacted' | 'talking' | 'proposal' | 'won' | 'lost' | 'parked'
export type FactKind = 'observed' | 'inferred'
export type RunKind =
  | 'thesis' | 'sources' | 'collector_build' | 'collect' | 'enrich' | 'draft' | 'follow_up' | 'lessons'
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'needs_person' | 'cancelled'
export type ProposalKind = 'thesis' | 'source' | 'next_step' | 'lesson'
export type ProposalDecision = 'pending' | 'accepted' | 'rejected'
export type DraftChannel = 'email' | 'linkedin' | 'call'
export type DraftStatus = 'draft' | 'copied' | 'sent'
export type ActivityKind = 'note' | 'reply' | 'call' | 'stage' | 'draft_sent' | 'review'
export type WorkerState = 'idle' | 'working' | 'limit'

export interface Profile {
  id: string
  user_id: string | null
  full_name: string
  email: string
  login_method: LoginMethod
  role: AppRole
  active: boolean
  created_at: string
  updated_at: string
}

export interface DirectoryEntry {
  id: string
  full_name: string
  role: AppRole
  active: boolean
}

export interface PlaybookSection {
  id: string
  key: string
  title: string
  hint: string
  body: string
  sort_order: number
  updated_by: string | null
  updated_at: string
}

export interface SourceRef {
  url: string
  title?: string
}

export interface Market {
  id: string
  name: string
  region: string
  brief: string
  thesis: string | null
  thesis_sources: SourceRef[]
  status: MarketStatus
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface Collector {
  id: string
  slug: string
  name: string
  description: string
  hosts: string[]
  terms_note: string
  code: string
  version: number
  status: CollectorStatus
  sample: Record<string, unknown>[]
  decided_by: string | null
  decided_at: string | null
  decided_note: string | null
  last_run_at: string | null
  last_rows: number | null
  health: 'ok' | 'empty' | 'error' | null
  last_error: string | null
  created_at: string
  updated_at: string
}

export interface MarketSource {
  id: string
  market_id: string
  name: string
  url: string
  kind: SourceKind
  why: string
  terms_note: string
  collector_id: string | null
  selected: boolean
  created_by: string | null
  created_at: string
}

export interface Account {
  id: string
  market_id: string
  name: string
  website: string | null
  domain: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  country: string | null
  review: AccountReview
  stage: AccountStage
  fit_score: number | null
  fit_reasons: string | null
  hook: string | null
  enriched_at: string | null
  do_not_contact: boolean
  service_line: string | null
  est_value: number | null
  source_id: string | null
  source_url: string | null
  raw: { text?: string | null } | null
  dedupe_key: string
  stage_changed_at: string
  last_activity_at: string | null
  created_at: string
  updated_at: string
}

export interface Contact {
  id: string
  account_id: string
  full_name: string
  title: string | null
  email: string | null
  phone: string | null
  linkedin_url: string | null
  source_url: string | null
  quote: string | null
  verified: boolean
  job_id: string | null
  created_by: string | null
  created_at: string
}

export interface AccountFact {
  id: string
  account_id: string
  job_id: string | null
  kind: FactKind
  label: string
  claim: string
  source_url: string | null
  quote: string | null
  context: string | null
  verified: boolean
  read_at: string | null
  rejected_at: string | null
  rejected_by: string | null
  created_at: string
}

export interface AgentRun {
  id: string
  kind: RunKind
  market_id: string
  goal: string
  status: JobStatus
  started_by: string | null
  created_at: string
  finished_at: string | null
  tokens_in: number
  tokens_out: number
  cost_usd: number
}

export interface AgentJob {
  id: string
  run_id: string
  kind: RunKind
  market_id: string
  account_id: string | null
  source_id: string | null
  collector_id: string | null
  activity_id: string | null
  input: Record<string, unknown>
  status: JobStatus
  worker_id: string | null
  attempts: number
  claimed_at: string | null
  heartbeat_at: string | null
  finished_at: string | null
  summary: string | null
  error: string | null
  tokens_in: number
  tokens_out: number
  cost_usd: number
  created_at: string
}

export interface AgentJobEvent {
  id: number
  job_id: string
  at: string
  kind: 'step' | 'tool' | 'warn' | 'error'
  body: string
}

export interface ThesisPayload {
  text: string
  sources?: SourceRef[]
}
export interface SourcePayload {
  name: string
  url: string
  kind?: SourceKind
  why?: string
  terms_note?: string
}
export interface NextStepPayload {
  note: string
  stage?: AccountStage
}
export interface LessonPayload {
  body: string
  general?: boolean
}

export interface Proposal {
  id: string
  job_id: string | null
  kind: ProposalKind
  market_id: string
  account_id: string | null
  summary: string
  payload: Record<string, unknown>
  decision: ProposalDecision
  final: Record<string, unknown> | null
  reason: string | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export interface Lesson {
  id: string
  market_id: string | null
  body: string
  created_by: string | null
  created_at: string
}

export interface Draft {
  id: string
  account_id: string
  contact_id: string | null
  channel: DraftChannel
  subject: string | null
  body: string
  original_body: string | null
  status: DraftStatus
  job_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  sent_at: string | null
}

export interface Activity {
  id: string
  account_id: string
  kind: ActivityKind
  body: string
  meta: Record<string, unknown>
  created_by: string | null
  created_at: string
}

export interface Worker {
  profile_id: string
  owner_id: string | null
  state: WorkerState
  info: { host?: string; version?: string; claude?: string; note?: string }
  last_seen_at: string
}
