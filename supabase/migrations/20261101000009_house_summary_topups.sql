-- =====================================================================
-- Зведення «Будинок»: окремі внески в депозит за місяць.
--   topups_paid    — підтверджені окремі внески (уже в балансі депозиту)
--   topups_pending — окремі внески на перевірці
-- Лише оновлення функції зведення; дані не змінюються.
-- =====================================================================

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
  v_dep numeric;
  v_hall numeric;
  v_other numeric;
  v_paid_total numeric;
  v_paid_extras numeric;
  v_topups_paid numeric := 0;
  v_topups_pending numeric := 0;
  v_envelope text;
  v_hall_cover numeric;
  v_after_hall numeric;
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

  v_envelope := s.envelope_url;

  -- Періоду з показником загального лічильника ще немає — беремо поточний,
  -- щоб показати внески квартир і посилання на конверт
  if v_period.id is null and p_period_id is null then
    -- як get_current_period(), але без оновлення статусів (функція лише читає)
    select * into v_period from public.billing_periods
     where status <> 'closed' and now() >= reading_window_start and now() < reading_window_end
     order by year, month limit 1;
    if v_period.id is null then
      select * into v_period from public.billing_periods order by year desc, month desc limit 1;
    end if;
  end if;

  if v_period.id is null then
    return jsonb_build_object(
      'period', null,
      'has_common', false,
      'deposit_public', v_public,
      'deposit_balance', v_balance,
      'envelope_url', v_envelope);
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
  select coalesce(sum(electricity_amount), 0),
         coalesce(sum(total_amount), 0),
         coalesce(sum(deposit_contribution + hall_lighting_amount + other_amount), 0)
    into v_paid_electricity, v_paid_total, v_paid_extras
    from public.payments where billing_period_id = v_period.id and status = 'paid';

  -- Внески поза електроенергією (депозит, освітлення під'їзду, інші) — за поданими показниками
  select coalesce(sum(amount) filter (where charge_type = 'deposit_contribution'), 0),
         coalesce(sum(amount) filter (where charge_type = 'hall_lighting'), 0),
         coalesce(sum(amount) filter (where charge_type = 'other'), 0)
    into v_dep, v_hall, v_other
    from public.additional_charges ac
   where ac.billing_period_id = v_period.id
     and exists (select 1 from public.meter_readings r
                  where r.apartment_id = ac.apartment_id and r.billing_period_id = v_period.id);

  -- Окремі внески в депозит, віднесені до цього місяця (таблиця може бути відсутня до міграції 0008)
  if to_regclass('public.deposit_topups') is not null then
    execute $q$select coalesce(sum(amount) filter (where status = 'paid'), 0),
                      coalesce(sum(amount) filter (where status = 'pending_review'), 0)
                 from public.deposit_topups where billing_period_id = $1$q$
      into v_topups_paid, v_topups_pending using v_period.id;
  end if;

  v_rate := public.get_applicable_tariff(v_period.id);

  if v_common.id is not null then
    v_disc := v_common.consumption_kwh - v_apts_kwh;
    if v_rate is not null then
      v_common_amount := round(v_common.consumption_kwh * v_rate, 2);
      v_diff_amount := v_common_amount - v_apts_amount;
      -- ще не покрита депозитом частина боргу
      -- Різницю спершу покривають внески за освітлення під'їзду (саме за нього й платимо
      -- через загальний лічильник), решту — депозит
      v_hall_cover := least(greatest(v_diff_amount, 0), v_hall);
      v_after_hall := v_diff_amount - v_hall;
      v_remaining := v_after_hall - v_used;
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
      end,
    'charged_deposit', v_dep,
    'charged_hall_lighting', v_hall,
    'hall_lighting_cover', v_hall_cover,
    'debt_after_hall_lighting', v_after_hall,
    'charged_other', v_other,
    'charged_extras', v_dep + v_hall + v_other,
    'charged_total', v_apts_amount + v_dep + v_hall + v_other,
    'paid_total', v_paid_total,
    'paid_extras', v_paid_extras,
    'topups_paid', v_topups_paid,
    'topups_pending', v_topups_pending,
    'envelope_url', v_envelope);
end;
$$;

grant execute on function public.get_house_summary(uuid) to authenticated, service_role;
