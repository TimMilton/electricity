-- =====================================================================
-- Електрооблік будинку — права доступу, RLS, сховище квитанцій
--
-- Принцип: роль authenticated має лише SELECT (обмежений RLS);
-- усі зміни — виключно через функції з перевірками.
-- Роль anon не має доступу до даних.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Привілеї на таблиці
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;

grant usage on schema public to anon, authenticated, service_role;

grant select on public.app_settings, public.billing_periods, public.tariffs,
                public.meter_readings, public.additional_charges,
                public.payments, public.payment_events, public.receipts,
                public.profiles, public.deposit_ledger,
                public.common_meter_readings, public.reconciliation_records,
                public.audit_logs
  to authenticated;

-- Квартири: хеш коду та лічильники спроб недоступні клієнту
grant select (id, apartment_number, sort_num, resident_surname, is_active, registration_status, created_at, updated_at)
  on public.apartments to authenticated;

grant all on all tables in schema public to service_role;

-- ---------------------------------------------------------------------
-- Привілеї на функції: за замовчуванням PostgreSQL дає EXECUTE для PUBLIC
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant execute on function
  public.is_admin(),
  public.my_apartment_id(),
  public.get_current_period(),
  public.get_previous_reading(uuid, uuid),
  public.get_applicable_tariff(uuid),
  public.submit_meter_reading(uuid, uuid, numeric, numeric, numeric, numeric, numeric, text, text, boolean),
  public.submit_payment_for_review(uuid, jsonb),
  public.add_payment_receipts(uuid, jsonb),
  public.get_deposit_summary(),
  public.get_period_table(uuid),
  public.period_label(integer, integer),
  -- адміністративні (кожна перевіряє роль усередині)
  public.admin_create_period(integer, integer, timestamptz, timestamptz, boolean),
  public.admin_create_next_period(),
  public.admin_update_period(uuid, timestamptz, timestamptz, boolean, text),
  public.admin_close_period(uuid, text),
  public.admin_reopen_period(uuid, timestamptz, text),
  public.admin_set_tariff(numeric, date, text),
  public.admin_delete_future_tariff(uuid, text),
  public.approve_payment(uuid, text),
  public.reject_payment(uuid, text),
  public.admin_create_deposit_operation(public.deposit_tx_type, numeric, text, uuid, uuid),
  public.get_previous_common_reading(uuid),
  public.calculate_reconciliation(uuid),
  public.admin_upsert_common_reading(uuid, numeric, numeric, text, text),
  public.admin_review_reconciliation(uuid, text),
  public.admin_close_reconciliation(uuid, text),
  public.admin_apply_deposit_adjustment(uuid, numeric, text),
  public.get_house_report(uuid),
  public.get_admin_overview(uuid),
  public.admin_upsert_apartment(uuid, text, text, boolean, numeric, date, text),
  public.admin_import_apartments(jsonb),
  public.admin_generate_registration_code(uuid, boolean),
  public.admin_generate_codes_bulk(),
  public.admin_revoke_registration_code(uuid),
  public.admin_list_apartments(),
  public.admin_list_users(),
  public.admin_set_profile_active(uuid, boolean, text),
  public.admin_set_profile_role(uuid, public.app_role, text),
  public.admin_update_settings(jsonb, text)
to authenticated;

-- Лише для сервера (сервісна роль)
grant execute on function
  public.check_rate_limit(text, integer, integer),
  public.registration_verify(text, text, text),
  public.registration_complete(uuid, uuid, text, text),
  public.bootstrap_admin(uuid, text)
to service_role;
grant execute on all functions in schema public to service_role;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.app_settings enable row level security;
alter table public.apartments enable row level security;
alter table public.profiles enable row level security;
alter table public.billing_periods enable row level security;
alter table public.tariffs enable row level security;
alter table public.meter_readings enable row level security;
alter table public.additional_charges enable row level security;
alter table public.payments enable row level security;
alter table public.payment_events enable row level security;
alter table public.receipts enable row level security;
alter table public.common_meter_readings enable row level security;
alter table public.reconciliation_records enable row level security;
alter table public.deposit_ledger enable row level security;
alter table public.audit_logs enable row level security;
alter table public.rate_limits enable row level security;

-- Загальнодоступні (для авторизованих) довідкові дані
create policy app_settings_read on public.app_settings for select to authenticated using (true);
create policy billing_periods_read on public.billing_periods for select to authenticated using (true);
create policy tariffs_read on public.tariffs for select to authenticated using (true);
create policy apartments_read on public.apartments for select to authenticated using (true);

-- Показники та внески — частина загальної таблиці будинку
create policy meter_readings_read on public.meter_readings for select to authenticated using (true);
create policy additional_charges_read on public.additional_charges for select to authenticated using (true);

-- Профілі: власний або адміністратор
create policy profiles_read on public.profiles for select to authenticated
  using (auth_user_id = auth.uid() or public.is_admin());

-- Платежі, історія та квитанції: власна квартира або адміністратор
create policy payments_read on public.payments for select to authenticated
  using (apartment_id = public.my_apartment_id() or public.is_admin());

create policy payment_events_read on public.payment_events for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.payments p where p.id = payment_id and p.apartment_id = public.my_apartment_id()));

create policy receipts_read on public.receipts for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.payments p where p.id = payment_id and p.apartment_id = public.my_apartment_id()));

-- Лише адміністратор
create policy common_meter_readings_read on public.common_meter_readings for select to authenticated
  using (public.is_admin());
create policy reconciliation_records_read on public.reconciliation_records for select to authenticated
  using (public.is_admin());
create policy audit_logs_read on public.audit_logs for select to authenticated
  using (public.is_admin());

-- Депозит: адміністратор — усе; мешканець — власні зарахування.
-- Загальний баланс мешканцям — через get_deposit_summary() з урахуванням налаштувань.
create policy deposit_ledger_read on public.deposit_ledger for select to authenticated
  using (public.is_admin()
         or (transaction_type = 'contribution' and apartment_id = public.my_apartment_id()));

-- rate_limits: жодних політик — доступ лише сервісній ролі

-- ---------------------------------------------------------------------
-- Supabase Storage: приватний бакет квитанцій
-- Шлях об'єкта: {apartment_id}/{payment_id}/{uuid}.{ext}
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 52428800,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.can_access_receipt_object(p_name text, p_for_write boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_parts text[];
  v_apartment uuid;
  v_payment public.payments;
begin
  if auth.uid() is null then return false; end if;
  v_parts := string_to_array(p_name, '/');
  if array_length(v_parts, 1) <> 3 or p_name like '%..%' then return false; end if;
  begin
    v_apartment := v_parts[1]::uuid;
    select * into v_payment from public.payments where id = v_parts[2]::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  if v_payment.id is null or v_payment.apartment_id <> v_apartment then return false; end if;
  if public.is_admin() then return true; end if;
  if v_apartment is distinct from public.my_apartment_id() then return false; end if;
  if p_for_write and v_payment.status = 'paid' then return false; end if;
  return true;
end;
$$;

grant execute on function public.can_access_receipt_object(text, boolean) to authenticated;

drop policy if exists receipts_objects_read on storage.objects;
drop policy if exists receipts_objects_insert on storage.objects;

create policy receipts_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and public.can_access_receipt_object(name, false));

create policy receipts_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and public.can_access_receipt_object(name, true));

-- UPDATE / DELETE для квитанцій не дозволено жодній ролі, окрім сервісної
