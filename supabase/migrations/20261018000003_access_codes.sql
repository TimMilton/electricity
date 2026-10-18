-- =====================================================================
-- Спрощений вхід мешканців: номер квартири + код доступу.
--
--   * Код доступу генерує адміністратор; він постійний і змінюється лише
--     адміністратором. Пошта мешканцю не потрібна, листи не надсилаються.
--   * Технічно код — це пароль облікового запису Supabase Auth квартири.
--     Сервер застосунку (сервісний ключ) створює або оновлює цей запис,
--     а функції нижче прив'язують його до квартири та знаходять для входу.
--   * Самостійна реєстрація більше не використовується.
-- =====================================================================

-- Прив'язати обліковий запис Auth до квартири після встановлення коду.
-- Викликає сервер застосунку від імені адміністратора (автор дії — адміністратор).
create or replace function public.admin_register_access_code(p_apartment_id uuid, p_auth_user_id uuid)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_apt public.apartments;
  v_existing public.profiles;
  v_other public.profiles;
  v public.profiles;
  v_created boolean := false;
begin
  perform public.require_admin();
  select * into v_apt from public.apartments where id = p_apartment_id for update;
  if v_apt.id is null then perform public.user_error('Квартиру не знайдено'); end if;
  if not v_apt.is_active then perform public.user_error('Квартира неактивна'); end if;
  if not exists (select 1 from auth.users where id = p_auth_user_id) then
    perform public.user_error('Обліковий запис не знайдено');
  end if;

  select * into v_existing from public.profiles
   where apartment_id = v_apt.id and is_primary and is_active
   limit 1;

  if v_existing.id is not null then
    if v_existing.auth_user_id <> p_auth_user_id then
      perform public.user_error('Квартира вже має інший обліковий запис');
    end if;
    v := v_existing;
  else
    select * into v_other from public.profiles where auth_user_id = p_auth_user_id;
    if v_other.id is not null then
      if v_other.apartment_id is distinct from v_apt.id or v_other.role <> 'resident' then
        perform public.user_error('Цей обліковий запис уже прив''язаний до іншої квартири або є адміністраторським');
      end if;
      -- раніше деактивований запис цієї ж квартири — відновлюємо
      update public.profiles set is_active = true, is_primary = true where id = v_other.id returning * into v;
    else
      insert into public.profiles (auth_user_id, apartment_id, surname, role, is_primary)
      values (p_auth_user_id, v_apt.id, v_apt.resident_surname, 'resident', true)
      returning * into v;
      v_created := true;
    end if;
  end if;

  update public.apartments
     set registration_status = 'registered',
         registration_code_hash = null,
         registration_code_created_at = now(),
         registration_failed_attempts = 0,
         registration_locked_until = null
   where id = v_apt.id;

  -- сам код у журнал не потрапляє
  perform public.write_audit('apartment.access_code_set', 'apartment', v_apt.id, null,
                             jsonb_build_object('apartment_number', v_apt.apartment_number,
                                                'profile_id', v.id, 'account_created', v_created), null);
  return v;
end;
$$;

-- Знайти пошту облікового запису квартири для входу за номером квартири.
-- Лише для сервера (сервісний ключ). Повертає null, якщо квартира не має активного доступу.
create or replace function public.system_login_email_for_apartment(p_apartment_number text)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.email::text
    from public.apartments a
    join public.profiles p on p.apartment_id = a.id and p.is_primary and p.is_active and p.role = 'resident'
    join auth.users u on u.id = p.auth_user_id
   where a.is_active
     and lower(btrim(a.apartment_number)) = lower(btrim(p_apartment_number))
   limit 1;
$$;

-- Обліковий запис Auth основного мешканця квартири (для адміністратора: створити чи оновити)
create or replace function public.admin_apartment_account(p_apartment_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v uuid;
begin
  perform public.require_admin();
  select auth_user_id into v from public.profiles
   where apartment_id = p_apartment_id and is_primary and role = 'resident'
   order by is_active desc, created_at
   limit 1;
  return v;
end;
$$;

revoke execute on function public.admin_register_access_code(uuid, uuid) from public, anon;
revoke execute on function public.admin_apartment_account(uuid) from public, anon;
revoke execute on function public.system_login_email_for_apartment(text) from public, anon, authenticated;
grant execute on function public.admin_register_access_code(uuid, uuid), public.admin_apartment_account(uuid)
  to authenticated, service_role;
grant execute on function public.system_login_email_for_apartment(text) to service_role;
