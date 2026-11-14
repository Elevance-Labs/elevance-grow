-- Assertion and identity helpers for test/sql/*.test.sql (see
-- scripts/test-sql.sh). They live in schema `t`, which exists only in the
-- test database.
create schema t;
grant usage on schema t to authenticated, anon;

create table t.results (id serial primary key, name text not null, ok boolean not null, detail text);
grant insert, select on t.results to authenticated, anon;
grant usage on sequence t.results_id_seq to authenticated, anon;

create function t.ok(p_name text, p_ok boolean, p_detail text default null)
returns void language sql as $$
  insert into t.results (name, ok, detail) values (p_name, coalesce(p_ok, false), p_detail);
$$;

create function t.eq(p_name text, p_got anyelement, p_want anyelement)
returns void language sql as $$
  insert into t.results (name, ok, detail)
  values (p_name, p_got is not distinct from p_want, format('got %s, want %s', p_got, p_want));
$$;

-- Passes when p_sql raises, with this SQLSTATE and/or message fragment if given.
create function t.throws(p_name text, p_sql text, p_code text default null, p_message text default null)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    insert into t.results (name, ok, detail) values (p_name,
      (p_code is null or sqlstate = p_code) and (p_message is null or sqlerrm ilike '%' || p_message || '%'),
      format('%s: %s', sqlstate, sqlerrm));
    return;
  end;
  insert into t.results (name, ok, detail) values (p_name, false, 'no error was raised');
end;
$$;

-- How many rows a statement touched (RLS refuses an update or delete by
-- matching nothing, not by raising).
create function t.rows(p_sql text)
returns bigint language plpgsql as $$
declare
  n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Act as this person from now on: their auth user, the `authenticated` role.
-- People are named by the part of their email before the @; the session's
-- provider follows the profile's sign-in method unless one is given.
create function t.login(p_name text, p_provider text default null)
returns void language plpgsql as $$
declare
  v_uid    uuid;
  v_email  text;
  v_method text;
begin
  execute 'reset role';
  select user_id, email, login_method::text into v_uid, v_email, v_method
    from public.profiles where email like p_name || '@%';
  if v_uid is null then
    select id into v_uid from auth.users where email = v_email;
  end if;
  perform set_config('test.uid', coalesce(v_uid::text, gen_random_uuid()::text), false);
  perform set_config('test.jwt', jsonb_build_object(
    'email', coalesce(v_email, p_name || '@elevancelabs.com'),
    'app_metadata', jsonb_build_object('provider',
      coalesce(p_provider, case v_method when 'password' then 'email' else 'google' end)))::text, false);
  execute 'set role authenticated';
end;
$$;

create function t.as_anon()
returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('test.uid', '', false);
  perform set_config('test.jwt', '', false);
  execute 'set role anon';
end;
$$;

-- Back to postgres (no RLS), still "signed in" as whoever was last.
create function t.superuser()
returns void language plpgsql as $$
begin
  execute 'reset role';
end;
$$;

-- Lookups that ignore RLS, so a test can name rows it can't see.
create function t.pid(p_name text) returns uuid language sql stable security definer as
  $$ select id from public.profiles where email like p_name || '@%' $$;
create function t.market(p_name text) returns uuid language sql stable security definer as
  $$ select id from public.markets where name = p_name $$;
create function t.account(p_name text) returns uuid language sql stable security definer as
  $$ select id from public.accounts where name = p_name $$;
create function t.account_row(p_name text) returns public.accounts language sql stable security definer as
  $$ select * from public.accounts where name = p_name $$;
create function t.job_row(p_id uuid) returns public.agent_jobs language sql stable security definer as
  $$ select * from public.agent_jobs where id = p_id $$;
create function t.run_status(p_id uuid) returns text language sql stable security definer as
  $$ select status::text from public.agent_runs where id = p_id $$;
create function t.count(p_table text, p_where text default 'true') returns bigint
  language plpgsql stable security definer as $$
declare n bigint;
begin
  execute format('select count(*) from public.%I where %s', p_table, p_where) into n;
  return n;
end;
$$;

grant execute on all functions in schema t to authenticated, anon;
