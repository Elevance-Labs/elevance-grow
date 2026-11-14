-- The prospecting flow end to end, as the growth person, the admin and the
-- worker each do their part.
\set thesis_text 'Self-service scrap yards buy end-of-life vehicles, set them in rows and let customers pull their own parts. Most are family owned, one to three yards, run on a yard management system from the early 2000s with no online inventory. Owners answer the phone themselves and belong to the state recyclers association.'

select t.login('sara');
insert into public.markets (name, region, brief) values ('Scrap yards', 'Ohio', 'Family-run, no online inventory');
select public.run_start('thesis', t.market('Scrap yards')) as run1 \gset
select t.eq('a new run waits in the queue', t.run_status(:'run1'), 'queued');
select t.throws('the same run twice is refused',
  format($$select public.run_start('thesis', %L)$$, t.market('Scrap yards')), 'P0001', 'already running');
select t.throws('sources need a thesis first',
  format($$select public.run_start('sources', %L)$$, t.market('Scrap yards')), 'P0001', 'thesis first');

-- ---------------- the worker claims and proposes a thesis ----------------
select t.login('pc');
select public.agent_heartbeat('idle', '{"version": "test"}');
select public.agent_claim() as ctx \gset
select (:'ctx'::jsonb -> 'job' ->> 'id') as job1 \gset
select t.eq('the worker is handed the thesis job', :'ctx'::jsonb -> 'job' ->> 'kind', 'thesis');
select t.eq('with the market', :'ctx'::jsonb -> 'market' ->> 'name', 'Scrap yards');
select t.ok('and the playbook sections that have text', jsonb_array_length(:'ctx'::jsonb -> 'playbook') >= 3);
select t.eq('the run is now running', t.run_status(:'run1'), 'running');
select t.eq('nothing else is waiting', public.agent_claim(), null::jsonb);
select public.agent_event(:'job1', 'step', 'Searching for how the industry works');
select t.throws('a thesis too short to be one is refused',
  format($$select public.agent_propose(%L, 'thesis', 's', '{"text": "short"}')$$, :'job1'), '22023');
select t.throws('a thesis job does not propose sources',
  format($$select public.agent_propose(%L, 'source', 's', '{"name": "x", "url": "https://x.org"}')$$, :'job1'), 'P0001');
select t.throws('nor save facts',
  format($$select public.agent_save_fact(%L, 'observed', 'x', 'y', 'https://x.org', 'q')$$, :'job1'), 'P0001');
select public.agent_propose(:'job1', 'thesis', 'Industry brief',
  jsonb_build_object('text', :'thesis_text', 'sources', jsonb_build_array(jsonb_build_object('url', 'https://a-r-a.org', 'title', 'ARA'))));
select public.agent_propose(:'job1', 'thesis', 'Industry brief, second go',
  jsonb_build_object('text', :'thesis_text' || ' Revised.', 'sources', '[]'::jsonb));
select t.eq('a second thesis from the job replaces the first',
  t.count('proposals', 'kind = ''thesis'' and decision = ''pending'''), 1::bigint);

select t.login('pc2');
select t.throws('another worker cannot write to this job',
  format($$select public.agent_event(%L, 'step', 'x')$$, :'job1'), '42501');
select t.throws('nor finish it',
  format($$select public.agent_finish(%L, 'done')$$, :'job1'), '42501');

select t.login('pc');
select public.agent_finish(:'job1', 'done', 'Thesis proposed', null, 1200, 300, 0.05);
select t.eq('the run is done', t.run_status(:'run1'), 'done');
select t.throws('a finished job takes no more writes',
  format($$select public.agent_event(%L, 'step', 'x')$$, :'job1'), '42501');

-- ---------------- a person decides ----------------
select t.login('sara');
select t.eq('the run carries its token use', (select tokens_in from public.agent_runs where id = :'run1'), 1200::bigint);
select id as p1 from public.proposals where kind = 'thesis' \gset
select t.eq('nothing is on the market until accepted', (select thesis from public.markets), null::text);
select public.proposal_decide(:'p1', true, jsonb_build_object('text', :'thesis_text' || ' Edited by Sara.', 'sources', '[]'::jsonb));
select t.ok('accepting with changes writes the changed thesis', (select thesis like '%Edited by Sara.' from public.markets));
select t.eq('and the market becomes active', (select status::text from public.markets), 'active');
select t.ok('what was accepted is kept beside what was proposed',
  (select final is not null and final <> payload from public.proposals where id = :'p1'));
select t.throws('a proposal is decided once',
  format($$select public.proposal_decide(%L, false)$$, :'p1'), 'P0001', 'already decided');

-- ---------------- sources ----------------
select public.run_start('sources', t.market('Scrap yards')) as run2 \gset
select t.login('pc');
select (public.agent_claim() -> 'job' ->> 'id') as job2 \gset
select public.agent_propose(:'job2', 'source', 'State licence register',
  '{"name": "Ohio BMV salvage dealers", "url": "https://bmv.ohio.gov/dealers", "kind": "register", "why": "Every licensed yard", "terms_note": "Public record"}');
select public.agent_propose(:'job2', 'source', 'Association directory',
  '{"name": "OATRA members", "url": "https://oatra.org/members", "kind": "directory", "why": "Members list"}');
select t.throws('a source without a web address is refused',
  format($$select public.agent_propose(%L, 'source', 's', '{"name": "x", "url": "ftp://x"}')$$, :'job2'), '22023');
select public.agent_finish(:'job2', 'done');

select t.login('sara');
select id as p2 from public.proposals where summary = 'State licence register' \gset
select id as p3 from public.proposals where summary = 'Association directory' \gset
select public.proposal_decide(:'p2', true);
select public.proposal_decide(:'p3', false, null, 'Members only, behind a login');
select t.eq('an accepted source is on the market, ticked',
  (select selected from public.market_sources where name = 'Ohio BMV salvage dealers'), true);
select t.eq('a rejected one is not', t.count('market_sources'), 1::bigint);
select t.eq('and its reason is kept', (select reason from public.proposals where id = :'p3'), 'Members only, behind a login');
select id as src from public.market_sources \gset

-- ---------------- the collector: built by the agent, approved by an admin ----------------
select t.throws('collecting needs an approved collector',
  format($$select public.run_start('collect', %L, null, %L)$$, t.market('Scrap yards'), :'src'), 'P0001', 'no approved collector');
select public.run_start('collector_build', t.market('Scrap yards'), null, :'src') as run3 \gset
select t.login('pc');
select public.agent_claim() as ctx \gset
select (:'ctx'::jsonb -> 'job' ->> 'id') as job3 \gset
select t.eq('the build job is handed its source', :'ctx'::jsonb -> 'source' ->> 'url', 'https://bmv.ohio.gov/dealers');
select t.throws('a collector may not call the worker''s own machine',
  format($$select public.agent_propose_collector(%L, 'ohio-bmv', 'n', 'd', array['localhost'], '', 'code')$$, :'job3'), '23514');
select t.throws('nor an address',
  format($$select public.agent_propose_collector(%L, 'ohio-bmv', 'n', 'd', array['192.168.1.10'], '', 'code')$$, :'job3'), '23514');
select t.throws('nor a private name',
  format($$select public.agent_propose_collector(%L, 'ohio-bmv', 'n', 'd', array['nas.local'], '', 'code')$$, :'job3'), '23514');
select t.throws('nor no host at all',
  format($$select public.agent_propose_collector(%L, 'ohio-bmv', 'n', 'd', array[]::text[], '', 'code')$$, :'job3'), '23514');
select public.agent_propose_collector(:'job3', 'ohio-bmv', 'Ohio BMV salvage dealers', 'Reads the public dealer list',
  array['bmv.ohio.gov'], 'Public record', 'export default async () => []', '[{"name": "Buckeye Pick-n-Pull"}]');
select public.agent_finish(:'job3', 'done');

select t.login('sara');
select t.eq('the collector waits, proposed', (select status::text from public.collectors), 'proposed');
select t.eq('and is linked to its source', (select collector_id is not null from public.market_sources), true);
select id as col from public.collectors \gset
select t.throws('a proposed collector does not run',
  format($$select public.run_start('collect', %L, null, %L)$$, t.market('Scrap yards'), :'src'), 'P0001');
select t.throws('growth cannot approve it',
  format($$select public.collector_decide(%L, 'approved')$$, :'col'), '42501');
select t.login('amna');
select public.collector_decide(:'col', 'approved', 'Read the code; public register');
select t.login('sara');
select public.run_start('collect', t.market('Scrap yards'), null, :'src') as run4 \gset

select t.login('pc');
select public.agent_claim() as ctx \gset
select (:'ctx'::jsonb -> 'job' ->> 'id') as job4 \gset
select t.eq('an approved collector''s code is handed to the worker',
  :'ctx'::jsonb -> 'collector' ->> 'code', 'export default async () => []');
select public.agent_save_candidates(:'job4', '[
  {"name": "Buckeye Pick-n-Pull", "city": "Dayton", "state": "OH", "website": "https://buckeyepnp.com", "source_url": "https://bmv.ohio.gov/dealers?p=1", "raw": "BUCKEYE PICK-N-PULL  DAYTON"},
  {"name": "Bob''s Auto Parts, LLC", "city": "Toledo", "state": "OH", "source_url": "https://bmv.ohio.gov/dealers?p=1"},
  {"name": "Bobs Auto Parts", "city": "Toledo", "state": "oh"},
  {"name": "Miller & Sons Salvage Co.", "city": "Lima", "state": "OH"},
  {"name": "   "}
]'::jsonb) as saved \gset
select t.eq('new businesses are added once each', (:'saved'::jsonb ->> 'new')::int, 3);
select t.eq('a second pass adds nothing',
  (public.agent_save_candidates(:'job4', '[{"name": "BOB''S AUTO PARTS LLC", "city": "Toledo", "state": "OH"}]'::jsonb) ->> 'new')::int, 0);
select public.agent_finish(:'job4', 'done');

select t.login('sara');
select t.eq('collected rows are candidates', t.count('accounts', 'review = ''candidate'''), 3::bigint);
select t.eq('the collector records its run', (select health from public.collectors), 'ok');
select t.throws('a candidate is not researched until accepted',
  format($$select public.run_start('enrich', %L, array[%L]::uuid[])$$, t.market('Scrap yards'), t.account('Buckeye Pick-n-Pull')), 'P0001', 'accepted');
select t.eq('accepting two', public.accounts_review(array[t.account('Buckeye Pick-n-Pull'), t.account('Bob''s Auto Parts, LLC')], 'accepted'), 2);
select t.eq('rejecting one', public.accounts_review(array[t.account('Miller & Sons Salvage Co.')], 'rejected'), 1);
select t.eq('a rejected business is not collected again', t.count('accounts'), 3::bigint);

-- A new version of the collector must be approved again.
select public.run_start('collector_build', t.market('Scrap yards'), null, :'src') as run5 \gset
select t.login('pc');
select (public.agent_claim() -> 'job' ->> 'id') as job5 \gset
select public.agent_propose_collector(:'job5', 'ohio-bmv', 'Ohio BMV salvage dealers', 'v2', array['bmv.ohio.gov', 'evil.example.org'], '', 'export default async () => fetch("https://evil.example.org")');
select public.agent_finish(:'job5', 'done');
select t.login('sara');
select t.eq('a changed collector is version 2, waiting again',
  (select version::text || ' ' || status::text from public.collectors), '2 proposed');
select t.throws('and does not run until approved again',
  format($$select public.run_start('collect', %L, null, %L)$$, t.market('Scrap yards'), :'src'), 'P0001');

-- ---------------- research ----------------
select public.run_start('enrich', t.market('Scrap yards'),
  array[t.account('Buckeye Pick-n-Pull'), t.account('Bob''s Auto Parts, LLC'), t.account('Buckeye Pick-n-Pull')]) as run6 \gset
select t.eq('one job per account', t.count('agent_jobs', format('run_id = %L', :'run6')), 2::bigint);
select t.login('pc');
select public.agent_claim() as ctx \gset
select (:'ctx'::jsonb -> 'job' ->> 'id') as job6 \gset
select (:'ctx'::jsonb -> 'account' ->> 'name') as acct \gset
select t.ok('the job is handed its account and the thesis',
  :'ctx'::jsonb -> 'account' ->> 'id' is not null and :'ctx'::jsonb -> 'market' ->> 'thesis' like '%Edited by Sara.');
select t.throws('something seen needs its page and its words',
  format($$select public.agent_save_fact(%L, 'observed', 'site', 'Site is dated')$$, :'job6'), '23514');
select public.agent_save_fact(:'job6', 'observed', 'Site last updated', 'The site footer says 2014',
  'https://buckeyepnp.com', '© 2014 Buckeye', '… All rights reserved © 2014 Buckeye Pick-n-Pull …', true) as fact1 \gset
select t.eq('the same fact saved twice is one fact',
  public.agent_save_fact(:'job6', 'observed', 'site last updated', 'The site footer says 2014', 'https://buckeyepnp.com', '© 2014 Buckeye'),
  :'fact1'::uuid);
select public.agent_save_fact(:'job6', 'inferred', 'Online inventory', 'Likely none: no search on the site',
  null, null, null, true);
select public.agent_save_fact(:'job6', 'observed', 'Phone', 'Lists one phone number', 'https://buckeyepnp.com/contact', '937-555-0100', null, false) as fact_unverified \gset
select t.throws('a contact needs the page that names them',
  format($$select public.agent_save_contact(%L, 'Dale Buck', 'Owner')$$, :'job6'), '22023');
select public.agent_save_contact(:'job6', 'Dale Buck', 'Owner', null, '937-555-0100', 'https://buckeyepnp.com/about', 'owned by Dale Buck since 1988', true);
select public.agent_save_contact(:'job6', 'dale buck', 'Owner', 'dale@buckeyepnp.com', null, 'https://buckeyepnp.com/about', 'Dale Buck', true);
select t.throws('a score needs its reasons',
  format($$select public.agent_save_enrichment(%L, 80, '', 'hook')$$, :'job6'), '22023');
select public.agent_save_enrichment(:'job6', 82, 'Family owned, dated site, phone only', 'Their site has not changed since 2014 and has no inventory search',
  '{"phone": "937-555-0100", "website": "https://other.example.org"}');
select public.agent_finish(:'job6', 'done', null, null, 5000, 900, 0.21);

select t.login('sara');
select t.eq('the account is scored', (t.account_row(:'acct')).fit_score, 82);
select t.eq('a blank detail is filled', (t.account_row(:'acct')).phone, '937-555-0100');
select t.ok('what was already there is kept', (t.account_row(:'acct')).website = 'https://buckeyepnp.com' or :'acct' <> 'Buckeye Pick-n-Pull');
select t.eq('a checked fact is marked verified', (select verified from public.account_facts where label = 'Site last updated'), true);
select t.eq('an inference never is', (select verified from public.account_facts where kind = 'inferred'), false);
select t.eq('an unchecked fact is kept, unverified', (select verified from public.account_facts where id = :'fact_unverified'), false);
select t.eq('the same person twice is one contact, details merged',
  (select count(*)::text || ' ' || max(email) from public.contacts), '1 dale@buckeyepnp.com');
select t.eq('the run is still going: one job left', t.run_status(:'run6'), 'running');
select public.fact_reject(:'fact_unverified');
select t.ok('a rejected fact is kept, set aside', (select rejected_at is not null from public.account_facts where id = :'fact_unverified'));

-- ---------------- drafts ----------------
select t.throws('a draft needs a channel',
  format($$select public.run_start('draft', %L, array[%L]::uuid[])$$, t.market('Scrap yards'), t.account(:'acct')), 'P0001', 'channel');
update public.accounts set do_not_contact = true where id = t.account(:'acct');
select t.throws('do not contact means no drafts',
  format($$select public.run_start('draft', %L, array[%L]::uuid[], null, '{"channel": "email"}')$$, t.market('Scrap yards'), t.account(:'acct')), 'P0001', 'do not contact');
update public.accounts set do_not_contact = false where id = t.account(:'acct');
select public.run_start('draft', t.market('Scrap yards'), array[t.account(:'acct')], null, '{"channel": "email"}') as run7 \gset

-- The research job still waiting is older, so it is claimed first; finish it.
select t.login('pc');
select (public.agent_claim() -> 'job' ->> 'id') as job6b \gset
select public.agent_finish(:'job6b', 'needs_person', null, 'The site shows a bot check');
select public.agent_claim() as ctx \gset
select (:'ctx'::jsonb -> 'job' ->> 'id') as job7 \gset
select t.eq('the draft job knows the channel', :'ctx'::jsonb -> 'job' -> 'input' ->> 'channel', 'email');
select t.eq('and is not shown the rejected fact', jsonb_array_length(:'ctx'::jsonb -> 'account' -> 'facts'), 2);
select public.agent_save_draft(:'job7', 'email', 'Your 2014 website', 'Hi Dale, I noticed…');
select public.agent_finish(:'job7', 'done');

select t.login('sara');
select t.eq('a job that hit a bot check asks for a person', (t.job_row(:'job6b')).status::text, 'needs_person');
select id as d1 from public.drafts \gset
update public.drafts set body = 'Hi Dale, I run a small software team…' where id = :'d1';
select t.eq('the original is kept beside the edit', (select original_body from public.drafts), 'Hi Dale, I noticed…');
select public.draft_mark(:'d1', 'copied');
select public.draft_mark(:'d1', 'sent');
select t.eq('sending moves the account to contacted', (t.account_row(:'acct')).stage::text, 'contacted');
select t.eq('and is on the timeline', t.count('activities', 'kind = ''draft_sent'''), 1::bigint);
select t.eq('a sent draft is no longer editable', t.rows(format('update public.drafts set body = %L where id = %L', 'x', :'d1')), 0::bigint);

-- ---------------- follow-up ----------------
insert into public.activities (account_id, kind, body) values (t.account(:'acct'), 'reply', 'Call me Thursday. Dale');
select id as reply from public.activities where kind = 'reply' \gset
select t.throws('a follow-up needs what it follows',
  format($$select public.run_start('follow_up', %L, array[%L]::uuid[])$$, t.market('Scrap yards'), t.account(:'acct')), 'P0001');
select public.run_start('follow_up', t.market('Scrap yards'), array[t.account(:'acct')], null,
  jsonb_build_object('activity_id', :'reply')) as run8 \gset
select t.login('pc');
select public.agent_claim() as ctx \gset
select (:'ctx'::jsonb -> 'job' ->> 'id') as job8 \gset
select t.eq('the job is handed the reply', :'ctx'::jsonb -> 'activity' ->> 'body', 'Call me Thursday. Dale');
select public.agent_propose(:'job8', 'next_step', 'Call Thursday', '{"note": "He asked for a call on Thursday; call before noon.", "stage": "talking"}');
select public.agent_finish(:'job8', 'done');
select t.login('sara');
select t.eq('the stage does not move until a person agrees', (t.account_row(:'acct')).stage::text, 'contacted');
select id as p8 from public.proposals where kind = 'next_step' \gset
select public.proposal_decide(:'p8', true);
select t.eq('accepting the next step moves it', (t.account_row(:'acct')).stage::text, 'talking');

select t.throws('losing an account needs a reason',
  format($$select public.account_move(%L, 'lost')$$, t.account(:'acct')), 'P0001', 'why');
select public.account_move(t.account(:'acct'), 'lost', 'Happy with their current system');
select t.eq('the reason is on the timeline',
  (select body from public.activities where kind = 'stage' order by created_at desc limit 1), 'Happy with their current system');
select t.throws('a rejected account is not in the pipeline',
  format($$select public.account_move(%L, 'qualified')$$, t.account('Miller & Sons Salvage Co.')), 'P0001');

-- ---------------- lessons ----------------
select public.run_start('lessons', t.market('Scrap yards')) as run9 \gset
select t.login('pc');
select public.agent_claim() as ctx \gset
select (:'ctx'::jsonb -> 'job' ->> 'id') as job9 \gset
select t.ok('the lessons job is handed the decisions and their reasons',
  :'ctx'::jsonb -> 'decisions' @> '[{"reasons": ["Happy with their current system"]}]');
select public.agent_propose(:'job9', 'lesson', 'Phone first', '{"body": "Owners answer the phone themselves; call before emailing."}');
select public.agent_finish(:'job9', 'done');
select t.login('sara');
select id as p9 from public.proposals where kind = 'lesson' \gset
select public.proposal_decide(:'p9', true);
select t.eq('an accepted lesson joins the market''s lessons', t.count('lessons'), 1::bigint);

-- ---------------- cancelling, and a worker that went silent ----------------
insert into public.markets (name, region) values ('Towing', 'Texas');
select public.run_start('thesis', t.market('Towing')) as run10 \gset
select public.run_cancel(:'run10');
select t.eq('a cancelled run is cancelled', t.run_status(:'run10'), 'cancelled');
select t.login('pc');
select t.eq('and its job is never handed out', public.agent_claim(), null::jsonb);

select t.login('sara');
select public.run_start('thesis', t.market('Towing')) as run11 \gset
select t.login('pc');
select (public.agent_claim() -> 'job' ->> 'id') as job11 \gset
select t.superuser();
update public.agent_jobs set heartbeat_at = now() - interval '11 minutes' where id = :'job11';
select t.login('pc2');
select public.agent_heartbeat('idle');
select t.eq('a job whose worker went silent is handed to the next one',
  public.agent_claim() -> 'job' ->> 'id', :'job11');
select t.eq('counting the try', (t.job_row(:'job11')).attempts, 2);
select t.login('pc');
select t.throws('the first worker can no longer write to it',
  format($$select public.agent_event(%L, 'step', 'x')$$, :'job11'), '42501');
select t.login('pc2');
select public.agent_finish(:'job11', 'failed', null, 'Usage limit reached');
select t.eq('a failed job fails its run', t.run_status(:'run11'), 'failed');

-- ---------------- a worker that belongs to one person ----------------
select t.login('amna');
update public.workers set owner_id = t.pid('amna') where profile_id = t.pid('pc');
select t.login('sara');
select public.run_start('thesis', t.market('Towing')) as run12 \gset
select t.login('pc');
select t.eq('a worker with an owner leaves other people''s jobs', public.agent_claim(), null::jsonb);
select t.login('pc2');
select t.ok('a shared worker takes them', public.agent_claim() is not null);

-- ---------------- handing a job back ----------------
select t.login('sara');
insert into public.markets (name, region) values ('Junk removal', 'Texas');
select public.run_start('thesis', t.market('Junk removal')) as run13 \gset
select t.login('pc2');
select (public.agent_claim() -> 'job' ->> 'id') as job12 \gset
select public.agent_release(:'job12', 'Claude usage limit reached; waiting for it to reset');
select t.eq('a job handed back waits again', (t.job_row(:'job12')).status::text, 'queued');
select t.eq('and the try is not counted', (t.job_row(:'job12')).attempts, 0);
select t.eq('its run is waiting again too', t.run_status(:'run13'), 'queued');
select t.eq('with a step saying why',
  t.count('agent_job_events', format('job_id = %L and kind = ''warn''', :'job12')), 1::bigint);
select t.throws('once handed back it is no longer the worker''s',
  format($$select public.agent_event(%L, 'step', 'x')$$, :'job12'), '42501');
