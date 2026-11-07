-- =====================================================================
-- Прізвище та ім'я мешканця — необов'язкові; мешканець змінює їх сам.
--
--   * apartments.resident_surname і profiles.surname можуть бути порожніми
--     (NULL): квартира визначається номером.
--   * resident_set_my_name() — мешканець сам вказує, змінює або видаляє
--     прізвище та ім'я своєї квартири (номер квартири змінює лише адміністратор).
--   * Видалення персональних даних тепер очищає ім'я (NULL), під'їзд —
--     це дані квартири, не персональні, тож лишається.
--   * Нова редакція згоди (2026-11-07-2): усі надають згоду повторно.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Необов'язкове ім'я
-- ---------------------------------------------------------------------
alter table public.apartments drop constraint if exists apartments_resident_surname_check;
alter table public.apartments alter column resident_surname drop not null;
alter table public.apartments add constraint apartments_resident_surname_check
  check (resident_surname is null or (btrim(resident_surname) <> '' and length(resident_surname) <= 100));

alter table public.profiles drop constraint if exists profiles_surname_check;
alter table public.profiles alter column surname drop not null;
alter table public.profiles add constraint profiles_surname_check
  check (surname is null or (btrim(surname) <> '' and length(surname) <= 100));

-- Квартири, дані яких уже видалено, — просто без імені
update public.apartments set resident_surname = null where resident_surname = 'Дані видалено';
update public.profiles set surname = null where surname = 'Дані видалено' and role = 'resident';

-- ---------------------------------------------------------------------
-- Адміністратор: квартира з необов'язковим ім'ям
-- ---------------------------------------------------------------------
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
  v_name text := nullif(btrim(p_resident_surname), '');
begin
  perform public.require_admin();
  if nullif(btrim(p_apartment_number), '') is null then
    perform public.user_error('Вкажіть номер квартири');
  end if;
  if v_name is not null and length(v_name) > 100 then
    perform public.user_error('Прізвище та ім''я — не більше 100 символів');
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
    values (btrim(p_apartment_number), v_name, coalesce(p_is_active, true),
            p_initial_reading, p_initial_reading_date)
    returning * into v;
    perform public.write_audit('apartment.create', 'apartment', v.id, null,
                               to_jsonb(v) - 'registration_code_hash', p_reason);
  else
    select * into v_old from public.apartments where id = p_id for update;
    if v_old.id is null then perform public.user_error('Квартиру не знайдено'); end if;
    update public.apartments
       set apartment_number = btrim(p_apartment_number),
           resident_surname = v_name,
           is_active = coalesce(p_is_active, is_active),
           initial_reading = p_initial_reading,
           initial_reading_date = p_initial_reading_date
     where id = p_id
    returning * into v;
    if v_old.resident_surname is distinct from v_name then
      update public.profiles set surname = v_name where apartment_id = v.id and role = 'resident';
    end if;
    perform public.write_audit('apartment.update', 'apartment', v.id, to_jsonb(v_old) - 'registration_code_hash',
                               to_jsonb(v) - 'registration_code_hash', p_reason);
  end if;
  return v;
end;
$$;

-- Імпорт: порожнє ім'я в рядку не стирає вже вказане
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
    if v_num is null then
      perform public.user_error('Кожен рядок має містити номер квартири');
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
         set resident_surname = coalesce(v_surname, resident_surname),
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

-- ---------------------------------------------------------------------
-- Мешканець сам змінює прізвище та ім'я своєї квартири (порожнє — видалити)
-- ---------------------------------------------------------------------
create or replace function public.resident_set_my_name(p_name text)
returns public.apartments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_old public.apartments;
  v public.apartments;
  v_name text := nullif(regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g'), '');
begin
  v_profile := public.require_profile();
  if v_profile.role <> 'resident' or v_profile.apartment_id is null then
    perform public.user_error('Змінити ім''я квартири може лише її мешканець');
  end if;
  if v_name is not null and length(v_name) > 100 then
    perform public.user_error('Прізвище та ім''я — не більше 100 символів');
  end if;
  select * into v_old from public.apartments where id = v_profile.apartment_id for update;
  if v_old.id is null then perform public.user_error('Квартиру не знайдено'); end if;
  if v_old.resident_surname is not distinct from v_name then
    return v_old;
  end if;
  update public.apartments set resident_surname = v_name where id = v_old.id returning * into v;
  update public.profiles set surname = v_name where apartment_id = v_old.id and role = 'resident';
  perform public.write_audit('apartment.name_set', 'apartment', v.id,
                             jsonb_build_object('resident_surname', v_old.resident_surname),
                             jsonb_build_object('resident_surname', v.resident_surname),
                             'Змінено мешканцем');
  return v;
end;
$$;

-- ---------------------------------------------------------------------
-- Видалення персональних даних: ім'я -> NULL, під'їзд лишається
-- ---------------------------------------------------------------------
create or replace function public.pd_erase_apartment(p_apartment_id uuid, p_mode text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_apt public.apartments;
  v_values text[];
  v_profiles int := 0;
  v_audit int := 0;
  r record;
begin
  select * into v_apt from public.apartments where id = p_apartment_id for update;
  if v_apt.id is null then perform public.user_error('Квартиру не знайдено'); end if;

  -- усі імена квартири: поточні та колишні (з журналу змін)
  select array_agg(distinct lower(btrim(s)))
    into v_values
    from (
      select v_apt.resident_surname as s
      union all
      select p.surname from public.profiles p where p.apartment_id = v_apt.id and p.role = 'resident'
      union all
      select x.value #>> '{}'
        from public.audit_logs a
        cross join lateral (
          select a.previous_values -> 'resident_surname' as value
          union all select a.new_values -> 'resident_surname'
        ) x
       where a.entity_type = 'apartment' and a.entity_id = v_apt.id
         and jsonb_typeof(x.value) = 'string'
    ) n
   where s is not null and btrim(s) <> '' and lower(btrim(s)) <> lower(public.pd_erased_label());

  p_note := public.pd_redact_text(p_note, v_values);

  for r in
    select p.* from public.profiles p where p.apartment_id = v_apt.id and p.role = 'resident'
  loop
    insert into public.personal_data_consents
      (auth_user_id, profile_id, apartment_id, apartment_number, role, event, consent_version, initiated_by, note)
    values
      (r.auth_user_id, r.id, v_apt.id, v_apt.apartment_number, r.role, 'withdrawn', public.consent_current_version(),
       auth.uid(), case when p_mode = 'self' then 'Відкликано мешканцем у застосунку'
                        else 'Видалено адміністратором: ' || coalesce(p_note, '') end);
  end loop;

  update public.profiles
     set surname = null, is_active = false
   where apartment_id = v_apt.id and role = 'resident';
  get diagnostics v_profiles = row_count;

  update public.apartments
     set resident_surname = null,
         registration_status = 'not_registered'
   where id = v_apt.id;

  if v_values is not null and cardinality(v_values) > 0 then
    perform set_config('app.pd_erasure', 'on', true);
    update public.audit_logs a
       set previous_values = public.pd_redact_jsonb(a.previous_values, v_values),
           new_values = public.pd_redact_jsonb(a.new_values, v_values),
           reason = public.pd_redact_text(a.reason, v_values)
     where exists (
       select 1 from unnest(v_values) val
        where lower(coalesce(a.previous_values::text, '')) like '%' || val || '%'
           or lower(coalesce(a.new_values::text, '')) like '%' || val || '%'
           or lower(coalesce(a.reason, '')) like '%' || val || '%'
     );
    get diagnostics v_audit = row_count;
    perform set_config('app.pd_erasure', 'off', true);
  end if;

  perform public.write_audit('personal_data.erase', 'apartment', v_apt.id, null,
                             jsonb_build_object('apartment_number', v_apt.apartment_number,
                                                'mode', p_mode,
                                                'accounts_deactivated', v_profiles,
                                                'audit_rows_redacted', v_audit),
                             p_note);
  return jsonb_build_object('apartment_number', v_apt.apartment_number,
                            'accounts_deactivated', v_profiles,
                            'audit_rows_redacted', v_audit);
end;
$$;

-- ---------------------------------------------------------------------
-- Нова редакція згоди (має збігатися з CONSENT_VERSION у src/lib/legal.ts)
-- ---------------------------------------------------------------------
create or replace function public.consent_current_version()
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select '2026-11-07-2'::text;
$$;

-- ---------------------------------------------------------------------
-- Права
-- ---------------------------------------------------------------------
revoke execute on function public.resident_set_my_name(text) from public, anon;
grant execute on function public.resident_set_my_name(text) to authenticated, service_role;
revoke execute on function public.pd_erase_apartment(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.admin_upsert_apartment(uuid, text, text, boolean, numeric, date, text) from public, anon;
grant execute on function public.admin_upsert_apartment(uuid, text, text, boolean, numeric, date, text) to authenticated;
revoke execute on function public.admin_import_apartments(jsonb) from public, anon;
grant execute on function public.admin_import_apartments(jsonb) to authenticated;
