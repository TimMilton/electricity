-- Початкове налаштування бази під час ПЕРШОГО запуску контейнера db
-- (виконується образом supabase/postgres з /docker-entrypoint-initdb.d/init-scripts).
-- Задає паролі службовим ролям, через які підключаються Auth, PostgREST і Storage,
-- та секрет JWT. Значення беруться зі змінних середовища контейнера.

\set pgpass `echo "$POSTGRES_PASSWORD"`
\set jwt_secret `echo "$JWT_SECRET"`
\set jwt_exp `echo "$JWT_EXP"`

ALTER USER authenticator WITH PASSWORD :'pgpass';
ALTER USER pgbouncer WITH PASSWORD :'pgpass';
ALTER USER supabase_auth_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_functions_admin WITH PASSWORD :'pgpass';
ALTER USER supabase_storage_admin WITH PASSWORD :'pgpass';

ALTER DATABASE postgres SET "app.settings.jwt_secret" TO :'jwt_secret';
ALTER DATABASE postgres SET "app.settings.jwt_exp" TO :'jwt_exp';
