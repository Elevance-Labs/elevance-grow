import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Alert, Button, Card, CardActionArea, CardContent, Chip, Stack, TextField, Typography, Box,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import { FormDialog, PageHeader } from '../components/common'
import { MARKET_STATUS_LABELS, errorMessage } from '../lib/constants'
import { useLoad } from '../lib/data'
import { supabase } from '../lib/supabase'
import type { Account, Market } from '../lib/types'

type Tally = Pick<Account, 'market_id' | 'review' | 'stage'>

/** Markets: one per industry and region. Each is a workspace for the agent. */
export default function Markets() {
  const navigate = useNavigate()
  const markets = useLoad<Market[]>(() => supabase.from('markets').select('*').order('created_at', { ascending: false }), [])
  const accounts = useLoad<Tally[]>(() => supabase.from('accounts').select('market_id, review, stage'), [])
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', region: '', brief: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function add() {
    setBusy(true)
    setError(null)
    const { data, error: insertError } = await supabase
      .from('markets')
      .insert({ name: form.name.trim(), region: form.region.trim(), brief: form.brief.trim() })
      .select('id')
      .single()
    setBusy(false)
    if (insertError) return setError(errorMessage(insertError, 'There is already a market for that industry and region.'))
    navigate(`/markets/${(data as { id: string }).id}`)
  }

  const tally = (id: string) => {
    const mine = (accounts.data ?? []).filter((a) => a.market_id === id)
    return {
      toReview: mine.filter((a) => a.review === 'candidate').length,
      accepted: mine.filter((a) => a.review === 'accepted').length,
      talking: mine.filter((a) => a.review === 'accepted' && ['contacted', 'talking', 'proposal'].includes(a.stage)).length,
    }
  }

  return (
    <>
      <PageHeader
        title="Markets"
        subtitle="An industry in a region. Name one and the agent researches it, finds where its businesses are listed, and builds the dataset."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setAdding(true)}>
            New market
          </Button>
        }
      />
      {markets.error && <Alert severity="error">{markets.error}</Alert>}
      {markets.data?.length === 0 && (
        <Typography sx={{ color: 'text.secondary' }}>
          No markets yet. Start with one you know: an industry and a state.
        </Typography>
      )}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr', xl: '1fr 1fr 1fr' } }}>
        {(markets.data ?? []).map((m) => {
          const t = tally(m.id)
          return (
            <Card key={m.id} variant="outlined">
              <CardActionArea component={Link} to={`/markets/${m.id}`} sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                    <Typography variant="h6" sx={{ flexGrow: 1 }} noWrap>
                      {m.name}
                    </Typography>
                    <Chip size="small" label={MARKET_STATUS_LABELS[m.status]} color={m.status === 'active' ? 'success' : 'default'} />
                  </Stack>
                  <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
                    {m.region}
                  </Typography>
                  <Typography variant="body2">
                    {m.thesis ? `${t.accepted} accepted · ${t.toReview} to review · ${t.talking} in conversation` : 'No thesis yet'}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          )
        })}
      </Box>

      <FormDialog open={adding} title="New market" submitLabel="Create" busy={busy} error={error} onSubmit={add} onClose={() => setAdding(false)}>
        <TextField label="Industry" placeholder="Self-service auto recycling" required autoFocus value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <TextField label="Region" placeholder="Ohio, United States" required value={form.region}
          onChange={(e) => setForm({ ...form, region: e.target.value })} />
        <TextField label="What we are after (optional)" multiline minRows={2} value={form.brief}
          helperText="Anything the agent should keep in mind: size, ownership, what to leave out."
          onChange={(e) => setForm({ ...form, brief: e.target.value })} />
      </FormDialog>
    </>
  )
}
