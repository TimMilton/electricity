-- =====================================================================
-- Окремі внески в депозит будинку — будь-коли, незалежно від показників.
--
-- Мешканець вказує суму, прикріплює квитанцію і надсилає на перевірку.
-- Адміністратор підтверджує (сума зараховується в журнал депозиту рівно один
-- раз) або відхиляє з причиною. Внесків може бути скільки завгодно:
-- напр. 50 грн разом із показниками, а через 10 днів ще 150 грн окремо.
--
-- Нові таблиці; журнал депозиту отримує посилання на внесок. Наявні платежі,
-- нарахування й записи депозиту не змінюються. Безпечно виконувати повторно.
-- =====================================================================

create table if not exists public.deposit_topups (
  id uuid primary key default gen_random_uuid(),
  apartment_id uuid not null references public.apartments (id),
  -- місяць, до якого відноситься запис у журналі депозиту (поточний на момент подання)
  billing_period_id uuid not null references public.billing_periods (id),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending_review' check (status in ('pending_review', 'paid', 'rejected')),
  note text check (note is null or length(note) <= 500),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  rejection_reason text,
  admin_note text
);
create index if not exists deposit_topups_apartment_idx on public.deposit_topups (apartment_id, created_at desc);
create index if not exists deposit_topups_status_idx on public.deposit_topups (status);

create table if not exists public.deposit_topup_receipts (
  id uuid primary key default gen_random_uuid(),
  topup_id uuid not null references public.deposit_topups (id),
  storage_path text not null unique check (storage_path like 'topup/%'),
  original_filename text not null check (length(original_filename) <= 255),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  file_size integer not null check (file_size > 0),
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);
create index if not exists deposit_topup_receipts_topup_idx on public.deposit_topup_receipts (topup_id);

-- Журнал депозиту: внесок може походити з місячного платежу або з окремого внеску
alter table public.deposit_ledger add column if not exists related_topup_id uuid references public.deposit_topups (id);
alter table public.deposit_ledger drop constraint if exists deposit_ledger_sign;
alter table public.deposit_ledger add constraint deposit_ledger_sign check (
  (transaction_type = 'contribution' and amount > 0 and (related_payment_id is not null or related_topup_id is not null))
  or (transaction_type = 'discrepancy_adjustment' and amount < 0 and related_reconciliation_id is not null)
  or (transaction_type = 'refund' and amount < 0)
  or (transaction_type = 'correction' and amount <> 0)
);
create unique index if not exists deposit_ledger_one_contribution_per_topup
  on public.deposit_ledger (related_topup_id)
  where transaction_type = 'contribution' and related_topup_id is not null;

-- Доступ: адміністратор — усі, мешканець — лише своєї квартири
alter table public.deposit_topups enable row level security;
alter table public.deposit_topup_receipts enable row level security;
grant select on public.deposit_topups, public.deposit_topup_receipts to authenticated;
grant all on public.deposit_topups, public.deposit_topup_receipts to service_role;

drop policy if exists deposit_topups_read on public.deposit_topups;
create policy deposit_topups_read on public.deposit_topups for select to authenticated
  using (public.is_admin() or apartment_id = public.my_apartment_id());

drop policy if exists deposit_topup_receipts_read on public.deposit_topup_receipts;
create policy deposit_topup_receipts_read on public.deposit_topup_receipts for select to authenticated
  using (exists (select 1 from public.deposit_topups t
                  where t.id = topup_id and (public.is_admin() or t.apartment_id = public.my_apartment_id())));

-- Подання внеску мешканцем (або адміністратором від імені квартири)
create or replace function public.submit_deposit_topup(p_apartment_id uuid, p_amount numeric, p_receipts jsonb, p_note text default null)
returns public.deposit_topups
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.app_settings;
  v_apt public.apartments;
  v_period public.billing_periods;
  v public.deposit_topups;
  v_item jsonb;
  v_prefix text;
begin
  perform public.require_apartment_access(p_apartment_id);
  select * into s from public.app_settings where id;
  select * into v_apt from public.apartments where id = p_apartment_id;
  if v_apt.id is null or not v_apt.is_active then
    perform public.user_error('Квартира неактивна. Зверніться до адміністратора');
  end if;
  if p_amount is null or p_amount <= 0 or not public.is_money(p_amount) then
    perform public.user_error('Сума внеску має бути додатною, з точністю до копійок');
  end if;
  if p_amount > s.max_contribution_amount then
    perform public.user_error(format('Сума внеску не може перевищувати %s', public.fmt_money(s.max_contribution_amount)));
  end if;
  if p_note is not null and length(p_note) > 500 then
    perform public.user_error('Примітка задовга (до 500 символів)');
  end if;
  if p_receipts is null or jsonb_typeof(p_receipts) <> 'array' or jsonb_array_length(p_receipts) = 0 then
    perform public.user_error('Прикріпіть квитанцію про переказ');
  end if;
  if jsonb_array_length(p_receipts) > 10 then
    perform public.user_error('Забагато файлів за один раз (максимум 10)');
  end if;
  v_prefix := 'topup/' || p_apartment_id::text || '/';
  for v_item in select * from jsonb_array_elements(p_receipts) loop
    if coalesce(v_item->>'storage_path', '') not like v_prefix || '%' or (v_item->>'storage_path') like '%..%' then
      perform public.user_error('Некоректний шлях до файлу квитанції');
    end if;
    if not ((v_item->>'mime_type') = any (s.allowed_receipt_mime_types)) then
      perform public.user_error('Недозволений формат файлу квитанції');
    end if;
    if coalesce((v_item->>'file_size')::bigint, 0) <= 0
       or (v_item->>'file_size')::bigint > s.max_receipt_size_mb::bigint * 1024 * 1024 then
      perform public.user_error(format('Розмір файлу перевищує %s МБ', s.max_receipt_size_mb));
    end if;
  end loop;

  v_period := public.get_current_period();
  if v_period.id is null then
    perform public.user_error('Розрахунковий період ще не створено. Зверніться до адміністратора');
  end if;

  insert into public.deposit_topups (apartment_id, billing_period_id, amount, note, created_by)
  values (p_apartment_id, v_period.id, p_amount, nullif(btrim(p_note), ''), auth.uid())
  returning * into v;

  insert into public.deposit_topup_receipts (topup_id, storage_path, original_filename, mime_type, file_size, uploaded_by)
  select v.id, x->>'storage_path', left(coalesce(nullif(x->>'original_filename', ''), 'квитанція'), 255),
         x->>'mime_type', (x->>'file_size')::integer, auth.uid()
    from jsonb_array_elements(p_receipts) x;

  perform public.write_audit('deposit_topup.submit', 'apartment', p_apartment_id, null,
                             to_jsonb(v) || jsonb_build_object('receipts', p_receipts), null);
  return v;
end;
$$;

-- Підтвердження (ідемпотентне: повторний виклик не створює другого запису в журналі)
create or replace function public.admin_approve_deposit_topup(p_topup_id uuid, p_note text default null)
returns public.deposit_topups
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.deposit_topups;
  v public.deposit_topups;
  v_apt public.apartments;
begin
  perform public.require_admin();
  select * into v_old from public.deposit_topups where id = p_topup_id for update;
  if v_old.id is null then perform public.user_error('Внесок не знайдено'); end if;
  if v_old.status = 'paid' then return v_old; end if;
  if v_old.status = 'rejected' then
    perform public.user_error('Внесок відхилено. Мешканець може подати новий');
  end if;

  update public.deposit_topups
     set status = 'paid', reviewed_by = auth.uid(), reviewed_at = now(),
         admin_note = nullif(btrim(p_note), '')
   where id = p_topup_id
  returning * into v;

  select * into v_apt from public.apartments where id = v.apartment_id;
  perform pg_advisory_xact_lock(hashtext('deposit_ledger'));
  insert into public.deposit_ledger (billing_period_id, apartment_id, transaction_type, amount, description,
                                     related_topup_id, created_by)
  values (v.billing_period_id, v.apartment_id, 'contribution', v.amount,
          format('Додатковий внесок у депозит, кв. %s (%s)', v_apt.apartment_number, to_char(v.created_at at time zone 'Europe/Kyiv', 'DD.MM.YYYY')),
          v.id, auth.uid())
  on conflict (related_topup_id) where transaction_type = 'contribution' and related_topup_id is not null do nothing;

  perform public.write_audit('deposit_topup.approve', 'apartment', v.apartment_id, to_jsonb(v_old), to_jsonb(v), p_note);
  return v;
end;
$$;

create or replace function public.admin_reject_deposit_topup(p_topup_id uuid, p_reason text)
returns public.deposit_topups
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.deposit_topups;
  v public.deposit_topups;
begin
  perform public.require_admin();
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) < 3 then
    perform public.user_error('Вкажіть причину відхилення');
  end if;
  select * into v_old from public.deposit_topups where id = p_topup_id for update;
  if v_old.id is null then perform public.user_error('Внесок не знайдено'); end if;
  if v_old.status = 'paid' then
    perform public.user_error('Внесок уже підтверджено й зараховано до депозиту. Виправлення — через коригування депозиту');
  end if;
  if v_old.status = 'rejected' then return v_old; end if;
  update public.deposit_topups
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), rejection_reason = btrim(p_reason)
   where id = p_topup_id
  returning * into v;
  perform public.write_audit('deposit_topup.reject', 'apartment', v.apartment_id, to_jsonb(v_old), to_jsonb(v), p_reason);
  return v;
end;
$$;

revoke execute on function public.submit_deposit_topup(uuid, numeric, jsonb, text) from public, anon;
revoke execute on function public.admin_approve_deposit_topup(uuid, text) from public, anon;
revoke execute on function public.admin_reject_deposit_topup(uuid, text) from public, anon;
grant execute on function public.submit_deposit_topup(uuid, numeric, jsonb, text) to authenticated, service_role;
grant execute on function public.admin_approve_deposit_topup(uuid, text) to authenticated, service_role;
grant execute on function public.admin_reject_deposit_topup(uuid, text) to authenticated, service_role;
