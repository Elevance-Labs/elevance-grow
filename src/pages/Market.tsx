import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, IconButton, Link as MuiLink, Menu, MenuItem, Stack, Tab,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography,
} from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { JobStatusChip, ProposalCard, RunList, SourceLink, SourceRefs, WorkerNotice } from '../components/Agent'
import { ConfirmDialog, FormDialog, PageHeader } from '../components/common'
import { placeOf, scoreColor } from '../lib/accounts'
import {
  CHANNEL_LABELS, COLLECTOR_STATUS_COLORS, COLLECTOR_STATUS_LABELS, MARKET_STATUS_LABELS, REVIEW_LABELS,
  SOURCE_KIND_LABELS, STAGE_LABELS, errorMessage, timeAgo,
} from '../lib/constants'
import { POLL_MS, useLoad } from '../lib/data'
import { anyOpen, loadRuns, openJob, runsSignature, startRun, type RunOptions, type RunWithJobs } from '../lib/runs'
import { supabase } from '../lib/supabase'
import type {
  Account, AccountReview, Collector, DraftChannel, Lesson, Market, MarketSource, Proposal, RunKind, SourceKind,
} from '../lib/types'

const TABS = ['thesis', 'sources', 'dataset', 'runs'] as const
type TabKey = (typeof TABS)[number]
const TAB_LABELS: Record<TabKey, string> = { thesis: 'Thesis', sources: 'Sources', dataset: 'Dataset', runs: 'Runs' }

/** One market: the agent's workspace for an industry and region. */
export default function MarketPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const tab: TabKey = TABS.includes(params.get('tab') as TabKey) ? (params.get('tab') as TabKey) : 'thesis'

  const market = useLoad<Market>(() => supabase.from('markets').select('*').eq('id', id).maybeSingle(), [id])
  const sources = useLoad<MarketSource[]>(
    () => supabase.from('market_sources').select('*').eq('market_id', id).order('created_at'), [id])
  const collectors = useLoad<Collector[]>(() => supabase.from('collectors').select('*'), [id])
  const accounts = useLoad<Account[]>(
    () => supabase.from('accounts').select('*').eq('market_id', id).order('fit_score', { ascending: false, nullsFirst: false }).order('name'), [id])
  const proposals = useLoad<Proposal[]>(
    () => supabase.from('proposals').select('*').eq('market_id', id).eq('decision', 'pending').order('created_at'), [id])
  const lessons = useLoad<Lesson[]>(
    () => supabase.from('lessons').select('*').eq('market_id', id).order('created_at'), [id])
  const [polling, setPolling] = useState(false)
  const runs = useLoad<RunWithJobs[]>(() => loadRuns(id), [id], polling ? POLL_MS : false)
  const open = anyOpen(runs.data)
  useEffect(() => setPolling(open), [open])

  // When a run or a job moves, what it wrote is read again.
  const signature = runsSignature(runs.data)
  const reloadAll = () => {
    market.reload(); sources.reload(); collectors.reload(); accounts.reload(); proposals.reload(); lessons.reload()
  }
  useEffect(() => {
    if (signature) reloadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const [runError, setRunError] = useState<string | null>(null)
  async function run(kind: RunKind, options: RunOptions = {}) {
    setRunError(null)
    const { error } = await startRun(kind, id, options)
    if (error) setRunError(error)
    await runs.reload()
    return !error
  }

  if (market.loading) return null
  if (!market.data) {
    return (
      <>
        <PageHeader title="Market not found" back="/markets" />
        <Typography sx={{ color: 'text.secondary' }}>It may have been removed.</Typography>
      </>
    )
  }
  const m = market.data
  const pending = (kind: Proposal['kind']) => (proposals.data ?? []).filter((p) => p.kind === kind && !p.account_id)
  const toReview = (accounts.data ?? []).filter((a) => a.review === 'candidate').length

  async function setStatus(status: Market['status']) {
    const { error } = await supabase.from('markets').update({ status }).eq('id', id)
    if (error) setRunError(errorMessage(error))
    market.reload()
  }

  return (
    <>
      <PageHeader
        title={m.name}
        subtitle={m.region}
        back="/markets"
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip size="small" label={MARKET_STATUS_LABELS[m.status]} color={m.status === 'active' ? 'success' : 'default'} />
            {m.status === 'archived' ? (
              <Button size="small" onClick={() => setStatus(m.thesis ? 'active' : 'draft')}>Reopen</Button>
            ) : (
              <Button size="small" onClick={() => setStatus('archived')}>Archive</Button>
            )}
          </Stack>
        }
      />
      <WorkerNotice waiting={open} />
      {runError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setRunError(null)}>
          {runError}
        </Alert>
      )}
      <Tabs
        value={tab}
        onChange={(_, value: TabKey) => setParams(value === 'thesis' ? {} : { tab: value }, { replace: true })}
        variant="scrollable"
        sx={{ mb: 3, borderBottom: 1, borderColor: 'divider' }}
      >
        <Tab value="thesis" label={TAB_LABELS.thesis} />
        <Tab value="sources" label={`${TAB_LABELS.sources}${sources.data?.length ? ` (${sources.data.length})` : ''}`} />
        <Tab value="dataset" label={`${TAB_LABELS.dataset}${toReview ? ` (${toReview} to review)` : ''}`} />
        <Tab value="runs" label={TAB_LABELS.runs} />
      </Tabs>

      {tab === 'thesis' && (
        <ThesisTab market={m} proposals={pending('thesis')} lessonProposals={pending('lesson')} lessons={lessons.data ?? []}
          runs={runs.data} run={run} onChange={reloadAll} />
      )}
      {tab === 'sources' && (
        <SourcesTab market={m} sources={sources.data ?? []} collectors={collectors.data ?? []} proposals={pending('source')}
          runs={runs.data} run={run} onChange={reloadAll} />
      )}
      {tab === 'dataset' && (
        <DatasetTab accounts={accounts.data ?? []} sources={sources.data ?? []} runs={runs.data} run={run} onChange={reloadAll} />
      )}
      {tab === 'runs' && <RunList runs={runs.data ?? []} onChange={runs.reload} empty="Nothing has been run for this market yet." />}
    </>
  )
}

type Run = (kind: RunKind, options?: RunOptions) => Promise<boolean>

// ---------------------------------------------------------------------------
// Thesis
// ---------------------------------------------------------------------------
function ThesisTab({
  market, proposals, lessonProposals, lessons, runs, run, onChange,
}: {
  market: Market
  proposals: Proposal[]
  lessonProposals: Proposal[]
  lessons: Lesson[]
  runs: RunWithJobs[] | null
  run: Run
  onChange: () => void
}) {
  const [editing, setEditing] = useState<'thesis' | 'brief' | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lesson, setLesson] = useState<string | null>(null)
  const writing = openJob(runs, 'thesis')
  const learning = openJob(runs, 'lessons')

  async function save() {
    setBusy(true)
    setError(null)
    const change = editing === 'brief'
      ? { brief: text.trim() }
      : { thesis: text.trim() || null, ...(market.status === 'draft' && text.trim() ? { status: 'active' as const } : {}) }
    const { error: saveError } = await supabase.from('markets').update(change).eq('id', market.id)
    setBusy(false)
    if (saveError) return setError(errorMessage(saveError))
    setEditing(null)
    onChange()
  }

  async function addLesson() {
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from('lessons').insert({ market_id: market.id, body: (lesson ?? '').trim() })
    setBusy(false)
    if (insertError) return setError(errorMessage(insertError))
    setLesson(null)
    onChange()
  }

  async function removeLesson(id: string) {
    await supabase.from('lessons').delete().eq('id', id)
    onChange()
  }

  return (
    <Stack spacing={3}>
      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>What we are after</Typography>
            <Button size="small" onClick={() => { setText(market.brief); setError(null); setEditing('brief') }}>Edit</Button>
          </Stack>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: market.brief ? 'text.primary' : 'text.secondary' }}>
            {market.brief || 'Nothing written. The agent goes by the industry, the region and the playbook.'}
          </Typography>
        </CardContent>
      </Card>

      {proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} onDecided={onChange} />
      ))}

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>Thesis</Typography>
            {writing ? (
              <JobStatusChip status={writing.status} />
            ) : (
              <Button size="small" variant={market.thesis ? 'text' : 'contained'} onClick={() => run('thesis')}>
                {market.thesis ? 'Research again' : 'Write the thesis'}
              </Button>
            )}
            <Button size="small" onClick={() => { setText(market.thesis ?? ''); setError(null); setEditing('thesis') }}>
              {market.thesis ? 'Edit' : 'Type it yourself'}
            </Button>
          </Stack>
          {market.thesis ? (
            <>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>{market.thesis}</Typography>
              <SourceRefs sources={market.thesis_sources ?? []} />
            </>
          ) : (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              The thesis is the industry brief everything else is built on: how these businesses work, who owns them,
              what software they run, where they are listed. The agent researches it from live sources and proposes it;
              nothing is kept until you accept it.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>What we have learned here</Typography>
            {learning ? <JobStatusChip status={learning.status} /> : <Button size="small" onClick={() => run('lessons')}>Suggest lessons</Button>}
            <Button size="small" onClick={() => { setLesson(''); setError(null) }}>Add one</Button>
          </Stack>
          <Stack spacing={1}>
            {lessonProposals.map((p) => (
              <ProposalCard key={p.id} proposal={p} onDecided={onChange} />
            ))}
            {lessons.length === 0 && lessonProposals.length === 0 && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Nothing yet. Lessons come from your decisions: what you accepted, what you parked and why. The agent
                reads them before every job in this market.
              </Typography>
            )}
            {lessons.map((l) => (
              <Stack key={l.id} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <Typography variant="body2" sx={{ flexGrow: 1 }}>{l.body}</Typography>
                <Tooltip title="Remove">
                  <IconButton size="small" aria-label={`Remove lesson: ${l.body}`} onClick={() => removeLesson(l.id)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            ))}
          </Stack>
        </CardContent>
      </Card>

      <FormDialog open={editing !== null} title={editing === 'brief' ? 'What we are after' : 'Thesis'} busy={busy} error={error}
        onSubmit={save} onClose={() => setEditing(null)}>
        <TextField label={editing === 'brief' ? 'What we are after' : 'Thesis'} multiline minRows={editing === 'brief' ? 3 : 10}
          autoFocus value={text} onChange={(e) => setText(e.target.value)} />
      </FormDialog>
      <FormDialog open={lesson !== null} title="Add a lesson" submitLabel="Add" busy={busy} error={error} onSubmit={addLesson} onClose={() => setLesson(null)}>
        <TextField label="Lesson" multiline minRows={2} required autoFocus value={lesson ?? ''}
          helperText="One sentence the agent should act on in this market." onChange={(e) => setLesson(e.target.value)} />
      </FormDialog>
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
function SourcesTab({
  market, sources, collectors, proposals, runs, run, onChange,
}: {
  market: Market
  sources: MarketSource[]
  collectors: Collector[]
  proposals: Proposal[]
  runs: RunWithJobs[] | null
  run: Run
  onChange: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', url: '', kind: 'other' as SourceKind, why: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<MarketSource | null>(null)
  const finding = openJob(runs, 'sources')

  async function add() {
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from('market_sources').insert({
      market_id: market.id, name: form.name.trim(), url: form.url.trim(), kind: form.kind, why: form.why.trim(),
    })
    setBusy(false)
    if (insertError) return setError(errorMessage(insertError, 'That address is already a source here.'))
    setAdding(false)
    setForm({ name: '', url: '', kind: 'other', why: '' })
    onChange()
  }

  async function toggle(source: MarketSource) {
    await supabase.from('market_sources').update({ selected: !source.selected }).eq('id', source.id)
    onChange()
  }

  async function remove() {
    if (!removing) return
    await supabase.from('market_sources').delete().eq('id', removing.id)
    setRemoving(null)
    onChange()
  }

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
        <Typography variant="body2" sx={{ color: 'text.secondary', flexGrow: 1, minWidth: 240 }}>
          Where lists of these businesses live. Tick the ones to use; each needs a collector, a small script that reads
          it, which the agent writes and an admin approves.
        </Typography>
        {finding ? (
          <JobStatusChip status={finding.status} />
        ) : (
          <Tooltip title={market.thesis ? '' : 'Approve a thesis first: sources are found from it.'}>
            <span>
              <Button variant="contained" disabled={!market.thesis} onClick={() => run('sources')}>Find sources</Button>
            </span>
          </Tooltip>
        )}
        <Button onClick={() => { setError(null); setAdding(true) }}>Add one</Button>
      </Stack>

      {proposals.map((p) => (
        <ProposalCard key={p.id} proposal={p} onDecided={onChange} />
      ))}

      {sources.length === 0 && proposals.length === 0 && (
        <Typography sx={{ color: 'text.secondary' }}>No sources yet.</Typography>
      )}
      {sources.map((source) => {
        const collector = collectors.find((c) => c.id === source.collector_id) ?? null
        const building = openJob(runs, 'collector_build', { sourceId: source.id })
        const collecting = openJob(runs, 'collect', { sourceId: source.id })
        return (
          <Card key={source.id} variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                <Tooltip title={source.selected ? 'In use' : 'Not in use'}>
                  <Checkbox checked={source.selected} onChange={() => toggle(source)} sx={{ mt: -1, ml: -1 }}
                    slotProps={{ input: { 'aria-label': `Use ${source.name}` } }} />
                </Tooltip>
                <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                  <Typography variant="subtitle2">
                    {source.name} <Chip size="small" label={SOURCE_KIND_LABELS[source.kind]} sx={{ ml: 0.5 }} />
                  </Typography>
                  <Typography variant="body2"><SourceLink url={source.url} /></Typography>
                  {source.why && <Typography variant="body2" sx={{ mt: 0.5 }}>{source.why}</Typography>}
                  {source.terms_note && (
                    <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
                      Terms: {source.terms_note}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
                    {collector ? (
                      <Chip size="small" component={Link} to="/sources" clickable
                        label={`Collector: ${COLLECTOR_STATUS_LABELS[collector.status]}`} color={COLLECTOR_STATUS_COLORS[collector.status]} />
                    ) : (
                      <Chip size="small" label="No collector" />
                    )}
                    {collector?.last_run_at && (
                      <Typography variant="caption" sx={{ color: collector.health === 'error' ? 'error.main' : 'text.secondary' }}>
                        {collector.health === 'error' ? 'Last run failed' : `${collector.last_rows ?? 0} rows`} · {timeAgo(collector.last_run_at)}
                      </Typography>
                    )}
                    {building && <JobStatusChip status={building.status} />}
                    {collecting && <JobStatusChip status={collecting.status} />}
                    {!building && !collecting && source.selected && (
                      <>
                        {collector?.status === 'approved' && (
                          <Button size="small" variant="contained" onClick={() => run('collect', { sourceId: source.id })}>
                            Collect
                          </Button>
                        )}
                        <Button size="small" onClick={() => run('collector_build', { sourceId: source.id })}>
                          {collector ? 'Rebuild collector' : 'Build collector'}
                        </Button>
                      </>
                    )}
                  </Stack>
                </Box>
                <Tooltip title="Remove">
                  <IconButton size="small" aria-label={`Remove ${source.name}`} onClick={() => setRemoving(source)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </CardContent>
          </Card>
        )
      })}

      <FormDialog open={adding} title="Add a source" submitLabel="Add" busy={busy} error={error} onSubmit={add} onClose={() => setAdding(false)}>
        <TextField label="Name" required autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextField label="Web address" required type="url" placeholder="https://" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <TextField select label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as SourceKind })}>
          {Object.entries(SOURCE_KIND_LABELS).map(([value, label]) => (
            <MenuItem key={value} value={value}>{label}</MenuItem>
          ))}
        </TextField>
        <TextField label="Why this source (optional)" multiline value={form.why} onChange={(e) => setForm({ ...form, why: e.target.value })} />
      </FormDialog>
      <ConfirmDialog open={removing !== null} title="Remove this source?" destructive confirmLabel="Remove"
        message={`${removing?.name ?? ''} will no longer be collected from. Businesses already collected stay.`}
        onConfirm={remove} onClose={() => setRemoving(null)} />
    </Stack>
  )
}

// ---------------------------------------------------------------------------
// Dataset
// ---------------------------------------------------------------------------
const REVIEWS: AccountReview[] = ['candidate', 'accepted', 'rejected']

function DatasetTab({
  accounts, sources, runs, run, onChange,
}: {
  accounts: Account[]
  sources: MarketSource[]
  runs: RunWithJobs[] | null
  run: Run
  onChange: () => void
}) {
  const [params, setParams] = useSearchParams()
  const counts = useMemo(
    () => Object.fromEntries(REVIEWS.map((r) => [r, accounts.filter((a) => a.review === r).length])) as Record<AccountReview, number>,
    [accounts])
  const asked = params.get('review') as AccountReview | null
  const review: AccountReview = asked && REVIEWS.includes(asked) ? asked : counts.candidate || !counts.accepted ? 'candidate' : 'accepted'
  const rows = accounts.filter((a) => a.review === review)
  const [selected, setSelected] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [channelMenu, setChannelMenu] = useState<HTMLElement | null>(null)
  const chosen = selected.filter((id) => rows.some((a) => a.id === id))
  useEffect(() => setSelected([]), [review])

  const setReview = (next: AccountReview) => {
    const p = new URLSearchParams(params)
    p.set('review', next)
    setParams(p, { replace: true })
  }

  async function decide(decision: AccountReview) {
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('accounts_review', { p_ids: chosen, p_decision: decision })
    setBusy(false)
    if (rpcError) return setError(rpcError.message)
    setSelected([])
    onChange()
  }

  async function start(kind: RunKind, input?: Record<string, unknown>) {
    setChannelMenu(null)
    setBusy(true)
    const ok = await run(kind, { accountIds: chosen, input })
    setBusy(false)
    if (ok) setSelected([])
  }

  const allChosen = rows.length > 0 && chosen.length === rows.length
  const draftable = chosen.every((id) => {
    const a = rows.find((x) => x.id === id)
    return a && a.hook !== null && !a.do_not_contact
  })

  return (
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, alignItems: 'center' }}>
        {REVIEWS.map((r) => (
          <Chip key={r} label={`${REVIEW_LABELS[r]} (${counts[r]})`} color={r === review ? 'primary' : 'default'}
            variant={r === review ? 'filled' : 'outlined'} onClick={() => setReview(r)} />
        ))}
        <Box sx={{ flexGrow: 1 }} />
        {chosen.length > 0 && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>{chosen.length} selected</Typography>
        )}
        {review !== 'accepted' && (
          <Button variant="contained" disabled={!chosen.length} loading={busy} onClick={() => decide('accepted')}>Accept</Button>
        )}
        {review !== 'rejected' && (
          <Button color="error" disabled={!chosen.length || busy} onClick={() => decide('rejected')}>Reject</Button>
        )}
        {review === 'accepted' && (
          <>
            <Button variant="contained" disabled={!chosen.length} loading={busy} onClick={() => start('enrich')}>Research</Button>
            <Tooltip title={chosen.length && !draftable ? 'Research an account before drafting to it; do-not-contact accounts get no drafts.' : ''}>
              <span>
                <Button disabled={!chosen.length || !draftable || busy} onClick={(e) => setChannelMenu(e.currentTarget)}>
                  Draft outreach
                </Button>
              </span>
            </Tooltip>
            <Menu anchorEl={channelMenu} open={!!channelMenu} onClose={() => setChannelMenu(null)}>
              {(Object.keys(CHANNEL_LABELS) as DraftChannel[]).map((channel) => (
                <MenuItem key={channel} onClick={() => start('draft', { channel })}>{CHANNEL_LABELS[channel]}</MenuItem>
              ))}
            </Menu>
          </>
        )}
      </Stack>
      {error && <Alert severity="error">{error}</Alert>}

      {rows.length === 0 ? (
        <Typography sx={{ color: 'text.secondary' }}>
          {accounts.length === 0
            ? 'No businesses yet. Collect from a source on the Sources tab and they appear here to review.'
            : `Nothing ${REVIEW_LABELS[review].toLowerCase()}.`}
        </Typography>
      ) : (
        <TableContainer component={Card} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox">
                  <Checkbox checked={allChosen} indeterminate={chosen.length > 0 && !allChosen}
                    onChange={() => setSelected(allChosen ? [] : rows.map((a) => a.id))}
                    slotProps={{ input: { 'aria-label': 'Select all' } }} />
                </TableCell>
                <TableCell>Business</TableCell>
                <TableCell>Place</TableCell>
                <TableCell>Website</TableCell>
                <TableCell>From</TableCell>
                {review === 'accepted' && <TableCell>Fit</TableCell>}
                {review === 'accepted' && <TableCell>Stage</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((a) => {
                const working = openJob(runs, 'enrich', { accountId: a.id }) ?? openJob(runs, 'draft', { accountId: a.id })
                return (
                  <TableRow key={a.id} hover selected={chosen.includes(a.id)}>
                    <TableCell padding="checkbox">
                      <Checkbox checked={chosen.includes(a.id)}
                        onChange={() => setSelected((s) => (s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id]))}
                        slotProps={{ input: { 'aria-label': `Select ${a.name}` } }} />
                    </TableCell>
                    <TableCell>
                      <MuiLink component={Link} to={`/accounts/${a.id}`} underline="hover" sx={{ fontWeight: 500 }}>{a.name}</MuiLink>
                      {a.do_not_contact && <Chip size="small" label="Do not contact" color="error" variant="outlined" sx={{ ml: 1 }} />}
                    </TableCell>
                    <TableCell>{placeOf(a) || '—'}</TableCell>
                    <TableCell>{a.domain ? <SourceLink url={a.website}>{a.domain}</SourceLink> : '—'}</TableCell>
                    <TableCell>{sources.find((s) => s.id === a.source_id)?.name ?? (a.source_id ? '—' : 'Added by hand')}</TableCell>
                    {review === 'accepted' && (
                      <TableCell>
                        {working ? <JobStatusChip status={working.status} />
                          : a.fit_score === null ? '—' : <Chip size="small" label={a.fit_score} color={scoreColor(a.fit_score)} />}
                      </TableCell>
                    )}
                    {review === 'accepted' && <TableCell>{STAGE_LABELS[a.stage]}</TableCell>}
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Stack>
  )
}
