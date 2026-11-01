-- =====================================================================
-- Квитанції про оплату за загальним лічильником будинку.
--
--   * завантажує й видаляє лише адміністратор (з журналом змін);
--   * адміністратор бачить їх одразу, мешканці — коли період закрито
--     (автоматично після завершення приймання показників або вручну);
--   * файли — у тому самому приватному сховищі, шлях house/<період>/<файл>;
--     посилання на перегляд видає сервер застосунку після перевірки доступу.
--
-- Нова таблиця; наявні дані не змінюються. Безпечно виконувати повторно.
-- =====================================================================

create table if not exists public.house_receipts (
  id uuid primary key default gen_random_uuid(),
  billing_period_id uuid not null references public.billing_periods (id),
  storage_path text not null unique check (storage_path like 'house/%'),
  original_filename text not null check (length(original_filename) <= 255),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  file_size integer not null check (file_size > 0),
  note text check (note is null or length(note) <= 500),
  uploaded_by uuid not null references auth.users (id),
  created_at timestamptz not null default now()
);

create index if not exists house_receipts_period_idx on public.house_receipts (billing_period_id);

alter table public.house_receipts enable row level security;
grant select on public.house_receipts to authenticated;
grant all on public.house_receipts to service_role;

drop policy if exists house_receipts_read on public.house_receipts;
create policy house_receipts_read on public.house_receipts for select to authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.billing_periods p where p.id = billing_period_id and p.status = 'closed')
  );

create or replace function public.admin_add_house_receipts(p_period_id uuid, p_receipts jsonb, p_note text default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s public.app_settings;
  v_period public.billing_periods;
  v_item jsonb;
  v_prefix text;
  v_count integer;
begin
  perform public.require_admin();
  select * into s from public.app_settings where id;
  select * into v_period from public.billing_periods where id = p_period_id;
  if v_period.id is null then
    perform public.user_error('Період не знайдено');
  end if;
  if p_receipts is null or jsonb_typeof(p_receipts) <> 'array' or jsonb_array_length(p_receipts) = 0 then
    perform public.user_error('Оберіть файл квитанції');
  end if;
  if jsonb_array_length(p_receipts) > 10 then
    perform public.user_error('Забагато файлів за один раз (максимум 10)');
  end if;
  if p_note is not null and length(p_note) > 500 then
    perform public.user_error('Примітка задовга (до 500 символів)');
  end if;
  v_prefix := 'house/' || p_period_id::text || '/';
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

  insert into public.house_receipts (billing_period_id, storage_path, original_filename, mime_type, file_size, note, uploaded_by)
  select p_period_id, r->>'storage_path',
         left(coalesce(nullif(r->>'original_filename', ''), 'квитанція'), 255),
         r->>'mime_type', (r->>'file_size')::integer, nullif(btrim(p_note), ''), auth.uid()
    from jsonb_array_elements(p_receipts) r;
  get diagnostics v_count = row_count;

  perform public.write_audit('house_receipt.add', 'billing_period', p_period_id, null, p_receipts, nullif(btrim(p_note), ''));
  return v_count;
end;
$$;

create or replace function public.admin_delete_house_receipt(p_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v public.house_receipts;
begin
  perform public.require_admin();
  if nullif(btrim(p_reason), '') is null or length(btrim(p_reason)) < 3 then
    perform public.user_error('Вкажіть причину видалення квитанції');
  end if;
  select * into v from public.house_receipts where id = p_id for update;
  if v.id is null then
    perform public.user_error('Квитанцію не знайдено або її вже видалено');
  end if;
  delete from public.house_receipts where id = v.id;
  perform public.write_audit('house_receipt.delete', 'billing_period', v.billing_period_id, to_jsonb(v), null, p_reason);
  return v.storage_path;
end;
$$;

revoke execute on function public.admin_add_house_receipts(uuid, jsonb, text) from public, anon;
revoke execute on function public.admin_delete_house_receipt(uuid, text) from public, anon;
grant execute on function public.admin_add_house_receipts(uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.admin_delete_house_receipt(uuid, text) to authenticated, service_role;
