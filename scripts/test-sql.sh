#!/usr/bin/env bash
# The database's own behaviour tests: RLS, column grants, triggers and RPCs,
# exercised as real signed-in people against a throwaway Postgres built from
# supabase/migrations/. This is what the browser tests (test/*.test.tsx)
# can't prove, since their Supabase is a mock.
#
# Each test/sql/*.test.sql file runs on a fresh copy of the fixtures
# (test/sql/_fixtures.sql), as `postgres` until it calls t.login(), which
# switches to the `authenticated` role as that person. Assertions are the
# t.* helpers in test/sql/_helpers.sql; any FAIL, or any error outside
# t.throws(), fails the run.
#
# Needs the Postgres server binaries on PATH (see check-schema.sh).
set -euo pipefail

cd "$(dirname "$0")/.."
source scripts/pg-sandbox.sh

# Supabase's auth, as far as the schema uses it. auth.uid() and auth.jwt()
# read what t.login() set.
stubs=$(cat <<'SQL'
create schema auth;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('test.jwt', true), '')::jsonb, '{}'::jsonb) $$;
create function auth.role() returns text language sql stable as $$ select current_user::text $$;
grant usage on schema auth to authenticated, anon;
SQL
)

createdb template_grow
psql -d template_grow -c "$stubs" >/dev/null
for f in supabase/migrations/*.sql test/sql/_helpers.sql test/sql/_fixtures.sql; do
  psql -d template_grow -f "$f" >/dev/null
done

status=0
for f in test/sql/*.test.sql; do
  echo "--- $f"
  db="t_$(basename "$f" .test.sql | tr -c 'a-z0-9\n' '_')"
  createdb -T template_grow "$db"
  stopped=
  out=$(psql -d "$db" -o /dev/null -f "$f" 2>&1) || stopped=1
  results=$(psql -d "$db" -At -c "select case when ok then 'OK  ' else 'FAIL' end || ' ' || name ||
                                   case when ok then '' else coalesce(' — ' || detail, '') end
                                   from t.results order by id")
  echo "$results"
  if grep -q '^FAIL' <<<"$results"; then status=1; fi
  if [ -n "$stopped" ]; then
    echo "$out" | grep -E 'ERROR|CONTEXT|LINE' | head -6
    echo "FAIL $f stopped on an unexpected error"
    status=1
  fi
done
exit $status
