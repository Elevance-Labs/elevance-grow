import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, Box, Card, CardActionArea, CardContent, Chip, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { PageHeader } from '../components/common'
import { goneQuiet, placeOf, scoreColor } from '../lib/accounts'
import { STAGES, STAGE_LABELS, formatUsd, timeAgo } from '../lib/constants'
import { useLoad } from '../lib/data'
import { supabase } from '../lib/supabase'
import type { Account, AccountStage, Market } from '../lib/types'

// Closed stages fold away by default: the board is for what is in play.
const OPEN_STAGES: AccountStage[] = ['researching', 'qualified', 'contacted', 'talking', 'proposal']

/** Every accepted account by stage. A card opens the account, where its stage is changed. */
export default function Pipeline() {
  const [params, setParams] = useSearchParams()
  const marketId = params.get('market') ?? ''
  const [showClosed, setShowClosed] = useState(false)
  const markets = useLoad<Market[]>(() => supabase.from('markets').select('*').order('name'), [])
  const accounts = useLoad<Account[]>(
    () => supabase.from('accounts').select('*').eq('review', 'accepted').order('fit_score', { ascending: false, nullsFirst: false }), [])
  const rows = (accounts.data ?? []).filter((a) => !marketId || a.market_id === marketId)
  const stages = showClosed ? STAGES : OPEN_STAGES
  const closed = rows.filter((a) => !OPEN_STAGES.includes(a.stage)).length

  return (
    <>
      <PageHeader
        title="Pipeline"
        subtitle="Accepted accounts by stage."
        actions={
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip label={showClosed ? 'Hide closed' : `Show closed (${closed})`} variant="outlined" onClick={() => setShowClosed((v) => !v)} />
            <TextField select label="Market" value={marketId} sx={{ minWidth: 200 }}
              onChange={(e) => setParams(e.target.value ? { market: e.target.value } : {}, { replace: true })}>
              <MenuItem value="">All markets</MenuItem>
              {(markets.data ?? []).map((m) => (
                <MenuItem key={m.id} value={m.id}>{m.name}, {m.region}</MenuItem>
              ))}
            </TextField>
          </Stack>
        }
      />
      {accounts.error && <Alert severity="error">{accounts.error}</Alert>}
      <Box sx={{ display: 'grid', gridAutoFlow: 'column', gridAutoColumns: 'minmax(240px, 1fr)', gap: 2, overflowX: 'auto', pb: 2, alignItems: 'start' }}>
        {stages.map((stage) => {
          const cards = rows.filter((a) => a.stage === stage)
          const value = cards.reduce((sum, a) => sum + (a.est_value ?? 0), 0)
          return (
            <Box key={stage} role="region" aria-label={STAGE_LABELS[stage]} sx={{ bgcolor: 'background.muted', borderRadius: 2, p: 1.5 }}>
              <Stack direction="row" sx={{ alignItems: 'baseline', mb: 1.5 }}>
                <Typography variant="subtitle2" sx={{ flexGrow: 1 }}>{STAGE_LABELS[stage]} · {cards.length}</Typography>
                {value > 0 && <Typography variant="caption" sx={{ color: 'text.secondary' }}>{formatUsd(value)}</Typography>}
              </Stack>
              <Stack spacing={1}>
                {cards.map((a) => (
                  <Card key={a.id} variant="outlined">
                    <CardActionArea component={Link} to={`/accounts/${a.id}`}>
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                          <Typography variant="body2" sx={{ fontWeight: 500, flexGrow: 1 }}>{a.name}</Typography>
                          {a.fit_score !== null && <Chip size="small" label={a.fit_score} color={scoreColor(a.fit_score)} />}
                        </Stack>
                        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                          {placeOf(a) || 'Place unknown'}
                        </Typography>
                        {a.hook && (
                          <Typography variant="caption" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', mt: 0.5 }}>
                            {a.hook}
                          </Typography>
                        )}
                        {goneQuiet(a) && (
                          <Chip size="small" color="warning" variant="outlined" sx={{ mt: 1 }}
                            label={`Quiet since ${timeAgo(a.last_activity_at ?? a.stage_changed_at)}`} />
                        )}
                      </CardContent>
                    </CardActionArea>
                  </Card>
                ))}
                {cards.length === 0 && <Typography variant="caption" sx={{ color: 'text.secondary' }}>Nothing here.</Typography>}
              </Stack>
            </Box>
          )
        })}
      </Box>
    </>
  )
}
