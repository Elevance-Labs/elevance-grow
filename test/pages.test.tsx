// Today, the pipeline, the playbook, the collector library and settings.
import { setupDom, reporter, text, click, type, choose, button, buttons, dialog, settle, row } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, lastRpc, PEOPLE } = await import('./mockSupabase')
const { workerNotice } = await import('../src/lib/runs')
const { check, done } = reporter()
const json = (v: unknown) => JSON.stringify(v)
const section = (name: string) => document.querySelector<HTMLElement>(`[aria-label="${name}"]`)
const card = (contains: string, root: ParentNode = document) =>
  [...root.querySelectorAll<HTMLElement>('.MuiCard-root')].find((c) => c.textContent?.includes(contains)) ?? null
async function open(path: string, who = PEOPLE.growth) {
  reset()
  signInAs(who)
  await mountApp(path)
}

// ---------------- Today ----------------
await open('/today')
check('Today lists the proposals waiting, saying where each belongs',
  section('Proposals')?.textContent?.includes('Proposals (4)') === true && card('Send the quote he asked for')?.textContent?.includes('Scrap yards · Lakeside U-Pull') === true)
check('the collectors waiting for approval', section('Collectors waiting for approval')?.textContent?.includes('ARA member directory') === true &&
  section('Collectors waiting for approval')?.textContent?.includes('a-r-a.org, cdn.a-r-a.org') === true)
check('where there are collected businesses to review',
  section('Collected businesses to review')?.querySelector('a')?.getAttribute('href') === '/markets/m-scrap?tab=dataset&review=candidate' &&
    section('Collected businesses to review')?.textContent?.includes('2 to accept or reject') === true)
check('researched accounts to qualify or park, best fit first',
  [...(section('Researched: qualify or park')?.querySelectorAll('a') ?? [])].map((a) => a.textContent).join() === 'Buckeye Pick-n-Pull,Quiet Acres Salvage',
  section('Researched: qualify or park')?.textContent ?? '')
check('drafts ready to send', section('Drafts ready to send')?.textContent?.includes('Email · Your 2014 website') === true)
check('and accounts gone quiet', section('Gone quiet')?.textContent?.includes('Lakeside U-Pull') === true)
check('nothing is running, so no run is shown', section('Running now') === null)
await click(button('Reject', card('County auditor salvage licences')!))
await click(button('Reject', dialog()!))
check('a proposal can be decided from Today; no reason sends none',
  json(lastRpc('proposal_decide')) === json({ p_id: 'pr-source', p_accept: false, p_final: null, p_reason: null }) &&
    section('Proposals')?.textContent?.includes('Proposals (3)') === true)

reset()
signInAs(PEOPLE.growth)
for (const name of ['proposals', 'drafts', 'accounts', 'collectors', 'agent_runs', 'markets'] as const) table(name).length = 0
await mountApp('/today')
check('with nothing waiting and no market, Today says where to start', text().includes('Nothing is waiting.') && button('Name a market') !== undefined)

// ---------------- pipeline ----------------
await open('/pipeline')
const column = (name: string) => document.querySelector<HTMLElement>(`[role="region"][aria-label="${name}"]`)
check('the pipeline shows accepted accounts by stage',
  column('Researching')?.textContent?.includes('Researching · 3') === true && column('Talking')?.textContent?.includes('Lakeside U-Pull') === true)
check('candidates and rejected businesses are not in it', !text().includes('Miller & Sons') && !text().includes('Mega Chain'))
check('closed stages are folded away', column('Won') === null && text().includes('Show closed (0)'))
check('a stage shows what it is worth', column('Talking')?.textContent?.includes('$40,000') === true, column('Talking')?.textContent ?? '')
check('a quiet account is flagged on its card', card('Lakeside U-Pull', column('Talking')!)?.textContent?.includes('Quiet since') === true)
check('a card opens the account', card('Lakeside U-Pull')?.querySelector('a')?.getAttribute('href') === '/accounts/a-talk')
await click(document.querySelector('.MuiChip-root[role="button"]'))
check('closed stages can be shown', column('Won') !== null && column('Lost') !== null && column('Parked') !== null)
await choose('Market', 'Towing, Texas')
check('filtering by market is kept in the address', location.search === '?market=m-tow' && !text().includes('Lakeside U-Pull'), location.search)

// ---------------- playbook ----------------
await open('/playbook')
check('the playbook has its six sections', document.querySelectorAll('textarea[aria-label]').length === 6)
check('and the lessons that hold everywhere, not a market\'s', text().includes('Lead with what we noticed') && !text().includes('Chains with more than five yards'))
const services = card('What we sell')!
check('nothing can be saved until something changed', (button('Save', services) as HTMLButtonElement).disabled)
const box = services.querySelector<HTMLTextAreaElement>('textarea[aria-label="What we sell"]')!
Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(box, 'Custom software for yards.')
box.dispatchEvent(new window.Event('input', { bubbles: true }))
await settle()
await click(button('Save', services))
check('saving a section sends its text and nothing else',
  json(captured.updates.at(-1)) === json({ table: 'playbook_sections', values: { body: 'Custom software for yards.' }, filters: [['id', 'eq', 'pb-service_lines']] }),
  json(captured.updates.at(-1)))
await click(button('Add one'))
await type('Lesson', ' Owners decide alone. ', dialog()!)
await click(button('Add', dialog()!))
check('a lesson added here is general: no market', json(captured.inserts.at(-1)) === json({ table: 'lessons', rows: [{ market_id: null, body: 'Owners decide alone.' }] }))
await click(button('Remove lesson: Lead with what we noticed, not with who we are.'))
check('a lesson can be removed', json(captured.deletes.at(-1)) === json({ table: 'lessons', filters: [['id', 'eq', 'l-2']] }))

// ---------------- the collector library ----------------
await open('/sources')
check('collectors waiting are listed apart from the library', text().indexOf('Waiting for approval') < text().indexOf('ARA member directory') &&
  text().indexOf('ARA member directory') < text().indexOf('Library'))
await click(button('Open ARA member directory'))
const d = () => dialog()!
check('a collector shows the only hosts it may call', d().textContent?.includes('May call only') === true && d().textContent?.includes('cdn.a-r-a.org') === true)
check('its code, to read before approving', d().querySelector('[aria-label="Collector code"]')?.textContent?.includes("import { getText } from './helpers.ts'") === true)
check('a sample of what it returned', d().querySelector('tbody')?.textContent?.includes('Miller & Sons Salvage') === true)
check('growth cannot approve it, and is told who can', button('Approve version 2', d()) === undefined && d().textContent?.includes('An admin approves collectors') === true)

await open('/sources', PEOPLE.admin)
await click(button('Open ARA member directory'))
await type('Note (optional)', ' Read it; directory only ', dialog()!)
await click(button('Approve version 2', dialog()!))
check('an admin approving sends the collector, the decision and the note',
  json(lastRpc('collector_decide')) === json({ p_id: 'c-ara', p_status: 'approved', p_note: 'Read it; directory only' }), json(lastRpc('collector_decide')))
await click(button('Open Ohio BMV salvage dealers'))
check('an approved collector says who approved it', dialog()?.textContent?.includes('by Amna Khan') === true)
failNext('rpc.collector_decide', { code: '42501', message: 'Only an admin can approve or retire a collector.' })
await click(button('Retire', dialog()!))
check('a refused decision is shown, and the dialog stays', dialog()?.textContent?.includes('Only an admin can approve or retire a collector.') === true)

// ---------------- runs ----------------
await open('/runs')
check('every run is listed with what it used', text().includes('Research 1 account in Scrap yards') && text().includes('51k tokens'), text().slice(0, 300))

// ---------------- settings ----------------
await open('/settings', PEOPLE.admin)
check('people and workers are listed apart', row('Sara Iqbal') !== undefined && row('Home PC') === undefined &&
  section('Workers')?.textContent?.includes('Home PC') === true)
check('a worker shows whether it is there', section('Workers')?.textContent?.includes('Online') === true && section('Workers')?.textContent?.includes('HOME-PC') === true)
await click(button('Add worker'))
await type('Name of the computer', 'Office PC', dialog()!)
await type('Email', 'Office-PC@Grow-Worker.dev', dialog()!)
await click(button('Save', dialog()!))
check('a worker is added as an agent with a password login, its address lower-cased',
  json(captured.inserts.at(-1)) === json({ table: 'profiles', rows: [{ full_name: 'Office PC', email: 'office-pc@grow-worker.dev', login_method: 'password', role: 'agent', active: true }] }),
  json(captured.inserts.at(-1)))

await click(button('Add person'))
await type('Full name', 'New Person', dialog()!)
await type('Email', 'new@gmail.com', dialog()!)
failNext('profiles.insert', { code: '23514', message: 'violates check constraint' })
await click(button('Save', dialog()!))
check('a wrong email for the sign-in method is explained', dialog()?.textContent?.includes('signs in with Google, any other with a password') === true)
await click(button('Cancel', dialog()!))

await click(button('Set password for Home PC'))
const generated = (dialog()!.querySelector('input') as HTMLInputElement).value
check('a password is suggested, long enough', generated.length >= 16)
await click(button('Set password', dialog()!))
check('setting it calls the function with the profile and the password',
  json(captured.functions.at(-1)) === json({ name: 'set-password', body: { profile_id: 'p-pc', password: generated } }), json(captured.functions.at(-1)))
check('and shows it once, to copy', dialog()?.textContent?.includes('it is not shown again') === true && dialog()?.textContent?.includes(generated) === true)
await click(button('Done', dialog()!))

await click(button('Set password for Home PC'))
failNext('functions.set-password', { message: 'Only an admin can set passwords.' })
await click(button('Set password', dialog()!))
check('a refusal from the function is shown as it says', dialog()?.textContent?.includes('Only an admin can set passwords.') === true)
await click(button('Cancel', dialog()!))

await choose('Does jobs started by', 'Amna Khan')
check('a worker can be kept to one person\'s jobs',
  json(captured.updates.at(-1)) === json({ table: 'workers', values: { owner_id: 'p-amna' }, filters: [['profile_id', 'eq', 'p-pc']] }), json(captured.updates.at(-1)))
check('there is no removing yourself', buttons('Remove Amna Khan').length === 0 && buttons('Remove Sara Iqbal').length === 1)

// ---------------- what a waiting person is told about workers ----------------
const seen = (minutesAgo: number, state = 'idle') =>
  ({ profile_id: 'w', owner_id: null, state, info: {}, last_seen_at: new Date(Date.now() - minutesAgo * 60_000).toISOString() }) as Parameters<typeof workerNotice>[0] extends (infer W)[] | null ? W : never
check('a worker heard from just now needs no notice', workerNotice([seen(0)]) === null)
check('none set up is said', workerNotice([])?.includes('No worker has been set up') === true)
check('one gone silent is offline', workerNotice([seen(5)])?.includes('offline') === true)
check('one at its usage limit says so', workerNotice([seen(0, 'limit')])?.includes('usage limit') === true)
check('before the workers are known, nothing is claimed', workerNotice(null) === null)

done()
