// Markets and the market workspace: naming a market, starting each kind of
// run, deciding proposals, sources and their collectors, and the dataset.
// What is asserted is who is offered what, and exactly what is sent.
import { setupDom, reporter, text, click, type, button, buttons, dialog, settle, waitFor, row } from './setup'
setupDom()

const { mountApp, location } = await import('./app')
const { reset, signInAs, captured, failNext, table, lastRpc, PEOPLE } = await import('./mockSupabase')
const { check, done } = reporter()
const json = (v: unknown) => JSON.stringify(v)
const card = (contains: string) =>
  [...document.querySelectorAll<HTMLElement>('.MuiCard-root')].find((c) => c.textContent?.includes(contains)) ?? null
const tab = (name: string) => [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((t) => t.textContent?.startsWith(name))
// By attribute value, not a selector: jsdom's selector engine trips on "&" in one.
const selectBox = (label: string) =>
  [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((i) => i.getAttribute('aria-label') === label) ?? null
async function open(path: string) {
  reset()
  signInAs(PEOPLE.growth)
  await mountApp(path)
}

// ---------------- the list, and a new market ----------------
await open('/markets')
check('markets are listed with where they stand',
  card('Scrap yards')?.textContent?.includes('4 accepted') === true && card('Scrap yards')?.textContent?.includes('2 to review') === true &&
    card('Towing')?.textContent?.includes('No thesis yet') === true, card('Scrap yards')?.textContent ?? '')
await click(button('New market'))
await type('Industry', '  Junk removal ', dialog()!)
await type('Region', 'Texas', dialog()!)
await type('What we are after (optional)', 'Owner-operated', dialog()!)
await click(button('Create', dialog()!))
check('a new market sends its name, region and brief, trimmed, and nothing else',
  json(captured.inserts.at(-1)) === json({ table: 'markets', rows: [{ name: 'Junk removal', region: 'Texas', brief: 'Owner-operated' }] }),
  json(captured.inserts.at(-1)))
check('and opens', location.pathname.startsWith('/markets/new-') && text().includes('Junk removal'), location.pathname)

await open('/markets')
await click(button('New market'))
await type('Industry', 'Scrap yards', dialog()!)
await type('Region', 'Ohio', dialog()!)
failNext('markets.insert', { code: '23505', message: 'duplicate key value violates unique constraint' })
await click(button('Create', dialog()!))
check('the same industry and region twice is explained', dialog()?.textContent?.includes('already a market for that industry and region') === true)

// ---------------- thesis ----------------
await open('/markets/m-tow')
check('a market with no thesis explains what one is', text().includes('The thesis is the industry brief'))
check('a waiting thesis is shown to decide', card('Towing operators in Texas') !== null && button('Accept') !== undefined)
check('with the pages it was read from', card('Towing operators in Texas')?.querySelector('a[href="https://www.tdlr.texas.gov/towing"]') !== null)
await click(button('Write the thesis'))
check('writing the thesis starts a thesis run for this market',
  json(lastRpc('run_start')) === json({ p_kind: 'thesis', p_market_id: 'm-tow', p_account_ids: null, p_source_id: null, p_input: {} }),
  json(lastRpc('run_start')))
check('and shows it waiting, instead of the button', text().includes('Waiting') && button('Write the thesis') === undefined)
check('with a worker online, nothing is said about workers', !text().includes('worker is offline'))

await click(button('Accept'))
check('accepting sends the proposal as it is',
  json(lastRpc('proposal_decide')) === json({ p_id: 'pr-thesis', p_accept: true, p_final: null, p_reason: null }), json(lastRpc('proposal_decide')))
check('and the thesis is on the market', table('markets').find((m) => m.id === 'm-tow')?.status === 'active' && card('Towing operators in Texas') !== null &&
  button('Accept') === undefined)

await open('/markets/m-tow')
await click(button('Change and accept'))
await type('Thesis', 'Edited by a person. '.repeat(12), dialog()!)
await click(button('Accept this', dialog()!))
const changed = lastRpc('proposal_decide') as { p_final: { text: string; sources: unknown[] } }
check('changing it first sends the changed text, keeping its sources',
  changed.p_final.text.startsWith('Edited by a person.') && changed.p_final.sources.length === 1, json(changed))

await open('/markets/m-tow')
await click(button('Reject'))
await type('Why (optional)', ' Too thin ', dialog()!)
await click(button('Reject', dialog()!))
check('rejecting sends the reason, trimmed',
  json(lastRpc('proposal_decide')) === json({ p_id: 'pr-thesis', p_accept: false, p_final: null, p_reason: 'Too thin' }), json(lastRpc('proposal_decide')))
check('and writes nothing to the market', table('markets').find((m) => m.id === 'm-tow')?.thesis === null)

await open('/markets/m-tow')
failNext('rpc.run_start', { code: 'P0001', message: 'That is already running for this market.' })
await click(button('Write the thesis'))
check('a refused run shows the database\'s own reason', text().includes('That is already running for this market.'))

// The worker being away is said where work is waiting.
await open('/markets/m-tow')
table('workers')[0].last_seen_at = new Date(Date.now() - 10 * 60_000).toISOString()
await click(button('Write the thesis'))
await waitFor(() => text().includes('The worker is offline'))
check('with the worker offline, a waiting run says so', text().includes('The worker is offline, so jobs will wait'))

// ---------------- lessons ----------------
await open('/markets/m-scrap')
check('a market shows its own lessons, not the general ones',
  text().includes('Chains with more than five yards') && !text().includes('Lead with what we noticed'))
await click(button('Suggest lessons'))
check('suggesting lessons starts a lessons run', (lastRpc('run_start') as { p_kind: string }).p_kind === 'lessons')
await click(button('Accept', card('Owners answer the phone themselves')!))
check('an accepted lesson joins the market\'s', table('lessons').some((l) => l.market_id === 'm-scrap' && String(l.body).startsWith('Owners answer')))

// ---------------- sources and collectors ----------------
await open('/markets/m-tow?tab=sources')
check('sources cannot be looked for before there is a thesis', (button('Find sources') as HTMLButtonElement).disabled)

await open('/markets/m-scrap?tab=sources')
await click(button('Find sources'))
check('finding sources starts a sources run', (lastRpc('run_start') as { p_kind: string }).p_kind === 'sources')

const bmv = () => card('https://bmv.ohio.gov/dealers'.replace('https://', ''))!
check('a source with an approved collector can be collected', button('Collect', bmv()) !== undefined && bmv().textContent?.includes('212 rows') === true)
await click(button('Collect', bmv()))
check('collecting names the source',
  json(lastRpc('run_start')) === json({ p_kind: 'collect', p_market_id: 'm-scrap', p_account_ids: null, p_source_id: 's-bmv', p_input: {} }), json(lastRpc('run_start')))
const ara = card('a-r-a.org/members')!
check('one whose collector waits for approval cannot', button('Collect', ara) === undefined && ara.textContent?.includes('Waiting for approval') === true)
const oatra = card('oatra.org/members')!
check('one with no collector offers to build it', button('Build collector', oatra) !== undefined && button('Collect', oatra) === undefined)
await click(button('Build collector', oatra))
check('building names the source', json(lastRpc('run_start')) ===
  json({ p_kind: 'collector_build', p_market_id: 'm-scrap', p_account_ids: null, p_source_id: 's-oatra', p_input: {} }), json(lastRpc('run_start')))

await click(selectBox('Use OATRA members'))
check('unticking a source sends only that', json(captured.updates.at(-1)) ===
  json({ table: 'market_sources', values: { selected: false }, filters: [['id', 'eq', 's-oatra']] }), json(captured.updates.at(-1)))
check('an unticked source offers no runs', button('Build collector', card('oatra.org/members')!) === undefined)

await click(button('Accept', card('County auditor salvage licences')!))
check('an accepted source is added to the market, ticked',
  table('market_sources').some((s) => s.url === 'https://auditor.example.org/salvage' && s.selected === true))

await click(button('Add one'))
await type('Name', 'Sheriff tow list', dialog()!)
await type('Web address', 'https://sheriff.example.org/tows', dialog()!)
await click(button('Add', dialog()!))
check('a source added by hand sends its market, name, address, kind and why',
  json(captured.inserts.at(-1)) === json({ table: 'market_sources', rows: [{ market_id: 'm-scrap', name: 'Sheriff tow list', url: 'https://sheriff.example.org/tows', kind: 'other', why: '' }] }),
  json(captured.inserts.at(-1)))

// ---------------- the dataset ----------------
await open('/markets/m-scrap?tab=dataset')
check('the dataset opens on what is waiting for review', row('Miller & Sons Salvage') !== undefined && row('Lima Auto Wrecking') !== undefined && row('Buckeye') === undefined)
check('nothing can be decided until something is selected', (button('Accept') as HTMLButtonElement).disabled)
await click(selectBox('Select all'))
await click(button('Accept'))
check('accepting sends the selected ids and the decision',
  json(lastRpc('accounts_review')) === json({ p_ids: ['a-lima', 'a-miller'], p_decision: 'accepted' }), json(lastRpc('accounts_review')))

await open('/markets/m-scrap?tab=dataset&review=candidate')
await click(selectBox('Select Miller & Sons Salvage'))
await click(button('Reject'))
check('rejecting sends just that one', json(lastRpc('accounts_review')) === json({ p_ids: ['a-miller'], p_decision: 'rejected' }))
check('candidates cannot be researched from here', button('Research') === undefined)

await open('/markets/m-scrap?tab=dataset&review=accepted')
check('accepted accounts show their fit, best first',
  [...document.querySelectorAll('tbody tr')].map((r) => r.querySelector('a')?.textContent).join() ===
    "Buckeye Pick-n-Pull,Lakeside U-Pull,Quiet Acres Salvage,Bob's Auto Parts",
  [...document.querySelectorAll('tbody tr')].map((r) => r.querySelector('a')?.textContent).join())
check('a do-not-contact account is marked', row('Quiet Acres')?.textContent?.includes('Do not contact') === true)
await click(selectBox('Select Buckeye Pick-n-Pull'))
await click(selectBox("Select Bob's Auto Parts"))
check('outreach cannot be drafted to an account not yet researched', (button('Draft outreach') as HTMLButtonElement).disabled)
await click(button('Research'))
check('research sends the selected accounts',
  json(lastRpc('run_start')) === json({ p_kind: 'enrich', p_market_id: 'm-scrap', p_account_ids: ['a-buckeye', 'a-bobs'], p_source_id: null, p_input: {} }),
  json(lastRpc('run_start')))
check('and each shows as waiting', row('Buckeye')?.textContent?.includes('Waiting') === true && row("Bob's")?.textContent?.includes('Waiting') === true)

await open('/markets/m-scrap?tab=dataset&review=accepted')
await click(selectBox('Select Quiet Acres Salvage'))
check('nor to one marked do not contact', (button('Draft outreach') as HTMLButtonElement).disabled)
await click(selectBox('Select Quiet Acres Salvage'))
await click(selectBox('Select Buckeye Pick-n-Pull'))
await click(button('Draft outreach'))
await click([...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent === 'Call script'))
check('a draft run carries the channel',
  json(lastRpc('run_start')) === json({ p_kind: 'draft', p_market_id: 'm-scrap', p_account_ids: ['a-buckeye'], p_source_id: null, p_input: { channel: 'call' } }),
  json(lastRpc('run_start')))

// ---------------- runs ----------------
await click(tab('Runs'))
check('the market\'s runs are listed, newest first', document.querySelectorAll('.MuiCard-root').length === 2 && text().includes('Research 1 account in Scrap yards'))
await click(buttons('Stop')[0])
check('stopping a run cancels it', json(lastRpc('run_cancel')) === json({ p_run_id: table('agent_runs').at(-1)!.id }) && text().includes('Cancelled'))
await click(buttons('See steps').at(-1))
await settle()
check('a run\'s steps are shown, with what the evidence check dropped',
  dialog()?.textContent?.includes('Reading buckeyepnp.com') === true && dialog()?.textContent?.includes('Dropped "Founded"') === true, dialog()?.textContent ?? '')

// ---------------- archiving ----------------
await open('/markets/m-scrap')
await click(button('Archive'))
check('archiving sends the status', json(captured.updates.at(-1)) === json({ table: 'markets', values: { status: 'archived' }, filters: [['id', 'eq', 'm-scrap']] }))

await open('/markets/nope')
check('an unknown market says so', text().includes('Market not found'))

done()
