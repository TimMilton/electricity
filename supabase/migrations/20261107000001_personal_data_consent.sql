-- =====================================================================
-- Згода на обробку персональних даних (Закон України «Про захист
-- персональних даних» № 2297-VI, ст. 2, 8, 11, 12, 15).
--
--   * Кожен вхід вимагає позначки згоди; факт згоди фіксується тут
--     (докази згоди: хто, коли, яка версія тексту, хеш тексту, IP, браузер).
--   * Без чинної згоди (остання подія користувача — «granted» поточної
--     версії) застосунок не відкриває обліковий запис.
--   * Мешканець може сам відкликати згоду й видалити свої персональні дані;
--     адміністратор — на прохання мешканця.
--   * Під час застосування міграції завершуються ВСІ активні сесії:
--     кожен користувач має увійти знову й надати згоду.
--
-- Зміна тексту згоди: оновіть CONSENT_VERSION у src/lib/legal.ts і
-- функцію public.consent_current_version() новою міграцією — усі
-- користувачі мають надати згоду повторно.
-- =====================================================================

create table public.personal_data_consents (
  id uuid primary key default gen_random_uuid(),
  -- без зовнішніх ключів: запис-доказ має пережити зміни в інших таблицях
  auth_user_id uuid not null,
  profile_id uuid,
  apartment_id uuid,
  apartment_number text check (apartment_number is null or length(apartment_number) <= 20),
  role public.app_role,
  event text not null check (event in ('granted', 'withdrawn')),
  consent_version text not null check (length(consent_version) between 1 and 40),
  text_sha256 text check (text_sha256 is null or text_sha256 ~ '^[0-9a-f]{64}$'),
  ip_address text check (ip_address is null or length(ip_address) <= 100),
  user_agent text check (user_agent is null or length(user_agent) <= 500),
  -- хто ініціював подію (для відкликання адміністратором — адміністратор)
  initiated_by uuid,
  note text check (note is null or length(note) <= 1000),
  created_at timestamptz not null default clock_timestamp()
);

create index personal_data_consents_user_idx on public.personal_data_consents (auth_user_id, created_at desc);
create index personal_data_consents_apartment_idx on public.personal_data_consents (apartment_id, created_at desc);

-- Записи-докази не змінюються і не видаляються
create trigger personal_data_consents_append_only before update or delete on public.personal_data_consents
  for each row execute function public.tg_append_only();

alter table public.personal_data_consents enable row level security;
grant select on public.personal_data_consents to authenticated;
grant all on public.personal_data_consents to service_role;

create policy personal_data_consents_read on public.personal_data_consents for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------
-- Поточна версія тексту згоди (має збігатися з CONSENT_VERSION у src/lib/legal.ts)
-- ---------------------------------------------------------------------
create or replace function public.consent_current_version()
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select '2026-11-07'::text;
$$;

-- Чи має користувач чинну згоду: остання його подія — «granted» поточної версії
create or replace function public.has_valid_consent(p_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select c.event = 'granted' and c.consent_version = public.consent_current_version()
      from public.personal_data_consents c
     where c.auth_user_id = p_auth_user_id
     order by c.created_at desc, c.id desc
     limit 1
  ), false);
$$;

-- Стан згоди поточного користувача (для застосунку)
create or replace function public.my_consent_status()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'ok', auth.uid() is not null and public.has_valid_consent(auth.uid()),
    'version', public.consent_current_version(),
    'granted_at', (
      select max(c.created_at) from public.personal_data_consents c
       where c.auth_user_id = auth.uid() and c.event = 'granted'
         and c.consent_version = public.consent_current_version()
    )
  );
$$;

-- Зафіксувати згоду під час входу. Лише сервер застосунку (сервісний ключ),
-- одразу після успішної перевірки коду/пароля.
create or replace function public.system_record_consent(
  p_auth_user_id uuid,
  p_version text,
  p_text_sha256 text,
  p_ip text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile public.profiles;
  v_number text;
  v_id uuid;
begin
  if p_version is distinct from public.consent_current_version() then
    perform public.user_error('Текст згоди оновлено. Оновіть сторінку, ознайомтеся з ним і спробуйте ще раз');
  end if;
  select * into v_profile from public.profiles where auth_user_id = p_auth_user_id and is_active limit 1;
  if v_profile.id is null then
    perform public.user_error('Обліковий запис не знайдено або деактивовано. Зверніться до адміністратора');
  end if;
  if v_profile.apartment_id is not null then
    select apartment_number into v_number from public.apartments where id = v_profile.apartment_id;
  end if;
  insert into public.personal_data_consents
    (auth_user_id, profile_id, apartment_id, apartment_number, role, event, consent_version,
     text_sha256, ip_address, user_agent, initiated_by)
  values
    (p_auth_user_id, v_profile.id, v_profile.apartment_id, v_number, v_profile.role, 'granted', p_version,
     lower(nullif(btrim(p_text_sha256), '')), left(nullif(btrim(p_ip), ''), 100), left(nullif(btrim(p_user_agent), ''), 500),
     p_auth_user_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'version', p_version);
end;
$$;

-- ---------------------------------------------------------------------
-- Видалення персональних даних
-- ---------------------------------------------------------------------
create or replace function public.pd_erased_label()
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select 'Дані видалено'::text;
$$;

-- Рекурсивно замінити в JSON рядкові значення, що збігаються з прізвищами
create or replace function public.pd_redact_jsonb(p jsonb, p_values text[])
returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  k text;
  v jsonb;
  r jsonb;
begin
  if p is null or p_values is null or cardinality(p_values) = 0 then return p; end if;
  case jsonb_typeof(p)
    when 'object' then
      r := '{}'::jsonb;
      for k, v in select e.key, e.value from jsonb_each(p) e loop
        r := r || jsonb_build_object(k, public.pd_redact_jsonb(v, p_values));
      end loop;
      return r;
    when 'array' then
      select coalesce(jsonb_agg(public.pd_redact_jsonb(e.value, p_values) order by e.ord), '[]'::jsonb)
        into r
        from jsonb_array_elements(p) with ordinality as e(value, ord);
      return r;
    when 'string' then
      if lower(btrim(p #>> '{}')) = any (p_values) then
        return to_jsonb(public.pd_erased_label());
      end if;
      return p;
    else
      return p;
  end case;
end;
$$;

-- Замінити в тексті згадки прізвищ (без урахування регістру)
create or replace function public.pd_redact_text(p text, p_values text[])
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  v text;
  r text := p;
begin
  if p is null or p_values is null then return p; end if;
  foreach v in array p_values loop
    -- екранувати спецсимволи регулярного виразу
    r := regexp_replace(r, regexp_replace(v, '([.*+?^${}()|\[\]\\])', '\\\1', 'g'), public.pd_erased_label(), 'gi');
  end loop;
  return r;
end;
$$;

-- Журнал змін лишається незмінним, крім одного випадку: видалення
-- персональних даних (замінюються лише значення, решта полів — без змін).
create or replace function public.tg_audit_logs_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('app.pd_erasure', true), '') = 'on'
     and new.id = old.id
     and new.actor_user_id is not distinct from old.actor_user_id
     and new.actor_role is not distinct from old.actor_role
     and new.action_type = old.action_type
     and new.entity_type = old.entity_type
     and new.entity_id is not distinct from old.entity_id
     and new.created_at = old.created_at then
    return new;
  end if;
  raise exception 'Записи таблиці % не можна змінювати або видаляти', tg_table_name
    using errcode = 'P0001';
end;
$$;

drop trigger if exists audit_logs_append_only on public.audit_logs;
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.tg_audit_logs_guard();

-- Ядро видалення: прізвище й під'їзд квартири, прізвища облікових записів,
-- згадки прізвищ у журналі змін; облікові записи мешканців деактивуються,
-- згода відкликається. Облікові (фінансові) записи квартири — показники,
-- нарахування, платежі, депозит — лишаються за номером квартири:
-- це розрахунки між співвласниками будинку.
-- Не надається жодній ролі: викликається лише з функцій нижче.
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

  select array_agg(distinct lower(btrim(s)))
    into v_values
    from (
      select v_apt.resident_surname as s
      union all
      select p.surname from public.profiles p where p.apartment_id = v_apt.id and p.role = 'resident'
    ) x
   where s is not null and btrim(s) <> '' and lower(btrim(s)) <> lower(public.pd_erased_label());

  -- підстава видалення теж не повинна містити прізвища
  p_note := public.pd_redact_text(p_note, v_values);

  -- відкликати згоду всіх облікових записів квартири
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
     set surname = public.pd_erased_label(), is_active = false
   where apartment_id = v_apt.id and role = 'resident';
  get diagnostics v_profiles = row_count;

  update public.apartments
     set resident_surname = public.pd_erased_label(),
         entrance = null,
         registration_status = 'not_registered'
   where id = v_apt.id;

  -- згадки прізвищ у журналі змін
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

-- Мешканець: відкликати згоду і видалити свої персональні дані
create or replace function public.resident_erase_my_personal_data()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.profiles;
begin
  v := public.require_profile();
  if v.role <> 'resident' or v.apartment_id is null then
    perform public.user_error('Адміністратор не може видалити власні дані цим способом. Спершу передайте права іншому адміністратору');
  end if;
  return public.pd_erase_apartment(v.apartment_id, 'self', null);
end;
$$;

-- Адміністратор: видалити персональні дані квартири на прохання мешканця
create or replace function public.admin_erase_apartment_personal_data(p_apartment_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.require_admin();
  if p_reason is null or length(btrim(p_reason)) < 3 then
    perform public.user_error('Вкажіть підставу (напр. «заява мешканця від 07.11.2026»)');
  end if;
  return public.pd_erase_apartment(p_apartment_id, 'admin', btrim(p_reason));
end;
$$;

-- ---------------------------------------------------------------------
-- Права на функції
-- ---------------------------------------------------------------------
revoke execute on function
  public.consent_current_version(),
  public.has_valid_consent(uuid),
  public.my_consent_status(),
  public.system_record_consent(uuid, text, text, text, text),
  public.pd_erased_label(),
  public.pd_redact_jsonb(jsonb, text[]),
  public.pd_redact_text(text, text[]),
  public.pd_erase_apartment(uuid, text, text),
  public.resident_erase_my_personal_data(),
  public.admin_erase_apartment_personal_data(uuid, text)
from public, anon, authenticated;

grant execute on function
  public.consent_current_version(),
  public.my_consent_status(),
  public.resident_erase_my_personal_data(),
  public.admin_erase_apartment_personal_data(uuid, text)
to authenticated;

grant execute on function
  public.consent_current_version(),
  public.has_valid_consent(uuid),
  public.my_consent_status(),
  public.system_record_consent(uuid, text, text, text, text)
to service_role;

-- ---------------------------------------------------------------------
-- Завершити всі активні сесії: кожен має увійти знову й надати згоду.
-- (Навіть якщо прав на схему auth немає, застосунок однаково не відкриє
--  обліковий запис без згоди — див. src/lib/auth.ts.)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regclass('auth.refresh_tokens') is not null then
    begin
      execute 'delete from auth.refresh_tokens';
    exception when others then
      raise notice 'auth.refresh_tokens: %', sqlerrm;
    end;
  end if;
  if to_regclass('auth.sessions') is not null then
    begin
      execute 'delete from auth.sessions';
    exception when others then
      raise notice 'auth.sessions: %', sqlerrm;
    end;
  end if;
end;
$$;
