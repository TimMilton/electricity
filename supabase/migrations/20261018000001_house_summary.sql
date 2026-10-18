-- =====================================================================
-- Зведення по будинку для кабінету мешканця:
--   показник загального лічильника, різниця з сумою квартирних показників,
--   розрахунок боргу в гривнях за загальним лічильником і стан депозиту.
--
-- Мешканці не мають прямого доступу до таблиць common_meter_readings і
-- reconciliation_records (RLS лише для адміністратора). Ця функція віддає
-- тільки агреговані дані будинку — без даних окремих квартир і без
-- внутрішніх пояснень адміністратора. Баланс депозиту показується, лише
-- якщо адміністратор увімкнув його публічне відображення.
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
begin
  v_profile := public.require_profile();
  select * into s from public.app_settings where id;
  v_public := v_profile.role = 'admin' or s.show_deposit_balance_to_residents;
  v_balance := case when v_public then public.deposit_balance_internal() end;

  if p_period_id is null then
    -- останній місяць, за який внесено показник загального лічильника
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
      -- Різниця в гривнях = рахунок за загальним лічильником − нараховано квартирам за електроенергію
      v_diff_amount := v_common_amount - v_apts_amount;
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
    -- чи вже враховано різницю цього місяця в депозиті (тоді баланс уже зменшено)
    'deposit_already_applied', coalesce(v_rec.status in ('adjustment_applied', 'closed'), false),
    'deposit_after', case
      when v_public and v_diff_amount is not null and v_diff_amount > 0
           and not coalesce(v_rec.status in ('adjustment_applied', 'closed'), false)
        then v_balance - v_diff_amount
      end);
end;
$$;

revoke execute on function public.get_house_summary(uuid) from public, anon;
grant execute on function public.get_house_summary(uuid) to authenticated, service_role;
