import type { ChipProps } from '@mui/material'
import type {
  AccountReview,
  AccountStage,
  ActivityKind,
  AppRole,
  CollectorStatus,
  DraftChannel,
  DraftStatus,
  JobStatus,
  LoginMethod,
  MarketStatus,
  RunKind,
  SourceKind,
} from './types'

export const COMPANY_NAME = 'Elevance Labs'
export const COMPANY_DOMAIN = 'elevancelabs.com'

export const APP_ROLE_LABELS: Record<AppRole, string> = {
  admin: 'Admin',
  growth: 'Growth',
  member: 'Member',
  agency: 'Agency',
  agent: 'Worker',
}

export const APP_ROLE_HINTS: Record<AppRole, string> = {
  admin: 'Everything, plus people, workers and approving collectors',
  growth: 'Prospecting, pipeline and playbook',
  member: 'Signs in; nothing to see yet',
  agency: 'Signs in; nothing to see yet',
  agent: 'A computer that does the research jobs',
}

export const LOGIN_METHOD_LABELS: Record<LoginMethod, string> = {
  google: `Google (@${COMPANY_DOMAIN})`,
  password: 'Email and password',
}

export const MARKET_STATUS_LABELS: Record<MarketStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
}

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  register: 'Register',
  directory: 'Directory',
  api: 'API',
  maps: 'Maps',
  press: 'Trade press',
  other: 'Other',
}

export const COLLECTOR_STATUS_LABELS: Record<CollectorStatus, string> = {
  proposed: 'Waiting for approval',
  approved: 'Approved',
  retired: 'Retired',
}
export const COLLECTOR_STATUS_COLORS: Record<CollectorStatus, ChipProps['color']> = {
  proposed: 'warning',
  approved: 'success',
  retired: 'default',
}

export const REVIEW_LABELS: Record<AccountReview, string> = {
  candidate: 'To review',
  accepted: 'Accepted',
  rejected: 'Rejected',
}

/** The pipeline, in board order. */
export const STAGES: AccountStage[] = [
  'researching', 'qualified', 'contacted', 'talking', 'proposal', 'won', 'lost', 'parked',
]
export const STAGE_LABELS: Record<AccountStage, string> = {
  researching: 'Researching',
  qualified: 'Qualified',
  contacted: 'Contacted',
  talking: 'Talking',
  proposal: 'Proposal',
  won: 'Won',
  lost: 'Lost',
  parked: 'Parked',
}
export const STAGE_COLORS: Record<AccountStage, ChipProps['color']> = {
  researching: 'default',
  qualified: 'info',
  contacted: 'primary',
  talking: 'secondary',
  proposal: 'warning',
  won: 'success',
  lost: 'error',
  parked: 'default',
}
/** Mirrors account_move: these need a reason. */
export const stageNeedsReason = (stage: AccountStage) => stage === 'lost' || stage === 'parked'

export const RUN_KIND_LABELS: Record<RunKind, string> = {
  thesis: 'Thesis',
  sources: 'Find sources',
  collector_build: 'Build collector',
  collect: 'Collect',
  enrich: 'Research',
  draft: 'Draft outreach',
  follow_up: 'Next step',
  lessons: 'Lessons',
}

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  queued: 'Waiting',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  needs_person: 'Needs a person',
  cancelled: 'Cancelled',
}
export const JOB_STATUS_COLORS: Record<JobStatus, ChipProps['color']> = {
  queued: 'default',
  running: 'info',
  done: 'success',
  failed: 'error',
  needs_person: 'warning',
  cancelled: 'default',
}
export const isOpen = (status: JobStatus) => status === 'queued' || status === 'running'

export const CHANNEL_LABELS: Record<DraftChannel, string> = {
  email: 'Email',
  linkedin: 'LinkedIn message',
  call: 'Call script',
}
export const DRAFT_STATUS_LABELS: Record<DraftStatus, string> = {
  draft: 'Draft',
  copied: 'Copied',
  sent: 'Sent',
}

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  note: 'Note',
  reply: 'Reply received',
  call: 'Call notes',
  stage: 'Stage',
  draft_sent: 'Outreach sent',
  review: 'Review',
}

/** A worker that has not been heard from for this long is shown offline. */
export const WORKER_OFFLINE_AFTER_MS = 90_000

export function formatDay(timestamp: string | null) {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDayTime(timestamp: string | null) {
  if (!timestamp) return '—'
  return new Date(timestamp).toLocaleString(undefined, {
    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
  })
}

/** "3 min ago", "2 h ago", "5 d ago"; a date beyond a month. */
export function timeAgo(timestamp: string | null, now = Date.now()) {
  if (!timestamp) return 'never'
  const seconds = Math.max(0, Math.round((now - new Date(timestamp).getTime()) / 1000))
  if (seconds < 45) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`
  if (seconds < 30 * 86_400) return `${Math.round(seconds / 86_400)} d ago`
  return formatDay(timestamp)
}

export function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 1000)}k`
  return String(n)
}

export function formatUsd(n: number | null) {
  if (n === null) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n >= 100 ? 0 : 2 })
}

export const trimOrNull = (value: string) => value.trim() || null

/** Postgres errors the pages meet, as something a person can act on. */
export function errorMessage(error: { code?: string; message: string }, duplicate = 'That already exists.') {
  if (error.code === '23505') return duplicate
  if (error.code === '42501') return 'You are not allowed to do that.'
  if (error.code === '23503') return 'That is still in use, so it cannot be removed.'
  return error.message
}
