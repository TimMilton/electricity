-- =====================================================================
-- Електрооблік будинку — бізнес-логіка в базі даних
--
-- Усі зміни даних виконуються лише через функції нижче (SECURITY DEFINER).
-- Користувачі (роль authenticated) не мають прав INSERT/UPDATE/DELETE
-- на таблиці — див. міграцію з RLS. Кожна функція:
--   * перевіряє автентифікацію та роль;
--   * перевіряє власника квартири / запису;
--   * перевіряє стан розрахункового періоду;
--   * виконує всі пов'язані зміни в одній транзакції;
--   * записує подію в audit_logs.
--
-- Помилки для користувача: SQLSTATE P0001, текст українською.
-- Потрібне явне підтвердження дії: SQLSTATE EO409.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Допоміжні функції
-- ---------------------------------------------------------------------
create or replace function public.fmt_ts(p_ts timestamptz)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select to_char(p_ts at time zone 'Europe/Kyiv', 'DD.MM.YYYY HH24:MI');
$$;

create or replace function public.fmt_money(p numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select replace(to_char(coalesce(p, 0), 'FM999999990.00'), '.', ',') || ' грн';
$$;

create or replace function public.period_label(p_year integer, p_month integer)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select (array['Січень','Лютий','Березень','Квітень','Травень','Червень',
                'Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'])[p_month]
         || ' ' || p_year::text;
$$;

create or replace function public.user_error(p_message text)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception '%', p_message using errcode = 'P0001';
end;
$$;

-- Перевірка точності грошової суми (не більше двох знаків після коми)
create or replace function public.is_money(p numeric)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  select p is not null and p = round(p, 2);
$$;

-- Профіль поточного користувача
create or replace function public.current_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.* from public.profiles p
  where p.auth_user_id = auth.uid() and p.is_active
  limit 1;
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.auth_user_id = auth.uid() and p.is_active and p.role = 'admin'
  );
$$;

create or replace function public.my_apartment_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.apartment_id from public.profiles p
  where p.auth_user_id = auth.uid() and p.is_active
  limit 1;
$$;

-- Вимагає автентифікованого активного користувача. Повертає профіль.
create or replace function public.require_profile()
returns public.profiles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.profiles;
begin
  if auth.uid() is null then
    perform public.user_error('Потрібно увійти в систему');
  end if;
  select * into v from public.profiles p where p.auth_user_id = auth.uid() limit 1;
  if v.id is null then
    perform public.user_error('Профіль користувача не знайдено. Зверніться до адміністратора');
  end if;
  if not v.is_active then
    perform public.user_error('Обліковий запис деактивовано. Зверніться до адміністратора');
  end if;
  return v;
end;
$$;

create or replace function public.require_admin()
returns public.profiles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.profiles;
begin
  v := public.require_profile();
  if v.role <> 'admin' then
    perform public.user_error('Дія доступна лише адміністратору');
  end if;
  return v;
end;
$$;

-- Перевірка доступу до квартири: власна квартира або адміністратор
create or replace function public.require_apartment_access(p_apartment_id uuid)
returns public.profiles
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v public.profiles;
begin
  v := public.require_profile();
  if v.role = 'admin' then
    return v;
  end if;
  if v.apartment_id is distinct from p_apartment_id then
    perform public.user_error('Немає доступу до даних цієї квартири');
  end if;
  return v;
end;
$$;

-- Запис у журнал змін
create or replace function public.write_audit(
  p_action text,
  p_entity_type text,
  p_entity_id uuid,
  p_previous jsonb,
  p_new jsonb,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role text;
begin
  select p.role::text into v_role from public.profiles p where p.auth_user_id = auth.uid();
  insert into public.audit_logs (actor_user_id, actor_role, action_type, entity_type, entity_id,
                                 previous_values, new_values, reason)
  values (auth.uid(), coalesce(v_role, case when auth.uid() is null then 'system' else 'unknown' end),
          p_action, p_entity_type, p_entity_id, p_previous, p_new, nullif(btrim(p_reason), ''));
end;
$$;

-- Захист від зміни ролі поза дозволеними функціями
create or replace function public.tg_profiles_guard_role()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role
     and coalesce(current_setting('app.allow_role_change', true), '') <> 'on' then
    raise exception 'Зміна ролі дозволена лише через адміністративну функцію' using errcode = 'P0001';
  end if;
  if new.auth_user_id is distinct from old.auth_user_id then
    raise exception 'Не можна змінити прив''язку профілю до користувача' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.tg_profiles_guard_role();

-- Нові профілі створюються лише з роллю resident, якщо явно не дозволено
create or replace function public.tg_profiles_guard_insert()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.role = 'admin' and coalesce(current_setting('app.allow_role_change', true), '') <> 'on' then
    raise exception 'Створення адміністратора дозволене лише через захищений механізм' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger profiles_guard_insert before insert on public.profiles
  for each row execute function public.tg_profiles_guard_insert();

-- ---------------------------------------------------------------------
-- Обмеження частоти (викликається сервером з сервісною роллю)
-- ---------------------------------------------------------------------
create or replace function public.check_rate_limit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.rate_limits;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update
    set hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
        window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning * into v;
  -- прибирання старих записів
  delete from public.rate_limits where window_start < now() - interval '2 days';
  return v.hits <= p_max;
end;
$$;

-- ---------------------------------------------------------------------
-- Розрахункові періоди
-- ---------------------------------------------------------------------

-- Автоматичне оновлення статусів за часом.
-- scheduled -> open коли настало вікно; scheduled/open -> closed після завершення вікна.
-- Закритий період автоматично не відкривається повторно.
create or replace function public.sync_period_statuses()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.billing_periods
     set status = 'closed', closed_at = reading_window_end
   where status in ('scheduled', 'open') and now() >= reading_window_end;

  update public.billing_periods
     set status = 'open'
   where status = 'scheduled' and now() >= reading_window_start and now() < reading_window_end;
end;
$$;

-- Поточний період для мешканця: відкритий -> найближчий запланований -> останній
create or replace function public.get_current_period()
returns public.billing_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.billing_periods;
begin
  perform public.sync_period_statuses();

  select * into v from public.billing_periods
   where status = 'open' and now() >= reading_window_start and now() < reading_window_end
   order by year, month limit 1;
  if v.id is not null then return v; end if;

  select * into v from public.billing_periods
   where status = 'scheduled' and reading_window_start > now()
   order by reading_window_start limit 1;
  if v.id is not null then return v; end if;

  select * into v from public.billing_periods order by year desc, month desc limit 1;
  return v;
end;
$$;

-- Фаза вікна приймання для інтерфейсу: before | open | after | closed
create or replace function public.period_phase(p public.billing_periods)
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select case
    when p.status = 'closed' then 'closed'
    when now() < p.reading_window_start then 'before'
    when now() >= p.reading_window_end then 'after'
    else 'open'
  end;
$$;

-- Перевірка, що мешканець може змінювати дані періоду
create or replace function public.assert_period_editable(p_period public.billing_periods, p_is_admin boolean)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if p_period.id is null then
    perform public.user_error('Розрахунковий період не знайдено');
  end if;
  if p_is_admin then
    if p_period.status = 'closed' and not p_period.allow_admin_edit_after_close then
      perform public.user_error('Період закрито без можливості адміністративного виправлення');
    end if;
    return;
  end if;
  if now() < p_period.reading_window_start then
    perform public.user_error(format(
      'Приймання показників за цей місяць ще не розпочалося. Період відкриється %s',
      public.fmt_ts(p_period.reading_window_start)));
  end if;
  if p_period.status = 'closed' or now() >= p_period.reading_window_end then
    perform public.user_error(format(
      'Період подання показників завершився %s. Зверніться до адміністратора, якщо потрібно виправити дані',
      public.fmt_ts(coalesce(least(p_period.closed_at, p_period.reading_window_end), p_period.reading_window_end))));
  end if;
end;
$$;

-- Межі вікна за замовчуванням для періоду (рік, місяць)
create or replace function public.default_window_for(p_year integer, p_month integer)
returns table (window_start timestamptz, window_end timestamptz)
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  s public.app_settings;
  v_base date;
begin
  select * into s from public.app_settings where id;
  v_base := make_date(p_year, p_month, 1);
  if s.window_for_previous_month then
    v_base := (v_base + interval '1 month')::date;
  end if;
  window_start := make_timestamptz(extract(year from v_base)::int, extract(month from v_base)::int,
                                   s.default_window_start_day, s.default_window_start_hour, 0, 0, 'Europe/Kyiv');
  window_end := make_timestamptz(extract(year from v_base)::int, extract(month from v_base)::int,
                                 s.default_window_end_day, s.default_window_end_hour, 59, 59, 'Europe/Kyiv');
  if window_end <= window_start then
    window_end := window_start + interval '1 day';
  end if;
  return next;
end;
$$;

create or replace function public.admin_create_period(
  p_year integer,
  p_month integer,
  p_window_start timestamptz default null,
  p_window_end timestamptz default null,
  p_allow_admin_edit_after_close boolean default null
)
returns public.billing_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_admin public.profiles;
  v public.billing_periods;
  d record;
  s public.app_settings;
begin
  v_admin := public.require_admin();
  select * into s from public.app_settings where id;
  if p_year not between 2000 and 2100 or p_month not between 1 and 12 then
    perform public.user_error('Некоректний рік або місяць');
  end if;
  if exists (select 1 from public.billing_periods where year = p_year and month = p_month) then
    perform public.user_error(format('Період %s уже існує', public.period_label(p_year, p_month)));
  end if;
  select * into d from public.default_window_for(p_year, p_month);
  insert into public.billing_periods (year, month, start_date, end_date, reading_window_start,
                                     reading_window_end, allow_admin_edit_after_close, created_by)
  values (p_year, p_month, make_date(p_year, p_month, 1),
          (make_date(p_year, p_month, 1) + interval '1 month - 1 day')::date,
          coalesce(p_window_start, d.window_start), coalesce(p_window_end, d.window_end),
          coalesce(p_allow_admin_edit_after_close, s.admin_edit_after_close), auth.uid())
  returning * into v;
  perform public.sync_period_statuses();
  select * into v from public.billing_periods where id = v.id;
  perform public.write_audit('period.create', 'billing_period', v.id, null, to_jsonb(v), null);
  return v;
end;
$$;

-- Створити наступний період після останнього (або поточний місяць, якщо періодів ще немає)
create or replace function public.admin_create_next_period()
returns public.billing_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_last public.billing_periods;
  v_year integer;
  v_month integer;
  s public.app_settings;
  v_now date := (now() at time zone 'Europe/Kyiv')::date;
begin
  perform public.require_admin();
  select * into s from public.app_settings where id;
  select * into v_last from public.billing_periods order by year desc, month desc limit 1;
  if v_last.id is null then
    if s.window_for_previous_month then
      v_now := (v_now - interval '1 month')::date;
    end if;
    v_year := extract(year from v_now)::int;
    v_month := extract(month from v_now)::int;
  else
    v_year := v_last.year + case when v_last.month = 12 then 1 else 0 end;
    v_month := case when v_last.month = 12 then 1 else v_last.month + 1 end;
  end if;
  return public.admin_create_period(v_year, v_month, null, null, null);
end;
$$;

create or replace function public.admin_update_period(
  p_period_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_allow_admin_edit_after_close boolean,
  p_reason text
)
returns public.billing_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.billing_periods;
  v public.billing_periods;
begin
  perform public.require_admin();
  select * into v_old from public.billing_periods where id = p_period_id for update;
  if v_old.id is null then perform public.user_error('Період не знайдено'); end if;
  if p_window_end <= p_window_start then
    perform public.user_error('Дата закриття має бути пізнішою за дату відкриття');
  end if;
  update public.billing_periods
     set reading_window_start = p_window_start,
         reading_window_end = p_window_end,
         allow_admin_edit_after_close = coalesce(p_allow_admin_edit_after_close, allow_admin_edit_after_close),
         -- якщо період ще не закритий вручну — статус перераховується за новими датами
         status = case when status = 'closed' then status
                       when now() < p_window_start then 'scheduled'::public.period_status
                       else status end
   where id = p_period_id
  returning * into v;
  perform public.sync_period_statuses();
  select * into v from public.billing_periods where id = p_period_id;
  perform public.write_audit('period.update', 'billing_period', v.id, to_jsonb(v_old), to_jsonb(v), p_reason);
  return v;
end;
$$;

create or replace function public.admin_close_period(p_period_id uuid, p_reason text)
returns public.billing_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.billing_periods;
  v public.billing_periods;
begin
  perform public.require_admin();
  select * into v_old from public.billing_periods where id = p_period_id for update;
  if v_old.id is null then perform public.user_error('Період не знайдено'); end if;
  if v_old.status = 'closed' then return v_old; end if;
  update public.billing_periods
     set status = 'closed', closed_at = now(), closed_by = auth.uid()
   where id = p_period_id
  returning * into v;
  perform public.write_audit('period.close', 'billing_period', v.id, to_jsonb(v_old), to_jsonb(v), p_reason);
  return v;
end;
$$;

create or replace function public.admin_reopen_period(p_period_id uuid, p_new_window_end timestamptz, p_reason text)
returns public.billing_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.billing_periods;
  v public.billing_periods;
begin
  perform public.require_admin();
  if nullif(btrim(p_reason), '') is null then
    perform public.user_error('Вкажіть причину повторного відкриття');
  end if;
  select * into v_old from public.billing_periods where id = p_period_id for update;
  if v_old.id is null then perform public.user_error('Період не знайдено'); end if;
  if p_new_window_end <= now() then
    perform public.user_error('Нова дата закриття має бути в майбутньому');
  end if;
  update public.billing_periods
     set status = case when now() >= reading_window_start then 'open'::public.period_status else 'scheduled' end,
         closed_at = null, closed_by = null,
         reading_window_end = p_new_window_end
   where id = p_period_id
  returning * into v;
  perform public.write_audit('period.reopen', 'billing_period', v.id, to_jsonb(v_old), to_jsonb(v), p_reason);
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Тарифи
-- ---------------------------------------------------------------------
create or replace function public.get_applicable_tariff(p_period_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.rate_per_kwh
    from public.tariffs t
    join public.billing_periods p on p.id = p_period_id
   where t.valid_from <= p.start_date
     and (t.valid_until is null or t.valid_until >= p.start_date)
   order by t.valid_from desc
   limit 1;
$$;

create or replace function public.admin_set_tariff(p_rate numeric, p_valid_from date, p_reason text default null)
returns public.tariffs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.tariffs;
  v_prev public.tariffs;
begin
  perform public.require_admin();
  if p_rate is null or p_rate <= 0 or p_rate <> round(p_rate, 4) then
    perform public.user_error('Тариф має бути додатним числом (до 4 знаків після коми)');
  end if;
  if p_rate > 1000 then
    perform public.user_error('Тариф перевищує допустиме значення');
  end if;
  if p_valid_from is null then
    perform public.user_error('Вкажіть дату початку дії тарифу');
  end if;
  if exists (select 1 from public.tariffs where valid_from >= p_valid_from) then
    perform public.user_error('Уже існує тариф з такою або пізнішою датою початку дії. '
      || 'Новий тариф має починати діяти пізніше за останній');
  end if;
  select * into v_prev from public.tariffs where valid_until is null order by valid_from desc limit 1 for update;
  if v_prev.id is not null then
    update public.tariffs set valid_until = p_valid_from - 1 where id = v_prev.id;
  end if;
  insert into public.tariffs (rate_per_kwh, valid_from, created_by)
  values (p_rate, p_valid_from, auth.uid())
  returning * into v;
  perform public.write_audit('tariff.create', 'tariff', v.id, to_jsonb(v_prev), to_jsonb(v), p_reason);
  return v;
end;
$$;

-- Видалити лише майбутній тариф, який ще не набув чинності
create or replace function public.admin_delete_future_tariff(p_tariff_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.tariffs;
begin
  perform public.require_admin();
  select * into v from public.tariffs where id = p_tariff_id for update;
  if v.id is null then perform public.user_error('Тариф не знайдено'); end if;
  if v.valid_from <= (now() at time zone 'Europe/Kyiv')::date then
    perform public.user_error('Чинний або минулий тариф видаляти не можна — встановіть новий тариф');
  end if;
  if exists (select 1 from public.tariffs where valid_from > v.valid_from) then
    perform public.user_error('Спочатку видаліть пізніші тарифи');
  end if;
  delete from public.tariffs where id = v.id;
  update public.tariffs set valid_until = null
   where id = (select id from public.tariffs order by valid_from desc limit 1);
  perform public.write_audit('tariff.delete', 'tariff', v.id, to_jsonb(v), null, p_reason);
end;
$$;

-- ---------------------------------------------------------------------
-- Показники квартир
-- ---------------------------------------------------------------------

-- Останній зафіксований показник квартири до заданого періоду
create or replace function public.get_previous_reading(p_apartment_id uuid, p_period_id uuid)
returns table (previous_reading numeric, source text, recorded_at timestamptz, source_period_id uuid, source_label text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_period public.billing_periods;
  v_apt public.apartments;
begin
  select * into v_period from public.billing_periods where id = p_period_id;
  if v_period.id is null then return; end if;

  return query
    select r.current_reading, 'reading'::text, r.submitted_at, p.id, public.period_label(p.year, p.month)
      from public.meter_readings r
      join public.billing_periods p on p.id = r.billing_period_id
     where r.apartment_id = p_apartment_id
       and (p.year, p.month) < (v_period.year, v_period.month)
     order by p.year desc, p.month desc
     limit 1;
  if found then return; end if;

  select * into v_apt from public.apartments where id = p_apartment_id;
  if v_apt.initial_reading is not null then
    return query select v_apt.initial_reading, 'initial'::text,
                        v_apt.initial_reading_date::timestamptz, null::uuid, 'Початковий показник'::text;
  end if;
end;
$$;

create or replace function public.payment_amounts_json(p public.payments)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'electricity_amount', p.electricity_amount,
    'deposit_contribution', p.deposit_contribution,
    'hall_lighting_amount', p.hall_lighting_amount,
    'other_amount', p.other_amount,
    'total_amount', p.total_amount);
$$;

/*
  Подання (або адміністративне виправлення) показника та додаткових внесків.

  Мешканець: лише власна квартира, лише у відкрите вікно, лише поки платіж
  не подано на перевірку / не підтверджено. Попередній показник визначає сервер.

  Адміністратор: будь-яка квартира, незалежно від вікна (якщо період дозволяє
  адміністративне виправлення), може вказати попередній показник (заміна лічильника),
  для зміни наявного запису обов'язкова причина. Якщо зміна поточного показника
  впливає на наступні місяці — потрібне явне підтвердження (EO409), наступні
  місяці автоматично НЕ перераховуються.
*/
create or replace function public.submit_meter_reading(
  p_apartment_id uuid,
  p_period_id uuid,
  p_current_reading numeric,
  p_deposit_contribution numeric default 0,
  p_hall_lighting numeric default 0,
  p_other_amount numeric default 0,
  p_previous_reading numeric default null,
  p_notes text default null,
  p_reason text default null,
  p_acknowledge_downstream boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_is_admin boolean;
  v_apt public.apartments;
  v_period public.billing_periods;
  v_settings public.app_settings;
  v_existing public.meter_readings;
  v_reading public.meter_readings;
  v_payment public.payments;
  v_old_payment public.payments;
  v_prev numeric;
  v_prev_info record;
  v_rate numeric;
  v_electricity numeric;
  v_consumption numeric;
  v_avg numeric;
  v_anomaly boolean := false;
  v_warnings text[] := array[]::text[];
  v_downstream_count integer;
  v_old_charges jsonb;
  v_total numeric;
begin
  v_profile := public.require_apartment_access(p_apartment_id);
  v_is_admin := v_profile.role = 'admin';
  select * into v_settings from public.app_settings where id;

  select * into v_apt from public.apartments where id = p_apartment_id for update;
  if v_apt.id is null then perform public.user_error('Квартиру не знайдено'); end if;
  if not v_apt.is_active and not v_is_admin then
    perform public.user_error('Квартира неактивна. Зверніться до адміністратора');
  end if;

  perform public.sync_period_statuses();
  select * into v_period from public.billing_periods where id = p_period_id;
  perform public.assert_period_editable(v_period, v_is_admin);

  -- Валідація сум
  p_deposit_contribution := coalesce(p_deposit_contribution, 0);
  p_hall_lighting := coalesce(p_hall_lighting, 0);
  p_other_amount := coalesce(p_other_amount, 0);
  if p_current_reading is null or p_current_reading < 0 or p_current_reading <> round(p_current_reading, 2) then
    perform public.user_error('Поточний показник має бути невід''ємним числом (до 2 знаків після коми)');
  end if;
  if p_current_reading > 9999999999 then
    perform public.user_error('Показник перевищує допустиме значення');
  end if;
  if not (public.is_money(p_deposit_contribution) and public.is_money(p_hall_lighting) and public.is_money(p_other_amount)) then
    perform public.user_error('Суми внесків мають бути вказані з точністю до копійок');
  end if;
  if p_deposit_contribution < 0 or p_hall_lighting < 0 or p_other_amount < 0 then
    perform public.user_error('Суми внесків не можуть бути від''ємними');
  end if;
  if greatest(p_deposit_contribution, p_hall_lighting, p_other_amount) > v_settings.max_contribution_amount then
    perform public.user_error(format('Сума внеску не може перевищувати %s', public.fmt_money(v_settings.max_contribution_amount)));
  end if;
  if p_other_amount > 0 and not v_settings.other_charges_enabled and not v_is_admin then
    perform public.user_error('Інші внески зараз не приймаються');
  end if;

  select * into v_existing from public.meter_readings
   where apartment_id = p_apartment_id and billing_period_id = p_period_id
   for update;

  select * into v_old_payment from public.payments
   where apartment_id = p_apartment_id and billing_period_id = p_period_id
   for update;

  if not v_is_admin and v_old_payment.status in ('pending_review', 'paid') then
    perform public.user_error('Платіж за цей місяць уже подано на перевірку або підтверджено. '
      || 'Зміна показників і внесків можлива лише через адміністратора');
  end if;

  if v_existing.id is not null and v_is_admin and nullif(btrim(p_reason), '') is null then
    perform public.user_error('Для виправлення наявного показника вкажіть причину');
  end if;

  -- Попередній показник
  if v_existing.id is not null then
    v_prev := v_existing.previous_reading;
    if v_is_admin and p_previous_reading is not null then
      v_prev := p_previous_reading;
    end if;
  else
    select * into v_prev_info from public.get_previous_reading(p_apartment_id, p_period_id);
    v_prev := v_prev_info.previous_reading;
    if v_is_admin and p_previous_reading is not null then
      if v_prev is not null and p_previous_reading <> v_prev and nullif(btrim(p_reason), '') is null then
        perform public.user_error('Попередній показник відрізняється від останнього зафіксованого — вкажіть причину');
      end if;
      v_prev := p_previous_reading;
    elsif v_prev is null then
      -- Перше подання: історії немає, початковий показник не задано
      if p_previous_reading is null then
        perform public.user_error('Не знайдено попереднього показника. Вкажіть показник на початок обліку '
          || 'або зверніться до адміністратора');
      end if;
      v_prev := p_previous_reading;
      v_warnings := array_append(v_warnings, 'Попередній показник вказано вручну (перше подання)');
    end if;
  end if;

  if v_prev < 0 or v_prev <> round(v_prev, 2) then
    perform public.user_error('Попередній показник має бути невід''ємним числом');
  end if;
  if p_current_reading < v_prev then
    perform public.user_error(format(
      'Поточний показник (%s) менший за попередній (%s). Автоматичний розрахунок неможливий — '
      || 'зверніться до адміністратора для перевірки', p_current_reading, v_prev));
  end if;

  -- Тариф: для наявного запису зберігається зафіксований тариф
  if v_existing.id is not null then
    v_rate := v_existing.tariff_rate;
  else
    v_rate := public.get_applicable_tariff(p_period_id);
    if v_rate is null then
      perform public.user_error('Тариф для цього періоду не визначено. Зверніться до адміністратора');
    end if;
  end if;

  v_consumption := p_current_reading - v_prev;
  v_electricity := round(v_consumption * v_rate, 2);

  -- Попередження про аномальне споживання (не відхиляє)
  if v_settings.anomaly_threshold_kwh is not null and v_consumption > v_settings.anomaly_threshold_kwh then
    v_anomaly := true;
  end if;
  if v_settings.anomaly_multiplier is not null then
    select avg(r.consumption_kwh) into v_avg
      from (select r2.consumption_kwh
              from public.meter_readings r2
              join public.billing_periods p2 on p2.id = r2.billing_period_id
             where r2.apartment_id = p_apartment_id
               and (p2.year, p2.month) < (v_period.year, v_period.month)
             order by p2.year desc, p2.month desc limit 3) r;
    if v_avg is not null and v_avg > 0 and v_consumption > v_avg * v_settings.anomaly_multiplier then
      v_anomaly := true;
    end if;
  end if;
  if v_anomaly then
    v_warnings := array_append(v_warnings, format('Аномально високе споживання: %s кВт·год. Перевірте показник', v_consumption));
  end if;

  -- Вплив на наступні місяці
  if v_existing.id is not null and p_current_reading <> v_existing.current_reading then
    select count(*) into v_downstream_count
      from public.meter_readings r
      join public.billing_periods p on p.id = r.billing_period_id
     where r.apartment_id = p_apartment_id
       and (p.year, p.month) > (v_period.year, v_period.month);
    if v_downstream_count > 0 then
      if not coalesce(p_acknowledge_downstream, false) then
        raise exception 'Зміна поточного показника впливає на % наступн. період(и): їхній попередній показник '
          'залишиться без змін і не буде перераховано автоматично. Підтвердьте виправлення', v_downstream_count
          using errcode = 'EO409';
      end if;
      v_warnings := array_append(v_warnings, format('Виправлення впливає на %s наступн. період(и) — перевірте їх окремо', v_downstream_count));
    end if;
  end if;

  select coalesce(jsonb_object_agg(charge_type, amount), '{}'::jsonb) into v_old_charges
    from public.additional_charges
   where apartment_id = p_apartment_id and billing_period_id = p_period_id;

  if v_existing.id is null then
    insert into public.meter_readings (apartment_id, billing_period_id, previous_reading, current_reading,
                                       tariff_rate, electricity_amount, is_anomaly, entered_by, entry_source, notes)
    values (p_apartment_id, p_period_id, v_prev, p_current_reading, v_rate, v_electricity, v_anomaly,
            auth.uid(), case when v_is_admin then 'admin' else 'resident' end::public.entry_source,
            nullif(btrim(p_notes), ''))
    returning * into v_reading;
  else
    update public.meter_readings
       set previous_reading = v_prev,
           current_reading = p_current_reading,
           electricity_amount = v_electricity,
           is_anomaly = v_anomaly,
           entered_by = auth.uid(),
           entry_source = case when v_is_admin then 'admin' else 'resident' end::public.entry_source,
           notes = coalesce(nullif(btrim(p_notes), ''), notes),
           updated_at = now()
     where id = v_existing.id
    returning * into v_reading;
  end if;

  insert into public.additional_charges (apartment_id, billing_period_id, charge_type, amount, created_by)
  values (p_apartment_id, p_period_id, 'deposit_contribution', p_deposit_contribution, auth.uid()),
         (p_apartment_id, p_period_id, 'hall_lighting', p_hall_lighting, auth.uid()),
         (p_apartment_id, p_period_id, 'other', p_other_amount, auth.uid())
  on conflict (apartment_id, billing_period_id, charge_type)
  do update set amount = excluded.amount, created_by = excluded.created_by, updated_at = now();

  v_total := v_electricity + p_deposit_contribution + p_hall_lighting + p_other_amount;

  -- Платіж: створюється / оновлюється лише поки його не подано
  if v_old_payment.id is null then
    insert into public.payments (apartment_id, billing_period_id, electricity_amount, deposit_contribution,
                                 hall_lighting_amount, other_amount, total_amount, status)
    values (p_apartment_id, p_period_id, v_electricity, p_deposit_contribution, p_hall_lighting,
            p_other_amount, v_total, 'awaiting_payment')
    returning * into v_payment;
    insert into public.payment_events (payment_id, event_type, status_after, attempt_no, amounts, actor_user_id)
    values (v_payment.id, 'created', v_payment.status, 0, public.payment_amounts_json(v_payment), auth.uid());
  elsif v_old_payment.status in ('awaiting_payment', 'rejected') then
    update public.payments
       set electricity_amount = v_electricity,
           deposit_contribution = p_deposit_contribution,
           hall_lighting_amount = p_hall_lighting,
           other_amount = p_other_amount,
           total_amount = v_total
     where id = v_old_payment.id
    returning * into v_payment;
    if public.payment_amounts_json(v_payment) <> public.payment_amounts_json(v_old_payment) then
      insert into public.payment_events (payment_id, event_type, status_after, attempt_no, amounts, actor_user_id)
      values (v_payment.id, 'amounts_updated', v_payment.status, v_payment.attempt_no,
              public.payment_amounts_json(v_payment), auth.uid());
    end if;
  else
    -- Платіж уже подано / підтверджено: зафіксована сума не змінюється непомітно
    v_payment := v_old_payment;
    if v_old_payment.total_amount <> v_total then
      v_warnings := array_append(v_warnings, format(
        'Платіж має статус «%s» на суму %s, нове нарахування — %s. Різницю потрібно врегулювати окремо',
        case v_old_payment.status when 'paid' then 'Сплачено' else 'На перевірці' end,
        public.fmt_money(v_old_payment.total_amount), public.fmt_money(v_total)));
    end if;
  end if;

  perform public.write_audit(
    case when v_existing.id is null then 'reading.create' else 'reading.update' end,
    'meter_reading', v_reading.id,
    case when v_existing.id is null then null
         else to_jsonb(v_existing) || jsonb_build_object('charges', v_old_charges) end,
    to_jsonb(v_reading) || jsonb_build_object('charges', jsonb_build_object(
      'deposit_contribution', p_deposit_contribution, 'hall_lighting', p_hall_lighting, 'other', p_other_amount)),
    coalesce(p_reason, case when v_is_admin then 'Внесено адміністратором' end));

  return jsonb_build_object(
    'reading', to_jsonb(v_reading),
    'payment', to_jsonb(v_payment),
    'warnings', to_jsonb(v_warnings));
end;
$$;

-- ---------------------------------------------------------------------
-- Платежі
-- ---------------------------------------------------------------------

-- Перевірка метаданих квитанцій, переданих сервером після завантаження у Storage
create or replace function public.validate_receipts_input(p_payment public.payments, p_receipts jsonb)
returns void
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  s public.app_settings;
  r jsonb;
  v_prefix text := p_payment.apartment_id::text || '/' || p_payment.id::text || '/';
begin
  select * into s from public.app_settings where id;
  if p_receipts is null or jsonb_typeof(p_receipts) <> 'array' then
    perform public.user_error('Некоректний список квитанцій');
  end if;
  if jsonb_array_length(p_receipts) > 10 then
    perform public.user_error('Забагато файлів за один раз (максимум 10)');
  end if;
  for r in select * from jsonb_array_elements(p_receipts) loop
    if coalesce(r->>'storage_path', '') not like v_prefix || '%' or (r->>'storage_path') like '%..%' then
      perform public.user_error('Некоректний шлях до файлу квитанції');
    end if;
    if not ((r->>'mime_type') = any (s.allowed_receipt_mime_types)) then
      perform public.user_error('Недозволений формат файлу квитанції');
    end if;
    if coalesce((r->>'file_size')::bigint, 0) <= 0
       or (r->>'file_size')::bigint > s.max_receipt_size_mb::bigint * 1024 * 1024 then
      perform public.user_error(format('Розмір файлу перевищує %s МБ', s.max_receipt_size_mb));
    end if;
  end loop;
end;
$$;

create or replace function public.insert_receipts(p_payment public.payments, p_receipts jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  insert into public.receipts (payment_id, attempt_no, storage_path, original_filename, mime_type, file_size, uploaded_by)
  select p_payment.id, p_payment.attempt_no, r->>'storage_path',
         left(coalesce(nullif(r->>'original_filename', ''), 'квитанція'), 255),
         r->>'mime_type', (r->>'file_size')::integer, auth.uid()
    from jsonb_array_elements(p_receipts) r;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

/*
  Подання оплати на перевірку: статус awaiting_payment/rejected -> pending_review.
  Повторне подання після відхилення використовує той самий платіж
  (нове нарахування не створюється), номер спроби збільшується.
*/
create or replace function public.submit_payment_for_review(p_payment_id uuid, p_receipts jsonb)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_old public.payments;
  v public.payments;
begin
  select * into v_old from public.payments where id = p_payment_id for update;
  if v_old.id is null then perform public.user_error('Платіж не знайдено'); end if;
  v_profile := public.require_apartment_access(v_old.apartment_id);

  if v_old.status = 'pending_review' then
    perform public.user_error('Платіж уже на перевірці. Повторне надсилання не потрібне');
  end if;
  if v_old.status = 'paid' then
    perform public.user_error('Платіж уже підтверджено');
  end if;
  if v_old.total_amount <= 0 then
    perform public.user_error('Сума до сплати — 0 грн. Оплата не потрібна');
  end if;
  if p_receipts is null or jsonb_typeof(p_receipts) <> 'array' or jsonb_array_length(p_receipts) = 0 then
    perform public.user_error('Завантажте квитанцію про оплату');
  end if;
  perform public.validate_receipts_input(v_old, p_receipts);

  update public.payments
     set status = 'pending_review',
         attempt_no = attempt_no + 1,
         submitted_at = now(),
         rejection_reason = null,
         reviewed_at = null,
         reviewed_by = null
   where id = p_payment_id
  returning * into v;

  perform public.insert_receipts(v, p_receipts);

  insert into public.payment_events (payment_id, event_type, status_after, attempt_no, amounts, actor_user_id)
  values (v.id, 'submitted', v.status, v.attempt_no, public.payment_amounts_json(v), auth.uid());

  perform public.write_audit('payment.submit', 'payment', v.id, to_jsonb(v_old), to_jsonb(v),
                             case when v_profile.role = 'admin' then 'Подано адміністратором' end);
  return v;
end;
$$;

-- Додати квитанції до наявного платежу
-- Мешканець: лише власний платіж зі статусом «На перевірці».
-- Адміністратор: будь-який платіж.
create or replace function public.add_payment_receipts(p_payment_id uuid, p_receipts jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v public.payments;
  v_count integer;
begin
  select * into v from public.payments where id = p_payment_id for update;
  if v.id is null then perform public.user_error('Платіж не знайдено'); end if;
  v_profile := public.require_apartment_access(v.apartment_id);
  if v_profile.role <> 'admin' and v.status <> 'pending_review' then
    perform public.user_error('Додати квитанцію можна лише до платежу, що перебуває на перевірці. '
      || 'Для нової оплати скористайтеся сторінкою «Оплатити»');
  end if;
  if p_receipts is null or jsonb_typeof(p_receipts) <> 'array' or jsonb_array_length(p_receipts) = 0 then
    perform public.user_error('Не вибрано файл квитанції');
  end if;
  perform public.validate_receipts_input(v, p_receipts);
  v_count := public.insert_receipts(v, p_receipts);
  insert into public.payment_events (payment_id, event_type, status_after, attempt_no, actor_user_id, reason)
  values (v.id, 'receipt_added', v.status, v.attempt_no, auth.uid(), format('Додано файлів: %s', v_count));
  perform public.write_audit('receipt.add', 'payment', v.id, null, p_receipts, null);
  return v_count;
end;
$$;

/*
  Підтвердження оплати (ідемпотентне).
  Повторний виклик для вже підтвердженого платежу нічого не змінює і
  не створює повторного зарахування до депозиту (також гарантовано
  унікальним індексом deposit_ledger_one_contribution_per_payment).
*/
create or replace function public.approve_payment(p_payment_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.payments;
  v public.payments;
  v_has_receipts boolean;
  v_ledger_id uuid;
  v_period public.billing_periods;
begin
  perform public.require_admin();
  select * into v_old from public.payments where id = p_payment_id for update;
  if v_old.id is null then perform public.user_error('Платіж не знайдено'); end if;

  if v_old.status = 'paid' then
    return jsonb_build_object('payment', to_jsonb(v_old), 'already_paid', true, 'deposit_entry_id', null);
  end if;

  select exists (select 1 from public.receipts where payment_id = v_old.id) into v_has_receipts;
  if not v_has_receipts and nullif(btrim(p_note), '') is null then
    perform public.user_error('Підтвердження без квитанції потребує примітки адміністратора');
  end if;

  update public.payments
     set status = 'paid',
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         rejection_reason = null,
         confirmed_without_receipt = not v_has_receipts,
         admin_note = coalesce(nullif(btrim(p_note), ''), admin_note),
         submitted_at = coalesce(submitted_at, now())
   where id = p_payment_id
  returning * into v;

  if v.deposit_contribution > 0 then
    select * into v_period from public.billing_periods where id = v.billing_period_id;
    insert into public.deposit_ledger (billing_period_id, apartment_id, transaction_type, amount, description,
                                       related_payment_id, created_by)
    values (v.billing_period_id, v.apartment_id, 'contribution', v.deposit_contribution,
            format('Депозитний внесок за %s (підтверджений платіж)', public.period_label(v_period.year, v_period.month)),
            v.id, auth.uid())
    on conflict (related_payment_id) where transaction_type = 'contribution' do nothing
    returning id into v_ledger_id;
  end if;

  insert into public.payment_events (payment_id, event_type, status_after, attempt_no, amounts, reason, actor_user_id)
  values (v.id, 'approved', v.status, v.attempt_no, public.payment_amounts_json(v),
          case when v_has_receipts then nullif(btrim(p_note), '')
               else 'Підтверджено без квитанції: ' || btrim(p_note) end,
          auth.uid());

  perform public.write_audit('payment.approve', 'payment', v.id, to_jsonb(v_old), to_jsonb(v),
                             case when v_has_receipts then p_note else 'Підтверджено без квитанції: ' || p_note end);

  return jsonb_build_object('payment', to_jsonb(v), 'already_paid', false, 'deposit_entry_id', v_ledger_id);
end;
$$;

create or replace function public.reject_payment(p_payment_id uuid, p_reason text)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.payments;
  v public.payments;
begin
  perform public.require_admin();
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) < 3 then
    perform public.user_error('Вкажіть причину відхилення');
  end if;
  select * into v_old from public.payments where id = p_payment_id for update;
  if v_old.id is null then perform public.user_error('Платіж не знайдено'); end if;
  if v_old.status = 'paid' then
    perform public.user_error('Підтверджений платіж не можна відхилити. Для виправлення використайте коригування');
  end if;
  if v_old.status = 'rejected' then
    return v_old;
  end if;

  update public.payments
     set status = 'rejected',
         rejection_reason = btrim(p_reason),
         reviewed_at = now(),
         reviewed_by = auth.uid()
   where id = p_payment_id
  returning * into v;

  insert into public.payment_events (payment_id, event_type, status_after, attempt_no, amounts, reason, actor_user_id)
  values (v.id, 'rejected', v.status, v.attempt_no, public.payment_amounts_json(v), btrim(p_reason), auth.uid());

  perform public.write_audit('payment.reject', 'payment', v.id, to_jsonb(v_old), to_jsonb(v), p_reason);
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Депозит
-- ---------------------------------------------------------------------
create or replace function public.deposit_balance_internal()
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(amount), 0)::numeric(12,2) from public.deposit_ledger;
$$;

-- Зведення депозиту з урахуванням прав і налаштувань публічності
create or replace function public.get_deposit_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  s public.app_settings;
  v_public boolean;
  v_usage jsonb;
  v_mine jsonb;
begin
  v_profile := public.require_profile();
  select * into s from public.app_settings where id;
  v_public := v_profile.role = 'admin' or s.show_deposit_balance_to_residents;

  -- власні внески квартири (заявлені та підтверджені)
  select coalesce(jsonb_agg(x order by x->>'sort' desc), '[]'::jsonb) into v_mine
  from (
    select jsonb_build_object(
      'sort', lpad(bp.year::text, 4, '0') || lpad(bp.month::text, 2, '0'),
      'period_id', bp.id,
      'period_label', public.period_label(bp.year, bp.month),
      'declared_amount', pay.deposit_contribution,
      'payment_status', pay.status,
      'confirmed', exists (select 1 from public.deposit_ledger l
                           where l.related_payment_id = pay.id and l.transaction_type = 'contribution'),
      'confirmed_at', pay.reviewed_at
    ) x
    from public.payments pay
    join public.billing_periods bp on bp.id = pay.billing_period_id
    where pay.apartment_id = v_profile.apartment_id and pay.deposit_contribution > 0
  ) t;

  if v_public then
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', l.id,
             'period_label', public.period_label(bp.year, bp.month),
             'transaction_type', l.transaction_type,
             'amount', l.amount,
             'description', l.description,
             'created_at', l.created_at) order by l.created_at desc), '[]'::jsonb)
      into v_usage
      from public.deposit_ledger l
      join public.billing_periods bp on bp.id = l.billing_period_id
     where l.transaction_type <> 'contribution';
  end if;

  return jsonb_build_object(
    'is_public', v_public,
    'balance', case when v_public then public.deposit_balance_internal() end,
    'total_contributions', case when v_public then
       (select coalesce(sum(amount), 0) from public.deposit_ledger where transaction_type = 'contribution') end,
    'usage', v_usage,
    'public_note', s.deposit_public_note,
    'my_contributions', v_mine);
end;
$$;

-- Ручна операція з депозитом: correction (±) або refund (повернення, сума додатна на вході)
create or replace function public.admin_create_deposit_operation(
  p_type public.deposit_tx_type,
  p_amount numeric,
  p_description text,
  p_period_id uuid,
  p_apartment_id uuid default null
)
returns public.deposit_ledger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.deposit_ledger;
  v_amount numeric;
  v_balance numeric;
begin
  perform public.require_admin();
  if p_type not in ('correction', 'refund') then
    perform public.user_error('Внески та списання на розбіжності створюються лише через відповідні процеси');
  end if;
  if nullif(btrim(p_description), '') is null then
    perform public.user_error('Вкажіть підставу операції');
  end if;
  if p_amount is null or p_amount = 0 or not public.is_money(p_amount) then
    perform public.user_error('Сума має бути ненульовою, з точністю до копійок');
  end if;
  if not exists (select 1 from public.billing_periods where id = p_period_id) then
    perform public.user_error('Оберіть розрахунковий період');
  end if;
  if p_type = 'refund' and p_amount < 0 then
    perform public.user_error('Суму повернення вкажіть додатним числом');
  end if;

  v_amount := case when p_type = 'refund' then -p_amount else p_amount end;

  perform pg_advisory_xact_lock(hashtext('deposit_ledger'));
  v_balance := public.deposit_balance_internal();
  if v_amount < 0 and v_balance + v_amount < 0 then
    perform public.user_error(format('Недостатньо коштів на депозиті. Поточний баланс: %s', public.fmt_money(v_balance)));
  end if;

  insert into public.deposit_ledger (billing_period_id, apartment_id, transaction_type, amount, description, created_by)
  values (p_period_id, p_apartment_id, p_type, v_amount, btrim(p_description), auth.uid())
  returning * into v;

  perform public.write_audit('deposit.' || p_type::text, 'deposit_ledger', v.id,
                             jsonb_build_object('balance', v_balance),
                             to_jsonb(v) || jsonb_build_object('balance', v_balance + v_amount),
                             p_description);
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Загальний лічильник і розбіжності
-- ---------------------------------------------------------------------
create or replace function public.get_previous_common_reading(p_period_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.current_reading
    from public.common_meter_readings c
    join public.billing_periods p on p.id = c.billing_period_id
    join public.billing_periods target on target.id = p_period_id
   where (p.year, p.month) < (target.year, target.month)
   order by p.year desc, p.month desc
   limit 1;
$$;

create or replace function public.calculate_reconciliation(p_period_id uuid)
returns public.reconciliation_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_common public.common_meter_readings;
  v_old public.reconciliation_records;
  v public.reconciliation_records;
  v_apartment_sum numeric;
  v_readings integer;
  v_active integer;
  v_missing integer;
  v_rate numeric;
begin
  perform public.require_admin();
  select * into v_common from public.common_meter_readings where billing_period_id = p_period_id;
  if v_common.id is null then
    perform public.user_error('Спочатку внесіть показники загального лічильника за цей період');
  end if;

  select * into v_old from public.reconciliation_records where billing_period_id = p_period_id for update;
  if v_old.status in ('adjustment_applied', 'closed') then
    perform public.user_error('Розбіжність за цей період уже використана або закрита — перерахунок неможливий');
  end if;

  select coalesce(sum(r.consumption_kwh), 0), count(*) into v_apartment_sum, v_readings
    from public.meter_readings r where r.billing_period_id = p_period_id;
  select count(*) into v_active from public.apartments where is_active;
  select count(*) into v_missing
    from public.apartments a
   where a.is_active
     and not exists (select 1 from public.meter_readings r
                     where r.apartment_id = a.id and r.billing_period_id = p_period_id);
  v_rate := public.get_applicable_tariff(p_period_id);

  insert into public.reconciliation_records (billing_period_id, common_consumption_kwh, apartment_consumption_kwh,
      discrepancy_kwh, tariff_rate, discrepancy_amount, readings_count, active_apartments_count,
      is_preliminary, status, created_by)
  values (p_period_id, v_common.consumption_kwh, v_apartment_sum, v_common.consumption_kwh - v_apartment_sum,
          v_rate, case when v_rate is null then null
                       else round((v_common.consumption_kwh - v_apartment_sum) * v_rate, 2) end,
          v_readings, v_active, v_missing > 0, 'calculated', auth.uid())
  on conflict (billing_period_id) do update
    set common_consumption_kwh = excluded.common_consumption_kwh,
        apartment_consumption_kwh = excluded.apartment_consumption_kwh,
        discrepancy_kwh = excluded.discrepancy_kwh,
        tariff_rate = excluded.tariff_rate,
        discrepancy_amount = excluded.discrepancy_amount,
        readings_count = excluded.readings_count,
        active_apartments_count = excluded.active_apartments_count,
        is_preliminary = excluded.is_preliminary,
        status = 'calculated',
        reviewed_at = null,
        reviewed_by = null,
        updated_at = now()
  returning * into v;

  perform public.write_audit('reconciliation.calculate', 'reconciliation', v.id, to_jsonb(v_old), to_jsonb(v), null);
  return v;
end;
$$;

create or replace function public.admin_upsert_common_reading(
  p_period_id uuid,
  p_current_reading numeric,
  p_previous_reading numeric default null,
  p_notes text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.common_meter_readings;
  v public.common_meter_readings;
  v_prev numeric;
  v_rec public.reconciliation_records;
begin
  perform public.require_admin();
  if not exists (select 1 from public.billing_periods where id = p_period_id) then
    perform public.user_error('Період не знайдено');
  end if;
  if p_current_reading is null or p_current_reading < 0 or p_current_reading <> round(p_current_reading, 2) then
    perform public.user_error('Поточний показник має бути невід''ємним числом');
  end if;
  select * into v_old from public.common_meter_readings where billing_period_id = p_period_id for update;
  if v_old.id is not null and nullif(btrim(p_reason), '') is null then
    perform public.user_error('Для виправлення показника загального лічильника вкажіть причину');
  end if;
  if exists (select 1 from public.reconciliation_records
             where billing_period_id = p_period_id and status in ('adjustment_applied', 'closed')) then
    perform public.user_error('Розбіжність за цей період уже використана або закрита — зміна показника неможлива');
  end if;

  v_prev := coalesce(p_previous_reading, v_old.previous_reading, public.get_previous_common_reading(p_period_id));
  if v_prev is null then
    perform public.user_error('Попередній показник загального лічильника не знайдено — вкажіть його');
  end if;
  if v_prev < 0 or v_prev <> round(v_prev, 2) then
    perform public.user_error('Попередній показник має бути невід''ємним числом');
  end if;
  if p_current_reading < v_prev then
    perform public.user_error('Поточний показник загального лічильника менший за попередній');
  end if;

  insert into public.common_meter_readings (billing_period_id, previous_reading, current_reading, entered_by, notes)
  values (p_period_id, v_prev, p_current_reading, auth.uid(), nullif(btrim(p_notes), ''))
  on conflict (billing_period_id) do update
    set previous_reading = excluded.previous_reading,
        current_reading = excluded.current_reading,
        entered_by = excluded.entered_by,
        notes = coalesce(excluded.notes, common_meter_readings.notes),
        updated_at = now()
  returning * into v;

  perform public.write_audit(case when v_old.id is null then 'common_reading.create' else 'common_reading.update' end,
                             'common_meter_reading', v.id, to_jsonb(v_old), to_jsonb(v), p_reason);

  v_rec := public.calculate_reconciliation(p_period_id);
  return jsonb_build_object('common_reading', to_jsonb(v), 'reconciliation', to_jsonb(v_rec));
end;
$$;

create or replace function public.admin_review_reconciliation(p_reconciliation_id uuid, p_explanation text)
returns public.reconciliation_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.reconciliation_records;
  v public.reconciliation_records;
begin
  perform public.require_admin();
  select * into v_old from public.reconciliation_records where id = p_reconciliation_id for update;
  if v_old.id is null then perform public.user_error('Запис розбіжності не знайдено'); end if;
  if v_old.status <> 'calculated' then
    perform public.user_error('Позначити перевіреною можна лише щойно розраховану розбіжність');
  end if;
  if (v_old.is_preliminary or v_old.discrepancy_kwh < 0) and nullif(btrim(p_explanation), '') is null then
    perform public.user_error('Дані неповні або розбіжність від''ємна — додайте пояснення перевірки');
  end if;
  update public.reconciliation_records
     set status = 'reviewed', reviewed_at = now(), reviewed_by = auth.uid(),
         explanation = coalesce(nullif(btrim(p_explanation), ''), explanation), updated_at = now()
   where id = p_reconciliation_id
  returning * into v;
  perform public.write_audit('reconciliation.review', 'reconciliation', v.id, to_jsonb(v_old), to_jsonb(v), p_explanation);
  return v;
end;
$$;

create or replace function public.admin_close_reconciliation(p_reconciliation_id uuid, p_explanation text)
returns public.reconciliation_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.reconciliation_records;
  v public.reconciliation_records;
begin
  perform public.require_admin();
  select * into v_old from public.reconciliation_records where id = p_reconciliation_id for update;
  if v_old.id is null then perform public.user_error('Запис розбіжності не знайдено'); end if;
  if v_old.status = 'closed' then return v_old; end if;
  if v_old.status = 'calculated' then
    perform public.user_error('Спочатку перевірте розбіжність');
  end if;
  update public.reconciliation_records
     set status = 'closed',
         explanation = coalesce(nullif(btrim(p_explanation), ''), explanation), updated_at = now()
   where id = p_reconciliation_id
  returning * into v;
  perform public.write_audit('reconciliation.close', 'reconciliation', v.id, to_jsonb(v_old), to_jsonb(v), p_explanation);
  return v;
end;
$$;

/*
  Використання депозиту для покриття перевіреної розбіжності.
  Лише ручне рішення адміністратора; автоматичного списання немає.
*/
create or replace function public.admin_apply_deposit_adjustment(
  p_reconciliation_id uuid,
  p_amount numeric,
  p_description text
)
returns public.deposit_ledger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rec public.reconciliation_records;
  v public.deposit_ledger;
  v_balance numeric;
begin
  perform public.require_admin();
  select * into v_rec from public.reconciliation_records where id = p_reconciliation_id for update;
  if v_rec.id is null then perform public.user_error('Запис розбіжності не знайдено'); end if;
  if v_rec.status not in ('reviewed', 'adjustment_applied') then
    perform public.user_error('Використати депозит можна лише після перевірки розбіжності адміністратором');
  end if;
  if v_rec.discrepancy_kwh <= 0 then
    perform public.user_error('Розбіжність не є додатною — списання депозиту не застосовується. Перевірте дані');
  end if;
  if p_amount is null or p_amount <= 0 or not public.is_money(p_amount) then
    perform public.user_error('Сума списання має бути додатною, з точністю до копійок');
  end if;
  if nullif(btrim(p_description), '') is null then
    perform public.user_error('Вкажіть підставу використання депозиту');
  end if;

  perform pg_advisory_xact_lock(hashtext('deposit_ledger'));
  v_balance := public.deposit_balance_internal();
  if p_amount > v_balance then
    perform public.user_error(format('Недостатньо коштів на депозиті. Поточний баланс: %s', public.fmt_money(v_balance)));
  end if;

  insert into public.deposit_ledger (billing_period_id, transaction_type, amount, description,
                                     related_reconciliation_id, created_by)
  values (v_rec.billing_period_id, 'discrepancy_adjustment', -p_amount, btrim(p_description), v_rec.id, auth.uid())
  returning * into v;

  update public.reconciliation_records set status = 'adjustment_applied', updated_at = now()
   where id = v_rec.id;

  perform public.write_audit('deposit.discrepancy_adjustment', 'deposit_ledger', v.id,
                             jsonb_build_object('balance', v_balance),
                             to_jsonb(v) || jsonb_build_object('balance', v_balance - p_amount),
                             p_description);
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Загальна таблиця за місяць (для всіх авторизованих).
-- Повертає лише дані загального обліку — без приватних полів платежу.
-- ---------------------------------------------------------------------
create or replace function public.get_period_table(p_period_id uuid)
returns table (
  apartment_id uuid,
  apartment_number text,
  resident_surname text,
  has_reading boolean,
  previous_reading numeric,
  current_reading numeric,
  consumption_kwh numeric,
  tariff_rate numeric,
  electricity_amount numeric,
  deposit_contribution numeric,
  hall_lighting_amount numeric,
  other_amount numeric,
  total_amount numeric,
  payment_id uuid,
  payment_status public.payment_status,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  receipt_count integer,
  is_own boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
begin
  v_profile := public.require_profile();
  return query
  select a.id, a.apartment_number, a.resident_surname,
         r.id is not null,
         r.previous_reading, r.current_reading, r.consumption_kwh, r.tariff_rate, r.electricity_amount,
         dc.amount, hl.amount, ot.amount,
         case when r.id is null then null
              else r.electricity_amount + coalesce(dc.amount, 0) + coalesce(hl.amount, 0) + coalesce(ot.amount, 0) end,
         pay.id,
         coalesce(pay.status, 'awaiting_payment'::public.payment_status),
         pay.submitted_at,
         case when pay.status = 'paid' then pay.reviewed_at end,
         (select count(*)::integer from public.receipts rc where rc.payment_id = pay.id),
         a.id = v_profile.apartment_id
    from public.apartments a
    left join public.meter_readings r on r.apartment_id = a.id and r.billing_period_id = p_period_id
    left join public.additional_charges dc on dc.apartment_id = a.id and dc.billing_period_id = p_period_id
                                          and dc.charge_type = 'deposit_contribution'
    left join public.additional_charges hl on hl.apartment_id = a.id and hl.billing_period_id = p_period_id
                                          and hl.charge_type = 'hall_lighting'
    left join public.additional_charges ot on ot.apartment_id = a.id and ot.billing_period_id = p_period_id
                                          and ot.charge_type = 'other'
    left join public.payments pay on pay.apartment_id = a.id and pay.billing_period_id = p_period_id
   where a.is_active or r.id is not null or pay.id is not null
   order by a.sort_num nulls last, a.apartment_number;
end;
$$;

-- ---------------------------------------------------------------------
-- Звіт за будинком за місяць (адміністратор)
-- ---------------------------------------------------------------------
create or replace function public.get_house_report(p_period_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_period public.billing_periods;
  v_common public.common_meter_readings;
  v_rec public.reconciliation_records;
  v_apartment_sum numeric;
  v_with integer;
  v_active integer;
  v_without integer;
  v_rate numeric;
  v_opening numeric;
  v_contrib numeric;
  v_usage numeric;
  v_corr numeric;
  v_refund numeric;
  v_closing numeric;
  v_charges jsonb;
  v_payments jsonb;
  v_disc numeric;
begin
  perform public.require_admin();
  select * into v_period from public.billing_periods where id = p_period_id;
  if v_period.id is null then perform public.user_error('Період не знайдено'); end if;
  select * into v_common from public.common_meter_readings where billing_period_id = p_period_id;
  select * into v_rec from public.reconciliation_records where billing_period_id = p_period_id;

  select coalesce(sum(consumption_kwh), 0), count(*) into v_apartment_sum, v_with
    from public.meter_readings where billing_period_id = p_period_id;
  select count(*) into v_active from public.apartments where is_active;
  select count(*) into v_without from public.apartments a
   where a.is_active and not exists (select 1 from public.meter_readings r
                                     where r.apartment_id = a.id and r.billing_period_id = p_period_id);
  v_rate := public.get_applicable_tariff(p_period_id);
  v_disc := case when v_common.id is null then null else v_common.consumption_kwh - v_apartment_sum end;

  select jsonb_build_object(
    'electricity', coalesce(sum(r.electricity_amount), 0),
    'deposit', coalesce((select sum(amount) from public.additional_charges
                          where billing_period_id = p_period_id and charge_type = 'deposit_contribution'), 0),
    'hall_lighting', coalesce((select sum(amount) from public.additional_charges
                               where billing_period_id = p_period_id and charge_type = 'hall_lighting'), 0),
    'other', coalesce((select sum(amount) from public.additional_charges
                       where billing_period_id = p_period_id and charge_type = 'other'), 0))
    into v_charges
    from public.meter_readings r where r.billing_period_id = p_period_id;

  select jsonb_build_object(
    'paid_count', count(*) filter (where status = 'paid'),
    'paid_total', coalesce(sum(total_amount) filter (where status = 'paid'), 0),
    'pending_count', count(*) filter (where status = 'pending_review'),
    'pending_total', coalesce(sum(total_amount) filter (where status = 'pending_review'), 0),
    'awaiting_count', count(*) filter (where status = 'awaiting_payment'),
    'awaiting_total', coalesce(sum(total_amount) filter (where status = 'awaiting_payment'), 0),
    'rejected_count', count(*) filter (where status = 'rejected'),
    'rejected_total', coalesce(sum(total_amount) filter (where status = 'rejected'), 0))
    into v_payments
    from public.payments where billing_period_id = p_period_id;

  select coalesce(sum(l.amount), 0) into v_opening
    from public.deposit_ledger l join public.billing_periods p on p.id = l.billing_period_id
   where (p.year, p.month) < (v_period.year, v_period.month);
  select coalesce(sum(amount) filter (where transaction_type = 'contribution'), 0),
         coalesce(sum(amount) filter (where transaction_type = 'discrepancy_adjustment'), 0),
         coalesce(sum(amount) filter (where transaction_type = 'correction'), 0),
         coalesce(sum(amount) filter (where transaction_type = 'refund'), 0)
    into v_contrib, v_usage, v_corr, v_refund
    from public.deposit_ledger where billing_period_id = p_period_id;
  v_closing := v_opening + v_contrib + v_usage + v_corr + v_refund;

  return jsonb_build_object(
    'period', to_jsonb(v_period) || jsonb_build_object('label', public.period_label(v_period.year, v_period.month)),
    'generated_at', now(),
    'common_consumption_kwh', v_common.consumption_kwh,
    'common_reading', to_jsonb(v_common),
    'apartment_consumption_kwh', v_apartment_sum,
    'apartments_with_readings', v_with,
    'apartments_without_readings', v_without,
    'active_apartments', v_active,
    'discrepancy_kwh', v_disc,
    'discrepancy_abs_kwh', abs(v_disc),
    'tariff_rate', v_rate,
    'discrepancy_amount', case when v_disc is null or v_rate is null then null else round(v_disc * v_rate, 2) end,
    'is_preliminary', v_without > 0 or v_common.id is null,
    'reconciliation', to_jsonb(v_rec),
    'charges', v_charges,
    'payments', v_payments,
    'deposit', jsonb_build_object(
      'opening_balance', v_opening,
      'contributions', v_contrib,
      'discrepancy_usage', v_usage,
      'corrections', v_corr,
      'refunds', v_refund,
      'closing_balance', v_closing,
      'current_balance', public.deposit_balance_internal()));
end;
$$;

-- Ключові показники адмін-панелі
create or replace function public.get_admin_overview(p_period_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_report jsonb;
begin
  v_report := public.get_house_report(p_period_id);
  return v_report || jsonb_build_object(
    'charges_total', (select coalesce(sum(r.electricity_amount), 0) from public.meter_readings r
                       where r.billing_period_id = p_period_id)
                     + (select coalesce(sum(amount), 0) from public.additional_charges
                         where billing_period_id = p_period_id),
    'pending_review_all', (select count(*) from public.payments where status = 'pending_review'));
end;
$$;

-- ---------------------------------------------------------------------
-- Квартири, коди реєстрації, користувачі (адміністратор)
-- ---------------------------------------------------------------------
create or replace function public.generate_code_text()
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_code text := '';
  i integer;
begin
  for i in 0..9 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  return substr(v_code, 1, 5) || '-' || substr(v_code, 6, 5);
end;
$$;

create or replace function public.normalize_code(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

create or replace function public.normalize_name(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select lower(regexp_replace(btrim(coalesce(p, '')), '[\s''’ʼ`-]+', '', 'g'));
$$;

create or replace function public.admin_upsert_apartment(
  p_id uuid,
  p_apartment_number text,
  p_resident_surname text,
  p_is_active boolean default true,
  p_initial_reading numeric default null,
  p_initial_reading_date date default null,
  p_reason text default null
)
returns public.apartments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.apartments;
  v public.apartments;
begin
  perform public.require_admin();
  if nullif(btrim(p_apartment_number), '') is null or nullif(btrim(p_resident_surname), '') is null then
    perform public.user_error('Вкажіть номер квартири і прізвище');
  end if;
  if p_initial_reading is not null and (p_initial_reading < 0 or p_initial_reading <> round(p_initial_reading, 2)) then
    perform public.user_error('Початковий показник має бути невід''ємним числом');
  end if;
  if exists (select 1 from public.apartments
             where lower(btrim(apartment_number)) = lower(btrim(p_apartment_number))
               and id is distinct from p_id) then
    perform public.user_error(format('Квартира №%s уже існує', btrim(p_apartment_number)));
  end if;

  if p_id is null then
    insert into public.apartments (apartment_number, resident_surname, is_active, initial_reading, initial_reading_date)
    values (btrim(p_apartment_number), btrim(p_resident_surname), coalesce(p_is_active, true),
            p_initial_reading, p_initial_reading_date)
    returning * into v;
    perform public.write_audit('apartment.create', 'apartment', v.id, null,
                               to_jsonb(v) - 'registration_code_hash', p_reason);
  else
    select * into v_old from public.apartments where id = p_id for update;
    if v_old.id is null then perform public.user_error('Квартиру не знайдено'); end if;
    update public.apartments
       set apartment_number = btrim(p_apartment_number),
           resident_surname = btrim(p_resident_surname),
           is_active = coalesce(p_is_active, is_active),
           initial_reading = p_initial_reading,
           initial_reading_date = p_initial_reading_date
     where id = p_id
    returning * into v;
    perform public.write_audit('apartment.update', 'apartment', v.id, to_jsonb(v_old) - 'registration_code_hash',
                               to_jsonb(v) - 'registration_code_hash', p_reason);
  end if;
  return v;
end;
$$;

-- Імпорт списку квартир: [{"apartment_number": "1", "resident_surname": "...", "initial_reading": 123}]
create or replace function public.admin_import_apartments(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r jsonb;
  v_created integer := 0;
  v_updated integer := 0;
  v_existing public.apartments;
  v_num text;
  v_surname text;
  v_initial numeric;
begin
  perform public.require_admin();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    perform public.user_error('Список квартир порожній');
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    perform public.user_error('Забагато рядків (максимум 2000)');
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_num := nullif(btrim(r->>'apartment_number'), '');
    v_surname := nullif(btrim(r->>'resident_surname'), '');
    v_initial := nullif(r->>'initial_reading', '')::numeric;
    if v_num is null or v_surname is null then
      perform public.user_error('Кожен рядок має містити номер квартири та прізвище');
    end if;
    if v_initial is not null and (v_initial < 0 or v_initial <> round(v_initial, 2)) then
      perform public.user_error(format('Некоректний початковий показник для квартири №%s', v_num));
    end if;
    select * into v_existing from public.apartments where lower(btrim(apartment_number)) = lower(v_num) for update;
    if v_existing.id is null then
      insert into public.apartments (apartment_number, resident_surname, initial_reading)
      values (v_num, v_surname, v_initial);
      v_created := v_created + 1;
    else
      update public.apartments
         set resident_surname = v_surname,
             initial_reading = coalesce(v_initial, initial_reading)
       where id = v_existing.id;
      v_updated := v_updated + 1;
    end if;
  end loop;
  perform public.write_audit('apartment.import', 'apartment', null, null,
                             jsonb_build_object('created', v_created, 'updated', v_updated, 'rows', jsonb_array_length(p_rows)), null);
  return jsonb_build_object('created', v_created, 'updated', v_updated);
end;
$$;

-- Згенерувати одноразовий код. Відкритий код повертається лише один раз.
create or replace function public.admin_generate_registration_code(p_apartment_id uuid, p_allow_additional boolean default false)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_apt public.apartments;
  v_code text;
  v_has_primary boolean;
begin
  perform public.require_admin();
  select * into v_apt from public.apartments where id = p_apartment_id for update;
  if v_apt.id is null then perform public.user_error('Квартиру не знайдено'); end if;
  if not v_apt.is_active then perform public.user_error('Квартира неактивна'); end if;
  select exists (select 1 from public.profiles where apartment_id = v_apt.id and is_primary and is_active)
    into v_has_primary;
  if v_has_primary and not coalesce(p_allow_additional, false) then
    perform public.user_error('Квартира вже має активний обліковий запис. Щоб дозволити додатковий акаунт, '
      || 'увімкніть відповідну опцію');
  end if;
  v_code := public.generate_code_text();
  update public.apartments
     set registration_code_hash = extensions.crypt(public.normalize_code(v_code), extensions.gen_salt('bf', 8)),
         registration_code_created_at = now(),
         registration_failed_attempts = 0,
         registration_locked_until = null,
         registration_status = case when v_has_primary then 'additional_allowed'::public.registration_status
                                    else 'not_registered'::public.registration_status end
   where id = v_apt.id;
  perform public.write_audit('apartment.code_generate', 'apartment', v_apt.id, null,
                             jsonb_build_object('additional', v_has_primary), null);
  return v_code;
end;
$$;

-- Масова генерація кодів для незареєстрованих квартир
create or replace function public.admin_generate_codes_bulk()
returns table (apartment_number text, resident_surname text, code text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  a public.apartments;
begin
  perform public.require_admin();
  for a in select * from public.apartments ap
            where ap.is_active
              and not exists (select 1 from public.profiles p where p.apartment_id = ap.id and p.is_primary and p.is_active)
            order by ap.sort_num nulls last, ap.apartment_number loop
    apartment_number := a.apartment_number;
    resident_surname := a.resident_surname;
    code := public.admin_generate_registration_code(a.id, false);
    return next;
  end loop;
end;
$$;

create or replace function public.admin_revoke_registration_code(p_apartment_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_admin();
  update public.apartments
     set registration_code_hash = null, registration_code_created_at = null,
         registration_status = case when registration_status = 'additional_allowed'
                                    then 'registered'::public.registration_status else registration_status end
   where id = p_apartment_id;
  perform public.write_audit('apartment.code_revoke', 'apartment', p_apartment_id, null, null, null);
end;
$$;

create or replace function public.admin_list_apartments()
returns table (
  id uuid,
  apartment_number text,
  resident_surname text,
  is_active boolean,
  registration_status public.registration_status,
  has_active_code boolean,
  code_created_at timestamptz,
  is_locked boolean,
  initial_reading numeric,
  initial_reading_date date,
  accounts_count integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_admin();
  return query
  select a.id, a.apartment_number, a.resident_surname, a.is_active, a.registration_status,
         a.registration_code_hash is not null, a.registration_code_created_at,
         coalesce(a.registration_locked_until > now(), false),
         a.initial_reading, a.initial_reading_date,
         (select count(*)::integer from public.profiles p where p.apartment_id = a.id and p.is_active)
    from public.apartments a
   order by a.sort_num nulls last, a.apartment_number;
end;
$$;

create or replace function public.admin_list_users()
returns table (
  profile_id uuid,
  auth_user_id uuid,
  email text,
  surname text,
  apartment_id uuid,
  apartment_number text,
  role public.app_role,
  is_primary boolean,
  is_active boolean,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  email_confirmed boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_admin();
  return query
  select p.id, p.auth_user_id, u.email::text, p.surname, p.apartment_id, a.apartment_number, p.role,
         p.is_primary, p.is_active, p.created_at, u.last_sign_in_at, u.email_confirmed_at is not null
    from public.profiles p
    join auth.users u on u.id = p.auth_user_id
    left join public.apartments a on a.id = p.apartment_id
   order by a.sort_num nulls last, a.apartment_number, p.created_at;
end;
$$;

create or replace function public.admin_set_profile_active(p_profile_id uuid, p_is_active boolean, p_reason text)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.profiles;
  v public.profiles;
begin
  perform public.require_admin();
  select * into v_old from public.profiles where id = p_profile_id for update;
  if v_old.id is null then perform public.user_error('Профіль не знайдено'); end if;
  if v_old.auth_user_id = auth.uid() and not p_is_active then
    perform public.user_error('Не можна деактивувати власний обліковий запис');
  end if;
  if v_old.role = 'admin' and not p_is_active
     and (select count(*) from public.profiles where role = 'admin' and is_active) <= 1 then
    perform public.user_error('Не можна деактивувати останнього адміністратора');
  end if;
  update public.profiles set is_active = p_is_active where id = p_profile_id returning * into v;
  if p_is_active is false and v_old.is_primary and v_old.apartment_id is not null then
    update public.apartments set registration_status = 'not_registered'
     where id = v_old.apartment_id
       and not exists (select 1 from public.profiles where apartment_id = v_old.apartment_id and is_primary and is_active);
  end if;
  perform public.write_audit(case when p_is_active then 'user.activate' else 'user.deactivate' end,
                             'profile', v.id, to_jsonb(v_old), to_jsonb(v), p_reason);
  return v;
end;
$$;

create or replace function public.admin_set_profile_role(p_profile_id uuid, p_role public.app_role, p_reason text)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.profiles;
  v public.profiles;
begin
  perform public.require_admin();
  if nullif(btrim(p_reason), '') is null then
    perform public.user_error('Вкажіть причину зміни ролі');
  end if;
  select * into v_old from public.profiles where id = p_profile_id for update;
  if v_old.id is null then perform public.user_error('Профіль не знайдено'); end if;
  if v_old.role = p_role then return v_old; end if;
  if v_old.role = 'admin' and (select count(*) from public.profiles where role = 'admin' and is_active) <= 1 then
    perform public.user_error('Не можна зняти роль з останнього адміністратора');
  end if;
  if p_role = 'resident' and v_old.apartment_id is null then
    perform public.user_error('Для ролі мешканця профіль має бути прив''язаний до квартири');
  end if;
  perform set_config('app.allow_role_change', 'on', true);
  update public.profiles set role = p_role where id = p_profile_id returning * into v;
  perform set_config('app.allow_role_change', 'off', true);
  perform public.write_audit('user.role_change', 'profile', v.id, to_jsonb(v_old), to_jsonb(v), p_reason);
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Самостійна реєстрація (викликається сервером із сервісною роллю)
-- ---------------------------------------------------------------------

-- Перевірка даних квартири. Повертає однакову загальну помилку для всіх
-- невдалих випадків, щоб не розкривати дані інших мешканців.
create or replace function public.registration_verify(p_apartment_number text, p_surname text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.app_settings;
  v_apt public.apartments;
  v_ok boolean := true;
begin
  select * into s from public.app_settings where id;
  if not s.registration_open then
    return jsonb_build_object('ok', false, 'reason', 'registration_closed');
  end if;

  select * into v_apt from public.apartments
   where lower(btrim(apartment_number)) = lower(btrim(p_apartment_number))
   for update;
  if v_apt.id is null or not v_apt.is_active then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_apt.registration_locked_until is not null and v_apt.registration_locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  if v_apt.registration_status = 'registered' then
    v_ok := false;
  end if;
  if public.normalize_name(v_apt.resident_surname) <> public.normalize_name(p_surname) then
    v_ok := false;
  end if;
  if s.registration_code_required or v_apt.registration_status = 'additional_allowed' then
    if v_apt.registration_code_hash is null
       or extensions.crypt(public.normalize_code(p_code), v_apt.registration_code_hash) <> v_apt.registration_code_hash then
      v_ok := false;
    end if;
  end if;

  if not v_ok then
    update public.apartments
       set registration_failed_attempts = registration_failed_attempts + 1,
           registration_locked_until = case when registration_failed_attempts + 1 >= s.registration_code_max_attempts
                                            then now() + make_interval(mins => s.registration_lockout_minutes)
                                            else registration_locked_until end
     where id = v_apt.id;
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  return jsonb_build_object('ok', true, 'apartment_id', v_apt.id);
end;
$$;

-- Завершення реєстрації: повторна перевірка під блокуванням, створення профілю,
-- одноразовий код погашається.
create or replace function public.registration_complete(
  p_auth_user_id uuid,
  p_apartment_id uuid,
  p_surname text,
  p_code text
)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.app_settings;
  v_apt public.apartments;
  v public.profiles;
  v_additional boolean;
begin
  select * into s from public.app_settings where id;
  select * into v_apt from public.apartments where id = p_apartment_id for update;
  if v_apt.id is null or not v_apt.is_active then
    perform public.user_error('Не вдалося підтвердити квартиру');
  end if;
  if v_apt.registration_status = 'registered' then
    perform public.user_error('Квартира вже має зареєстрований обліковий запис');
  end if;
  if public.normalize_name(v_apt.resident_surname) <> public.normalize_name(p_surname) then
    perform public.user_error('Не вдалося підтвердити квартиру');
  end if;
  v_additional := v_apt.registration_status = 'additional_allowed';
  if s.registration_code_required or v_additional then
    if v_apt.registration_code_hash is null
       or extensions.crypt(public.normalize_code(p_code), v_apt.registration_code_hash) <> v_apt.registration_code_hash then
      perform public.user_error('Не вдалося підтвердити квартиру');
    end if;
  end if;
  if not v_additional and exists (select 1 from public.profiles
                                  where apartment_id = v_apt.id and is_primary and is_active) then
    perform public.user_error('Квартира вже має зареєстрований обліковий запис');
  end if;
  if exists (select 1 from public.profiles where auth_user_id = p_auth_user_id) then
    perform public.user_error('Цей користувач уже має профіль');
  end if;

  insert into public.profiles (auth_user_id, apartment_id, surname, role, is_primary)
  values (p_auth_user_id, v_apt.id, btrim(p_surname), 'resident', not v_additional)
  returning * into v;

  update public.apartments
     set registration_status = 'registered',
         registration_code_hash = null,
         registration_failed_attempts = 0,
         registration_locked_until = null
   where id = v_apt.id;

  insert into public.audit_logs (actor_user_id, actor_role, action_type, entity_type, entity_id, new_values)
  values (p_auth_user_id, 'resident', 'user.register', 'profile', v.id,
          jsonb_build_object('apartment_id', v_apt.id, 'is_primary', not v_additional));
  return v;
end;
$$;

-- Початкове створення адміністратора (лише сервісна роль / SQL-консоль)
create or replace function public.bootstrap_admin(p_auth_user_id uuid, p_surname text)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.profiles;
begin
  perform set_config('app.allow_role_change', 'on', true);
  insert into public.profiles (auth_user_id, apartment_id, surname, role, is_primary)
  values (p_auth_user_id, null, coalesce(nullif(btrim(p_surname), ''), 'Адміністратор'), 'admin', false)
  on conflict (auth_user_id) do update set role = 'admin', is_active = true
  returning * into v;
  perform set_config('app.allow_role_change', 'off', true);
  insert into public.audit_logs (actor_user_id, actor_role, action_type, entity_type, entity_id, new_values)
  values (null, 'system', 'user.bootstrap_admin', 'profile', v.id, to_jsonb(v));
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Налаштування
-- ---------------------------------------------------------------------
create or replace function public.admin_update_settings(p_settings jsonb, p_reason text default null)
returns public.app_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.app_settings;
  v public.app_settings;
  v_allowed text[] := array[
    'envelope_url', 'max_receipt_size_mb', 'allowed_receipt_mime_types', 'show_deposit_balance_to_residents',
    'other_charges_enabled', 'max_contribution_amount', 'registration_open', 'registration_code_required',
    'registration_code_max_attempts', 'registration_lockout_minutes', 'default_window_start_day',
    'default_window_start_hour', 'default_window_end_day', 'default_window_end_hour',
    'window_for_previous_month', 'admin_edit_after_close', 'anomaly_threshold_kwh', 'anomaly_multiplier',
    'deposit_public_note'];
  k text;
begin
  perform public.require_admin();
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    perform public.user_error('Некоректні налаштування');
  end if;
  for k in select jsonb_object_keys(p_settings) loop
    if not (k = any (v_allowed)) then
      perform public.user_error(format('Невідомий параметр: %s', k));
    end if;
  end loop;
  select * into v_old from public.app_settings where id for update;

  update public.app_settings s
     set envelope_url = case when p_settings ? 'envelope_url' then nullif(btrim(p_settings->>'envelope_url'), '') else s.envelope_url end,
         max_receipt_size_mb = coalesce((p_settings->>'max_receipt_size_mb')::integer, s.max_receipt_size_mb),
         allowed_receipt_mime_types = coalesce(
           (select array_agg(x) from jsonb_array_elements_text(p_settings->'allowed_receipt_mime_types') x),
           s.allowed_receipt_mime_types),
         show_deposit_balance_to_residents = coalesce((p_settings->>'show_deposit_balance_to_residents')::boolean, s.show_deposit_balance_to_residents),
         other_charges_enabled = coalesce((p_settings->>'other_charges_enabled')::boolean, s.other_charges_enabled),
         max_contribution_amount = coalesce((p_settings->>'max_contribution_amount')::numeric, s.max_contribution_amount),
         registration_open = coalesce((p_settings->>'registration_open')::boolean, s.registration_open),
         registration_code_required = coalesce((p_settings->>'registration_code_required')::boolean, s.registration_code_required),
         registration_code_max_attempts = coalesce((p_settings->>'registration_code_max_attempts')::integer, s.registration_code_max_attempts),
         registration_lockout_minutes = coalesce((p_settings->>'registration_lockout_minutes')::integer, s.registration_lockout_minutes),
         default_window_start_day = coalesce((p_settings->>'default_window_start_day')::integer, s.default_window_start_day),
         default_window_start_hour = coalesce((p_settings->>'default_window_start_hour')::integer, s.default_window_start_hour),
         default_window_end_day = coalesce((p_settings->>'default_window_end_day')::integer, s.default_window_end_day),
         default_window_end_hour = coalesce((p_settings->>'default_window_end_hour')::integer, s.default_window_end_hour),
         window_for_previous_month = coalesce((p_settings->>'window_for_previous_month')::boolean, s.window_for_previous_month),
         admin_edit_after_close = coalesce((p_settings->>'admin_edit_after_close')::boolean, s.admin_edit_after_close),
         anomaly_threshold_kwh = case when p_settings ? 'anomaly_threshold_kwh'
                                      then nullif(p_settings->>'anomaly_threshold_kwh', '')::numeric else s.anomaly_threshold_kwh end,
         anomaly_multiplier = case when p_settings ? 'anomaly_multiplier'
                                   then nullif(p_settings->>'anomaly_multiplier', '')::numeric else s.anomaly_multiplier end,
         deposit_public_note = case when p_settings ? 'deposit_public_note'
                                    then nullif(btrim(p_settings->>'deposit_public_note'), '') else s.deposit_public_note end,
         updated_by = auth.uid()
   where s.id
  returning * into v;

  perform public.write_audit('settings.update', 'app_settings', null, to_jsonb(v_old), to_jsonb(v), p_reason);
  return v;
exception
  when check_violation then
    perform public.user_error('Одне з налаштувань має неприпустиме значення');
    return null;
  when invalid_text_representation then
    perform public.user_error('Одне з налаштувань має некоректний формат');
    return null;
end;
$$;
