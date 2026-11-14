import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardActionArea, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { useAuth } from '../auth/AuthProvider'
import { PageHeader } from '../components/common'
import { COLLECTOR_STATUS_COLORS, COLLECTOR_STATUS_LABELS, formatDayTime, timeAgo } from '../lib/constants'
import { useLoad } from '../lib/data'
import { supabase } from '../lib/supabase'
import type { Collector, CollectorStatus, DirectoryEntry } from '../lib/types'

const HEALTH: Record<NonNullable<Collector['health']>, string> = { ok: 'Working', empty: 'Returned nothing', error: 'Failed' }
// The columns a collector's rows have (worker/lib/clean.ts), in reading order.
const SAMPLE_COLUMNS = ['name', 'city', 'state', 'website', 'phone', 'source_url'] as const

/**
 * The collector library: the scripts that read each source. The agent writes
 * them; one runs on the worker only after an admin has approved that version.
 */
export default function Sources() {
  const collectors = useLoad<Collector[]>(() => supabase.from('collectors').select('*').order('name'), [])
  const people = useLoad<DirectoryEntry[]>(() => supabase.from('profile_directory').select('*'), [])
  const [open, setOpen] = useState<string | null>(null)
  const shown = collectors.data?.find((c) => c.id === open) ?? null
  const waiting = (collectors.data ?? []).filter((c) => c.status === 'proposed')
  const rest = (collectors.data ?? []).filter((c) => c.status !== 'proposed')

  return (
    <>
      <PageHeader title="Sources"
        subtitle="Collectors: small scripts that pull a list from one source, the same way every time. Written by the agent, approved by an admin, reusable across markets." />
      {collectors.error && <Alert severity="error">{collectors.error}</Alert>}
      {collectors.data?.length === 0 && (
        <Typography sx={{ color: 'text.secondary' }}>
          No collectors yet. On a market's Sources tab, tick a source and choose Build collector.
        </Typography>
      )}
      {waiting.length > 0 && (
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>Waiting for approval</Typography>
      )}
      <Stack spacing={1.5} sx={{ mb: waiting.length ? 4 : 0 }}>
        {waiting.map((c) => <CollectorRow key={c.id} collector={c} onOpen={() => setOpen(c.id)} />)}
      </Stack>
      {rest.length > 0 && waiting.length > 0 && (
        <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>Library</Typography>
      )}
      <Stack spacing={1.5}>
        {rest.map((c) => <CollectorRow key={c.id} collector={c} onOpen={() => setOpen(c.id)} />)}
      </Stack>
      {shown && (
        <CollectorDialog collector={shown}
          decidedBy={people.data?.find((p) => p.id === shown.decided_by)?.full_name ?? null}
          onChange={collectors.reload} onClose={() => setOpen(null)} />
      )}
    </>
  )
}

function CollectorRow({ collector: c, onOpen }: { collector: Collector; onOpen: () => void }) {
  return (
    <Card variant="outlined">
      <CardActionArea onClick={onOpen} aria-label={`Open ${c.name}`}>
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 0.5 }}>
            <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>{c.name}</Typography>
            {c.health && c.status === 'approved' && (
              <Chip size="small" variant="outlined" label={HEALTH[c.health]} color={c.health === 'ok' ? 'success' : 'warning'} />
            )}
            <Chip size="small" label={COLLECTOR_STATUS_LABELS[c.status]} color={COLLECTOR_STATUS_COLORS[c.status]} />
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Calls {c.hosts.join(', ')} · version {c.version}
            {c.last_run_at && ` · last run ${timeAgo(c.last_run_at)}, ${c.last_rows ?? 0} rows`}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

function CollectorDialog({
  collector: c, decidedBy, onChange, onClose,
}: {
  collector: Collector
  decidedBy: string | null
  onChange: () => void
  onClose: () => void
}) {
  const { isAdmin } = useAuth()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const sample = Array.isArray(c.sample) ? c.sample : []
  const columns = SAMPLE_COLUMNS.filter((col) => sample.some((row) => row[col]))

  async function decide(status: CollectorStatus) {
    setBusy(true)
    setError(null)
    const { error: rpcError } = await supabase.rpc('collector_decide', { p_id: c.id, p_status: status, p_note: note.trim() || null })
    setBusy(false)
    if (rpcError) return setError(rpcError.message)
    onChange()
    onClose()
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pr: 7 }}>
        {c.name}{' '}
        <Chip size="small" label={COLLECTOR_STATUS_LABELS[c.status]} color={COLLECTOR_STATUS_COLORS[c.status]} sx={{ ml: 1 }} />
      </DialogTitle>
      <IconButton aria-label="Close" onClick={onClose} disabled={busy} sx={{ position: 'absolute', top: 12, right: 12 }}>
        <CloseIcon />
      </IconButton>
      <DialogContent dividers>
        <Stack spacing={2.5}>
          {c.description && <Typography variant="body2">{c.description}</Typography>}
          <Box>
            <Typography variant="subtitle2">May call only</Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 1 }}>
              {c.hosts.map((h) => <Chip key={h} size="small" variant="outlined" label={h} />)}
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.5 }}>
              The worker runs it with network access to these hosts and nothing else: no files, no other sites.
            </Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2">Terms of the source</Typography>
            <Typography variant="body2" sx={{ color: c.terms_note ? 'text.primary' : 'warning.main' }}>
              {c.terms_note || 'The agent recorded nothing about this source\'s terms. Check them before approving.'}
            </Typography>
          </Box>
          <Box>
            <Typography variant="subtitle2">Sample from its test run ({sample.length} rows)</Typography>
            {sample.length === 0 ? (
              <Typography variant="body2" sx={{ color: 'warning.main' }}>No sample rows were recorded.</Typography>
            ) : (
              <TableContainer sx={{ maxHeight: 280, border: 1, borderColor: 'divider', borderRadius: 1, mt: 0.5 }}>
                <Table size="small" stickyHeader>
                  <TableHead>
                    <TableRow>{columns.map((col) => <TableCell key={col}>{col}</TableCell>)}</TableRow>
                  </TableHead>
                  <TableBody>
                    {sample.slice(0, 20).map((row, i) => (
                      <TableRow key={i}>
                        {columns.map((col) => (
                          <TableCell key={col} sx={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {String(row[col] ?? '')}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Box>
          <Box>
            <Typography variant="subtitle2">The script (version {c.version})</Typography>
            <Box component="pre" aria-label="Collector code"
              sx={{ m: 0, mt: 0.5, p: 1.5, maxHeight: 360, overflow: 'auto', bgcolor: 'background.subtle', border: 1, borderColor: 'divider', borderRadius: 1, fontSize: 12.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {c.code}
            </Box>
          </Box>
          {c.decided_at && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {c.status === 'approved' ? 'Approved' : 'Retired'} {formatDayTime(c.decided_at)}{decidedBy ? ` by ${decidedBy}` : ''}
              {c.decided_note ? ` · ${c.decided_note}` : ''}
            </Typography>
          )}
          {c.last_error && <Alert severity="warning">Last run: {c.last_error}</Alert>}
          {isAdmin && c.status !== 'retired' && (
            <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
          )}
          {!isAdmin && c.status === 'proposed' && (
            <Alert severity="info">An admin approves collectors: approving lets this script run on the worker.</Alert>
          )}
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      {isAdmin && (
        <DialogActions sx={{ px: 3, py: 2 }}>
          {c.status !== 'retired' && (
            <Button color="error" disabled={busy} onClick={() => decide('retired')}>
              {c.status === 'proposed' ? 'Turn down' : 'Retire'}
            </Button>
          )}
          {c.status !== 'approved' && (
            <Button variant="contained" loading={busy} onClick={() => decide('approved')}>
              Approve version {c.version}
            </Button>
          )}
        </DialogActions>
      )}
    </Dialog>
  )
}
