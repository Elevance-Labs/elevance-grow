// The Grow worker: the program on the computer that does the agent's jobs.
//
//   node worker/main.ts        (or: yarn worker)
//
// It signs in to Grow with its own narrow login, says it is here, and takes
// one job at a time from the queue. A collect job runs its approved collector
// in the sandbox, with no model. Every other job starts Claude Code, which is
// signed in on this computer with its owner's Claude account, gives it that
// job's tools, and reports how it went. It only ever connects out.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { runClaude, version } from './claude.ts'
import { runCollector } from './collector.ts'
import { loadConfig } from './config.ts'
import { cleanRows } from './lib/clean.ts'
import { buildBrief, type JobContext } from './prompts.ts'
import { evidenceLine, newStats, outcome, toolsFor, type Stats } from './tools.ts'

function settings() {
  try {
    return loadConfig()
  } catch (e) {
    console.error((e as Error).message)
    process.exit(1)
  }
}
const config = settings()
const client = createClient(config.url, config.anonKey, { auth: { persistSession: false, autoRefreshToken: true } })
const log = (...parts: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...parts)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

type State = 'idle' | 'working' | 'limit'
let state: State = 'idle'
const info: { host: string; version: string; claude?: string; deno?: string; note?: string } = {
  host: hostname(),
  version: '1',
}
/** Nothing is claimed before this time: set after a usage limit or a sign-in problem. */
let pausedUntil = 0
let current: { jobId: string; kill: (() => void) | null } | null = null
let stopping = false

async function rpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await client.rpc(name, args)
  return { data: data as unknown, error: error ? { message: error.message, code: error.code } : null }
}

async function heartbeat() {
  const { error } = await rpc('agent_heartbeat', { p_state: state, p_info: info })
  if (error) log('heartbeat failed:', error.message)
}

async function signIn() {
  const { error } = await client.auth.signInWithPassword({ email: config.email, password: config.password })
  if (error) throw new Error(`Could not sign in to Grow as ${config.email}: ${error.message}`)
  const { data, error: bindError } = await client.rpc('bind_profile').maybeSingle()
  const profile = data as { role?: string; full_name?: string } | null
  if (bindError || !profile) throw new Error(`Signed in, but Grow has no active profile for ${config.email}. An admin adds the worker under Settings.`)
  if (profile.role !== 'agent') throw new Error(`${config.email} is a ${profile.role} login. A worker needs its own, with the Worker role.`)
  log(`signed in as ${profile.full_name}`)
}

/** A token good for the whole job, for the tool server Claude starts. */
async function freshToken() {
  const { data, error } = await client.auth.refreshSession()
  if (error || !data.session) throw new Error(`Could not refresh the Grow session: ${error?.message ?? 'no session'}`)
  return data.session.access_token
}

async function finish(jobId: string, status: 'done' | 'failed' | 'needs_person', fields: { summary?: string | null; error?: string | null; tokensIn?: number; tokensOut?: number; costUsd?: number } = {}) {
  const { error } = await rpc('agent_finish', {
    p_job_id: jobId, p_status: status, p_summary: fields.summary ?? null, p_error: fields.error ?? null,
    p_tokens_in: fields.tokensIn ?? 0, p_tokens_out: fields.tokensOut ?? 0, p_cost_usd: fields.costUsd ?? 0,
  })
  // Refused when a person stopped the run meanwhile: nothing more to do.
  if (error) log(`could not close job ${jobId}: ${error.message}`)
  else log(`job ${jobId} ${status}${fields.error ? `: ${fields.error}` : ''}`)
}

// ---------------------------------------------------------------------------
// A collect job: the approved script, the sandbox, plain cleaning. No model.
// ---------------------------------------------------------------------------
async function collect(ctx: JobContext) {
  const jobId = ctx.job.id
  if (!ctx.collector) return finish(jobId, 'failed', { error: 'This source\'s collector is not approved (it may have changed since the run was started).' })
  await rpc('agent_event', { p_job_id: jobId, p_kind: 'step', p_body: `Running collector ${ctx.collector.slug} (version ${ctx.collector.version}) against ${ctx.collector.hosts.join(', ')}` })
  const run = await runCollector(ctx.collector.code, ctx.collector.hosts, { deno: config.denoBin })
  if (!run.ok) return finish(jobId, 'failed', { error: run.error })
  const cleaned = cleanRows(run.rows)
  let fresh = 0
  for (let i = 0; i < cleaned.rows.length || i === 0; i += 1000) {
    const { data, error } = await rpc('agent_save_candidates', { p_job_id: jobId, p_rows: cleaned.rows.slice(i, i + 1000) })
    if (error) return finish(jobId, 'failed', { error: error.message })
    fresh += (data as { new?: number } | null)?.new ?? 0
  }
  await finish(jobId, 'done', {
    summary: `${cleaned.rows.length} businesses read: ${fresh} new, ${cleaned.rows.length - fresh} already known.` +
      (cleaned.dropped || cleaned.duplicates ? ` Left out: ${cleaned.dropped} without a usable name, ${cleaned.duplicates} repeats.` : ''),
  })
}

// ---------------------------------------------------------------------------
// Every other job: Claude Code, with that job's tools.
// ---------------------------------------------------------------------------
async function think(ctx: JobContext) {
  const jobId = ctx.job.id
  const brief = buildBrief(ctx)
  const dir = await mkdtemp(join(tmpdir(), 'grow-job-'))
  const stateFile = join(dir, 'state.json')
  try {
    const jobFile = join(dir, 'job.json')
    const mcpFile = join(dir, 'mcp.json')
    await writeFile(jobFile, JSON.stringify(ctx))
    await writeFile(stateFile, JSON.stringify(newStats()))
    const servers: Record<string, unknown> = {
      grow: {
        command: process.execPath,
        args: [fileURLToPath(new URL('./mcp.ts', import.meta.url))],
        env: {
          GROW_SUPABASE_URL: config.url, GROW_SUPABASE_ANON_KEY: config.anonKey, GROW_ACCESS_TOKEN: await freshToken(),
          GROW_JOB_FILE: jobFile, GROW_STATE_FILE: stateFile, GROW_DENO_BIN: config.denoBin,
        },
      },
    }
    // A real browser only for jobs that read the web, and only when one is set up.
    const browser = config.browserServer && brief.builtins.length > 0
    if (browser) servers.browser = config.browserServer
    await writeFile(mcpFile, JSON.stringify({ mcpServers: servers }), { mode: 0o600 })

    // The names of the job's own tools, so exactly those are allowed.
    const own = toolsFor({
      jobId, kind: ctx.job.kind, input: ctx.job.input, knownFacts: 0, stats: newStats(),
      rpc: async () => ({ data: null, error: null }), readPage: async () => ({ ok: false, reason: '' }),
      runCollector: async () => ({ ok: false, error: '' }),
    }).map((tool) => `mcp__grow__${tool.name}`)

    const run = await runClaude(brief.prompt, {
      bin: config.claudeBin,
      model: brief.model === 'writing' ? config.modelWriting : config.modelResearch,
      mcpConfig: mcpFile,
      builtins: brief.builtins,
      allowed: [...own, ...brief.builtins, ...(browser ? ['mcp__browser'] : [])],
      cwd: dir,
      timeoutMs: config.jobTimeoutMs,
      onSpawn: (kill) => { if (current) current.kill = kill },
    })

    let stats: Stats = newStats()
    try {
      stats = { ...stats, ...(JSON.parse(await readFile(stateFile, 'utf8')) as Stats) }
    } catch {
      // Claude never called a tool: the stats stay empty.
    }
    const usage = { tokensIn: run.tokensIn, tokensOut: run.tokensOut, costUsd: run.costUsd }

    if (stopping) return // handed back by shutdown()
    if (!run.ok && (run.limit || run.signedOut) && !stats.saved) {
      // Not the job's fault: hand it back and wait. What it saved so far stays.
      const reason = run.limit
        ? 'The Claude usage limit was reached. The job waits and is picked up again when the limit resets.'
        : 'Claude Code is not signed in on the worker. Sign in there (run "claude" and /login); the job waits.'
      await rpc('agent_release', { p_job_id: jobId, p_reason: reason })
      state = run.limit ? 'limit' : 'idle'
      info.note = run.limit ? undefined : 'Claude Code is not signed in on this computer.'
      pausedUntil = Date.now() + (run.limit ? 15 : 5) * 60_000
      log(reason)
      return
    }
    info.note = undefined

    const result = outcome(ctx.job.kind, stats)
    const summary = [run.text, evidenceLine(stats)].filter(Boolean).join('\n\n') || null
    if (result.status === 'failed') {
      return finish(jobId, 'failed', { summary, error: run.ok ? result.error : `${run.error ?? 'Claude Code failed.'}`, ...usage })
    }
    await finish(jobId, result.status, { summary, error: result.error, ...usage })
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function work(ctx: JobContext) {
  current = { jobId: ctx.job.id, kill: null }
  state = 'working'
  await heartbeat()
  log(`job ${ctx.job.id}: ${ctx.job.kind} for ${ctx.account?.name ?? ctx.source?.name ?? ctx.market.name}`)
  // Keeps the job marked alive while it runs; a silent worker's job is given to another.
  const beat = setInterval(heartbeat, 30_000)
  try {
    if (ctx.job.kind === 'collect') await collect(ctx)
    else await think(ctx)
  } catch (e) {
    log('job failed:', e)
    if (!stopping) await finish(ctx.job.id, 'failed', { error: `The worker hit an error: ${(e as Error).message}` })
  } finally {
    clearInterval(beat)
    current = null
    if (state === 'working') state = 'idle'
  }
}

async function shutdown() {
  if (stopping) return
  stopping = true
  log('stopping')
  if (current) {
    current.kill?.()
    await rpc('agent_release', { p_job_id: current.jobId, p_reason: 'The worker was stopped. The job waits for it to start again.' })
  }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

async function main() {
  await signIn()
  info.claude = (await version(config.claudeBin)) ?? undefined
  info.deno = (await version(config.denoBin)) ?? undefined
  if (!info.claude) info.note = 'Claude Code was not found on this computer.'
  else if (!info.deno) info.note = 'Deno is not installed, so collectors cannot run. Research and drafting still work.'
  log(`Claude Code ${info.claude ?? 'not found'}, Deno ${info.deno ?? 'not found'}`)
  log('waiting for jobs')

  let lastBeat = 0
  while (!stopping) {
    try {
      if (Date.now() - lastBeat > 30_000) {
        if (state === 'limit' && Date.now() >= pausedUntil) state = 'idle'
        await heartbeat()
        lastBeat = Date.now()
      }
      if (Date.now() < pausedUntil || !info.claude) {
        // Without Claude Code only collect jobs could run; keep it simple and wait.
        if (!info.claude) info.claude = (await version(config.claudeBin)) ?? undefined
        await sleep(30_000)
        continue
      }
      const { data, error } = await rpc('agent_claim')
      if (error) {
        log('claim failed:', error.message)
        await sleep(30_000)
        continue
      }
      if (!data) {
        await sleep(config.pollMs)
        continue
      }
      await work(data as JobContext)
      lastBeat = 0
    } catch (e) {
      // The network dropped, the session ended: wait, sign in again, carry on.
      log('loop error:', (e as Error).message)
      await sleep(30_000)
      await signIn().catch((again) => log((again as Error).message))
    }
  }
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
