-- =====================================================================
-- Під'їзд квартири (1, 2 або 3).
-- Мешканець вказує під'їзд своєї квартири на головній сторінці,
-- адміністратор може змінити його для будь-якої квартири.
-- Під'їзд показується в загальній таблиці місяця і доступний для фільтра.
-- =====================================================================

alter table public.apartments
  add column if not exists entrance smallint
  constraint apartments_entrance_range check (entrance between 1 and 3);

-- Права на таблицю квартир видано по стовпчиках — додаємо новий
grant select (entrance) on public.apartments to authenticated;

create or replace function public.set_apartment_entrance(p_apartment_id uuid, p_entrance integer)
returns public.apartments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.apartments;
  v public.apartments;
begin
  -- мешканець — лише своя квартира; адміністратор — будь-яка
  perform public.require_apartment_access(p_apartment_id);
  if p_entrance is not null and p_entrance not between 1 and 3 then
    perform public.user_error('Під''їзд має бути 1, 2 або 3');
  end if;
  select * into v_old from public.apartments where id = p_apartment_id for update;
  if v_old.id is null then
    perform public.user_error('Квартиру не знайдено');
  end if;
  if v_old.entrance is not distinct from p_entrance::smallint then
    return v_old;
  end if;
  update public.apartments set entrance = p_entrance::smallint where id = p_apartment_id
  returning * into v;
  perform public.write_audit('apartment.entrance_set', 'apartment', v.id,
    jsonb_build_object('entrance', v_old.entrance), jsonb_build_object('entrance', v.entrance), null);
  return v;
end;
$$;

-- Загальна таблиця місяця: додано стовпчик «під'їзд» (зміна набору стовпчиків потребує drop)
drop function if exists public.get_period_table(uuid);

create or replace function public.get_period_table(p_period_id uuid)
returns table (
  apartment_id uuid,
  apartment_number text,
  resident_surname text,
  entrance smallint,
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
  select a.id, a.apartment_number, a.resident_surname, a.entrance,
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

revoke execute on function public.set_apartment_entrance(uuid, integer) from public, anon;
revoke execute on function public.get_period_table(uuid) from public, anon;
grant execute on function public.set_apartment_entrance(uuid, integer) to authenticated, service_role;
grant execute on function public.get_period_table(uuid) to authenticated, service_role;
