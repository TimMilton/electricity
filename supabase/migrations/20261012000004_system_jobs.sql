-- =====================================================================
-- Системні задачі (виконуються за розкладом сервером із сервісною роллю)
-- =====================================================================

-- Автоматичне створення періоду поточного місяця за типовими налаштуваннями,
-- якщо адміністратор його ще не створив, та оновлення статусів періодів.
create or replace function public.system_ensure_current_period()
returns public.billing_periods
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.app_settings;
  v_today date := (now() at time zone 'Europe/Kyiv')::date;
  v_target date;
  v public.billing_periods;
  d record;
begin
  select * into s from public.app_settings where id;
  v_target := date_trunc('month', v_today)::date;
  if s.window_for_previous_month then
    v_target := (v_target - interval '1 month')::date;
  end if;

  select * into v from public.billing_periods
   where year = extract(year from v_target)::int and month = extract(month from v_target)::int;

  if v.id is null then
    select * into d from public.default_window_for(extract(year from v_target)::int, extract(month from v_target)::int);
    insert into public.billing_periods (year, month, start_date, end_date, reading_window_start, reading_window_end,
                                       allow_admin_edit_after_close)
    values (extract(year from v_target)::int, extract(month from v_target)::int, v_target,
            (v_target + interval '1 month - 1 day')::date, d.window_start, d.window_end, s.admin_edit_after_close)
    returning * into v;
    insert into public.audit_logs (actor_user_id, actor_role, action_type, entity_type, entity_id, new_values, reason)
    values (null, 'system', 'period.create', 'billing_period', v.id, to_jsonb(v), 'Автоматичне створення за розкладом');
  end if;

  perform public.sync_period_statuses();
  select * into v from public.billing_periods where id = v.id;
  return v;
end;
$$;

revoke execute on function public.system_ensure_current_period() from public, anon, authenticated;
grant execute on function public.system_ensure_current_period() to service_role;
