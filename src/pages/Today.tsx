import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Alert, Box, Button, Card, CardContent, Chip, Link as MuiLink, Stack, Typography,
} from '@mui/material'
import { ProposalCard, RunList, WorkerNotice } from '../components/Agent'
import { PageHeader } from '../components/common'
import { awaitsDecision, goneQuiet, placeOf, scoreColor } from '../lib/accounts'
import { CHANNEL_LABELS, timeAgo } from '../lib/constants'
import { POLL_MS, useLoad } from '../lib/data'
import { anyOpen, loadRuns, runsSignature, type RunWithJobs } from '../lib/runs'
import { supabase } from '../lib/supabase'
import type { Account, Collector, Draft, Market, Proposal } from '../lib/types'
import { useAuth } from '../auth/AuthProvider'

/** What needs a decision: the agent's work waits here until a person looks at it. */
export default function Today() {
  const { isAdmin } = useAuth()
  const markets = useLoad<Market[]>(() => supabase.from('markets').select('*'), [])
  const proposals = useLoad<Proposal[]>(
    () => supabase.from('proposals').select('*').eq('decision', 'pending').order('created_at'), [])
  const collectors = useLoad<Collector[]>(() => supabase.from('collectors').select('*').eq('status', 'proposed'), [])
  const accounts = useLoad<Account[]>(() => supabase.from('accounts').select('*').neq('review', 'rejected'), [])
  const drafts = useLoad<Draft[]>(() => supabase.from('drafts').select('*').neq('status', 'sent').order('created_at', { ascending: false }), [])
  const [polling, setPolling] = useState(false)
  const runs = useLoad<RunWithJobs[]>(() => loadRuns(null, 15), [], polling ? POLL_MS : false)
  const open = anyOpen(runs.data)
  useEffect(() => setPolling(open), [open])
  const signature = runsSignature(runs.data)
  const reloadAll = () => {
    proposals.reload(); collectors.reload(); accounts.reload(); drafts.reload()
  }
  useEffect(() => {
    if (signature) reloadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const marketName = (id: string) => markets.data?.find((m) => m.id === id)?.name ?? ''
  const all = accounts.data ?? []
  const accountName = (id: string | null) => all.find((a) => a.id === id)?.name ?? ''
  const candidates = (markets.data ?? [])
    .map((m) => ({ market: m, count: all.filter((a) => a.market_id === m.id && a.review === 'candidate').length }))
    .filter((x) => x.count > 0)
  const toDecide = all.filter(awaitsDecision).sort((a, b) => (b.fit_score ?? 0) - (a.fit_score ?? 0))
  const quiet = all.filter((a) => goneQuiet(a))
  const ready = (drafts.data ?? []).filter((d) => all.some((a) => a.id === d.account_id))
  const active = (runs.data ?? []).filter((r) => r.status === 'queued' || r.status === 'running')
  const troubled = (runs.data ?? []).filter((r) => r.status === 'failed' || r.status === 'needs_person').slice(0, 3)
  const loaded = !proposals.loading && !accounts.loading && !drafts.loading && !collectors.loading
  const nothing = loaded && !proposals.data?.length && !collectors.data?.length && !candidates.length && !toDecide.length
    && !quiet.length && !ready.length && !active.length && !troubled.length

  return (
    <>
      <PageHeader title="Today" subtitle="What is waiting for you to decide." />
      <WorkerNotice waiting={open} />
      {proposals.error && <Alert severity="error">{proposals.error}</Alert>}
      {nothing && (
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Nothing is waiting.</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {markets.data?.length
                ? 'Open a market to collect more businesses or research the ones you have.'
                : 'Start by naming a market: an industry and a region. The agent takes it from there, and what it finds comes back here.'}
            </Typography>
            <Button component={Link} to="/markets" variant="contained" sx={{ mt: 2 }}>
              {markets.data?.length ? 'Open markets' : 'Name a market'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Stack spacing={4}>
        {active.length > 0 && (
          <Section title="Running now">
            <RunList runs={active} onChange={runs.reload} />
          </Section>
        )}

        {troubled.length > 0 && (
          <Section title="Runs that need a look">
            <RunList runs={troubled} onChange={runs.reload} />
          </Section>
        )}

        {(collectors.data ?? []).length > 0 && (
          <Section title="Collectors waiting for approval" count={collectors.data!.length}>
            {collectors.data!.map((c) => (
              <Row key={c.id} to="/sources" title={c.name}
                detail={`Calls ${c.hosts.join(', ')} · version ${c.version}${isAdmin ? '' : ' · an admin approves'}`} />
            ))}
          </Section>
        )}

        {(proposals.data ?? []).length > 0 && (
          <Section title="Proposals" count={proposals.data!.length}>
            {proposals.data!.map((p) => (
              <ProposalCard key={p.id} proposal={p} onDecided={reloadAll}
                context={[marketName(p.market_id), accountName(p.account_id)].filter(Boolean).join(' · ')} />
            ))}
          </Section>
        )}

        {candidates.length > 0 && (
          <Section title="Collected businesses to review">
            {candidates.map(({ market, count }) => (
              <Row key={market.id} to={`/markets/${market.id}?tab=dataset&review=candidate`} title={`${market.name}, ${market.region}`}
                detail={`${count} to accept or reject`} />
            ))}
          </Section>
        )}

        {toDecide.length > 0 && (
          <Section title="Researched: qualify or park" count={toDecide.length}>
            {toDecide.slice(0, 12).map((a) => (
              <Row key={a.id} to={`/accounts/${a.id}`} title={a.name} score={a.fit_score}
                detail={[placeOf(a), a.hook].filter(Boolean).join(' · ')} />
            ))}
            {toDecide.length > 12 && (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>and {toDecide.length - 12} more, in their markets.</Typography>
            )}
          </Section>
        )}

        {ready.length > 0 && (
          <Section title="Drafts ready to send" count={ready.length}>
            {ready.slice(0, 12).map((d) => (
              <Row key={d.id} to={`/accounts/${d.account_id}`} title={accountName(d.account_id)}
                detail={`${CHANNEL_LABELS[d.channel]}${d.subject ? ` · ${d.subject}` : ''} · written ${timeAgo(d.created_at)}`} />
            ))}
          </Section>
        )}

        {quiet.length > 0 && (
          <Section title="Gone quiet" count={quiet.length}>
            {quiet.map((a) => (
              <Row key={a.id} to={`/accounts/${a.id}`} title={a.name}
                detail={`Nothing since ${timeAgo(a.last_activity_at ?? a.stage_changed_at)}`} />
            ))}
          </Section>
        )}
      </Stack>
    </>
  )
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <Box component="section" aria-label={title}>
      <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 1.5 }}>
        {title}{count ? ` (${count})` : ''}
      </Typography>
      <Stack spacing={1.5}>{children}</Stack>
    </Box>
  )
}

function Row({ to, title, detail, score }: { to: string; title: string; detail: string; score?: number | null }) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <MuiLink component={Link} to={to} underline="hover" variant="subtitle2">{title}</MuiLink>
            <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>{detail}</Typography>
          </Box>
          {score !== null && score !== undefined && <Chip size="small" label={score} color={scoreColor(score)} />}
        </Stack>
      </CardContent>
    </Card>
  )
}
