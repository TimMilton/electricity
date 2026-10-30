-- =====================================================================
-- 1. Перше подання показника квартири.
--    Якщо в квартири ще немає жодного показника й початковий показник не
--    задано, мешканець вказує показник на початок обліку разом із поточним.
--    Поки вікно приймання відкрите, він може виправити обидва значення.
--    Далі попереднім показником автоматично стає поточний показник
--    попереднього місяця — вводити його знову не потрібно.
--
-- 2. Виправлення показника загального лічильника за минулі місяці.
--    Адміністратор може одразу узгодити початковий показник наступного
--    місяця з новим значенням (p_update_next); розбіжність наступного
--    місяця тоді теж перераховується.
-- =====================================================================

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
    if p_previous_reading is not null and p_previous_reading <> v_existing.previous_reading then
      if v_is_admin then
        v_prev := p_previous_reading;
      elsif not exists (select 1 from public.get_previous_reading(p_apartment_id, p_period_id)) then
        -- Перше подання квартири: мешканець може виправити показник на початок обліку, поки вікно відкрите
        v_prev := p_previous_reading;
        v_warnings := array_append(v_warnings, 'Показник на початок обліку змінено');
      else
        perform public.user_error('Попередній показник узято з попереднього місяця. '
          || 'Щоб змінити його, зверніться до адміністратора');
      end if;
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

drop function if exists public.admin_upsert_common_reading(uuid, numeric, numeric, text, text, boolean);

create or replace function public.admin_upsert_common_reading(
  p_period_id uuid,
  p_current_reading numeric,
  p_previous_reading numeric default null,
  p_notes text default null,
  p_reason text default null,
  p_acknowledge boolean default false,
  p_update_next boolean default false
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
  v_next_new public.common_meter_readings;
  v_next_rec public.reconciliation_records;
  v_next_used numeric := 0;
  v_next_label text;
  v_before public.common_meter_readings;
  v_before_label text;
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

  -- Наступний місяць з показником (для узгодження початкового значення)
  select c.* into v_next
    from public.common_meter_readings c
    join public.billing_periods p on p.id = c.billing_period_id
   where (p.year, p.month) > (v_period.year, v_period.month)
   order by p.year, p.month
   limit 1
   for update of c;
  if v_next.id is not null then
    select public.period_label(year, month) into v_next_label from public.billing_periods where id = v_next.billing_period_id;
    select * into v_next_rec from public.reconciliation_records where billing_period_id = v_next.billing_period_id;
    if v_next_rec.id is not null then
      v_next_used := public.reconciliation_deposit_used(v_next_rec.id);
    end if;
  end if;

  if not coalesce(p_acknowledge, false) then
    if v_used > 0 then
      raise exception 'За розбіжність цього місяця з депозиту вже використано %. Після виправлення розбіжність буде '
        'перераховано, а записи депозиту залишаться без змін — за потреби виправте їх коригуванням. Підтвердіть виправлення',
        public.fmt_money(v_used)
        using errcode = 'EO409';
    end if;
    if coalesce(p_update_next, false) and v_next.id is not null
       and v_next.previous_reading <> p_current_reading and v_next_used > 0 then
      raise exception 'За розбіжність за % з депозиту вже використано %. Її буде перераховано, а записи депозиту '
        'залишаться без змін. Підтвердіть виправлення', lower(v_next_label), public.fmt_money(v_next_used)
        using errcode = 'EO409';
    end if;
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

  -- Наступний місяць починається з власного «попереднього» показника
  if v_next.id is not null and v_next.previous_reading <> v.current_reading then
    if coalesce(p_update_next, false) then
      if v_next.current_reading < v.current_reading then
        perform public.user_error(format(
          'Не вдалося оновити %s: його поточний показник (%s) менший за новий (%s). Спершу виправте %s',
          lower(v_next_label), v_next.current_reading, v.current_reading, lower(v_next_label)));
      end if;
      update public.common_meter_readings
         set previous_reading = v.current_reading, updated_at = now()
       where id = v_next.id
      returning * into v_next_new;
      perform public.write_audit('common_reading.update', 'common_meter_reading', v_next.id, to_jsonb(v_next), to_jsonb(v_next_new),
        format('Початковий показник узгоджено з виправленим показником за %s%s',
               lower(public.period_label(v_period.year, v_period.month)),
               coalesce(': ' || nullif(btrim(p_reason), ''), '')));
      if v_next_rec.id is not null then
        perform public.recalculate_reconciliation_internal(v_next.billing_period_id);
      end if;
      v_warnings := array_append(v_warnings, format(
        'Початковий показник за %s змінено з %s на %s, розбіжність за %s перераховано',
        lower(v_next_label), v_next.previous_reading, v.current_reading, lower(v_next_label)));
      if v_next_used > 0 then
        v_warnings := array_append(v_warnings, format(
          'З депозиту за %s уже використано %s. Перевірте, чи потрібне коригування депозиту',
          lower(v_next_label), public.fmt_money(v_next_used)));
      end if;
    else
      v_warnings := array_append(v_warnings, format(
        'Показник за %s починається з %s, а не з %s — за потреби виправте і його',
        lower(v_next_label), v_next.previous_reading, v.current_reading));
    end if;
  end if;

  -- Попередній місяць закінчується іншим значенням — лише попередження
  select c.* into v_before
    from public.common_meter_readings c
    join public.billing_periods p on p.id = c.billing_period_id
   where (p.year, p.month) < (v_period.year, v_period.month)
   order by p.year desc, p.month desc
   limit 1;
  if v_before.id is not null and v_before.current_reading <> v.previous_reading then
    select public.period_label(year, month) into v_before_label from public.billing_periods where id = v_before.billing_period_id;
    v_warnings := array_append(v_warnings, format(
      'Показник за %s закінчується на %s, а цей місяць починається з %s',
      lower(v_before_label), v_before.current_reading, v.previous_reading));
  end if;

  return jsonb_build_object('common_reading', to_jsonb(v), 'reconciliation', to_jsonb(v_rec), 'warnings', to_jsonb(v_warnings));
end;
$$;

revoke execute on function public.admin_upsert_common_reading(uuid, numeric, numeric, text, text, boolean, boolean) from public, anon;
grant execute on function public.admin_upsert_common_reading(uuid, numeric, numeric, text, text, boolean, boolean) to authenticated, service_role;
