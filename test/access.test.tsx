// Who gets in, and what each role is offered. The database refuses the same
// people (test/sql/access.test.sql); this is the app not offering what it
// would refuse.
import { setupDom, reporter, text, navLabels, settle } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, PEOPLE, WORKER } = await import('./mockSupabase')
const { check, done } = reporter()

const PROSPECTING = ['markets', 'accounts', 'proposals', 'playbook_sections', 'drafts', 'collectors', 'agent_runs']
const readsProspecting = () => captured.reads.filter((t) => PROSPECTING.includes(t))

// ---------------- signed out, and refused ----------------
reset()
await mountApp('/markets')
check('signed out, every address is the sign-in page', text().includes('Sign in with Google') && !text().includes('Markets'))
check('and nothing is read', captured.reads.length === 0, captured.reads.join())

reset()
signInAs(null)
await mountApp('/today')
check('a session with no profile is refused, with the reason', text().includes('Sign-in refused'), text().slice(0, 200))
check('and signed out again', captured.auth.some((a) => a.call === 'signOut'))

reset()
signInAs(WORKER)
await mountApp('/today')
check('a worker login is not let into the app', text().includes('This is a worker login') && captured.auth.some((a) => a.call === 'signOut'),
  text().slice(0, 200))
check('and reads nothing', readsProspecting().length === 0, readsProspecting().join())

// ---------------- growth ----------------
reset()
signInAs(PEOPLE.growth)
await mountApp('/')
check('growth lands on Today', location.pathname === '/today', location.pathname)
check('growth is offered prospecting, not settings',
  navLabels().join() === 'Today,Markets,Pipeline,Playbook,Sources,Runs', navLabels().join())
await mountApp('/settings')
check('the settings address is not there for growth', location.pathname === '/today', location.pathname)
check('and no profile list was asked for', !captured.reads.includes('profiles'), captured.reads.join())
await mountApp('/welcome')
check('nor the page for people with nothing here', location.pathname === '/today')

// ---------------- admin ----------------
reset()
signInAs(PEOPLE.admin)
await mountApp('/settings')
check('an admin has Settings too', navLabels().join() === 'Today,Markets,Pipeline,Playbook,Sources,Runs,Settings', navLabels().join())
check('and it opens', location.pathname === '/settings' && text().includes('Workers'))

// ---------------- a member, and the agency ----------------
for (const [name, who] of [['a member', PEOPLE.member], ['the agency', PEOPLE.agency]] as const) {
  reset()
  signInAs(who)
  await mountApp('/')
  check(`${name} lands on the welcome page`, location.pathname === '/welcome' && text().includes('nothing for you here yet'), location.pathname)
  check(`${name} is offered nothing else`, navLabels().join() === 'Welcome', navLabels().join())
  for (const path of ['/today', '/markets', '/markets/m-scrap', '/accounts/a-buckeye', '/pipeline', '/playbook', '/sources', '/runs', '/settings']) {
    await mountApp(path)
    await settle()
    if (location.pathname !== '/welcome') check(`${name} cannot open ${path}`, false, location.pathname)
  }
  check(`${name} is sent back from every prospecting address`, location.pathname === '/welcome')
  check(`for ${name} the app never asks for prospecting data`, readsProspecting().length === 0, readsProspecting().join())
}

done()
