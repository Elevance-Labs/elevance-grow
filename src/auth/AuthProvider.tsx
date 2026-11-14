import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { COMPANY_DOMAIN } from '../lib/constants'
import { SSO_PARAM, ssoHint } from '../lib/suite'
import type { Profile } from '../lib/types'

interface AuthState {
  loading: boolean
  profile: Profile | null
  error: string | null
  isAdmin: boolean
  // Works on prospecting: admin or growth. Everything in this phase is theirs.
  isGrowth: boolean
  // Came in through a password reset link, so should set a new password now.
  recovering: boolean
  endRecovery: () => void
  signIn: () => Promise<void>
  // For password logins: people without a company Google account.
  signInWithPassword: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

const NOT_ALLOWED = `Sign-in refused. You need an @${COMPANY_DOMAIN} Google account, or a password login set up for you, with an active profile here. Ask an admin if you think this is a mistake.`

// Supabase reports OAuth failures as error_description in the query string or hash.
function readOAuthError(): string | null {
  const fromQuery = new URLSearchParams(window.location.search).get('error_description')
  const fromHash = new URLSearchParams(window.location.hash.replace(/^#\/?/, '')).get(
    'error_description',
  )
  return fromQuery ?? fromHash
}

// A sibling app's switcher hands the person over with their company email in
// the address (`?sso=`). It is read once, as the page loads, and taken out of
// the address so that a reload, a bookmark or the return from Google never
// carries it again.
function takeSsoHint(): string | null {
  const url = new URL(window.location.href)
  if (!url.searchParams.has(SSO_PARAM)) return null
  const hint = ssoHint(url.search, COMPANY_DOMAIN)
  url.searchParams.delete(SSO_PARAM)
  window.history.replaceState(window.history.state, '', url)
  return hint
}
const handedOver = takeSsoHint()
let handOverStarted = false

export function AuthProvider({ children }: { children: ReactNode }) {
  const [sessionReady, setSessionReady] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [binding, setBinding] = useState(false)
  const [error, setError] = useState<string | null>(readOAuthError)
  const [handOverFailed, setHandOverFailed] = useState(false)
  const [recovering, setRecovering] = useState(false)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true)
      if (event === 'SIGNED_OUT') setRecovering(false)
      setUserId(session?.user.id ?? null)
      setSessionReady(true)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // Handed over from a sibling app with no session here: go straight to
  // Google, naming the account, with no chooser. Google already knows them, so
  // it comes back signed in without showing a screen. Tried once per page
  // load; whatever Google returns, the address no longer carries the hint.
  const handingOver = sessionReady && !userId && handedOver !== null && !handOverFailed
  useEffect(() => {
    if (!handingOver || handOverStarted) return
    handOverStarted = true
    supabase.auth
      .signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin + window.location.pathname,
          queryParams: { hd: COMPANY_DOMAIN, login_hint: handedOver as string },
        },
      })
      .then(({ error: signInError }) => {
        if (!signInError) return
        setError(signInError.message)
        setHandOverFailed(true)
      })
  }, [handingOver])

  // A session alone is not enough: the user must match an active profile.
  useEffect(() => {
    if (!sessionReady) return
    if (!userId) {
      setProfile(null)
      return
    }
    let cancelled = false
    setBinding(true)
    supabase
      .rpc('bind_profile')
      .maybeSingle()
      .then(async ({ data, error: rpcError }) => {
        if (cancelled) return
        if (rpcError || !data) {
          setError(rpcError ? `Could not verify your account: ${rpcError.message}` : NOT_ALLOWED)
          await supabase.auth.signOut()
        } else if ((data as Profile).role === 'agent') {
          // A worker's login is for the worker program, not for the app.
          setError('This is a worker login. It signs in from the worker program, not here.')
          await supabase.auth.signOut()
        } else {
          setProfile(data as Profile)
        }
        setBinding(false)
      })
    return () => {
      cancelled = true
    }
  }, [sessionReady, userId])

  const role = profile?.role
  const value = useMemo<AuthState>(
    () => ({
      loading: !sessionReady || binding || handingOver || (!!userId && !profile),
      profile,
      error,
      isAdmin: role === 'admin',
      isGrowth: role === 'admin' || role === 'growth',
      recovering,
      endRecovery: () => setRecovering(false),
      signIn: async () => {
        setError(null)
        const { error: signInError } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin + window.location.pathname,
            // hd only pre-filters the Google account picker; the database enforces the domain.
            queryParams: { hd: COMPANY_DOMAIN, prompt: 'select_account' },
          },
        })
        if (signInError) setError(signInError.message)
      },
      signInWithPassword: async (email, password) => {
        setError(null)
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        })
        if (signInError) setError(signInError.message)
      },
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }),
    [sessionReady, binding, handingOver, userId, profile, role, error, recovering],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
