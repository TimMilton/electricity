#!/usr/bin/env bash
# Застосовує міграції застосунку (supabase/migrations/*.sql) до бази.
# Запускається одноразовим контейнером `migrate` під час кожного `docker compose up`:
# уже застосовані міграції пропускаються (облік — у supabase_migrations.schema_migrations,
# тій самій таблиці, що використовує Supabase CLI).
#
# Чекає, доки сервіси Auth і Storage створять свої схеми (auth.users, storage.objects),
# бо міграції застосунку на них посилаються.
set -euo pipefail

export PGHOST="${PGHOST:-db}"
export PGPORT="${PGPORT:-5432}"
export PGUSER="${PGUSER:-supabase_admin}"
export PGDATABASE="${PGDATABASE:-postgres}"
export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-/migrations}"
WAIT_SECONDS="${WAIT_SECONDS:-300}"
export PGOPTIONS="${PGOPTIONS:--c client_min_messages=warning}"

log() { echo "[migrate] $*"; }

deadline=$(( $(date +%s) + WAIT_SECONDS ))
wait_for() {
  local what="$1"; shift
  until "$@" >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      log "не дочекалися: $what"
      exit 1
    fi
    sleep 2
  done
}

log "очікування бази ${PGHOST}:${PGPORT}…"
wait_for "база даних" pg_isready -q

for rel in auth.users storage.buckets storage.objects; do
  log "очікування таблиці $rel…"
  wait_for "$rel" bash -c "[ \"\$(psql -tAqc \"select to_regclass('$rel') is not null\")\" = t ]"
done

psql -v ON_ERROR_STOP=1 -q <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
SQL

applied=0
shopt -s nullglob
for file in "$MIGRATIONS_DIR"/*.sql; do
  base="$(basename "$file" .sql)"
  version="${base%%_*}"
  name="${base#*_}"
  if [ -n "$(psql -tAqc "select 1 from supabase_migrations.schema_migrations where version = '${version}'")" ]; then
    continue
  fi
  log "застосування ${base}…"
  psql -v ON_ERROR_STOP=1 -q --single-transaction \
    -f "$file" \
    -c "insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}')"
  applied=$((applied + 1))
done

# PostgREST має перечитати схему (нові таблиці й функції)
psql -q -c "notify pgrst, 'reload schema'" || true

log "готово, нових міграцій: ${applied}"
