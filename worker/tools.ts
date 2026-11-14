// The tools Claude is given for a job. Each job kind gets only its own; every
// one writes through the worker's narrow RPCs, for the claimed job alone.
//
// This is where the evidence rules are enforced by code rather than asked of
// the model: a quoted fact is saved only after the worker has read the page
// itself and found the words on it.
import { z } from 'zod'
import { cleanRows } from './lib/clean.ts'
import { checkHosts } from './lib/hosts.ts'
import { MIN_PAGE_TEXT, MIN_QUOTE, findQuote, looksBlocked } from './lib/verify.ts'

export type RunKind =
  | 'thesis' | 'sources' | 'collector_build' | 'collect' | 'enrich' | 'draft' | 'follow_up' | 'lessons'

export type PageRead = { ok: true; status: number; text: string } | { ok: false; reason: string }
export type CollectorRun = { ok: true; rows: unknown[] } | { ok: false; error: string }
export interface RpcAnswer {
  data: unknown
  error: { message: string; code?: string } | null
}

/** What a job did, kept by the tools and read by the worker once Claude has finished. */
export interface Stats {
  checked: number
  unchecked: number
  dropped: number
  inferred: number
  contacts: number
  proposals: number
  /** The job's one required result was saved (the score, the draft, the collector). */
  saved: boolean
  needsPerson: string | null
}
export const newStats = (): Stats => ({
  checked: 0, unchecked: 0, dropped: 0, inferred: 0, contacts: 0, proposals: 0, saved: false, needsPerson: null,
})

export interface ToolDeps {
  jobId: string
  kind: RunKind
  input: Record<string, unknown>
  /** Facts the account already had when the job started. */
  knownFacts: number
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcAnswer>
  readPage: (url: string) => Promise<PageRead>
  runCollector: (code: string, hosts: string[]) => Promise<CollectorRun>
  stats: Stats
  /** Called after the stats change, so the worker can read them even if Claude is killed. */
  persist?: () => void
}

export interface ToolResult {
  text: string
  isError?: boolean
}
export interface Tool {
  name: string
  description: string
  shape: z.ZodRawShape
  run: (args: Record<string, unknown>) => Promise<ToolResult>
}

const ok = (text: string): ToolResult => ({ text })
const refuse = (text: string): ToolResult => ({ text, isError: true })
const isHttp = (url: unknown): url is string => typeof url === 'string' && /^https?:\/\/\S+$/i.test(url)
const STAGES = ['researching', 'qualified', 'contacted', 'talking', 'proposal', 'won', 'lost', 'parked'] as const
const SOURCE_KINDS = ['register', 'directory', 'api', 'maps', 'press', 'other'] as const

export function toolsFor(deps: ToolDeps): Tool[] {
  const { stats } = deps
  const pages = new Map<string, Promise<PageRead>>()
  const read = (url: string) => {
    if (!pages.has(url)) pages.set(url, deps.readPage(url))
    return pages.get(url)!
  }
  const event = (kind: 'step' | 'tool' | 'warn', body: string) =>
    deps.rpc('agent_event', { p_job_id: deps.jobId, p_kind: kind, p_body: body })
  const changed = () => deps.persist?.()
  const failed = (error: { message: string }) => refuse(`Not saved: ${error.message}`)

  /**
   * Reads the page and looks for the quote. `verified` only when the words
   * are there; `unreadable` when the worker could not get the page's text at
   * all (so the claim is kept, marked not checked); `absent` when the page
   * was read and the words are not on it (so the claim is dropped).
   */
  async function check(url: string, quote: string) {
    if (quote.trim().length < MIN_QUOTE) return { state: 'short' as const }
    const page = await read(url)
    if (!page.ok) return { state: 'unreadable' as const, why: page.reason }
    if (looksBlocked(page.status, page.text)) return { state: 'unreadable' as const, why: `the site refused the checker (HTTP ${page.status})` }
    if (page.text.length < MIN_PAGE_TEXT) return { state: 'unreadable' as const, why: 'the page has almost no text without running its scripts' }
    const found = findQuote(page.text, quote)
    return found.found ? { state: 'verified' as const, context: found.context } : { state: 'absent' as const }
  }

  const note: Tool = {
    name: 'note',
    description: 'Report what you are doing now, in one short sentence, for the person watching. Use it at each new step.',
    shape: { text: z.string().min(3).max(300) },
    run: async ({ text }) => {
      await event('step', String(text))
      return ok('Noted.')
    },
  }

  const needsPerson: Tool = {
    name: 'needs_person',
    description:
      'Stop and hand this to a person. Use it when a site shows a bot check, a captcha or a login wall, or when the job cannot be done without something only a person can do. Never try to get past such a check. After calling this, end.',
    shape: { reason: z.string().min(5).max(500) },
    run: async ({ reason }) => {
      stats.needsPerson = String(reason)
      changed()
      await event('warn', `Needs a person: ${String(reason)}`)
      return ok('Recorded. Stop now and say so in your final message.')
    },
  }

  const byKind: Record<RunKind, Tool[]> = {
    collect: [],

    thesis: [
      {
        name: 'propose_thesis',
        description:
          'Propose the industry thesis for a person to accept. Call once, at the end. List every page you actually read and relied on; a thesis without its sources is refused.',
        shape: {
          text: z.string().min(200).max(20000).describe('The brief, in plain paragraphs with short headings.'),
          sources: z.array(z.object({ url: z.string(), title: z.string().max(200).optional() })).min(2).max(40),
        },
        run: async ({ text, sources }) => {
          const list = (sources as { url: string; title?: string }[]).filter((s) => isHttp(s.url))
          if (list.length < 2) return refuse('Not saved: give at least two web pages (http or https) you read for this.')
          const { error } = await deps.rpc('agent_propose', {
            p_job_id: deps.jobId, p_kind: 'thesis', p_summary: 'Industry thesis', p_payload: { text: String(text).trim(), sources: list },
          })
          if (error) return failed(error)
          stats.proposals++
          stats.saved = true
          changed()
          return ok('Proposed. A person will read it and accept, change or reject it.')
        },
      },
    ],

    sources: [
      {
        name: 'propose_source',
        description:
          'Propose one place where a list of these businesses can be read. The worker opens the address itself first; one it cannot reach is refused. Prefer official registers, open data and association directories over sites that forbid collection.',
        shape: {
          name: z.string().min(2).max(160),
          url: z.string().describe('The page or file where the list itself is, not the site\'s home page.'),
          kind: z.enum(SOURCE_KINDS),
          why: z.string().min(10).max(600).describe('What the list covers and roughly how many businesses.'),
          terms_note: z.string().min(5).max(600).describe('What the source\'s terms of use or robots file say about automated reading. Say so if you could not find them.'),
        },
        run: async ({ name, url, kind, why, terms_note }) => {
          if (!isHttp(url)) return refuse('Not saved: the address must start with http:// or https://.')
          const page = await read(url)
          let terms = String(terms_note)
          if (!page.ok) return refuse(`Not saved: the worker could not open that address (${page.reason}). Check it, or propose another.`)
          if (looksBlocked(page.status, page.text)) {
            terms += ` The worker's own check was refused by the site (HTTP ${page.status}): a person should open it before it is used.`
          } else if (page.status >= 400) {
            return refuse(`Not saved: that address answers HTTP ${page.status}.`)
          }
          const { error } = await deps.rpc('agent_propose', {
            p_job_id: deps.jobId, p_kind: 'source', p_summary: String(name),
            p_payload: { name: String(name).trim(), url, kind, why: String(why).trim(), terms_note: terms.trim() },
          })
          if (error) return error.code === '23505' ? refuse('Not saved: that address is already a source on this market.') : failed(error)
          stats.proposals++
          stats.saved = true
          changed()
          return ok('Proposed.')
        },
      },
    ],

    collector_build: [
      {
        name: 'test_collector',
        description:
          'Run a collector script in the sandbox and see what it returns. The script may reach only the hosts you name: no files, no other sites, no imports except "./helpers.ts". Use this until the rows are right.',
        shape: {
          hosts: z.array(z.string()).min(1).max(5).describe('Bare host names the script calls, e.g. ["data.ohio.gov"].'),
          code: z.string().min(20).max(60000),
        },
        run: async ({ hosts, code }) => {
          const checked = checkHosts(hosts)
          if (checked.error !== null) return refuse(checked.error)
          await event('tool', `Testing a collector against ${checked.hosts.join(', ')}`)
          const run = await deps.runCollector(String(code), checked.hosts)
          if (!run.ok) return refuse(`The script failed: ${run.error}`)
          let cleaned
          try {
            cleaned = cleanRows(run.rows)
          } catch (e) {
            return refuse((e as Error).message)
          }
          const withSource = cleaned.rows.filter((r) => r.source_url).length
          return ok(
            `${cleaned.rows.length} usable rows (${cleaned.dropped} without a usable name, ${cleaned.duplicates} repeats). ` +
              `${withSource} carry a source_url.\nFirst rows:\n${JSON.stringify(cleaned.rows.slice(0, 5), null, 1)}`,
          )
        },
      },
      {
        name: 'propose_collector',
        description:
          'Propose the finished collector. The worker runs it once more and keeps the first rows as the sample a person sees. It will not run for real until an admin approves it.',
        shape: {
          slug: z.string().regex(/^[a-z][a-z0-9-]{2,59}$/).describe('A short id for the source, e.g. "ohio-bmv-salvage".'),
          name: z.string().min(3).max(160),
          description: z.string().min(10).max(1000).describe('What it reads and how, in plain words for the person approving it.'),
          hosts: z.array(z.string()).min(1).max(5),
          terms_note: z.string().min(5).max(600).describe('What the source\'s terms or robots file allow.'),
          code: z.string().min(20).max(60000),
        },
        run: async ({ slug, name, description, hosts, terms_note, code }) => {
          const checked = checkHosts(hosts)
          if (checked.error !== null) return refuse(checked.error)
          const run = await deps.runCollector(String(code), checked.hosts)
          if (!run.ok) return refuse(`Not proposed: the script failed on its final run: ${run.error}`)
          let cleaned
          try {
            cleaned = cleanRows(run.rows)
          } catch (e) {
            return refuse(`Not proposed: ${(e as Error).message}`)
          }
          if (!cleaned.rows.length) return refuse('Not proposed: the script returned no usable rows.')
          const { error } = await deps.rpc('agent_propose_collector', {
            p_job_id: deps.jobId, p_slug: slug, p_name: name, p_description: description, p_hosts: checked.hosts,
            p_terms_note: terms_note, p_code: code, p_sample: cleaned.rows.slice(0, 20),
          })
          if (error) return failed(error)
          stats.saved = true
          changed()
          await event('tool', `Proposed collector "${String(name)}": ${cleaned.rows.length} rows on its test run`)
          return ok(`Proposed with a ${Math.min(20, cleaned.rows.length)}-row sample from ${cleaned.rows.length} rows. An admin approves it before it runs.`)
        },
      },
    ],

    enrich: [
      {
        name: 'save_fact',
        description:
          'Save one thing you read about this business. Give the page and the exact words on it that say so. The worker reads the page itself: words that are not there are refused. Save a fact as soon as you find it.',
        shape: {
          label: z.string().min(2).max(80).describe('A short name for what this is, e.g. "Yard management software".'),
          claim: z.string().min(5).max(1000).describe('The fact, in one plain sentence.'),
          url: z.string().describe('The page you read it on.'),
          quote: z.string().min(MIN_QUOTE).max(600).describe('The exact words from that page, copied, not paraphrased.'),
        },
        run: async ({ label, claim, url, quote }) => {
          if (!isHttp(url)) return refuse('Not saved: give the web address of the page you read it on.')
          const result = await check(url, String(quote))
          if (result.state === 'short') return refuse(`Not saved: quote at least ${MIN_QUOTE} characters, enough of the sentence to find it.`)
          if (result.state === 'absent') {
            stats.dropped++
            changed()
            await event('warn', `Dropped "${String(label)}": the quoted words are not on ${url}`)
            return refuse('Not saved: the worker read that page and those words are not on it. Copy the words exactly as the page has them, or leave this fact out. Do not reword it to get it through.')
          }
          const verified = result.state === 'verified'
          const { error } = await deps.rpc('agent_save_fact', {
            p_job_id: deps.jobId, p_kind: 'observed', p_label: label, p_claim: claim, p_source_url: url, p_quote: quote,
            p_context: verified ? result.context : null, p_verified: verified,
          })
          if (error) return failed(error)
          if (verified) stats.checked++
          else stats.unchecked++
          changed()
          await event('tool', `Fact: ${String(label)} (${verified ? 'checked against the page' : 'not checked'})`)
          return verified
            ? ok('Saved, checked against the page.')
            : ok(`Saved, marked NOT CHECKED: ${result.why}. A person will have to open the page; do not lean on this fact for the score.`)
        },
      },
      {
        name: 'save_inference',
        description:
          'Save a conclusion you draw from the facts, which no page states outright. It is shown as inferred, never as fact. Say which facts it rests on.',
        shape: {
          label: z.string().min(2).max(80),
          claim: z.string().min(5).max(1000).describe('The inference and what it rests on, e.g. "Likely no online inventory: the site has no search and its last update is 2014."'),
        },
        run: async ({ label, claim }) => {
          const { error } = await deps.rpc('agent_save_fact', { p_job_id: deps.jobId, p_kind: 'inferred', p_label: label, p_claim: claim })
          if (error) return failed(error)
          stats.inferred++
          changed()
          return ok('Saved as inferred.')
        },
      },
      {
        name: 'save_contact',
        description:
          'Save a person at this business in their business role (owner, manager), where a public page names them. Give the page and the exact words naming them. Business details only: nothing personal, nothing from social profiles.',
        shape: {
          full_name: z.string().min(3).max(120),
          title: z.string().max(120).optional(),
          email: z.string().max(200).optional().describe('Only a business address the page itself gives.'),
          phone: z.string().max(60).optional(),
          url: z.string(),
          quote: z.string().min(MIN_QUOTE).max(600).describe('The exact words on the page that name this person.'),
        },
        run: async ({ full_name, title, email, phone, url, quote }) => {
          if (!isHttp(url)) return refuse('Not saved: give the web address of the page that names them.')
          const surname = String(full_name).trim().split(/\s+/).at(-1)!.toLowerCase()
          if (!String(quote).toLowerCase().includes(surname)) return refuse('Not saved: the quote must include the person\'s name.')
          const result = await check(url, String(quote))
          if (result.state === 'short') return refuse(`Not saved: quote at least ${MIN_QUOTE} characters.`)
          if (result.state === 'absent') {
            stats.dropped++
            changed()
            await event('warn', `Dropped contact ${String(full_name)}: the quoted words are not on ${url}`)
            return refuse('Not saved: the worker read that page and those words are not on it.')
          }
          const { error } = await deps.rpc('agent_save_contact', {
            p_job_id: deps.jobId, p_full_name: full_name, p_title: title ?? null, p_email: email ?? null, p_phone: phone ?? null,
            p_source_url: url, p_quote: quote, p_verified: result.state === 'verified',
          })
          if (error) return failed(error)
          stats.contacts++
          changed()
          await event('tool', `Contact: ${String(full_name)}${title ? `, ${String(title)}` : ''}`)
          return ok(result.state === 'verified' ? 'Saved, checked against the page.' : `Saved, marked NOT CHECKED: ${result.why}.`)
        },
      },
      {
        name: 'save_enrichment',
        description:
          'Finish the research: how well this business fits, why, and the specific reason to talk to them. Call once, last, after saving the facts it rests on. The reason to talk must be about this business, from its facts, not a general pitch.',
        shape: {
          fit_score: z.number().int().min(0).max(100),
          fit_reasons: z.string().min(20).max(1500).describe('The reasons for the score, each resting on a saved fact. Say what is unknown.'),
          hook: z.string().min(20).max(600).describe('One or two sentences: the specific thing about this business that makes a conversation worth having.'),
          website: z.string().max(300).optional(),
          phone: z.string().max(60).optional(),
          address: z.string().max(300).optional(),
          country: z.string().max(120).optional(),
        },
        run: async ({ fit_score, fit_reasons, hook, website, phone, address, country }) => {
          if (deps.knownFacts + stats.checked + stats.unchecked === 0) {
            return refuse('Not saved: no facts have been saved for this business. Save what you read first (save_fact); a score with nothing under it is a guess. If nothing can be found, give a low score only after saving the facts that show that, or call needs_person.')
          }
          const { error } = await deps.rpc('agent_save_enrichment', {
            p_job_id: deps.jobId, p_fit_score: fit_score, p_fit_reasons: fit_reasons, p_hook: hook,
            p_fields: { website, phone, address, country },
          })
          if (error) return failed(error)
          stats.saved = true
          changed()
          await event('tool', `Scored ${String(fit_score)} out of 100`)
          return ok('Saved.')
        },
      },
    ],

    draft: [
      {
        name: 'save_draft',
        description:
          'Save the outreach draft for a person to edit and send themselves. Call once. Use only proof written in the playbook and facts saved for this account; invent nothing.',
        shape: {
          subject: z.string().max(200).optional().describe('For an email. Leave out for a LinkedIn message or a call script.'),
          body: z.string().min(40).max(6000),
          contact_id: z.string().uuid().optional().describe('The contact it is written to, from the account\'s contacts, if any.'),
        },
        run: async ({ subject, body, contact_id }) => {
          const channel = deps.input.channel
          if (channel === 'email' && !String(subject ?? '').trim()) return refuse('Not saved: an email needs a subject.')
          const { error } = await deps.rpc('agent_save_draft', {
            p_job_id: deps.jobId, p_channel: channel, p_subject: subject ?? null, p_body: body, p_contact_id: contact_id ?? null,
          })
          if (error) return failed(error)
          stats.saved = true
          changed()
          return ok('Saved as a draft.')
        },
      },
    ],

    follow_up: [
      {
        name: 'propose_next_step',
        description: 'Propose what to do next with this account, and the stage it should move to if that changed. Call once.',
        shape: {
          note: z.string().min(10).max(1500).describe('What to do next and why, in a few plain sentences.'),
          stage: z.enum(STAGES).optional().describe('Only if the account should move stage.'),
        },
        run: async ({ note: text, stage }) => {
          const { error } = await deps.rpc('agent_propose', {
            p_job_id: deps.jobId, p_kind: 'next_step', p_summary: 'Next step',
            p_payload: stage ? { note: String(text).trim(), stage } : { note: String(text).trim() },
          })
          if (error) return failed(error)
          stats.proposals++
          stats.saved = true
          changed()
          return ok('Proposed.')
        },
      },
    ],

    lessons: [
      {
        name: 'propose_lesson',
        description:
          'Propose one lesson from the decisions and reasons you were given: a single sentence the agent should act on next time. Only what the decisions actually show; propose none if they show nothing yet.',
        shape: {
          body: z.string().min(10).max(600),
          general: z.boolean().optional().describe('True if it holds in every market, not just this one.'),
        },
        run: async ({ body, general }) => {
          const { error } = await deps.rpc('agent_propose', {
            p_job_id: deps.jobId, p_kind: 'lesson', p_summary: 'Lesson', p_payload: { body: String(body).trim(), general: general === true },
          })
          if (error) return failed(error)
          stats.proposals++
          stats.saved = true
          changed()
          return ok('Proposed.')
        },
      },
    ],
  }

  return [note, needsPerson, ...byKind[deps.kind]]
}

/** Whether the job produced what its kind is for; if not, why it counts as failed. */
export function outcome(kind: RunKind, stats: Stats): { status: 'done' | 'failed' | 'needs_person'; error: string | null } {
  if (stats.needsPerson) return { status: 'needs_person', error: stats.needsPerson }
  // Lessons may honestly find nothing to say.
  if (stats.saved || kind === 'lessons') return { status: 'done', error: null }
  const missing: Record<RunKind, string> = {
    thesis: 'a thesis', sources: 'any source', collector_build: 'a collector', collect: 'any rows',
    enrich: 'a score and reason to talk', draft: 'a draft', follow_up: 'a next step', lessons: 'a lesson',
  }
  return { status: 'failed', error: `The agent finished without saving ${missing[kind]}.` }
}

/** One line on what the evidence check did, for the job's summary. */
export function evidenceLine(stats: Stats) {
  const parts = [
    stats.checked && `${stats.checked} checked against the page`,
    stats.unchecked && `${stats.unchecked} not checked`,
    stats.inferred && `${stats.inferred} inferred`,
    stats.dropped && `${stats.dropped} dropped (words not on the page)`,
    stats.contacts && `${stats.contacts} ${stats.contacts === 1 ? 'person' : 'people'}`,
  ].filter(Boolean)
  return parts.length ? `Facts: ${parts.join(', ')}.` : ''
}
