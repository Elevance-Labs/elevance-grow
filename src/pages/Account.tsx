import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, Chip, Collapse, Divider, FormControlLabel, IconButton, Link as MuiLink,
  Menu, MenuItem, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopyOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { JobStatusChip, ProposalCard, SourceLink, WorkerNotice } from '../components/Agent'
import { FormDialog, PageHeader } from '../components/common'
import { factCounts, linkedinSearchUrl, placeOf, scoreColor, standing } from '../lib/accounts'
import {
  ACTIVITY_LABELS, CHANNEL_LABELS, DRAFT_STATUS_LABELS, STAGES, STAGE_COLORS, STAGE_LABELS, errorMessage,
  formatDayTime, stageNeedsReason, trimOrNull,
} from '../lib/constants'
import { POLL_MS, useLoad } from '../lib/data'
import { anyOpen, loadRuns, openJob, runsSignature, startRun, type RunWithJobs } from '../lib/runs'
import { supabase } from '../lib/supabase'
import type {
  Account, AccountFact, AccountStage, Activity, ActivityKind, Contact, Draft, DraftChannel, Proposal,
} from '../lib/types'

/** One business: what is known and where it was read, the reason to talk, drafts and the timeline. */
export default function AccountPage() {
  const { id = '' } = useParams()
  const account = useLoad<Account>(() => supabase.from('accounts').select('*').eq('id', id).maybeSingle(), [id])
  const facts = useLoad<AccountFact[]>(() => supabase.from('account_facts').select('*').eq('account_id', id).order('created_at'), [id])
  const contacts = useLoad<Contact[]>(() => supabase.from('contacts').select('*').eq('account_id', id).order('created_at'), [id])
  const drafts = useLoad<Draft[]>(() => supabase.from('drafts').select('*').eq('account_id', id).order('created_at', { ascending: false }), [id])
  const timeline = useLoad<Activity[]>(() => supabase.from('activities').select('*').eq('account_id', id).order('created_at', { ascending: false }), [id])
  const proposals = useLoad<Proposal[]>(
    () => supabase.from('proposals').select('*').eq('account_id', id).eq('decision', 'pending').order('created_at'), [id])
  const marketId = account.data?.market_id ?? null
  const [polling, setPolling] = useState(false)
  const runs = useLoad<RunWithJobs[]>(
    () => (marketId ? loadRuns(marketId) : Promise.resolve({ data: [] as RunWithJobs[], error: null })),
    [marketId], polling ? POLL_MS : false)
  const mine = (runs.data ?? []).map((r) => ({ ...r, jobs: r.jobs.filter((j) => j.account_id === id) })).filter((r) => r.jobs.length)
  const open = anyOpen(mine)
  useEffect(() => setPolling(open), [open])

  const reloadAll = () => {
    account.reload(); facts.reload(); contacts.reload(); drafts.reload(); timeline.reload(); proposals.reload()
  }
  const signature = runsSignature(mine)
  useEffect(() => {
    if (signature) reloadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const [error, setError] = useState<string | null>(null)
  const [moving, setMoving] = useState<AccountStage | null>(null)
  const [stageMenu, setStageMenu] = useState<HTMLElement | null>(null)
  const [channelMenu, setChannelMenu] = useState<HTMLElement | null>(null)
  const [showRejected, setShowRejected] = useState(false)

  if (account.loading) return null
  const a = account.data
  if (!a) {
    return (
      <>
        <PageHeader title="Account not found" back="/markets" />
        <Typography sx={{ color: 'text.secondary' }}>It may have been removed.</Typography>
      </>
    )
  }

  async function run(kind: 'enrich' | 'draft' | 'follow_up', input?: Record<string, unknown>) {
    setError(null)
    setChannelMenu(null)
    const result = await startRun(kind, a!.market_id, { accountIds: [a!.id], input })
    if (result.error) setError(result.error)
    runs.reload()
  }

  async function move(stage: AccountStage, note: string | null) {
    setError(null)
    const { error: rpcError } = await supabase.rpc('account_move', { p_id: a!.id, p_stage: stage, p_note: note })
    if (rpcError) return rpcError.message
    reloadAll()
    return null
  }

  async function pickStage(stage: AccountStage) {
    setStageMenu(null)
    if (stageNeedsReason(stage)) return setMoving(stage)
    const failed = await move(stage, null)
    if (failed) setError(failed)
  }

  async function review(decision: 'accepted' | 'rejected') {
    const { error: rpcError } = await supabase.rpc('accounts_review', { p_ids: [a!.id], p_decision: decision })
    if (rpcError) setError(rpcError.message)
    reloadAll()
  }

  async function patch(change: Partial<Account>) {
    const { error: saveError } = await supabase.from('accounts').update(change).eq('id', a!.id)
    if (saveError) setError(errorMessage(saveError, 'Another business here already has that name and place.'))
    account.reload()
  }

  const researching = openJob(mine, 'enrich')
  const drafting = openJob(mine, 'draft')
  const counts = factCounts(facts.data ?? [])
  const live = standing(facts.data ?? [])
  const rejected = (facts.data ?? []).filter((f) => f.rejected_at)

  return (
    <>
      <PageHeader
        title={a.name}
        subtitle={[placeOf(a), a.domain].filter(Boolean).join(' · ') || undefined}
        back={`/markets/${a.market_id}?tab=dataset`}
        actions={
          a.review === 'accepted' ? (
            <>
              <Chip component="button" label={STAGE_LABELS[a.stage]} color={STAGE_COLORS[a.stage]} onClick={(e) => setStageMenu(e.currentTarget)}
                aria-label={`Stage: ${STAGE_LABELS[a.stage]}. Change`} />
              <Menu anchorEl={stageMenu} open={!!stageMenu} onClose={() => setStageMenu(null)}>
                {STAGES.filter((s) => s !== a.stage).map((s) => (
                  <MenuItem key={s} onClick={() => pickStage(s)}>Move to {STAGE_LABELS[s]}</MenuItem>
                ))}
              </Menu>
            </>
          ) : (
            <Stack direction="row" spacing={1}>
              <Button variant="contained" onClick={() => review('accepted')}>Accept</Button>
              {a.review !== 'rejected' && <Button color="error" onClick={() => review('rejected')}>Reject</Button>}
            </Stack>
          )
        }
      />
      <WorkerNotice waiting={open} />
      {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}
      {a.review === 'candidate' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Collected, not yet reviewed. Accept it to research it; reject it and it will not be collected again.
        </Alert>
      )}

      <Stack spacing={2} sx={{ mb: 2 }}>
        {(proposals.data ?? []).map((p) => (
          <ProposalCard key={p.id} proposal={p} onDecided={reloadAll} />
        ))}
      </Stack>

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' }, alignItems: 'start' }}>
        <Stack spacing={2}>
          {/* The reason to talk */}
          <Card variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>The reason to talk</Typography>
                {a.fit_score !== null && <Chip size="small" label={`Fit ${a.fit_score}`} color={scoreColor(a.fit_score)} />}
                {researching ? (
                  <JobStatusChip status={researching.status} />
                ) : (
                  a.review === 'accepted' && (
                    <Button size="small" variant={a.enriched_at ? 'text' : 'contained'} onClick={() => run('enrich')}>
                      {a.enriched_at ? 'Research again' : 'Research'}
                    </Button>
                  )
                )}
              </Stack>
              {a.hook ? (
                <EditableText label="The reason to talk" value={a.hook} onSave={(hook) => patch({ hook: trimOrNull(hook) })} />
              ) : (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Not researched yet. The agent reads this business's own site and public listings, saves what it finds
                  with the page and the words it found it in, then says how well it fits and why you would call.
                </Typography>
              )}
              {a.fit_reasons && (
                <Typography variant="body2" sx={{ mt: 1.5, color: 'text.secondary', whiteSpace: 'pre-wrap' }}>
                  {a.fit_reasons}
                </Typography>
              )}
            </CardContent>
          </Card>

          {/* Evidence */}
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>What we know</Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {counts.verified} checked against the page · {counts.unverified} not checked · {counts.inferred} inferred
              </Typography>
              <Stack spacing={1.5} divider={<Divider flexItem />} sx={{ mt: 1.5 }}>
                {live.length === 0 && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>No facts yet.</Typography>
                )}
                {live.map((f) => (
                  <Fact key={f.id} fact={f} onChange={facts.reload} />
                ))}
              </Stack>
              {rejected.length > 0 && (
                <>
                  <Button size="small" sx={{ mt: 1.5 }} onClick={() => setShowRejected((v) => !v)}>
                    {showRejected ? 'Hide' : 'Show'} {rejected.length} set aside
                  </Button>
                  <Collapse in={showRejected} unmountOnExit>
                    <Stack spacing={1.5} divider={<Divider flexItem />} sx={{ mt: 1, opacity: 0.7 }}>
                      {rejected.map((f) => (
                        <Fact key={f.id} fact={f} onChange={facts.reload} />
                      ))}
                    </Stack>
                  </Collapse>
                </>
              )}
            </CardContent>
          </Card>

          {/* Drafts */}
          <Card variant="outlined">
            <CardContent>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>Outreach</Typography>
                {drafting ? (
                  <JobStatusChip status={drafting.status} />
                ) : (
                  a.review === 'accepted' && (
                    <Tooltip title={a.do_not_contact ? 'Marked do not contact.' : a.hook ? '' : 'Research the account first: a draft is built on its reason to talk.'}>
                      <span>
                        <Button size="small" disabled={a.do_not_contact || !a.hook} onClick={(e) => setChannelMenu(e.currentTarget)}>
                          Draft outreach
                        </Button>
                      </span>
                    </Tooltip>
                  )
                )}
                <Menu anchorEl={channelMenu} open={!!channelMenu} onClose={() => setChannelMenu(null)}>
                  {(Object.keys(CHANNEL_LABELS) as DraftChannel[]).map((channel) => (
                    <MenuItem key={channel} onClick={() => run('draft', { channel })}>{CHANNEL_LABELS[channel]}</MenuItem>
                  ))}
                </Menu>
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                Nothing is sent from here. Copy a draft out, send it yourself, then mark it sent.
              </Typography>
              <Stack spacing={2} sx={{ mt: 1.5 }}>
                {(drafts.data ?? []).map((d) => (
                  <DraftCard key={d.id} draft={d} blocked={a.do_not_contact} onChange={reloadAll} />
                ))}
              </Stack>
            </CardContent>
          </Card>
        </Stack>

        <Stack spacing={2}>
          {/* Details */}
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>Details</Typography>
              <Detail label="Website">{a.website ? <SourceLink url={a.website} /> : '—'}</Detail>
              <Detail label="Phone">{a.phone ?? '—'}</Detail>
              <Detail label="Address">{[a.address, placeOf(a), a.country].filter(Boolean).join(', ') || '—'}</Detail>
              {a.source_url && <Detail label="Listed at"><SourceLink url={a.source_url} /></Detail>}
              <FormControlLabel
                sx={{ mt: 1 }}
                control={<Switch checked={a.do_not_contact} onChange={(e) => patch({ do_not_contact: e.target.checked })} />}
                label="Do not contact"
              />
            </CardContent>
          </Card>

          {/* People */}
          <Card variant="outlined">
            <CardContent>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1 }}>People</Typography>
              {(contacts.data ?? []).length === 0 && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Nobody yet. Research finds the owner or manager where they are publicly named.
                </Typography>
              )}
              <Stack spacing={1.5} divider={<Divider flexItem />}>
                {(contacts.data ?? []).map((c) => (
                  <Box key={c.id}>
                    <Typography variant="subtitle2">{c.full_name}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {[c.title, c.email, c.phone].filter(Boolean).join(' · ') || 'No details'}
                    </Typography>
                    {c.source_url && (
                      <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                        {c.verified ? 'Named at ' : 'Said to be named at '}
                        <SourceLink url={c.source_url} />
                        {c.quote && `: “${c.quote}”`}
                      </Typography>
                    )}
                    {/* A person looks on LinkedIn; the app never does. */}
                    <MuiLink href={linkedinSearchUrl(c, a)} target="_blank" rel="noopener noreferrer" variant="caption">
                      Find on LinkedIn
                    </MuiLink>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>

          {/* Timeline */}
          <Timeline accountId={a.id} entries={timeline.data ?? []} followingUp={!!openJob(mine, 'follow_up')}
            onAdded={(activityId, kind) => {
              timeline.reload()
              if (kind !== 'note') run('follow_up', { activity_id: activityId })
            }} />
        </Stack>
      </Box>

      {moving && (
        <ReasonDialog stage={moving} onMove={(note) => move(moving, note)} onClose={() => setMoving(null)} />
      )}
    </>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, py: 0.5 }}>
      <Typography variant="body2" sx={{ color: 'text.secondary', width: 88, flexShrink: 0 }}>{label}</Typography>
      <Typography variant="body2" sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Typography>
    </Box>
  )
}

/** Text a person may rewrite in place. */
function EditableText({ label, value, onSave }: { label: string; value: string; onSave: (value: string) => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(value)
  if (!editing) {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Typography sx={{ flexGrow: 1, whiteSpace: 'pre-wrap' }}>{value}</Typography>
        <Button size="small" onClick={() => { setText(value); setEditing(true) }}>Edit</Button>
      </Stack>
    )
  }
  return (
    <Stack spacing={1}>
      <TextField label={label} multiline fullWidth autoFocus value={text} onChange={(e) => setText(e.target.value)} />
      <Stack direction="row" spacing={1}>
        <Button size="small" variant="contained" onClick={() => { onSave(text); setEditing(false) }}>Save</Button>
        <Button size="small" onClick={() => setEditing(false)}>Cancel</Button>
      </Stack>
    </Stack>
  )
}

/** One claim with where it was read. The chip says how far to trust it. */
function Fact({ fact, onChange }: { fact: AccountFact; onChange: () => void }) {
  const [open, setOpen] = useState(false)
  const set = async (rejected: boolean) => {
    await supabase.rpc('fact_reject', { p_id: fact.id, p_rejected: rejected })
    onChange()
  }
  const trust = fact.kind === 'inferred'
    ? { label: 'Inferred', color: 'default' as const, hint: 'The agent\'s reading of the facts, not something it saw written.' }
    : fact.verified
      ? { label: 'Checked', color: 'success' as const, hint: 'The worker read the page again itself and found these words on it.' }
      : { label: 'Not checked', color: 'warning' as const, hint: 'The worker could not re-read the page to confirm these words. Open the page before relying on this.' }
  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {fact.label}
        </Typography>
        <Tooltip title={trust.hint}>
          <Chip size="small" variant="outlined" label={trust.label} color={trust.color} />
        </Tooltip>
        <Box sx={{ flexGrow: 1 }} />
        <Button size="small" color={fact.rejected_at ? 'primary' : 'inherit'} onClick={() => set(!fact.rejected_at)}>
          {fact.rejected_at ? 'Bring back' : 'Wrong'}
        </Button>
      </Stack>
      <Typography variant="body2">{fact.claim}</Typography>
      {fact.quote && (
        <Typography variant="body2" sx={{ mt: 0.5, pl: 1.5, borderLeft: 3, borderColor: 'divider', color: 'text.secondary', fontStyle: 'italic', overflowWrap: 'anywhere' }}>
          “{fact.quote}”
        </Typography>
      )}
      {fact.source_url && (
        <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
          <SourceLink url={fact.source_url} />
          {fact.read_at && ` · read ${formatDayTime(fact.read_at)}`}
          {fact.context && (
            <>
              {' · '}
              <MuiLink component="button" type="button" variant="caption" onClick={() => setOpen((v) => !v)}>
                {open ? 'hide' : 'show'} the words around it
              </MuiLink>
            </>
          )}
        </Typography>
      )}
      {fact.context && (
        <Collapse in={open} unmountOnExit>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, p: 1, bgcolor: 'background.subtle', borderRadius: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
            {fact.context}
          </Typography>
        </Collapse>
      )}
    </Box>
  )
}

function DraftCard({ draft, blocked, onChange }: { draft: Draft; blocked: boolean; onChange: () => void }) {
  const [subject, setSubject] = useState(draft.subject ?? '')
  const [body, setBody] = useState(draft.body)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const sent = draft.status === 'sent'
  const dirty = !sent && (body !== draft.body || subject !== (draft.subject ?? ''))

  async function save() {
    setError(null)
    const { error: saveError } = await supabase.from('drafts').update({ subject: trimOrNull(subject), body: body.trim() }).eq('id', draft.id)
    if (saveError) return setError(errorMessage(saveError))
    onChange()
  }

  async function mark(status: 'copied' | 'sent') {
    setError(null)
    const { error: rpcError } = await supabase.rpc('draft_mark', { p_id: draft.id, p_status: status })
    if (rpcError) return setError(rpcError.message)
    onChange()
  }

  async function copy() {
    if (dirty) await save()
    const text = draft.channel === 'email' && subject.trim() ? `Subject: ${subject.trim()}\n\n${body}` : body
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      return setError('Could not copy. Select the text and copy it yourself.')
    }
    if (draft.status === 'draft') await mark('copied')
  }

  async function remove() {
    await supabase.from('drafts').delete().eq('id', draft.id)
    onChange()
  }

  return (
    <Box sx={{ p: 1.5, border: 1, borderColor: 'divider', borderRadius: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
        <Chip size="small" label={CHANNEL_LABELS[draft.channel]} />
        <Chip size="small" variant="outlined" label={DRAFT_STATUS_LABELS[draft.status]} color={sent ? 'success' : 'default'} />
        <Typography variant="caption" sx={{ color: 'text.secondary', flexGrow: 1 }}>
          {formatDayTime(sent ? draft.sent_at : draft.created_at)}
        </Typography>
        {!sent && (
          <Tooltip title="Delete draft">
            <IconButton size="small" aria-label="Delete draft" onClick={remove}><DeleteOutlineIcon fontSize="small" /></IconButton>
          </Tooltip>
        )}
      </Stack>
      <Stack spacing={1.5}>
        {draft.channel === 'email' && (
          <TextField label="Subject" fullWidth value={subject} disabled={sent} onChange={(e) => setSubject(e.target.value)} />
        )}
        <TextField label="Message" multiline minRows={4} fullWidth value={body} disabled={sent} onChange={(e) => setBody(e.target.value)} />
        {error && <Alert severity="error">{error}</Alert>}
        {!sent && (
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
            <Button size="small" variant="contained" startIcon={<ContentCopyIcon />} onClick={copy}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {dirty && <Button size="small" onClick={save}>Save changes</Button>}
            <Tooltip title={blocked ? 'This account is marked do not contact.' : ''}>
              <span>
                <Button size="small" disabled={blocked || dirty} onClick={() => mark('sent')}>Mark as sent</Button>
              </span>
            </Tooltip>
          </Stack>
        )}
      </Stack>
    </Box>
  )
}

const LOGGABLE: ActivityKind[] = ['note', 'reply', 'call']

/** The account's history, and the box to add to it. A reply or call notes also ask the agent what to do next. */
function Timeline({
  accountId, entries, followingUp, onAdded,
}: {
  accountId: string
  entries: Activity[]
  followingUp: boolean
  onAdded: (activityId: string, kind: ActivityKind) => void
}) {
  const [kind, setKind] = useState<ActivityKind>('note')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    if (!body.trim()) return
    setBusy(true)
    setError(null)
    const { data, error: insertError } = await supabase
      .from('activities').insert({ account_id: accountId, kind, body: body.trim() }).select('id').single()
    setBusy(false)
    if (insertError) return setError(errorMessage(insertError))
    setBody('')
    onAdded((data as { id: string }).id, kind)
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>Timeline</Typography>
          {followingUp && <Chip size="small" color="info" label="Working out the next step" />}
        </Stack>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1}>
            {LOGGABLE.map((k) => (
              <Chip key={k} size="small" label={ACTIVITY_LABELS[k]} color={k === kind ? 'primary' : 'default'}
                variant={k === kind ? 'filled' : 'outlined'} onClick={() => setKind(k)} />
            ))}
          </Stack>
          <TextField
            label={kind === 'reply' ? 'Paste their reply' : kind === 'call' ? 'What was said' : 'Note'}
            multiline minRows={2} fullWidth value={body} onChange={(e) => setBody(e.target.value)}
            helperText={kind === 'note' ? undefined : 'Saving this also asks the agent to suggest the next step.'}
          />
          {error && <Alert severity="error">{error}</Alert>}
          <Box>
            <Button size="small" variant="contained" loading={busy} disabled={!body.trim()} onClick={add}>Add</Button>
          </Box>
        </Stack>
        <Stack spacing={1.5} divider={<Divider flexItem />} sx={{ mt: 2 }}>
          {entries.map((e) => (
            <Box key={e.id}>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {describe(e)} · {formatDayTime(e.created_at)}
              </Typography>
              {e.body && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{e.body}</Typography>}
            </Box>
          ))}
        </Stack>
      </CardContent>
    </Card>
  )
}

function describe(e: Activity) {
  if (e.kind === 'stage') {
    const to = e.meta.to as AccountStage | undefined
    return to ? `Moved to ${STAGE_LABELS[to]}` : ACTIVITY_LABELS.stage
  }
  if (e.kind === 'review') return e.meta.decision === 'rejected' ? 'Rejected' : 'Accepted'
  if (e.kind === 'draft_sent') {
    const channel = e.meta.channel as DraftChannel | undefined
    return channel ? `${CHANNEL_LABELS[channel]} sent` : ACTIVITY_LABELS.draft_sent
  }
  return ACTIVITY_LABELS[e.kind]
}

function ReasonDialog({
  stage, onMove, onClose,
}: {
  stage: AccountStage
  onMove: (note: string) => Promise<string | null>
  onClose: () => void
}) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function submit() {
    setBusy(true)
    const failed = await onMove(note.trim())
    setBusy(false)
    if (failed) return setError(failed)
    onClose()
  }
  return (
    <FormDialog open title={`Move to ${STAGE_LABELS[stage]}`} submitLabel="Move" busy={busy} error={error} onSubmit={submit} onClose={onClose}>
      <TextField label="Why" required multiline minRows={2} autoFocus value={note} onChange={(e) => setNote(e.target.value)}
        helperText="The reason is kept on the timeline, and it is what the agent's lessons are drawn from." />
    </FormDialog>
  )
}
