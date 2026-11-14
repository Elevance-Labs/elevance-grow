import { useState } from 'react'
import {
  Alert, Box, Button, Card, CardContent, Chip, FormControlLabel, IconButton, MenuItem, Stack, Switch, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Tooltip, Typography,
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutlined'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined'
import { useAuth } from '../auth/AuthProvider'
import { ConfirmDialog, FormDialog, PageHeader } from '../components/common'
import {
  APP_ROLE_HINTS, APP_ROLE_LABELS, COMPANY_DOMAIN, LOGIN_METHOD_LABELS, errorMessage, timeAgo,
} from '../lib/constants'
import { POLL_MS, useLoad } from '../lib/data'
import { generatePassword, setProfilePassword } from '../lib/passwordLogin'
import { isOnline } from '../lib/runs'
import { supabase } from '../lib/supabase'
import type { AppRole, LoginMethod, Profile, Worker } from '../lib/types'

const ROLES: AppRole[] = ['admin', 'growth', 'member', 'agency', 'agent']
const blank = { full_name: '', email: '', login_method: 'google' as LoginMethod, role: 'growth' as AppRole, active: true }

/** Admins: who may sign in and as what, and the workers that do the agent's jobs. */
export default function Settings() {
  const { profile: me } = useAuth()
  const people = useLoad<Profile[]>(() => supabase.from('profiles').select('*').order('full_name'), [])
  const workers = useLoad<Worker[]>(() => supabase.from('workers').select('*'), [], POLL_MS * 3)
  const [editing, setEditing] = useState<Profile | 'new' | null>(null)
  const [form, setForm] = useState(blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState<Profile | null>(null)
  const [password, setPassword] = useState<{ profile: Profile; value: string; done: boolean } | null>(null)

  const all = people.data ?? []
  const staff = all.filter((p) => p.role !== 'agent')
  const agents = all.filter((p) => p.role === 'agent')

  function open(target: Profile | 'new', role: AppRole = 'growth') {
    setError(null)
    setForm(target === 'new'
      ? { ...blank, role, login_method: role === 'agent' || role === 'agency' ? 'password' : 'google' }
      : { full_name: target.full_name, email: target.email, login_method: target.login_method, role: target.role, active: target.active })
    setEditing(target)
  }

  async function save() {
    setBusy(true)
    setError(null)
    const row = { ...form, full_name: form.full_name.trim(), email: form.email.trim().toLowerCase() }
    const { error: saveError } = editing === 'new'
      ? await supabase.from('profiles').insert(row)
      : await supabase.from('profiles').update(row).eq('id', (editing as Profile).id)
    setBusy(false)
    if (saveError) {
      return setError(saveError.code === '23514'
        ? `Check the email and sign-in method: an @${COMPANY_DOMAIN} address signs in with Google, any other with a password; a worker always has a password; and there must stay one active admin.`
        : errorMessage(saveError, 'Someone already has that email.'))
    }
    setEditing(null)
    people.reload()
  }

  async function remove() {
    if (!removing) return
    setBusy(true)
    const { error: deleteError } = await supabase.from('profiles').delete().eq('id', removing.id)
    setBusy(false)
    setRemoving(null)
    if (deleteError) setError(errorMessage(deleteError))
    people.reload()
    workers.reload()
  }

  async function savePassword() {
    if (!password) return
    setBusy(true)
    setError(null)
    const failed = await setProfilePassword(password.profile.id, password.value)
    setBusy(false)
    if (failed) return setError(failed)
    setPassword({ ...password, done: true })
    people.reload()
  }

  async function setOwner(worker: Worker, ownerId: string) {
    const { error: saveError } = await supabase.from('workers').update({ owner_id: ownerId || null }).eq('profile_id', worker.profile_id)
    if (saveError) setError(errorMessage(saveError))
    workers.reload()
  }

  const actions = (p: Profile) => (
    <Stack direction="row" sx={{ justifyContent: 'flex-end' }}>
      {p.login_method === 'password' && (
        <Tooltip title="Set password">
          <IconButton size="small" aria-label={`Set password for ${p.full_name}`}
            onClick={() => { setError(null); setPassword({ profile: p, value: generatePassword(), done: false }) }}>
            <KeyOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Edit">
        <IconButton size="small" aria-label={`Edit ${p.full_name}`} onClick={() => open(p)}><EditOutlinedIcon fontSize="small" /></IconButton>
      </Tooltip>
      {p.id !== me?.id && (
        <Tooltip title="Remove">
          <IconButton size="small" aria-label={`Remove ${p.full_name}`} onClick={() => setRemoving(p)}><DeleteOutlineIcon fontSize="small" /></IconButton>
        </Tooltip>
      )}
    </Stack>
  )

  return (
    <>
      <PageHeader title="Settings" />
      {people.error && <Alert severity="error">{people.error}</Alert>}
      {error && !editing && !password && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

      <Stack spacing={4}>
        <Box component="section" aria-label="People">
          <Stack direction="row" sx={{ alignItems: 'center', mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>People</Typography>
            <Button startIcon={<AddIcon />} onClick={() => open('new')}>Add person</Button>
          </Stack>
          <TableContainer component={Card} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell><TableCell>Email</TableCell><TableCell>Role</TableCell>
                  <TableCell>Signs in with</TableCell><TableCell>Signed in</TableCell><TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {staff.map((p) => (
                  <TableRow key={p.id} hover sx={{ opacity: p.active ? 1 : 0.55 }}>
                    <TableCell>{p.full_name}{!p.active && <Chip size="small" label="Deactivated" sx={{ ml: 1 }} />}</TableCell>
                    <TableCell>{p.email}</TableCell>
                    <TableCell>{APP_ROLE_LABELS[p.role]}</TableCell>
                    <TableCell>{p.login_method === 'google' ? 'Google' : 'Password'}</TableCell>
                    <TableCell>{p.user_id ? 'Yes' : 'Not yet'}</TableCell>
                    <TableCell align="right">{actions(p)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Box>

        <Box component="section" aria-label="Workers">
          <Stack direction="row" sx={{ alignItems: 'center', mb: 0.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, flexGrow: 1 }}>Workers</Typography>
            <Button startIcon={<AddIcon />} onClick={() => open('new', 'agent')}>Add worker</Button>
          </Stack>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
            A worker is a computer that does the agent's jobs with Claude Code, signed in there with its owner's Claude
            account. It gets a login of its own here, which can do nothing but take a job and hand back its findings.
          </Typography>
          <Stack spacing={1.5}>
            {agents.length === 0 && (
              <Card variant="outlined">
                <CardContent>
                  <Typography variant="subtitle2">No worker yet, so jobs will wait.</Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
                    1. Add a worker here (any made-up address that is not @{COMPANY_DOMAIN}) and set its password.
                    2. On the computer, follow “Setting up a worker” in the README: install Claude Code and sign in,
                    put the address and password in worker/.env, and start it. It appears here within a minute.
                  </Typography>
                </CardContent>
              </Card>
            )}
            {agents.map((p) => {
              const w = workers.data?.find((x) => x.profile_id === p.id) ?? null
              const online = w ? isOnline(w) : false
              return (
                <Card key={p.id} variant="outlined" sx={{ opacity: p.active ? 1 : 0.55 }}>
                  <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}>
                      <Box sx={{ flexGrow: 1, minWidth: 200 }}>
                        <Typography variant="subtitle2">
                          {p.full_name}{' '}
                          <Chip size="small" sx={{ ml: 0.5 }}
                            color={!w ? 'default' : !online ? 'default' : w.state === 'limit' ? 'warning' : 'success'}
                            label={!w ? 'Never connected' : !online ? 'Offline' : w.state === 'limit' ? 'At usage limit' : w.state === 'working' ? 'Working' : 'Online'} />
                        </Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          {p.email}
                          {w && ` · last seen ${timeAgo(w.last_seen_at)}`}
                          {w?.info.host && ` · ${w.info.host}`}
                          {w?.info.claude && ` · Claude Code ${w.info.claude}`}
                        </Typography>
                        {w?.info.note && <Typography variant="caption" sx={{ color: 'warning.main' }}>{w.info.note}</Typography>}
                      </Box>
                      {w && (
                        <TextField select label="Does jobs started by" value={w.owner_id ?? ''} sx={{ minWidth: 200 }}
                          onChange={(e) => setOwner(w, e.target.value)}>
                          <MenuItem value="">Anyone</MenuItem>
                          {staff.filter((s) => s.role === 'admin' || s.role === 'growth').map((s) => (
                            <MenuItem key={s.id} value={s.id}>{s.full_name}</MenuItem>
                          ))}
                        </TextField>
                      )}
                      {actions(p)}
                    </Stack>
                  </CardContent>
                </Card>
              )
            })}
          </Stack>
        </Box>
      </Stack>

      <FormDialog open={editing !== null} title={editing === 'new' ? (form.role === 'agent' ? 'Add worker' : 'Add person') : 'Edit'}
        busy={busy} error={error} onSubmit={save} onClose={() => setEditing(null)}>
        <TextField label={form.role === 'agent' ? 'Name of the computer' : 'Full name'} required autoFocus value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
        <TextField label="Email" type="email" required value={form.email}
          helperText={form.role === 'agent' ? 'Its login name: any address that is not a company one, e.g. home-pc@grow-worker.dev. No mail is sent to it.' : undefined}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <TextField select label="Role" value={form.role} helperText={APP_ROLE_HINTS[form.role]}
          onChange={(e) => {
            const role = e.target.value as AppRole
            setForm({ ...form, role, login_method: role === 'agent' ? 'password' : form.login_method })
          }}>
          {ROLES.map((r) => <MenuItem key={r} value={r}>{APP_ROLE_LABELS[r]}</MenuItem>)}
        </TextField>
        <TextField select label="Signs in with" value={form.login_method} disabled={form.role === 'agent'}
          onChange={(e) => setForm({ ...form, login_method: e.target.value as LoginMethod })}>
          {(Object.keys(LOGIN_METHOD_LABELS) as LoginMethod[]).map((m) => (
            <MenuItem key={m} value={m}>{LOGIN_METHOD_LABELS[m]}</MenuItem>
          ))}
        </TextField>
        <FormControlLabel label="Active (may sign in)"
          control={<Switch checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />} />
      </FormDialog>

      {password && (
        <FormDialog open title={`Set password for ${password.profile.full_name}`} submitLabel={password.done ? 'Done' : 'Set password'}
          busy={busy} error={error} onSubmit={password.done ? () => setPassword(null) : savePassword} onClose={() => setPassword(null)}>
          {password.done ? (
            <Alert severity="success">
              Set. Copy it now: it is not shown again.
              <Box component="code" sx={{ display: 'block', mt: 1, fontSize: 16, userSelect: 'all' }}>{password.value}</Box>
            </Alert>
          ) : (
            <>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                This replaces any password they have and signs them out everywhere.
              </Typography>
              <TextField label="New password" required value={password.value}
                onChange={(e) => setPassword({ ...password, value: e.target.value })}
                slotProps={{ htmlInput: { style: { fontFamily: 'ui-monospace, Menlo, Consolas, monospace' } } }} />
            </>
          )}
        </FormDialog>
      )}

      <ConfirmDialog open={removing !== null} title={`Remove ${removing?.full_name ?? ''}?`} destructive confirmLabel="Remove" busy={busy}
        message="They will no longer be able to sign in. What they did stays, without their name on it."
        onConfirm={remove} onClose={() => setRemoving(null)} />
    </>
  )
}
