-- =====================================================================
-- Виправлення тарифу адміністратором (ставка й дата початку дії).
--
-- Тариф застосовується до місяця, якщо діє з 1 числа цього місяця або раніше.
-- Якщо тариф випадково встановлено з пізнішої дати (напр. «сьогодні»),
-- поточний місяць лишається без тарифу. Раніше такий тариф не можна було
-- ні видалити (дата вже настала), ні додати раніший — тепер його можна виправити.
--
-- Правила:
--   * обов'язкова причина, зміна записується в журнал;
--   * дата має лишатися між сусідніми тарифами; кінець дії попереднього
--     тарифу зсувається автоматично;
--   * уже збережені нарахування не перераховуються (у показнику зафіксовано
--     тариф на момент подання) — лише попередження з кількістю таких показників.
-- =====================================================================

create or replace function public.admin_update_tariff(
  p_tariff_id uuid,
  p_rate numeric,
  p_valid_from date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.tariffs;
  v public.tariffs;
  v_prev public.tariffs;
  v_next public.tariffs;
  v_from date;
  v_affected integer;
  v_warnings text[] := array[]::text[];
begin
  perform public.require_admin();
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) < 3 then
    perform public.user_error('Вкажіть причину зміни тарифу');
  end if;
  if p_rate is null or p_rate <= 0 or p_rate <> round(p_rate, 4) then
    perform public.user_error('Тариф має бути додатним числом (до 4 знаків після коми)');
  end if;
  if p_rate > 1000 then
    perform public.user_error('Тариф перевищує допустиме значення');
  end if;
  if p_valid_from is null then
    perform public.user_error('Вкажіть дату початку дії тарифу');
  end if;

  select * into v_old from public.tariffs where id = p_tariff_id for update;
  if v_old.id is null then
    perform public.user_error('Тариф не знайдено');
  end if;
  select * into v_prev from public.tariffs where valid_from < v_old.valid_from order by valid_from desc limit 1 for update;
  select * into v_next from public.tariffs where valid_from > v_old.valid_from order by valid_from limit 1;

  if v_prev.id is not null and p_valid_from <= v_prev.valid_from then
    perform public.user_error(format('Дата має бути пізніше за початок попереднього тарифу (%s)', to_char(v_prev.valid_from, 'DD.MM.YYYY')));
  end if;
  if v_next.id is not null and p_valid_from >= v_next.valid_from then
    perform public.user_error(format('Дата має бути раніше за початок наступного тарифу (%s)', to_char(v_next.valid_from, 'DD.MM.YYYY')));
  end if;

  -- Спершу звільняємо діапазон попереднього тарифу, щоб не порушити обмеження
  if v_prev.id is not null then
    update public.tariffs set valid_until = p_valid_from - 1 where id = v_prev.id;
  end if;
  update public.tariffs
     set rate_per_kwh = p_rate, valid_from = p_valid_from
   where id = v_old.id
  returning * into v;

  perform public.write_audit('tariff.update', 'tariff', v.id, to_jsonb(v_old), to_jsonb(v), p_reason);

  -- Уже збережені показники, тариф яких тепер відрізняється від чинного
  v_from := least(v_old.valid_from, p_valid_from);
  select count(*) into v_affected
    from public.meter_readings r
    join public.billing_periods p on p.id = r.billing_period_id
   where p.start_date >= v_from
     and r.tariff_rate is distinct from public.get_applicable_tariff(p.id);
  if v_affected > 0 then
    v_warnings := array_append(v_warnings, format(
      '%s збережен. показник(ів) розраховано за попереднім тарифом — їх не перераховано. За потреби виправте їх у розділі «Показники»',
      v_affected));
  end if;

  return jsonb_build_object('tariff', to_jsonb(v), 'warnings', to_jsonb(v_warnings));
end;
$$;

revoke execute on function public.admin_update_tariff(uuid, numeric, date, text) from public, anon;
grant execute on function public.admin_update_tariff(uuid, numeric, date, text) to authenticated, service_role;
