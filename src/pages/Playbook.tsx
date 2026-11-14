import { useState } from 'react'
import { Alert, Box, Button, Card, CardContent, IconButton, Stack, TextField, Tooltip, Typography } from '@mui/material'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import { FormDialog, PageHeader } from '../components/common'
import { errorMessage, timeAgo } from '../lib/constants'
import { useLoad } from '../lib/data'
import { supabase } from '../lib/supabase'
import type { Lesson, PlaybookSection } from '../lib/types'

/** What every agent job is grounded in: who we are, what we sell, proof, voice, and what we have learned. */
export default function Playbook() {
  const sections = useLoad<PlaybookSection[]>(() => supabase.from('playbook_sections').select('*').order('sort_order'), [])
  const lessons = useLoad<Lesson[]>(() => supabase.from('lessons').select('*').is('market_id', null).order('created_at'), [])
  const [adding, setAdding] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addLesson() {
    setBusy(true)
    setError(null)
    const { error: insertError } = await supabase.from('lessons').insert({ market_id: null, body: (adding ?? '').trim() })
    setBusy(false)
    if (insertError) return setError(errorMessage(insertError))
    setAdding(null)
    lessons.reload()
  }

  async function removeLesson(id: string) {
    await supabase.from('lessons').delete().eq('id', id)
    lessons.reload()
  }

  return (
    <>
      <PageHeader title="Playbook"
        subtitle="The agent reads all of this before every job. A draft can only quote proof that is written here." />
      {sections.error && <Alert severity="error">{sections.error}</Alert>}
      <Stack spacing={2}>
        {(sections.data ?? []).map((s) => (
          <SectionCard key={s.id} section={s} onSaved={sections.reload} />
        ))}
        <Card variant="outlined">
          <CardContent>
            <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>What we have learned</Typography>
              <Button size="small" onClick={() => { setError(null); setAdding('') }}>Add one</Button>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Lessons that hold in every market. Each market keeps its own on its Thesis tab.
            </Typography>
            <Stack spacing={1} sx={{ mt: 1.5 }}>
              {(lessons.data ?? []).length === 0 && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>None yet.</Typography>
              )}
              {(lessons.data ?? []).map((l) => (
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
      </Stack>
      <FormDialog open={adding !== null} title="Add a lesson" submitLabel="Add" busy={busy} error={error} onSubmit={addLesson} onClose={() => setAdding(null)}>
        <TextField label="Lesson" multiline minRows={2} required autoFocus value={adding ?? ''}
          helperText="One sentence the agent should act on everywhere." onChange={(e) => setAdding(e.target.value)} />
      </FormDialog>
    </>
  )
}

function SectionCard({ section, onSaved }: { section: PlaybookSection; onSaved: () => void }) {
  const [body, setBody] = useState(section.body)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = body !== section.body

  async function save() {
    setBusy(true)
    setError(null)
    const { error: saveError } = await supabase.from('playbook_sections').update({ body }).eq('id', section.id)
    setBusy(false)
    if (saveError) return setError(errorMessage(saveError))
    onSaved()
  }

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>{section.title}</Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1.5 }}>{section.hint}</Typography>
        <TextField
          multiline minRows={3} fullWidth value={body} onChange={(e) => setBody(e.target.value)}
          placeholder="Nothing written yet. The agent leaves out what it is not told."
          slotProps={{ htmlInput: { 'aria-label': section.title, maxLength: 8000 } }}
        />
        {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1.5 }}>
          <Button size="small" variant="contained" disabled={!dirty} loading={busy} onClick={save}>Save</Button>
          {dirty && <Button size="small" onClick={() => setBody(section.body)}>Discard</Button>}
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {section.updated_by ? `Saved ${timeAgo(section.updated_at)}` : 'Starter text'}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  )
}
