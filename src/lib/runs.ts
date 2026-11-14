// Runs and their jobs: starting and cancelling one, reading how it is going,
// and whether a worker is there to do it.
import { supabase } from './supabase'
import { WORKER_OFFLINE_AFTER_MS, isOpen } from './constants'
import type { AgentJob, AgentRun, RunKind, Worker } from './types'

export interface RunOptions {
  accountIds?: string[]
  sourceId?: string
  input?: Record<string, unknown>
}

/** Starts a run (the only way jobs are made). Returns its id, or the reason it was refused. */
export async function startRun(kind: RunKind, marketId: string, options: RunOptions = {}) {
  const { data, error } = await supabase.rpc('run_start', {
    p_kind: kind,
    p_market_id: marketId,
    p_account_ids: options.accountIds ?? null,
    p_source_id: options.sourceId ?? null,
    p_input: options.input ?? {},
  })
  // run_start's refusals are written for the person: shown as they are.
  return error ? { id: null, error: error.message } : { id: data as string, error: null }
}

export async function cancelRun(runId: string) {
  const { error } = await supabase.rpc('run_cancel', { p_run_id: runId })
  return error?.message ?? null
}

export type RunWithJobs = AgentRun & { jobs: AgentJob[] }

/** The latest runs (of a market, or everywhere) with their jobs: two reads, no embed. */
export async function loadRuns(marketId: string | null, limit = 30) {
  let query = supabase.from('agent_runs').select('*').order('created_at', { ascending: false }).limit(limit)
  if (marketId) query = query.eq('market_id', marketId)
  const runs = await query
  if (runs.error) return { data: null, error: runs.error }
  const list = (runs.data ?? []) as AgentRun[]
  if (!list.length) return { data: [] as RunWithJobs[], error: null }
  const jobs = await supabase.from('agent_jobs').select('*').in('run_id', list.map((r) => r.id)).order('created_at')
  if (jobs.error) return { data: null, error: jobs.error }
  const all = (jobs.data ?? []) as AgentJob[]
  return { data: list.map((r) => ({ ...r, jobs: all.filter((j) => j.run_id === r.id) })), error: null }
}

export const anyOpen = (runs: RunWithJobs[] | null) => !!runs?.some((r) => isOpen(r.status))

/** Changes whenever a run or job moves, so a page knows to read its own data again. */
export const runsSignature = (runs: RunWithJobs[] | null) =>
  (runs ?? []).map((r) => `${r.id}:${r.status}:${r.jobs.filter((j) => !isOpen(j.status)).length}`).join('|')

export function progress(run: RunWithJobs) {
  const finished = run.jobs.filter((j) => !isOpen(j.status)).length
  return { finished, total: run.jobs.length, percent: run.jobs.length ? (finished / run.jobs.length) * 100 : 0 }
}

/** The open job of this kind for an account or a source, if there is one. */
export function openJob(runs: RunWithJobs[] | null, kind: RunKind, target: { accountId?: string; sourceId?: string } = {}) {
  for (const run of runs ?? []) {
    for (const job of run.jobs) {
      if (job.kind !== kind || !isOpen(job.status)) continue
      if (target.accountId && job.account_id !== target.accountId) continue
      if (target.sourceId && job.source_id !== target.sourceId) continue
      return job
    }
  }
  return null
}

export const isOnline = (worker: Worker, now = Date.now()) =>
  now - new Date(worker.last_seen_at).getTime() < WORKER_OFFLINE_AFTER_MS

/** What to tell someone who has work waiting: nothing when a worker is on it. */
export function workerNotice(workers: Worker[] | null, now = Date.now()) {
  if (workers === null) return null
  const online = workers.filter((w) => isOnline(w, now))
  if (!workers.length) return 'No worker has been set up yet, so jobs will wait. An admin adds one under Settings.'
  if (!online.length) return 'The worker is offline, so jobs will wait until it is running again.'
  if (online.every((w) => w.state === 'limit')) {
    return 'The worker has reached its Claude usage limit. Jobs will carry on when the limit resets.'
  }
  return null
}
