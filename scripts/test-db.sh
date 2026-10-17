#!/usr/bin/env bash
# Локальний PostgreSQL для інтеграційних тестів (без Docker).
# Використання: scripts/test-db.sh start|stop|status
# Після start: export TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/postgres
set -euo pipefail

PGBIN="${PGBIN:-$(dirname "$(command -v pg_ctl 2>/dev/null || ls -d /usr/lib/postgresql/*/bin/pg_ctl | tail -1)")}"
DATA_DIR="${TEST_PG_DIR:-$PWD/.pgtest}"
PORT="${TEST_PG_PORT:-54329}"

case "${1:-start}" in
  start)
    if [ ! -f "$DATA_DIR/PG_VERSION" ]; then
      "$PGBIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
    fi
    if ! "$PGBIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1; then
      "$PGBIN/pg_ctl" -D "$DATA_DIR" -l "$DATA_DIR/server.log" \
        -o "-p $PORT -k $DATA_DIR -c listen_addresses=127.0.0.1 -c timezone=UTC" -w start >/dev/null
    fi
    echo "postgres://postgres@127.0.0.1:$PORT/postgres"
    ;;
  stop)
    "$PGBIN/pg_ctl" -D "$DATA_DIR" -m fast stop
    ;;
  status)
    "$PGBIN/pg_ctl" -D "$DATA_DIR" status
    ;;
  *)
    echo "usage: $0 start|stop|status" >&2
    exit 1
    ;;
esac
