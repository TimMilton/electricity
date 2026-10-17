#!/usr/bin/env bash
# Відновлення з резервної копії, створеної scripts/docker-backup.sh.
#
#   scripts/docker-restore.sh backups/2026-10-17_0330
#
# Порядок:
#   1. Якщо відновлюєте на новому сервері — скопіюйте env.backup з копії у .env
#      (паролі й ключі мають збігатися з тими, з якими створено копію) і запустіть
#      стек: docker compose up -d --build
#   2. Запустіть цей скрипт. ПОТОЧНІ ДАНІ БУДЕ ЗАМІНЕНО даними з копії.
#
# Версії образів мають бути тими самими, що й під час створення копії.
set -euo pipefail
cd "$(dirname "$0")/.."

src="${1:?Вкажіть каталог резервної копії}"
[ -f "$src/database.dump" ] || { echo "Немає $src/database.dump"; exit 1; }

read -r -p "Поточні дані буде замінено копією з $src. Продовжити? [так/ні] " answer
[ "$answer" = "так" ] || { echo "Скасовано"; exit 1; }

echo "Зупинка застосунку та сервісів API…"
docker compose stop app cron auth rest storage

echo "Очищення поточних даних…"
docker compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q' <<'SQL'
do $$
declare
  t text;
begin
  select string_agg(format('%I.%I', schemaname, tablename), ', ')
    into t
    from pg_tables
   where schemaname in ('public', 'auth', 'storage', 'supabase_migrations')
     and (schemaname, tablename) not in (('auth', 'schema_migrations'), ('storage', 'migrations'));
  if t is not null then
    execute 'truncate ' || t || ' cascade';
  end if;
end;
$$;
SQL

echo "Відновлення бази…"
docker compose exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h localhost -U supabase_admin -d postgres \
  --data-only --disable-triggers --single-transaction --exit-on-error' < "$src/database.dump"

echo "Запуск сховища та відновлення файлів…"
docker compose start storage
for _ in $(seq 1 30); do
  docker compose exec -T storage true 2>/dev/null && break
  sleep 2
done
if [ -f "$src/storage.tar.gz" ]; then
  docker compose exec -T storage sh -c 'cd /var/lib/storage && find . -mindepth 1 -delete && tar xzf -' < "$src/storage.tar.gz"
fi

echo "Запуск усіх сервісів…"
docker compose up -d
echo "Готово. Перевірте баланс депозиту й кілька квитанцій в адмін-панелі."
