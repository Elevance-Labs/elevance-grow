-- Who gets in, and what each kind of caller can reach.

-- ---------------- nobody signed in ----------------
select t.as_anon();
select t.throws('anon reads no table', 'select 1 from public.markets', '42501');
select t.throws('anon reads no profile', 'select 1 from public.profiles', '42501');
select t.throws('anon reads no directory', 'select 1 from public.profile_directory', '42501');
select t.throws('anon cannot bind', 'select public.bind_profile()', '42501');
select t.throws('anon cannot claim a job', 'select public.agent_claim()', '42501');
select t.throws('anon cannot start a run',
  $$select public.run_start('thesis', gen_random_uuid())$$, '42501');

-- ---------------- binding ----------------
select t.login('sara');
select t.eq('a growth person binds to their profile', (select role::text from public.bind_profile()), 'growth');
select t.login('zara');
select t.eq('a deactivated profile does not bind', (select count(*) from public.bind_profile()), 0::bigint);
select t.superuser();
insert into auth.users (id, email, email_confirmed_at) values (gen_random_uuid(), 'bilal@elevancelabs.com', now());
select t.login('bilal');
select t.eq('a first sign-in binds the waiting profile', (select full_name from public.bind_profile()), 'Bilal Shah');
select t.login('kim');
select t.eq('the agency binds with its password login', (select role::text from public.bind_profile()), 'agency');
select t.login('kim', 'google');
select t.eq('a Google session never claims a password profile', (select count(*) from public.bind_profile()), 0::bigint);
select t.login('pc');
select t.eq('a worker binds as an agent', (select role::text from public.bind_profile()), 'agent');
select t.superuser();
update auth.users set email_confirmed_at = null where email = 'pc2@grow-worker.dev';
update public.profiles set user_id = null where email = 'pc2@grow-worker.dev';
select t.login('pc2');
select t.eq('an unconfirmed password user does not bind', (select count(*) from public.bind_profile()), 0::bigint);
select t.superuser();
update auth.users set email_confirmed_at = now() where email = 'pc2@grow-worker.dev';
update public.profiles set user_id = '00000000-0000-0000-0000-000000000010' where email = 'pc2@grow-worker.dev';

-- ---------------- profiles ----------------
select t.login('sara');
select t.eq('a growth person reads only their own profile', (select count(*) from public.profiles), 1::bigint);
select t.ok('but sees names in the directory', (select count(*) from public.profile_directory) >= 6);
select t.throws('and cannot add people',
  $$insert into public.profiles (full_name, email) values ('X Y', 'x@elevancelabs.com')$$, '42501');
select t.eq('nor promote themselves',
  t.rows($$update public.profiles set role = 'admin' where email = 'sara@elevancelabs.com'$$), 0::bigint);

select t.login('omar');
select t.eq('a member sees no names', (select count(*) from public.profile_directory), 0::bigint);

select t.login('amna');
select t.eq('an admin reads every profile', (select count(*) from public.profiles), 8::bigint);
select t.throws('a company address cannot be a password login',
  $$insert into public.profiles (full_name, email, login_method) values ('X Y', 'x@elevancelabs.com', 'password')$$, '23514');
select t.throws('an outside address cannot sign in with Google',
  $$insert into public.profiles (full_name, email) values ('X Y', 'x@gmail.com')$$, '23514');
select t.throws('a worker is always a password login',
  $$insert into public.profiles (full_name, email, role) values ('Bot', 'bot@elevancelabs.com', 'agent')$$, '23514');
select t.throws('user_id is not writable',
  $$update public.profiles set user_id = null where email = 'sara@elevancelabs.com'$$, '42501');
select t.throws('the last admin cannot be demoted',
  $$update public.profiles set role = 'growth' where email = 'amna@elevancelabs.com'$$, '23514');
select t.throws('nor deactivated',
  $$update public.profiles set active = false where email = 'amna@elevancelabs.com'$$, '23514');
select t.eq('an admin cannot delete their own profile',
  t.rows($$delete from public.profiles where email = 'amna@elevancelabs.com'$$), 0::bigint);
update public.profiles set email = 'kim@otheragency.co' where email = 'kim@brightagency.co';
select t.superuser();
select t.ok('changing an email unbinds the login',
  (select user_id is null from public.profiles where email = 'kim@otheragency.co'));

-- ---------------- a member and the agency see nothing of prospecting ----------------
select t.superuser();
insert into public.markets (name, region) values ('Scrap yards', 'Ohio');
insert into public.accounts (market_id, name, city, state, review)
  values (t.market('Scrap yards'), 'Buckeye Pick-n-Pull', 'Dayton', 'OH', 'accepted');

select t.login('omar');
select t.eq('a member reads no market', (select count(*) from public.markets), 0::bigint);
select t.eq('no account', (select count(*) from public.accounts), 0::bigint);
select t.eq('no playbook', (select count(*) from public.playbook_sections), 0::bigint);
select t.throws('and cannot add a market',
  $$insert into public.markets (name, region) values ('Towing', 'Texas')$$, '42501');
select t.throws('nor start a run',
  format($$select public.run_start('thesis', %L)$$, t.market('Scrap yards')), '42501');
select t.throws('nor move an account',
  format($$select public.account_move(%L, 'qualified')$$, t.account('Buckeye Pick-n-Pull')), '42501');

select t.login('kim');
select t.eq('the agency reads no market', (select count(*) from public.markets), 0::bigint);
select t.eq('no account either', (select count(*) from public.accounts), 0::bigint);

-- ---------------- a worker has no table access ----------------
select t.login('pc');
select t.eq('a worker reads no market', (select count(*) from public.markets), 0::bigint);
select t.eq('no account', (select count(*) from public.accounts), 0::bigint);
select t.eq('no playbook', (select count(*) from public.playbook_sections), 0::bigint);
select t.eq('no job, except through its RPCs', (select count(*) from public.agent_jobs), 0::bigint);
select t.throws('it cannot start a run',
  format($$select public.run_start('thesis', %L)$$, t.market('Scrap yards')), '42501');
select t.throws('nor decide a proposal', $$select public.proposal_decide(gen_random_uuid(), true)$$, '42501');
select t.throws('nor approve a collector',
  $$select public.collector_decide(gen_random_uuid(), 'approved')$$, '42501');
select t.throws('nor review accounts',
  format($$select public.accounts_review(array[%L]::uuid[], 'accepted')$$, t.account('Buckeye Pick-n-Pull')), '42501');
select t.throws('the job context is not callable directly',
  $$select public.agent_job_context(gen_random_uuid())$$, '42501');

-- ---------------- what the growth team cannot write directly ----------------
select t.login('sara');
select t.eq('growth reads the market', (select count(*) from public.markets), 1::bigint);
select t.eq('and the six playbook sections', (select count(*) from public.playbook_sections), 6::bigint);
select t.throws('a stage is not client-writable',
  $$update public.accounts set stage = 'won'$$, '42501');
select t.throws('nor a review',
  $$update public.accounts set review = 'rejected'$$, '42501');
select t.throws('nor a fit score',
  $$update public.accounts set fit_score = 99$$, '42501');
select t.throws('facts are not client-writable',
  format($$insert into public.account_facts (account_id, label, claim) values (%L, 'x', 'y')$$,
         t.account('Buckeye Pick-n-Pull')), '42501');
select t.throws('nor proposals',
  $$update public.proposals set decision = 'accepted'$$, '42501');
select t.throws('nor jobs',
  $$update public.agent_jobs set status = 'done'$$, '42501');
select t.throws('nor collectors',
  $$update public.collectors set status = 'approved'$$, '42501');
select t.throws('a playbook section''s title is fixed',
  $$update public.playbook_sections set title = 'x'$$, '42501');
update public.playbook_sections set body = 'We build software.' where key = 'service_lines';
select t.superuser();
select t.eq('its text is theirs to write, stamped with who',
  (select updated_by from public.playbook_sections where key = 'service_lines'), t.pid('sara'));
select t.login('sara');
select t.throws('the timeline''s own kinds are not for people to write',
  format($$insert into public.activities (account_id, kind, body) values (%L, 'stage', 'x')$$,
         t.account('Buckeye Pick-n-Pull')), '42501');
insert into public.accounts (market_id, name, website, city, state)
  values (t.market('Scrap yards'), 'Hand Added Salvage, Inc.', 'https://www.HandAdded.com/contact', 'Akron', 'OH');
select t.eq('an account a person adds starts accepted',
  (select review::text from public.accounts where name like 'Hand Added%'), 'accepted');
select t.eq('its domain is read from the website',
  (select domain from public.accounts where name like 'Hand Added%'), 'handadded.com');
select t.throws('the same business twice is refused',
  format($$insert into public.accounts (market_id, name, city, state) values (%L, 'Hand-Added Salvage', 'akron', 'oh')$$,
         t.market('Scrap yards')), '23505');
select t.eq('growth cannot delete a market',
  t.rows(format('delete from public.markets where id = %L', t.market('Scrap yards'))), 0::bigint);
select t.throws('only an admin approves a collector',
  $$select public.collector_decide(gen_random_uuid(), 'approved')$$, '42501');
