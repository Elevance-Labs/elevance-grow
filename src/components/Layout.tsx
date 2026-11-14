import { useState, type ReactElement } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import {
  AppBar,
  Box,
  ButtonBase,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import AutoStoriesOutlinedIcon from '@mui/icons-material/AutoStoriesOutlined'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import HistoryOutlinedIcon from '@mui/icons-material/HistoryOutlined'
import HubOutlinedIcon from '@mui/icons-material/HubOutlined'
import KeyOutlinedIcon from '@mui/icons-material/KeyOutlined'
import KeyboardDoubleArrowLeftIcon from '@mui/icons-material/KeyboardDoubleArrowLeft'
import KeyboardDoubleArrowRightIcon from '@mui/icons-material/KeyboardDoubleArrowRight'
import LogoutIcon from '@mui/icons-material/Logout'
import MenuIcon from '@mui/icons-material/Menu'
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import TodayOutlinedIcon from '@mui/icons-material/TodayOutlined'
import ViewKanbanOutlinedIcon from '@mui/icons-material/ViewKanbanOutlined'
import WavingHandOutlinedIcon from '@mui/icons-material/WavingHandOutlined'
import { useAuth } from '../auth/AuthProvider'
import { APP_ROLE_LABELS } from '../lib/constants'
import { PASSWORD_MIN_LENGTH } from '../lib/passwordLogin'
import { supabase } from '../lib/supabase'
import AppSwitcher from './AppSwitcher'
import { useNavCollapsed } from './useNavCollapsed'
import { FormDialog, Logo, PersonAvatar } from './common'
import { InstallBanner, InstallNavButton } from './InstallApp'
import ThemeModeSwitch from './ThemeModeSwitch'

const DRAWER_WIDTH = 248
// Collapsed, the navigation is a rail just wide enough for its icons.
const RAIL_WIDTH = 68

interface NavItem {
  to: string
  label: string
  icon: ReactElement
  // Admin or growth: everyone who works on prospecting.
  growthOnly?: boolean
  adminOnly?: boolean
  // Shown only to people with nothing else here yet (member, agency).
  othersOnly?: boolean
}

// A section shows when the person may see at least one of its items.
interface NavSection {
  title: string
  items: NavItem[]
}

const NAV: NavSection[] = [
  {
    title: 'Home',
    items: [
      { to: '/today', label: 'Today', icon: <TodayOutlinedIcon />, growthOnly: true },
      { to: '/welcome', label: 'Welcome', icon: <WavingHandOutlinedIcon />, othersOnly: true },
    ],
  },
  {
    title: 'Sales',
    items: [
      { to: '/markets', label: 'Markets', icon: <PublicOutlinedIcon />, growthOnly: true },
      { to: '/pipeline', label: 'Pipeline', icon: <ViewKanbanOutlinedIcon />, growthOnly: true },
    ],
  },
  {
    title: 'Agent',
    items: [
      { to: '/playbook', label: 'Playbook', icon: <AutoStoriesOutlinedIcon />, growthOnly: true },
      { to: '/sources', label: 'Sources', icon: <HubOutlinedIcon />, growthOnly: true },
      { to: '/runs', label: 'Runs', icon: <HistoryOutlinedIcon />, growthOnly: true },
    ],
  },
  {
    title: 'Configuration',
    items: [{ to: '/settings', label: 'Settings', icon: <SettingsOutlinedIcon />, adminOnly: true }],
  },
]

export default function Layout() {
  const { profile, isAdmin, isGrowth, recovering, endRecovery, signOut } = useAuth()
  const theme = useTheme()
  const desktop = useMediaQuery(theme.breakpoints.up('md'))
  const { pathname } = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  // On a wide screen the navigation folds to a rail of icons; the choice is
  // remembered, and shared with the other Elevance apps.
  const [collapsed, toggleCollapsed] = useNavCollapsed()
  const rail = desktop && collapsed
  const navWidth = rail ? RAIL_WIDTH : DRAWER_WIDTH
  const navLabel = rail ? 'Expand navigation' : 'Collapse navigation'
  const [userMenu, setUserMenu] = useState<HTMLElement | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)

  if (!profile) return null

  // The most specific item wins. An account opens from a market, so it keeps Markets lit.
  const activeTo = NAV.flatMap((section) => section.items)
    .map((item) => item.to)
    .filter((to) => pathname === to || pathname.startsWith(`${to}/`) || (to === '/markets' && pathname.startsWith('/accounts/')))
    .sort((a, b) => b.length - a.length)[0]

  const drawer = (
    <>
      <Toolbar />
      {/* On a phone the offer to install leads the navigation, until dismissed. */}
      {!desktop && <InstallBanner />}
      {NAV.map((section) => {
        const items = section.items.filter(
          (item) =>
            (isGrowth || !item.growthOnly) && (isAdmin || !item.adminOnly) && (!isGrowth || !item.othersOnly),
        )
        if (!items.length) return null
        return (
          <List
            key={section.title}
            sx={{ px: rail ? 1 : 1.5 }}
            aria-label={section.title}
            subheader={
              rail ? (
                <Box sx={{ height: 12 }} />
              ) : (
                <ListSubheader disableSticky sx={{ bgcolor: 'transparent', lineHeight: '36px' }}>
                  {section.title}
                </ListSubheader>
              )
            }
          >
            {items.map((item) => (
              <Tooltip key={item.to} title={rail ? item.label : ''} placement="right">
              <ListItemButton
                component={Link}
                to={item.to}
                selected={item.to === activeTo}
                aria-label={item.label}
                onClick={() => setMobileOpen(false)}
                sx={{
                  borderRadius: 2,
                  mb: 0.5,
                  justifyContent: rail ? 'center' : 'flex-start',
                  '&.Mui-selected': {
                    color: 'primary.main',
                    '& .MuiListItemIcon-root': { color: 'primary.main' },
                  },
                }}
              >
                <ListItemIcon sx={{ minWidth: rail ? 0 : 40 }}>{item.icon}</ListItemIcon>
                {!rail && <ListItemText primary={item.label} slotProps={{ primary: { sx: { fontWeight: 500 } } }} />}
              </ListItemButton>
              </Tooltip>
            ))}
          </List>
        )
      })}
      {/* Pinned to the foot of the navigation, where it stays put whether the
          navigation is folded or not. Not a page, so not a list item. Install
          shares the row, after Collapse; on the rail it sits above it. */}
      {desktop && (
        <Box
          sx={{
            mt: 'auto', position: 'sticky', bottom: 0, p: 1, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider',
            display: 'flex', flexDirection: rail ? 'column' : 'row', gap: 0.5,
          }}
        >
          {rail && <InstallNavButton rail />}
          <Tooltip title={rail ? navLabel : ''} placement="right">
            <ButtonBase
              onClick={toggleCollapsed}
              aria-label={navLabel}
              aria-expanded={!rail}
              sx={{
                flex: rail ? 'none' : 1, minWidth: 0, borderRadius: 2, py: 1, px: rail ? 0 : 1.25, gap: 1.5, color: 'text.secondary',
                justifyContent: rail ? 'center' : 'flex-start', '&:hover': { bgcolor: 'action.hover' },
              }}
            >
              {rail ? <KeyboardDoubleArrowRightIcon /> : <KeyboardDoubleArrowLeftIcon />}
              {!rail && <Typography variant="body2" noWrap sx={{ fontWeight: 500 }}>Collapse</Typography>}
            </ButtonBase>
          </Tooltip>
          {!rail && <InstallNavButton rail={false} />}
        </Box>
      )}
    </>
  )

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <AppBar
        position="fixed"
        color="inherit"
        elevation={0}
        sx={{ zIndex: theme.zIndex.drawer + 1, borderBottom: 1, borderColor: 'divider' }}
      >
        <Toolbar sx={{ gap: { xs: 0.75, sm: 1.5 } }}>
          {!desktop && (
            <IconButton edge="start" aria-label="Open navigation" onClick={() => setMobileOpen(true)}>
              <MenuIcon />
            </IconButton>
          )}
          <AppSwitcher current="grow" email={profile.email} />
          <Logo />
          <Typography variant="h6" component="div" noWrap sx={{ display: { xs: 'none', sm: 'block' } }}>
            Elevance Grow
          </Typography>
          <Box sx={{ flexGrow: 1 }} />

          <ButtonBase
            onClick={(e) => setUserMenu(e.currentTarget)}
            aria-label="Account menu"
            sx={{ borderRadius: 6, py: 0.5, pl: 0.5, pr: 1, gap: 1.25, flexShrink: 0, '&:hover': { bgcolor: 'action.hover' } }}
          >
            <PersonAvatar name={profile.full_name} size={34} />
            <Box sx={{ textAlign: 'left', display: { xs: 'none', md: 'block' } }}>
              <Typography variant="body2" sx={{ fontWeight: 500, lineHeight: 1.2 }}>
                {profile.full_name}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {APP_ROLE_LABELS[profile.role]}
              </Typography>
            </Box>
            <ExpandMoreIcon fontSize="small" sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }} />
          </ButtonBase>
          <Menu
            anchorEl={userMenu}
            open={!!userMenu}
            onClose={() => setUserMenu(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { mt: 1, minWidth: 240 } } }}
          >
            <Box sx={{ px: 2, py: 1 }}>
              <Typography variant="subtitle2">{profile.full_name}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {profile.email}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {APP_ROLE_LABELS[profile.role]}
              </Typography>
            </Box>
            <Divider />
            <ThemeModeSwitch />
            <Divider />
            {profile.login_method === 'password' && (
              <MenuItem
                onClick={() => {
                  setUserMenu(null)
                  setChangingPassword(true)
                }}
              >
                <ListItemIcon>
                  <KeyOutlinedIcon fontSize="small" />
                </ListItemIcon>
                Change password
              </MenuItem>
            )}
            <MenuItem
              onClick={() => {
                setUserMenu(null)
                signOut()
              }}
            >
              <ListItemIcon>
                <LogoutIcon fontSize="small" />
              </ListItemIcon>
              Sign out
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      <Drawer
        variant={desktop ? 'permanent' : 'temporary'}
        open={desktop || mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ width: navWidth, flexShrink: 0 }}
        slotProps={{ paper: { sx: { width: desktop ? navWidth : DRAWER_WIDTH, boxSizing: 'border-box', overflowX: 'hidden' } } }}
      >
        {drawer}
      </Drawer>

      <Box component="main" sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 } }}>
        <Toolbar />
        <Outlet />
      </Box>

      {(changingPassword || recovering) && (
        <PasswordDialog
          recovering={recovering}
          onClose={() => {
            setChangingPassword(false)
            endRecovery()
          }}
        />
      )}
    </Box>
  )
}

// Only password logins have a password to change; a reset link lands here too.
function PasswordDialog({ recovering, onClose }: { recovering: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (password.length < PASSWORD_MIN_LENGTH) return setError(`Use at least ${PASSWORD_MIN_LENGTH} characters.`)
    if (password !== confirm) return setError('The passwords do not match.')
    setBusy(true)
    setError(null)
    const { error: saveError } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (saveError) return setError(saveError.message)
    onClose()
  }

  return (
    <FormDialog
      open
      title={recovering ? 'Set a new password' : 'Change password'}
      error={error}
      busy={busy}
      onSubmit={save}
      onClose={onClose}
    >
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <TextField
        label="Confirm new password"
        type="password"
        autoComplete="new-password"
        required
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
    </FormDialog>
  )
}
