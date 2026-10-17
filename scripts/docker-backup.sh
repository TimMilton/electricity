#!/usr/bin/env bash
# Резервна копія Docker-стека без зупинки:
#   - дані бази (схеми public, auth, storage, supabase_migrations) — pg_dump, формат custom;
#   - файли квитанцій зі сховища;
#   - копія .env (без неї резервну копію не відновити).
#
#   scripts/docker-backup.sh [каталог]       (за замовчуванням ./backups/РРРР-ММ-ДД_ГГХХ)
#
# Для щоденних копій додайте в cron сервера, напр.:
#   30 3 * * * cd /opt/elektrooblik && scripts/docker-backup.sh >> backups/backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

dest="${1:-backups/$(date +%Y-%m-%d_%H%M)}"
mkdir -p "$dest"
chmod 700 "$dest"

echo "Копіювання бази…"
docker compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -h localhost -U supabase_admin -d postgres \
  --format=custom --data-only \
  --schema=public --schema=auth --schema=storage --schema=supabase_migrations \
  --exclude-table=auth.schema_migrations --exclude-table=storage.migrations' > "$dest/database.dump"

echo "Копіювання файлів квитанцій…"
docker compose exec -T storage sh -c 'cd /var/lib/storage && tar czf - .' > "$dest/storage.tar.gz"

cp .env "$dest/env.backup"
chmod 600 "$dest"/*

echo "Готово: $dest"
ls -lh "$dest"
