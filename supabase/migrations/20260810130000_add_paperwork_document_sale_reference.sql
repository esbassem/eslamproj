alter table public.paperwork_documents
  add column if not exists sale_id uuid;

alter table public.paperwork_documents
  drop constraint if exists paperwork_documents_sale_id_fkey;

alter table public.paperwork_documents
  add constraint paperwork_documents_sale_id_fkey
  foreign key (sale_id)
  references public.showroom_sales(id)
  on delete restrict;

create index if not exists idx_paperwork_documents_sale_id
  on public.paperwork_documents (sale_id)
  where sale_id is not null;

do $$
declare
  v_request_backfill_count bigint;
  v_document_backfill_count bigint;
  v_conflict_count bigint;
  v_unresolved_document_count bigint;
begin
  -- Repair only requests whose invoice is missing and can be established from
  -- their exact sale line. Customer/partner identity is deliberately not used.
  update public.paperwork_requests pr
  set sale_id = sl.sale_id
  from public.showroom_sale_lines sl
  where pr.sale_id is null
    and pr.sale_line_id is not null
    and sl.id = pr.sale_line_id
    and sl.tenant_id = pr.tenant_id
    and sl.sale_id is not null;

  get diagnostics v_request_backfill_count = row_count;

  select count(*)
  into v_conflict_count
  from public.paperwork_documents pd
  join public.paperwork_requests pr
    on pr.id = pd.paperwork_request_id
   and pr.tenant_id = pd.tenant_id
  left join public.showroom_sale_lines sl
    on sl.id = pr.sale_line_id
   and sl.tenant_id = pr.tenant_id
  where pd.sale_id is not null
    and coalesce(pr.sale_id, sl.sale_id) is not null
    and pd.sale_id is distinct from coalesce(pr.sale_id, sl.sale_id);

  raise notice 'paperwork document/request sale conflicts before backfill: %', v_conflict_count;

  -- paperwork_request is the authoritative source. Existing document values,
  -- including conflicts, are replaced by the request's confirmed invoice.
  update public.paperwork_documents pd
  set sale_id = coalesce(pr.sale_id, sl.sale_id)
  from public.paperwork_requests pr
  left join public.showroom_sale_lines sl
    on sl.id = pr.sale_line_id
   and sl.tenant_id = pr.tenant_id
  where pd.paperwork_request_id = pr.id
    and pd.tenant_id = pr.tenant_id
    and pd.sale_id is distinct from coalesce(pr.sale_id, sl.sale_id);

  get diagnostics v_document_backfill_count = row_count;

  select count(*)
  into v_unresolved_document_count
  from public.paperwork_documents pd
  join public.paperwork_requests pr
    on pr.id = pd.paperwork_request_id
   and pr.tenant_id = pd.tenant_id
  where pd.sale_id is null;

  raise notice 'paperwork requests sale_id backfilled: %', v_request_backfill_count;
  raise notice 'paperwork documents sale_id backfilled: %', v_document_backfill_count;
  raise notice 'linked paperwork documents still without a confirmed sale: %', v_unresolved_document_count;
end;
$$;

create or replace function public.sync_paperwork_document_sale_from_request()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_request_sale_id uuid;
begin
  if new.paperwork_request_id is null then
    return new;
  end if;

  select coalesce(pr.sale_id, sl.sale_id)
  into v_request_sale_id
  from public.paperwork_requests pr
  left join public.showroom_sale_lines sl
    on sl.id = pr.sale_line_id
   and sl.tenant_id = pr.tenant_id
  where pr.id = new.paperwork_request_id
    and pr.tenant_id = new.tenant_id;

  if not found then
    raise exception 'طلب الأوراق المرتبط غير موجود داخل نفس المنشأة.';
  end if;

  new.sale_id := v_request_sale_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_paperwork_document_sale_from_request
on public.paperwork_documents;

create trigger trg_sync_paperwork_document_sale_from_request
before insert or update of paperwork_request_id, tenant_id, sale_id
on public.paperwork_documents
for each row
execute function public.sync_paperwork_document_sale_from_request();

create or replace function public.sync_linked_paperwork_documents_sale()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_sale_id uuid;
begin
  v_sale_id := new.sale_id;

  if v_sale_id is null and new.sale_line_id is not null then
    select sl.sale_id
    into v_sale_id
    from public.showroom_sale_lines sl
    where sl.tenant_id = new.tenant_id
      and sl.id = new.sale_line_id;
  end if;

  update public.paperwork_documents
  set sale_id = v_sale_id
  where tenant_id = new.tenant_id
    and paperwork_request_id = new.id
    and sale_id is distinct from v_sale_id;

  return new;
end;
$$;

drop trigger if exists trg_sync_linked_paperwork_documents_sale
on public.paperwork_requests;

create trigger trg_sync_linked_paperwork_documents_sale
after update of sale_id, sale_line_id
on public.paperwork_requests
for each row
when (
  old.sale_id is distinct from new.sale_id
  or old.sale_line_id is distinct from new.sale_line_id
)
execute function public.sync_linked_paperwork_documents_sale();

create or replace function public.receive_paperwork_request_from_processor(
  p_tenant_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_request public.paperwork_requests;
  v_document public.paperwork_documents;
  v_old_stage text;
  v_sale_id uuid;
  v_document_owner_name text;
  v_now timestamptz := now();
  v_notes text := 'تم استلام الأوراق من الجهة وإيداعها بالخزنة.';
begin
  if p_tenant_id is null or p_request_id is null then
    raise exception 'تعذر تحديد الشركة أو طلب الأوراق.';
  end if;

  select tu.id
  into v_user_id
  from public.tenant_users tu
  where tu.tenant_id = p_tenant_id
    and tu.auth_user_id = auth.uid()
    and tu.is_active = true
  limit 1;

  if v_user_id is null then
    raise exception 'Current user is not an active tenant user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_request_id::text, 0));

  select pr.*
  into v_request
  from public.paperwork_requests pr
  where pr.tenant_id = p_tenant_id
    and pr.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'طلب الأوراق غير موجود.';
  end if;

  if v_request.current_stage not in ('sent_to_processor', 'processor_ready') then
    raise exception 'لا يمكن استلام طلب ليس موجودًا لدى الجهة.';
  end if;

  if v_request.status <> 'open' then
    raise exception 'لا يمكن استلام طلب غير مفتوح.';
  end if;

  if v_request.customer_id is null then
    raise exception 'لا يمكن استلام الورقة لأن طلب الأوراق لا يحتوي على عميل مرتبط.';
  end if;

  v_document_owner_name := nullif(trim(coalesce(v_request.document_owner_name, '')), '');
  if v_document_owner_name is null then
    raise exception 'اسم صاحب الجواب غير مسجل في طلب الأوراق.';
  end if;

  v_sale_id := v_request.sale_id;
  if v_sale_id is null and v_request.sale_line_id is not null then
    select sl.sale_id
    into v_sale_id
    from public.showroom_sale_lines sl
    where sl.tenant_id = p_tenant_id
      and sl.id = v_request.sale_line_id;

    if v_sale_id is not null then
      update public.paperwork_requests
      set sale_id = v_sale_id,
          updated_at = v_now
      where id = v_request.id;
      v_request.sale_id := v_sale_id;
    end if;
  end if;

  v_old_stage := v_request.current_stage;

  update public.paperwork_requests
  set current_stage = 'received_from_processor',
      updated_at = v_now
  where id = v_request.id;

  select pd.*
  into v_document
  from public.paperwork_documents pd
  where pd.tenant_id = p_tenant_id
    and pd.paperwork_request_id = v_request.id
  order by pd.created_at asc
  limit 1
  for update;

  if v_document.id is null then
    insert into public.paperwork_documents (
      tenant_id, branch_id, paperwork_request_id, sale_id, tracking_unit_id,
      owner_partner_id, document_owner_name, source_type, document_type,
      document_title, status, notes, created_by
    ) values (
      p_tenant_id, v_request.branch_id, v_request.id, v_sale_id, v_request.tracking_unit_id,
      v_request.customer_id, v_document_owner_name, 'paperwork_request', 'jawab',
      'جواب', 'in_custody', v_notes, v_user_id
    )
    returning * into v_document;
  else
    update public.paperwork_documents
    set sale_id = v_sale_id,
        owner_partner_id = v_request.customer_id,
        document_owner_name = v_document_owner_name,
        status = 'in_custody',
        updated_at = v_now
    where id = v_document.id
    returning * into v_document;
  end if;

  insert into public.paperwork_document_moves (
    tenant_id, document_id, move_direction, source_type, from_partner_id,
    to_user_id, to_location, moved_at, notes, created_by
  ) values (
    p_tenant_id, v_document.id, 'in', 'from_processor', v_request.processor_partner_id,
    v_user_id, 'vault', v_now, v_notes, v_user_id
  );

  insert into public.paperwork_request_events (
    tenant_id, request_id, event_type, old_stage, new_stage, notes, created_by
  ) values (
    p_tenant_id, v_request.id, 'received_from_supplier', v_old_stage,
    'received_from_processor', v_notes, v_user_id
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'document_id', v_document.id,
    'sale_id', v_document.sale_id,
    'old_stage', v_old_stage,
    'current_stage', 'received_from_processor',
    'updated_at', v_now
  );
end;
$$;

grant execute on function public.receive_paperwork_request_from_processor(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
