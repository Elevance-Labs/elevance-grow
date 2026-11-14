// What the agent is doing and what it proposed: status chips, the worker
// notice, the list of runs with their progress, one run's steps, and the
// proposal card a person accepts, changes or rejects.
import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardActions, CardContent, Chip, Dialog, DialogContent, DialogTitle, IconButton,
  LinearProgress, Link as MuiLink, MenuItem, Stack, TextField, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import {
  JOB_STATUS_COLORS, JOB_STATUS_LABELS, RUN_KIND_LABELS, SOURCE_KIND_LABELS, STAGES, STAGE_LABELS,
  formatDayTime, formatTokens, isOpen, timeAgo,
} from '../lib/constants'
import { POLL_MS, useLoad } from '../lib/data'
import { cancelRun, progress, workerNotice, type RunWithJobs } from '../lib/runs'
import { safeUrl } from '../lib/accounts'
import { supabase } from '../lib/supabase'
import type {
  AccountStage, AgentJobEvent, JobStatus, LessonPayload, NextStepPayload, Proposal, SourceKind, SourcePayload,
  ThesisPayload, Worker,
} from '../lib/types'
import { FormDialog } from './common'

export function JobStatusChip({ status }: { status: JobStatus }) {
  return <Chip size="small" label={JOB_STATUS_LABELS[status]} color={JOB_STATUS_COLORS[status]} />
}

/** Shown where work is waiting and no worker is there to do it. */
export function WorkerNotice({ waiting }: { waiting: boolean }) {
  // Read afresh the moment work starts waiting, then now and again while it does.
  const { data } = useLoad<Worker[]>(() => supabase.from('workers').select('*'), [waiting], waiting ? POLL_MS * 3 : false)
  const notice = waiting ? workerNotice(data) : null
  if (!notice) return null
  return (
    <Alert severity="warning" sx={{ mb: 2 }}>
      {notice}
    </Alert>
  )
}

/** A link out to a source page, or the address as text when it is not one. */
export function SourceLink({ url, children }: { url: string | null; children?: string }) {
  const href = safeUrl(url)
  if (!href) return <>{children ?? url ?? ''}</>
  return (
    <MuiLink href={href} target="_blank" rel="noopener noreferrer nofollow" sx={{ overflowWrap: 'anywhere' }}>
      {children ?? href.replace(/^https?:\/\//, '')}
    </MuiLink>
  )
}

/** Runs, newest first: what was asked, how far along, and a way to stop. */
export function RunList({ runs, onChange, empty }: { runs: RunWithJobs[]; onChange: () => void; empty?: string }) {
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shown = runs.find((r) => r.id === open) ?? null

  async function cancel(id: string) {
    setError(await cancelRun(id))
    onChange()
  }

  if (!runs.length) return <Typography sx={{ color: 'text.secondary' }}>{empty ?? 'No runs yet.'}</Typography>
  return (
    <Stack spacing={1.5}>
      {error && <Alert severity="error">{error}</Alert>}
      {runs.map((run) => {
        const p = progress(run)
        const trouble = run.jobs.filter((j) => j.status === 'failed' || j.status === 'needs_person').length
        return (
          <Card key={run.id} variant="outlined">
            <CardContent sx={{ pb: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                <Typography variant="subtitle2" sx={{ flexGrow: 1, minWidth: 180 }}>
                  {run.goal}
                </Typography>
                <JobStatusChip status={run.status} />
              </Stack>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {RUN_KIND_LABELS[run.kind]} · started {timeAgo(run.created_at)} · {p.finished} of {p.total} done
                {trouble > 0 && ` · ${trouble} need a look`}
                {run.tokens_in + run.tokens_out > 0 && ` · ${formatTokens(run.tokens_in + run.tokens_out)} tokens`}
              </Typography>
              {isOpen(run.status) && (
                <LinearProgress
                  aria-label={`Progress of ${run.goal}`}
                  variant={p.finished ? 'determinate' : 'indeterminate'}
                  value={p.percent}
                  sx={{ mt: 1, borderRadius: 1 }}
                />
              )}
            </CardContent>
            <CardActions sx={{ px: 2, pt: 0 }}>
              <Button size="small" onClick={() => setOpen(run.id)}>
                See steps
              </Button>
              {isOpen(run.status) && (
                <Button size="small" color="error" onClick={() => cancel(run.id)}>
                  Stop
                </Button>
              )}
            </CardActions>
          </Card>
        )
      })}
      {shown && <RunDialog run={shown} onClose={() => setOpen(null)} />}
    </Stack>
  )
}

/** One run: each job, and the steps the worker reported, as they happen. */
export function RunDialog({ run, onClose }: { run: RunWithJobs; onClose: () => void }) {
  const ids = run.jobs.map((j) => j.id)
  const { data: events } = useLoad<AgentJobEvent[]>(
    () => supabase.from('agent_job_events').select('*').in('job_id', ids).order('id'),
    // Read once more when the run finishes, for its closing steps.
    [run.id, run.status],
    isOpen(run.status) ? POLL_MS : false,
  )

  return (
    <Dialog open onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 7 }}>{run.goal}</DialogTitle>
      <IconButton aria-label="Close" onClick={onClose} sx={{ position: 'absolute', top: 12, right: 12 }}>
        <CloseIcon />
      </IconButton>
      <DialogContent dividers>
        <Stack spacing={2}>
          {run.jobs.map((job, i) => {
            const mine = (events ?? []).filter((e) => e.job_id === job.id)
            return (
              <Box key={job.id}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <Typography variant="subtitle2">
                    {RUN_KIND_LABELS[job.kind]}
                    {run.jobs.length > 1 ? ` ${i + 1}` : ''}
                  </Typography>
                  <JobStatusChip status={job.status} />
                  {job.attempts > 1 && (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      try {job.attempts}
                    </Typography>
                  )}
                </Stack>
                {job.error && (
                  <Alert severity={job.status === 'needs_person' ? 'warning' : 'error'} sx={{ mb: 1 }}>
                    {job.error}
                  </Alert>
                )}
                {job.summary && (
                  <Typography variant="body2" sx={{ mb: 1, whiteSpace: 'pre-wrap' }}>
                    {job.summary}
                  </Typography>
                )}
                {mine.length === 0 && isOpen(job.status) && (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {job.status === 'queued' ? 'Waiting for the worker.' : 'Started; no steps reported yet.'}
                  </Typography>
                )}
                <Stack spacing={0.25}>
                  {mine.map((e) => (
                    <Typography
                      key={e.id}
                      variant="body2"
                      sx={{
                        color: e.kind === 'error' ? 'error.main' : e.kind === 'warn' ? 'warning.main' : 'text.secondary',
                        overflowWrap: 'anywhere',
                      }}
                    >
                      <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums', mr: 1 }}>
                        {new Date(e.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                      </Box>
                      {e.body}
                    </Typography>
                  ))}
                </Stack>
              </Box>
            )
          })}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            Started {formatDayTime(run.created_at)}
            {run.finished_at && ` · finished ${formatDayTime(run.finished_at)}`}
            {` · ${formatTokens(run.tokens_in)} tokens in, ${formatTokens(run.tokens_out)} out`}
          </Typography>
        </Stack>
      </DialogContent>
    </Dialog>
  )
}

const PROPOSAL_TITLES: Record<Proposal['kind'], string> = {
  thesis: 'Thesis',
  source: 'Source',
  next_step: 'Next step',
  lesson: 'Lesson',
}

/**
 * One proposal: what the agent suggests, and the three things a person can
 * do with it: accept it, change it and accept that, or reject it with a
 * reason. Nothing is on the record until one of the first two.
 */
export function ProposalCard({
  proposal, context, onDecided,
}: {
  proposal: Proposal
  // Where it belongs, for lists that mix markets and accounts.
  context?: string
  onDecided: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(accept: boolean, final: Record<string, unknown> | null, reason: string | null) {
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('proposal_decide', {
      p_id: proposal.id, p_accept: accept, p_final: final, p_reason: reason,
    })
    setBusy(false)
    if (rpcError) return setError(rpcError.message)
    setEditing(false)
    setRejecting(false)
    onDecided()
  }

  return (
    <Card variant="outlined">
      <CardContent sx={{ pb: 1 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
          <Chip size="small" color="primary" variant="outlined" label={PROPOSAL_TITLES[proposal.kind]} />
          {context && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {context}
            </Typography>
          )}
        </Stack>
        <ProposalBody proposal={proposal} />
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </CardContent>
      <CardActions sx={{ px: 2 }}>
        <Button size="small" variant="contained" loading={busy} onClick={() => decide(true, null, null)}>
          Accept
        </Button>
        <Button size="small" disabled={busy} onClick={() => setEditing(true)}>
          Change and accept
        </Button>
        <Button size="small" color="error" disabled={busy} onClick={() => setRejecting(true)}>
          Reject
        </Button>
      </CardActions>
      {editing && (
        <ProposalEditor
          proposal={proposal}
          busy={busy}
          error={error}
          onSave={(final) => decide(true, final, null)}
          onClose={() => setEditing(false)}
        />
      )}
      {rejecting && (
        <RejectDialog busy={busy} error={error} onReject={(reason) => decide(false, null, reason)} onClose={() => setRejecting(false)} />
      )}
    </Card>
  )
}

function ProposalBody({ proposal }: { proposal: Proposal }) {
  if (proposal.kind === 'thesis') {
    const p = proposal.payload as unknown as ThesisPayload
    return (
      <>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {p.text}
        </Typography>
        <SourceRefs sources={p.sources ?? []} />
      </>
    )
  }
  if (proposal.kind === 'source') {
    const p = proposal.payload as unknown as SourcePayload
    return (
      <>
        <Typography variant="subtitle2">
          {p.name}{' '}
          <Chip size="small" label={SOURCE_KIND_LABELS[p.kind ?? 'other']} sx={{ ml: 0.5 }} />
        </Typography>
        <Typography variant="body2">
          <SourceLink url={p.url} />
        </Typography>
        {p.why && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {p.why}
          </Typography>
        )}
        {p.terms_note && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
            Terms: {p.terms_note}
          </Typography>
        )}
      </>
    )
  }
  if (proposal.kind === 'next_step') {
    const p = proposal.payload as unknown as NextStepPayload
    return (
      <>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
          {p.note}
        </Typography>
        {p.stage && (
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
            Accepting moves the account to {STAGE_LABELS[p.stage]}.
          </Typography>
        )}
      </>
    )
  }
  const p = proposal.payload as unknown as LessonPayload
  return <Typography variant="body2">{p.body}</Typography>
}

export function SourceRefs({ sources }: { sources: { url: string; title?: string }[] }) {
  if (!sources.length) return null
  return (
    <Box sx={{ mt: 1 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        Read for this:
      </Typography>
      {sources.map((s) => (
        <Typography key={s.url} variant="caption" sx={{ display: 'block' }}>
          <SourceLink url={s.url}>{s.title || undefined}</SourceLink>
        </Typography>
      ))}
    </Box>
  )
}

function ProposalEditor({
  proposal, busy, error, onSave, onClose,
}: {
  proposal: Proposal
  busy: boolean
  error: string | null
  onSave: (final: Record<string, unknown>) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Record<string, unknown>>(proposal.payload)
  const set = (key: string, value: unknown) => setDraft((d) => ({ ...d, [key]: value }))
  const text = (key: string) => (draft[key] as string | undefined) ?? ''

  return (
    <FormDialog open title={`Change the ${PROPOSAL_TITLES[proposal.kind].toLowerCase()}`} submitLabel="Accept this" busy={busy} error={error}
      onSubmit={() => onSave(draft)} onClose={onClose}>
      {proposal.kind === 'thesis' && (
        <TextField label="Thesis" multiline minRows={10} required value={text('text')} onChange={(e) => set('text', e.target.value)} />
      )}
      {proposal.kind === 'source' && (
        <>
          <TextField label="Name" required value={text('name')} onChange={(e) => set('name', e.target.value)} />
          <TextField label="Web address" required value={text('url')} onChange={(e) => set('url', e.target.value)} />
          <TextField select label="Kind" value={(draft.kind as SourceKind | undefined) ?? 'other'} onChange={(e) => set('kind', e.target.value)}>
            {Object.entries(SOURCE_KIND_LABELS).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField label="Why this source" multiline value={text('why')} onChange={(e) => set('why', e.target.value)} />
          <TextField label="Terms of use" multiline value={text('terms_note')} onChange={(e) => set('terms_note', e.target.value)} />
        </>
      )}
      {proposal.kind === 'next_step' && (
        <>
          <TextField label="Next step" multiline minRows={3} required value={text('note')} onChange={(e) => set('note', e.target.value)} />
          <TextField select label="Move the account to" value={(draft.stage as AccountStage | undefined) ?? ''}
            onChange={(e) => setDraft((d) => {
              const { stage: _dropped, ...rest } = d
              return e.target.value ? { ...rest, stage: e.target.value } : rest
            })}>
            <MenuItem value="">Leave it where it is</MenuItem>
            {STAGES.map((stage) => (
              <MenuItem key={stage} value={stage}>
                {STAGE_LABELS[stage]}
              </MenuItem>
            ))}
          </TextField>
        </>
      )}
      {proposal.kind === 'lesson' && (
        <TextField label="Lesson" multiline minRows={2} required value={text('body')} onChange={(e) => set('body', e.target.value)} />
      )}
    </FormDialog>
  )
}

function RejectDialog({
  busy, error, onReject, onClose,
}: {
  busy: boolean
  error: string | null
  onReject: (reason: string | null) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  return (
    <FormDialog open title="Reject this" submitLabel="Reject" busy={busy} error={error}
      onSubmit={() => onReject(reason.trim() || null)} onClose={onClose}>
      <TextField
        label="Why (optional)"
        multiline
        minRows={2}
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        helperText="Reasons are what the agent's lessons are drawn from."
      />
    </FormDialog>
  )
}
