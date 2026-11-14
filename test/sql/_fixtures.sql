-- The people every SQL test starts from.
--
--   amna    admin
--   sara    growth
--   omar    member (every employee: sees nothing of prospecting)
--   zara    growth, deactivated
--   kim     the agency (outside address, password)
--   pc      a worker (agent, password)
--   pc2     a second worker
--   bilal   growth, never signed in (no auth user)
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-0000-0000-00000000000a', 'amna@elevancelabs.com', now()),
  ('00000000-0000-0000-0000-00000000000b', 'sara@elevancelabs.com', now()),
  ('00000000-0000-0000-0000-00000000000c', 'omar@elevancelabs.com', now()),
  ('00000000-0000-0000-0000-00000000000d', 'zara@elevancelabs.com', now()),
  ('00000000-0000-0000-0000-00000000000e', 'kim@brightagency.co', now()),
  ('00000000-0000-0000-0000-00000000000f', 'pc@grow-worker.dev', now()),
  ('00000000-0000-0000-0000-000000000010', 'pc2@grow-worker.dev', now());

insert into public.profiles (user_id, email, full_name, role, login_method, active) values
  ('00000000-0000-0000-0000-00000000000a', 'amna@elevancelabs.com', 'Amna Khan', 'admin', 'google', true),
  ('00000000-0000-0000-0000-00000000000b', 'sara@elevancelabs.com', 'Sara Iqbal', 'growth', 'google', true),
  ('00000000-0000-0000-0000-00000000000c', 'omar@elevancelabs.com', 'Omar Farooq', 'member', 'google', true),
  ('00000000-0000-0000-0000-00000000000d', 'zara@elevancelabs.com', 'Zara Ali', 'growth', 'google', false),
  ('00000000-0000-0000-0000-00000000000e', 'kim@brightagency.co', 'Kim Lee', 'agency', 'password', true),
  ('00000000-0000-0000-0000-00000000000f', 'pc@grow-worker.dev', 'Home PC', 'agent', 'password', true),
  ('00000000-0000-0000-0000-000000000010', 'pc2@grow-worker.dev', 'Second PC', 'agent', 'password', true),
  (null, 'bilal@elevancelabs.com', 'Bilal Shah', 'growth', 'google', true);
