-- =====================================================================
-- Видалення будь-якого тарифу адміністратором (не лише майбутнього).
--
--   * причина обов'язкова, видалений тариф зберігається в журналі змін;
--   * попередній тариф автоматично продовжується до початку наступного
--     (або стає чинним, якщо видалено останній);
--   * збережені нарахування не змінюються: у показнику зафіксовано тариф на
--     момент подання — повертається попередження з кількістю таких показників.
-- =====================================================================

create or replace function public.admin_delete_tariff(p_tariff_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.tariffs;
  v_prev public.tariffs;
  v_next public.tariffs;
  v_affected integer;
  v_warnings text[] := array[]::text[];
begin
  perform public.require_admin();
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) < 3 then
    perform public.user_error('Вкажіть причину видалення тарифу');
  end if;
  select * into v from public.tariffs where id = p_tariff_id for update;
  if v.id is null then
    perform public.user_error('Тариф не знайдено');
  end if;
  select * into v_prev from public.tariffs where valid_from < v.valid_from order by valid_from desc limit 1 for update;
  select * into v_next from public.tariffs where valid_from > v.valid_from order by valid_from limit 1;

  delete from public.tariffs where id = v.id;
  if v_prev.id is not null then
    update public.tariffs
       set valid_until = case when v_next.id is null then null else v_next.valid_from - 1 end
     where id = v_prev.id;
  end if;
  perform public.write_audit('tariff.delete', 'tariff', v.id, to_jsonb(v), null, p_reason);

  if not exists (select 1 from public.tariffs) then
    v_warnings := array_append(v_warnings, 'Тарифів не залишилося — розрахунок неможливий, доки ви не встановите новий');
  end if;
  select count(*) into v_affected
    from public.meter_readings r
    join public.billing_periods p on p.id = r.billing_period_id
   where p.start_date >= v.valid_from
     and r.tariff_rate is distinct from public.get_applicable_tariff(p.id);
  if v_affected > 0 then
    v_warnings := array_append(v_warnings, format(
      '%s збережен. показник(ів) розраховано за видаленим тарифом — їх не перераховано. За потреби виправте їх у розділі «Показники»',
      v_affected));
  end if;
  return jsonb_build_object('warnings', to_jsonb(v_warnings));
end;
$$;

revoke execute on function public.admin_delete_tariff(uuid, text) from public, anon;
grant execute on function public.admin_delete_tariff(uuid, text) to authenticated, service_role;
