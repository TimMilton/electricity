-- =====================================================================
-- Електрооблік будинку — схема бази даних
-- Усі суми зберігаються у numeric (точна десяткова арифметика).
--   гроші:       numeric(12,2)  (гривні з копійками)
--   показники:   numeric(12,2)  (кВт·год)
--   тариф:       numeric(10,4)  (грн за кВт·год)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Перелічувані типи
-- ---------------------------------------------------------------------
create type public.app_role as enum ('resident', 'admin');
create type public.registration_status as enum ('not_registered', 'registered', 'additional_allowed');
create type public.period_status as enum ('scheduled', 'open', 'closed');
create type public.entry_source as enum ('resident', 'admin');
create type public.charge_type as enum ('deposit_contribution', 'hall_lighting', 'other');
create type public.payment_status as enum ('awaiting_payment', 'pending_review', 'paid', 'rejected');
create type public.reconciliation_status as enum ('calculated', 'reviewed', 'adjustment_applied', 'closed');
create type public.deposit_tx_type as enum ('contribution', 'discrepancy_adjustment', 'correction', 'refund');

-- ---------------------------------------------------------------------
-- Загальна функція updated_at
-- ---------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Налаштування застосунку (один рядок)
-- ---------------------------------------------------------------------
create table public.app_settings (
  id boolean primary key default true check (id),
  envelope_url text check (envelope_url is null or envelope_url ~* '^https://'),
  max_receipt_size_mb integer not null default 10 check (max_receipt_size_mb between 1 and 50),
  allowed_receipt_mime_types text[] not null default array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
    check (allowed_receipt_mime_types <@ array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
           and cardinality(allowed_receipt_mime_types) > 0),
  show_deposit_balance_to_residents boolean not null default true,
  other_charges_enabled boolean not null default false,
  max_contribution_amount numeric(12,2) not null default 10000 check (max_contribution_amount > 0),
  registration_open boolean not null default true,
  registration_code_required boolean not null default true,
  registration_code_max_attempts integer not null default 5 check (registration_code_max_attempts between 1 and 50),
  registration_lockout_minutes integer not null default 30 check (registration_lockout_minutes between 1 and 10080),
  default_window_start_day integer not null default 1 check (default_window_start_day between 1 and 28),
  default_window_start_hour integer not null default 0 check (default_window_start_hour between 0 and 23),
  default_window_end_day integer not null default 5 check (default_window_end_day between 1 and 28),
  default_window_end_hour integer not null default 23 check (default_window_end_hour between 0 and 23),
  -- true: вікно на початку місяця M приймає показники за місяць M-1
  window_for_previous_month boolean not null default true,
  admin_edit_after_close boolean not null default true,
  anomaly_threshold_kwh numeric(12,2) check (anomaly_threshold_kwh is null or anomaly_threshold_kwh > 0),
  anomaly_multiplier numeric(6,2) check (anomaly_multiplier is null or anomaly_multiplier > 1),
  deposit_public_note text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

insert into public.app_settings (id) values (true);

create trigger app_settings_updated_at before update on public.app_settings
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Квартири
-- ---------------------------------------------------------------------
create table public.apartments (
  id uuid primary key default gen_random_uuid(),
  apartment_number text not null check (btrim(apartment_number) <> '' and length(apartment_number) <= 20),
  sort_num integer generated always as (nullif(substring(apartment_number from '^[0-9]+'), '')::integer) stored,
  resident_surname text not null check (btrim(resident_surname) <> '' and length(resident_surname) <= 100),
  is_active boolean not null default true,
  registration_status public.registration_status not null default 'not_registered',
  registration_code_hash text,
  registration_code_created_at timestamptz,
  registration_failed_attempts integer not null default 0,
  registration_locked_until timestamptz,
  initial_reading numeric(12,2) check (initial_reading is null or initial_reading >= 0),
  initial_reading_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index apartments_number_unique on public.apartments (lower(btrim(apartment_number)));
create index apartments_sort_idx on public.apartments (sort_num, apartment_number);

create trigger apartments_updated_at before update on public.apartments
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Профілі користувачів
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete cascade,
  apartment_id uuid references public.apartments (id),
  surname text not null check (btrim(surname) <> '' and length(surname) <= 100),
  role public.app_role not null default 'resident',
  is_primary boolean not null default true,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_resident_has_apartment check (role = 'admin' or apartment_id is not null)
);

-- Одна квартира — один основний активний акаунт
create unique index profiles_one_primary_per_apartment
  on public.profiles (apartment_id)
  where is_primary and is_active and apartment_id is not null;
create index profiles_apartment_idx on public.profiles (apartment_id);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- ---------------------------------------------------------------------
-- Розрахункові періоди
-- ---------------------------------------------------------------------
create table public.billing_periods (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2000 and 2100),
  month integer not null check (month between 1 and 12),
  start_date date not null,
  end_date date not null,
  reading_window_start timestamptz not null,
  reading_window_end timestamptz not null,
  status public.period_status not null default 'scheduled',
  allow_admin_edit_after_close boolean not null default true,
  closed_at timestamptz,
  closed_by uuid references auth.users (id),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint billing_periods_month_unique unique (year, month),
  constraint billing_periods_dates check (end_date >= start_date),
  constraint billing_periods_window check (reading_window_end > reading_window_start),
  constraint billing_periods_closed check ((status = 'closed') = (closed_at is not null))
);

create index billing_periods_order_idx on public.billing_periods (year desc, month desc);

-- ---------------------------------------------------------------------
-- Тарифи
-- ---------------------------------------------------------------------
create table public.tariffs (
  id uuid primary key default gen_random_uuid(),
  rate_per_kwh numeric(10,4) not null check (rate_per_kwh > 0),
  valid_from date not null unique,
  valid_until date,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint tariffs_range check (valid_until is null or valid_until >= valid_from)
);

-- ---------------------------------------------------------------------
-- Показники квартирних лічильників
-- ---------------------------------------------------------------------
create table public.meter_readings (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments (id),
  billing_period_id uuid not null references public.billing_periods (id),
  previous_reading numeric(12,2) not null check (previous_reading >= 0),
  current_reading numeric(12,2) not null check (current_reading >= 0),
  consumption_kwh numeric(12,2) generated always as (current_reading - previous_reading) stored,
  tariff_rate numeric(10,4) not null check (tariff_rate > 0),
  electricity_amount numeric(12,2) not null,
  is_anomaly boolean not null default false,
  entered_by uuid not null references auth.users (id),
  entry_source public.entry_source not null,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes text check (notes is null or length(notes) <= 1000),
  constraint meter_readings_unique unique (apartment_id, billing_period_id),
  constraint meter_readings_monotonic check (current_reading >= previous_reading),
  constraint meter_readings_amount check (
    electricity_amount = round((current_reading - previous_reading) * tariff_rate, 2)
  )
);

create index meter_readings_period_idx on public.meter_readings (billing_period_id);

-- ---------------------------------------------------------------------
-- Додаткові внески мешканця за період
-- ---------------------------------------------------------------------
create table public.additional_charges (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments (id),
  billing_period_id uuid not null references public.billing_periods (id),
  charge_type public.charge_type not null,
  amount numeric(12,2) not null check (amount >= 0),
  description text check (description is null or length(description) <= 500),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint additional_charges_unique unique (apartment_id, billing_period_id, charge_type)
);

create index additional_charges_period_idx on public.additional_charges (billing_period_id);

-- ---------------------------------------------------------------------
-- Платежі (один платіж на квартиру за період; спроби — у payment_events)
-- ---------------------------------------------------------------------
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments (id),
  billing_period_id uuid not null references public.billing_periods (id),
  electricity_amount numeric(12,2) not null default 0 check (electricity_amount >= 0),
  deposit_contribution numeric(12,2) not null default 0 check (deposit_contribution >= 0),
  hall_lighting_amount numeric(12,2) not null default 0 check (hall_lighting_amount >= 0),
  other_amount numeric(12,2) not null default 0 check (other_amount >= 0),
  total_amount numeric(12,2) not null default 0,
  status public.payment_status not null default 'awaiting_payment',
  attempt_no integer not null default 0 check (attempt_no >= 0),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  rejection_reason text,
  confirmed_without_receipt boolean not null default false,
  admin_note text check (admin_note is null or length(admin_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint payments_unique unique (apartment_id, billing_period_id),
  constraint payments_total check (
    total_amount = electricity_amount + deposit_contribution + hall_lighting_amount + other_amount
  ),
  constraint payments_rejection_reason check (status <> 'rejected' or nullif(btrim(rejection_reason), '') is not null),
  constraint payments_paid_reviewed check (status <> 'paid' or (reviewed_at is not null and reviewed_by is not null))
);

create index payments_status_idx on public.payments (status);
create index payments_period_idx on public.payments (billing_period_id);

create trigger payments_updated_at before update on public.payments
  for each row execute function public.tg_set_updated_at();

-- Історія спроб і змін статусу платежу (лише додавання)
create table public.payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  event_type text not null check (event_type in ('created', 'amounts_updated', 'submitted', 'receipt_added', 'approved', 'rejected')),
  status_after public.payment_status not null,
  attempt_no integer not null,
  amounts jsonb,
  reason text,
  actor_user_id uuid references auth.users (id),
  created_at timestamptz not null default now()
);

create index payment_events_payment_idx on public.payment_events (payment_id, created_at);

-- ---------------------------------------------------------------------
-- Квитанції
-- ---------------------------------------------------------------------
create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid not null references public.payments (id),
  attempt_no integer not null default 0,
  storage_path text not null unique,
  original_filename text not null check (length(original_filename) <= 255),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  file_size integer not null check (file_size > 0),
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index receipts_payment_idx on public.receipts (payment_id);

-- ---------------------------------------------------------------------
-- Загальний лічильник будинку
-- ---------------------------------------------------------------------
create table public.common_meter_readings (
  id uuid primary key default gen_random_uuid(),
  billing_period_id uuid not null unique references public.billing_periods (id),
  previous_reading numeric(14,2) not null check (previous_reading >= 0),
  current_reading numeric(14,2) not null check (current_reading >= 0),
  consumption_kwh numeric(14,2) generated always as (current_reading - previous_reading) stored,
  entered_by uuid not null references auth.users (id),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  notes text check (notes is null or length(notes) <= 1000),
  constraint common_meter_monotonic check (current_reading >= previous_reading)
);

-- ---------------------------------------------------------------------
-- Розбіжності загального та квартирних лічильників
-- ---------------------------------------------------------------------
create table public.reconciliation_records (
  id uuid primary key default gen_random_uuid(),
  billing_period_id uuid not null unique references public.billing_periods (id),
  common_consumption_kwh numeric(14,2) not null,
  apartment_consumption_kwh numeric(14,2) not null,
  discrepancy_kwh numeric(14,2) not null,
  tariff_rate numeric(10,4),
  discrepancy_amount numeric(14,2),
  readings_count integer not null,
  active_apartments_count integer not null,
  is_preliminary boolean not null,
  status public.reconciliation_status not null default 'calculated',
  explanation text check (explanation is null or length(explanation) <= 2000),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  constraint reconciliation_math check (discrepancy_kwh = common_consumption_kwh - apartment_consumption_kwh)
);

-- ---------------------------------------------------------------------
-- Журнал руху коштів депозиту (незмінний, суми зі знаком)
--   contribution            > 0
--   discrepancy_adjustment  < 0
--   refund                  < 0
--   correction              <> 0
-- Баланс = sum(amount)
-- ---------------------------------------------------------------------
create table public.deposit_ledger (
  id uuid primary key default gen_random_uuid(),
  billing_period_id uuid not null references public.billing_periods (id),
  apartment_id uuid references public.apartments (id),
  transaction_type public.deposit_tx_type not null,
  amount numeric(12,2) not null,
  description text not null check (btrim(description) <> '' and length(description) <= 1000),
  related_reconciliation_id uuid references public.reconciliation_records (id),
  related_payment_id uuid references public.payments (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  constraint deposit_ledger_sign check (
    (transaction_type = 'contribution' and amount > 0 and related_payment_id is not null)
    or (transaction_type = 'discrepancy_adjustment' and amount < 0 and related_reconciliation_id is not null)
    or (transaction_type = 'refund' and amount < 0)
    or (transaction_type = 'correction' and amount <> 0)
  )
);

-- Зарахування з одного платежу — лише один раз
create unique index deposit_ledger_one_contribution_per_payment
  on public.deposit_ledger (related_payment_id)
  where transaction_type = 'contribution';
create index deposit_ledger_period_idx on public.deposit_ledger (billing_period_id);
create index deposit_ledger_apartment_idx on public.deposit_ledger (apartment_id);

-- ---------------------------------------------------------------------
-- Журнал змін
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_role text,
  action_type text not null,
  entity_type text not null,
  entity_id uuid,
  previous_values jsonb,
  new_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);

create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- ---------------------------------------------------------------------
-- Обмеження частоти запитів (реєстрація, перевірка кодів)
-- ---------------------------------------------------------------------
create table public.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  hits integer not null default 0
);

-- ---------------------------------------------------------------------
-- Незмінність журналів: заборона UPDATE/DELETE для будь-кого
-- ---------------------------------------------------------------------
create or replace function public.tg_append_only()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'Записи таблиці % не можна змінювати або видаляти', tg_table_name
    using errcode = 'P0001';
end;
$$;

create trigger deposit_ledger_append_only before update or delete on public.deposit_ledger
  for each row execute function public.tg_append_only();
create trigger audit_logs_append_only before update or delete on public.audit_logs
  for each row execute function public.tg_append_only();
create trigger payment_events_append_only before update or delete on public.payment_events
  for each row execute function public.tg_append_only();
create trigger receipts_no_delete before delete on public.receipts
  for each row execute function public.tg_append_only();

-- Фінансові записи не видаляються
create trigger payments_no_delete before delete on public.payments
  for each row execute function public.tg_append_only();
create trigger meter_readings_no_delete before delete on public.meter_readings
  for each row execute function public.tg_append_only();
create trigger additional_charges_no_delete before delete on public.additional_charges
  for each row execute function public.tg_append_only();
