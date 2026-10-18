-- =====================================================================
-- Редагування та видалення показника загального лічильника адміністратором.
--
-- Правила:
--   * виправити можна завжди, навіть після закриття розбіжності — з причиною;
--     розбіжність перераховується і знову чекає на перевірку;
--   * якщо за розбіжність цього місяця вже списано кошти з депозиту,
--     виправлення потребує явного підтвердження (EO409), а записи депозиту
--     не змінюються (журнал незмінний — різницю виправляють коригуванням);
--   * видалити можна, лише якщо з депозиту за цю розбіжність нічого не списано;
--   * усе записується в журнал змін із попередніми значеннями.
-- =====================================================================

-- Сума, використана з депозиту на покриття розбіжності (додатне число)
create or replace function public.reconciliation_deposit_used(p_reconciliation_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(-sum(amount), 0)
    from public.deposit_ledger
   where related_reconciliation_id = p_reconciliation_id;
$$;

-- Перерахунок розбіжності без перевірки статусу (лише для внутрішнього використання)
create or replace function public.recalculate_reconciliation_internal(p_period_id uuid)
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
  select * into v_common from public.common_meter_readings where billing_period_id = p_period_id;
  if v_common.id is null then
    perform public.user_error('Спочатку внесіть показники загального лічильника за цей період');
  end if;
  select * into v_old from public.reconciliation_records where billing_period_id = p_period_id for update;

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

-- Ручний перерахунок (кнопка «Перерахувати») — як і раніше, лише для нерозглянутої розбіжності
create or replace function public.calculate_reconciliation(p_period_id uuid)
returns public.reconciliation_records
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.reconciliation_records;
begin
  perform public.require_admin();
  select * into v_old from public.reconciliation_records where billing_period_id = p_period_id;
  if v_old.status in ('adjustment_applied', 'closed') then
    perform public.user_error('Розбіжність за цей період уже використана або закрита. '
      || 'Щоб перерахувати її, виправте показник загального лічильника');
  end if;
  return public.recalculate_reconciliation_internal(p_period_id);
end;
$$;

-- Нова версія збереження показника (з підтвердженням, коли депозит уже використано)
drop function if exists public.admin_upsert_common_reading(uuid, numeric, numeric, text, text);

create or replace function public.admin_upsert_common_reading(
  p_period_id uuid,
  p_current_reading numeric,
  p_previous_reading numeric default null,
  p_notes text default null,
  p_reason text default null,
  p_acknowledge boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period public.billing_periods;
  v_old public.common_meter_readings;
  v public.common_meter_readings;
  v_prev numeric;
  v_old_rec public.reconciliation_records;
  v_rec public.reconciliation_records;
  v_used numeric := 0;
  v_next public.common_meter_readings;
  v_next_label text;
  v_warnings text[] := array[]::text[];
begin
  perform public.require_admin();
  select * into v_period from public.billing_periods where id = p_period_id;
  if v_period.id is null then
    perform public.user_error('Період не знайдено');
  end if;
  if p_current_reading is null or p_current_reading < 0 or p_current_reading <> round(p_current_reading, 2) then
    perform public.user_error('Поточний показник має бути невід''ємним числом');
  end if;
  select * into v_old from public.common_meter_readings where billing_period_id = p_period_id for update;
  if v_old.id is not null and nullif(btrim(p_reason), '') is null then
    perform public.user_error('Для виправлення показника загального лічильника вкажіть причину');
  end if;

  select * into v_old_rec from public.reconciliation_records where billing_period_id = p_period_id;
  if v_old_rec.id is not null then
    v_used := public.reconciliation_deposit_used(v_old_rec.id);
  end if;
  if v_used > 0 and not coalesce(p_acknowledge, false) then
    raise exception 'За розбіжність цього місяця з депозиту вже використано %. Після виправлення розбіжність буде '
      'перераховано, а записи депозиту залишаться без змін — за потреби виправте їх коригуванням. Підтвердіть виправлення',
      public.fmt_money(v_used)
      using errcode = 'EO409';
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

  v_rec := public.recalculate_reconciliation_internal(p_period_id);

  if v_old_rec.status in ('reviewed', 'adjustment_applied', 'closed') then
    v_warnings := array_append(v_warnings, 'Розбіжність перераховано — її потрібно перевірити повторно');
  end if;
  if v_used > 0 then
    v_warnings := array_append(v_warnings, format(
      'З депозиту за цей місяць уже використано %s. Перевірте, чи потрібне коригування депозиту', public.fmt_money(v_used)));
  end if;

  -- Наступний місяць починається з власного «попереднього» показника — попередити про розрив
  select c.* into v_next
    from public.common_meter_readings c
    join public.billing_periods p on p.id = c.billing_period_id
   where (p.year, p.month) > (v_period.year, v_period.month)
   order by p.year, p.month
   limit 1;
  if v_next.id is not null and v_next.previous_reading <> v.current_reading then
    select public.period_label(year, month) into v_next_label from public.billing_periods where id = v_next.billing_period_id;
    v_warnings := array_append(v_warnings, format(
      'Показник за %s починається з %s, а не з %s — за потреби виправте і його',
      lower(v_next_label), v_next.previous_reading, v.current_reading));
  end if;

  return jsonb_build_object('common_reading', to_jsonb(v), 'reconciliation', to_jsonb(v_rec), 'warnings', to_jsonb(v_warnings));
end;
$$;

-- Видалення показника загального лічильника разом із розрахунком розбіжності
create or replace function public.admin_delete_common_reading(p_period_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.common_meter_readings;
  v_rec public.reconciliation_records;
  v_used numeric;
begin
  perform public.require_admin();
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) < 3 then
    perform public.user_error('Вкажіть причину видалення');
  end if;
  select * into v_old from public.common_meter_readings where billing_period_id = p_period_id for update;
  if v_old.id is null then
    perform public.user_error('Показник загального лічильника за цей місяць не знайдено');
  end if;
  select * into v_rec from public.reconciliation_records where billing_period_id = p_period_id for update;
  if v_rec.id is not null then
    v_used := public.reconciliation_deposit_used(v_rec.id);
    if exists (select 1 from public.deposit_ledger where related_reconciliation_id = v_rec.id) then
      perform public.user_error(format(
        'Видалити неможливо: за розбіжність цього місяця з депозиту вже використано %s. '
        || 'Виправте показник замість видалення', public.fmt_money(v_used)));
    end if;
    delete from public.reconciliation_records where id = v_rec.id;
    perform public.write_audit('reconciliation.delete', 'reconciliation', v_rec.id, to_jsonb(v_rec), null, p_reason);
  end if;
  delete from public.common_meter_readings where id = v_old.id;
  perform public.write_audit('common_reading.delete', 'common_meter_reading', v_old.id, to_jsonb(v_old), null, p_reason);
end;
$$;

-- Зведення для мешканців: використання депозиту рахується за журналом, а не за статусом
create or replace function public.get_house_summary(p_period_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  s public.app_settings;
  v_period public.billing_periods;
  v_common public.common_meter_readings;
  v_rec public.reconciliation_records;
  v_public boolean;
  v_balance numeric;
  v_apts_kwh numeric;
  v_apts_amount numeric;
  v_with integer;
  v_active integer;
  v_missing integer;
  v_rate numeric;
  v_disc numeric;
  v_common_amount numeric;
  v_diff_amount numeric;
  v_paid_electricity numeric;
  v_used numeric := 0;
  v_remaining numeric;
begin
  v_profile := public.require_profile();
  select * into s from public.app_settings where id;
  v_public := v_profile.role = 'admin' or s.show_deposit_balance_to_residents;
  v_balance := case when v_public then public.deposit_balance_internal() end;

  if p_period_id is null then
    select p.* into v_period
      from public.billing_periods p
      join public.common_meter_readings c on c.billing_period_id = p.id
     order by p.year desc, p.month desc
     limit 1;
  else
    select * into v_period from public.billing_periods where id = p_period_id;
  end if;

  if v_period.id is null then
    return jsonb_build_object(
      'period', null,
      'has_common', false,
      'deposit_public', v_public,
      'deposit_balance', v_balance);
  end if;

  select * into v_common from public.common_meter_readings where billing_period_id = v_period.id;
  select * into v_rec from public.reconciliation_records where billing_period_id = v_period.id;
  if v_rec.id is not null then
    v_used := public.reconciliation_deposit_used(v_rec.id);
  end if;

  select coalesce(sum(consumption_kwh), 0), coalesce(sum(electricity_amount), 0), count(*)
    into v_apts_kwh, v_apts_amount, v_with
    from public.meter_readings where billing_period_id = v_period.id;
  select count(*) into v_active from public.apartments where is_active;
  select count(*) into v_missing
    from public.apartments a
   where a.is_active
     and not exists (select 1 from public.meter_readings r
                     where r.apartment_id = a.id and r.billing_period_id = v_period.id);
  select coalesce(sum(electricity_amount), 0) into v_paid_electricity
    from public.payments where billing_period_id = v_period.id and status = 'paid';

  v_rate := public.get_applicable_tariff(v_period.id);

  if v_common.id is not null then
    v_disc := v_common.consumption_kwh - v_apts_kwh;
    if v_rate is not null then
      v_common_amount := round(v_common.consumption_kwh * v_rate, 2);
      v_diff_amount := v_common_amount - v_apts_amount;
      -- ще не покрита депозитом частина боргу
      v_remaining := v_diff_amount - v_used;
    end if;
  end if;

  return jsonb_build_object(
    'period', jsonb_build_object(
      'id', v_period.id,
      'year', v_period.year,
      'month', v_period.month,
      'label', public.period_label(v_period.year, v_period.month)),
    'has_common', v_common.id is not null,
    'common_previous', v_common.previous_reading,
    'common_current', v_common.current_reading,
    'common_kwh', v_common.consumption_kwh,
    'common_updated_at', v_common.updated_at,
    'apartments_kwh', v_apts_kwh,
    'apartments_with_readings', v_with,
    'active_apartments', v_active,
    'apartments_missing', v_missing,
    'is_preliminary', v_missing > 0,
    'discrepancy_kwh', v_disc,
    'tariff_rate', v_rate,
    'common_amount', v_common_amount,
    'apartments_amount', v_apts_amount,
    'discrepancy_amount', v_diff_amount,
    'paid_electricity', v_paid_electricity,
    'reconciliation_status', v_rec.status,
    'deposit_public', v_public,
    'deposit_balance', v_balance,
    'deposit_used', case when v_public then v_used end,
    'deposit_already_applied', v_used > 0,
    'deposit_after', case
      when v_public and v_remaining is not null and v_remaining > 0 then v_balance - v_remaining
      end);
end;
$$;

-- Права
revoke execute on function public.reconciliation_deposit_used(uuid) from public, anon, authenticated;
revoke execute on function public.recalculate_reconciliation_internal(uuid) from public, anon, authenticated;
revoke execute on function public.admin_upsert_common_reading(uuid, numeric, numeric, text, text, boolean) from public, anon;
revoke execute on function public.admin_delete_common_reading(uuid, text) from public, anon;
grant execute on function public.admin_upsert_common_reading(uuid, numeric, numeric, text, text, boolean) to authenticated, service_role;
grant execute on function public.admin_delete_common_reading(uuid, text) to authenticated, service_role;
grant execute on function public.reconciliation_deposit_used(uuid), public.recalculate_reconciliation_internal(uuid) to service_role;
grant execute on function public.get_house_summary(uuid) to authenticated, service_role;
