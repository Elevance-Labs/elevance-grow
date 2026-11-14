// One account: the evidence and how far to trust it, the stage, drafts, the
// timeline, and what each action sends.
import { setupDom, reporter, text, click, type, button, buttons, dialog, settle } from './setup'
setupDom()

const { mountApp } = await import('./app')
const { reset, signInAs, captured, failNext, table, lastRpc, PEOPLE } = await import('./mockSupabase')
const { safeUrl, linkedinSearchUrl, goneQuiet, awaitsDecision } = await import('../src/lib/accounts')
const { check, done } = reporter()
const json = (v: unknown) => JSON.stringify(v)
const card = (contains: string) =>
  [...document.querySelectorAll<HTMLElement>('.MuiCard-root')].find((c) => c.textContent?.includes(contains)) ?? null
const menuItem = (name: string) => [...document.querySelectorAll('[role="menuitem"]')].find((i) => i.textContent === name)
const chips = (root: ParentNode) => [...root.querySelectorAll('.MuiChip-label')].map((c) => c.textContent)
async function open(path: string) {
  reset()
  signInAs(PEOPLE.growth)
  await mountApp(path)
}
// The clipboard, as a browser has it.
const copied: string[] = []
Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async (t: string) => void copied.push(t) }, configurable: true })

// ---------------- evidence ----------------
await open('/accounts/a-buckeye')
const known = () => card('What we know')!
check('the reason to talk leads, with the fit', card('The reason to talk')?.textContent?.includes('no inventory search') === true &&
  chips(card('The reason to talk')!).includes('Fit 82'))
check('each fact says how far to trust it', json(chips(known())) === json(['Checked', 'Not checked', 'Inferred']), json(chips(known())))
check('and the count says the same', known().textContent?.includes('1 checked against the page · 1 not checked · 1 inferred') === true)
check('a fact shows the words it was read in, and links to the page',
  known().textContent?.includes('“© 2014 Buckeye Pick-n-Pull”') === true && known().querySelector('a[href="https://buckeyepnp.com/"]') !== null)
check('source links open elsewhere and pass nothing on',
  [...known().querySelectorAll('a[href^="http"]')].every((a) => a.getAttribute('target') === '_blank' && a.getAttribute('rel')?.includes('noopener')))
check('a fact set aside is hidden', !known().textContent?.includes('Has three yards.') && button('Show 1 set aside') !== undefined)
await click(buttons('Wrong', known())[0])
check('marking a fact wrong sends it, kept not deleted', json(lastRpc('fact_reject')) === json({ p_id: 'f-1', p_rejected: true }) &&
  table('account_facts').length === 4)
check('and it joins the ones set aside', button('Show 2 set aside') !== undefined)
await click(button('Show 2 set aside'))
await click(buttons('Bring back', known())[0])
check('a fact can be brought back', (lastRpc('fact_reject') as { p_rejected: boolean }).p_rejected === false)

check('a link is only made from a web address', safeUrl('javascript:alert(1)') === null && safeUrl('data:text/html,x') === null &&
  safeUrl('buckeyepnp.com/about') === 'https://buckeyepnp.com/about' && safeUrl(null) === null)

// ---------------- people ----------------
const people = card('People')!
check('a person is shown with where they were named', people.textContent?.includes('Dale Buck') === true && people.textContent?.includes('owned by Dale Buck since 1988') === true)
const linkedin = people.querySelector<HTMLAnchorElement>('a[href*="linkedin.com"]')
check('LinkedIn is a search link for a person to open, nothing more',
  linkedin?.getAttribute('href') === linkedinSearchUrl({ full_name: 'Dale Buck' }, { name: 'Buckeye Pick-n-Pull' }) &&
    linkedin.getAttribute('href')!.startsWith('https://www.linkedin.com/search/results/people/?keywords=Dale%20Buck%20Buckeye'), linkedin?.getAttribute('href'))

// ---------------- the reason to talk is the person's to rewrite ----------------
await click(button('Edit', card('The reason to talk')!))
await type('The reason to talk', 'Their site still says 2014.', card('The reason to talk')!)
await click(button('Save', card('The reason to talk')!))
check('editing it sends only the new text',
  json(captured.updates.at(-1)) === json({ table: 'accounts', values: { hook: 'Their site still says 2014.' }, filters: [['id', 'eq', 'a-buckeye']] }), json(captured.updates.at(-1)))

await click(button('Research again'))
check('research again starts a run for this account',
  json(lastRpc('run_start')) === json({ p_kind: 'enrich', p_market_id: 'm-scrap', p_account_ids: ['a-buckeye'], p_source_id: null, p_input: {} }), json(lastRpc('run_start')))

// ---------------- stage ----------------
await open('/accounts/a-buckeye')
await click(button('Stage: Researching. Change'))
await click(menuItem('Move to Qualified'))
check('a move sends the stage, with no note asked for',
  json(lastRpc('account_move')) === json({ p_id: 'a-buckeye', p_stage: 'qualified', p_note: null }), json(lastRpc('account_move')))
check('and shows at once', button('Stage: Qualified. Change') !== undefined)
await click(button('Stage: Qualified. Change'))
await click(menuItem('Move to Lost'))
check('losing an account asks why first', dialog()?.textContent?.includes('Move to Lost') === true && captured.rpcs.filter((r) => r.name === 'account_move').length === 1)
await type('Why', ' Happy with their system ', dialog()!)
await click(button('Move', dialog()!))
check('and sends the reason, trimmed',
  json(lastRpc('account_move')) === json({ p_id: 'a-buckeye', p_stage: 'lost', p_note: 'Happy with their system' }), json(lastRpc('account_move')))
check('the reason is on the timeline', card('Timeline')?.textContent?.includes('Moved to Lost') === true && card('Timeline')?.textContent?.includes('Happy with their system') === true)

await open('/accounts/a-buckeye')
await click(button('Stage: Researching. Change'))
await click(menuItem('Move to Parked'))
failNext('rpc.account_move', { code: 'P0001', message: 'Say why: a reason is needed to mark an account lost or parked.' })
await type('Why', 'x', dialog()!)
await click(button('Move', dialog()!))
check('a refused move keeps the dialog open with the reason', dialog()?.textContent?.includes('Say why') === true)

// ---------------- drafts ----------------
await open('/accounts/a-buckeye')
const outreach = () => card('Outreach')!
check('the page says nothing is sent from here', outreach().textContent?.includes('Nothing is sent from here') === true)
await type('Message', 'Hi Dale, I run a small software team.', outreach())
check('a changed draft must be saved before it is marked sent', (button('Mark as sent', outreach()) as HTMLButtonElement).disabled && button('Save changes', outreach()) !== undefined)
await click(button('Save changes', outreach()))
check('saving sends the subject and message, and nothing else',
  json(captured.updates.at(-1)) === json({ table: 'drafts', values: { subject: 'Your 2014 website', body: 'Hi Dale, I run a small software team.' }, filters: [['id', 'eq', 'd-1']] }),
  json(captured.updates.at(-1)))
await click(button('Copy', outreach()))
check('copying puts the subject and message on the clipboard', copied.at(-1) === 'Subject: Your 2014 website\n\nHi Dale, I run a small software team.', copied.at(-1))
check('and marks the draft copied', json(lastRpc('draft_mark')) === json({ p_id: 'd-1', p_status: 'copied' }))
await click(button('Mark as sent', outreach()))
check('marking it sent goes through the RPC', json(lastRpc('draft_mark')) === json({ p_id: 'd-1', p_status: 'sent' }))
check('which moves the account to contacted and writes the timeline',
  button('Stage: Contacted. Change') !== undefined && card('Timeline')?.textContent?.includes('Email sent') === true)
check('a sent draft is no longer editable', outreach().querySelector<HTMLTextAreaElement>('textarea')?.disabled === true && button('Mark as sent', outreach()) === undefined)

await open('/accounts/a-buckeye')
await click(button('Draft outreach'))
await click(menuItem('LinkedIn message'))
check('a draft run carries the channel',
  json(lastRpc('run_start')) === json({ p_kind: 'draft', p_market_id: 'm-scrap', p_account_ids: ['a-buckeye'], p_source_id: null, p_input: { channel: 'linkedin' } }))

// ---------------- do not contact ----------------
await open('/accounts/a-dnc')
check('a do-not-contact account offers no outreach', (button('Draft outreach') as HTMLButtonElement).disabled)
await open('/accounts/a-bobs')
check('nor does one not yet researched', (button('Draft outreach') as HTMLButtonElement).disabled && button('Research') !== undefined)
await click(document.querySelector('.MuiSwitch-input'))
check('marking do not contact sends only that',
  json(captured.updates.at(-1)) === json({ table: 'accounts', values: { do_not_contact: true }, filters: [['id', 'eq', 'a-bobs']] }), json(captured.updates.at(-1)))

// ---------------- the timeline, and the next step ----------------
await open('/accounts/a-talk')
const timeline = () => card('Timeline')!
await type('Note', 'Left a voicemail.', timeline())
await click(button('Add', timeline()))
check('a note is added to the timeline', json(captured.inserts.at(-1)) === json({ table: 'activities', rows: [{ account_id: 'a-talk', kind: 'note', body: 'Left a voicemail.' }] }))
check('and asks the agent nothing', !captured.rpcs.some((r) => r.name === 'run_start'))
await click([...timeline().querySelectorAll('.MuiChip-root')].find((c) => c.textContent === 'Reply received'))
await type('Paste their reply', 'Call me Thursday. Dale', timeline())
await click(button('Add', timeline()))
const reply = table('activities').at(-1)!
check('a pasted reply is saved as a reply', reply.kind === 'reply' && reply.body === 'Call me Thursday. Dale')
check('and asks the agent for the next step, naming it',
  json(lastRpc('run_start')) === json({ p_kind: 'follow_up', p_market_id: 'm-scrap', p_account_ids: ['a-talk'], p_source_id: null, p_input: { activity_id: reply.id } }),
  json(lastRpc('run_start')))
check('which shows as being worked out', timeline().textContent?.includes('Working out the next step') === true)

const next = card('Send the quote he asked for')!
check('a proposed next step says what accepting will do', next.textContent?.includes('Accepting moves the account to Proposal') === true)
check('the stage has not moved yet', button('Stage: Talking. Change') !== undefined)
await click(button('Accept', next))
check('accepting it moves the account', button('Stage: Proposal. Change') !== undefined && json(lastRpc('proposal_decide')) ===
  json({ p_id: 'pr-next', p_accept: true, p_final: null, p_reason: null }))

// ---------------- a candidate ----------------
await open('/accounts/a-miller')
check('a candidate says it is not yet reviewed, and offers no research',
  text().includes('Collected, not yet reviewed') && button('Research') === undefined && button('Draft outreach') === undefined)
await click(button('Accept'))
check('accepting it from its page sends the decision', json(lastRpc('accounts_review')) === json({ p_ids: ['a-miller'], p_decision: 'accepted' }))
check('and it can now be researched', button('Research') !== undefined)

await open('/accounts/nope')
check('an unknown account says so', text().includes('Account not found'))

// ---------------- the rules the lists use ----------------
const base = table('accounts').find((a) => a.id === 'a-talk') as unknown as Parameters<typeof goneQuiet>[0]
check('an account in conversation with nothing for over a week has gone quiet', goneQuiet(base) === true)
check('one touched yesterday has not', goneQuiet({ ...base, last_activity_at: new Date(Date.now() - 86_400_000).toISOString() }) === false)
check('a won or lost account never has', goneQuiet({ ...base, stage: 'won' }) === false)
check('researched and still researching waits for a decision',
  awaitsDecision(table('accounts').find((a) => a.id === 'a-buckeye') as unknown as Parameters<typeof awaitsDecision>[0]) === true &&
    awaitsDecision(table('accounts').find((a) => a.id === 'a-bobs') as unknown as Parameters<typeof awaitsDecision>[0]) === false)

await settle()
done()
