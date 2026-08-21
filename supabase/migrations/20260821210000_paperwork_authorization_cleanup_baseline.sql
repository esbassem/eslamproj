begin;

-- Keep exceptional Paperwork operations temporarily restricted to tenant owners.
do $$
declare
  v_signature text;
  v_definition text;
  v_rewritten text;
begin
  foreach v_signature in array array[
    'public.link_existing_vault_document_to_request(uuid,uuid,uuid,text)',
    'public.create_legacy_delivered_paperwork_request(uuid,uuid,uuid,uuid,uuid,uuid,text)',
    'public.record_previous_customer_paperwork_delivery_bulk(uuid,uuid[],text,text)'
  ] loop
    select pg_get_functiondef(to_regprocedure(v_signature)) into v_definition;
    if v_definition is null then
      raise exception 'Required Paperwork function is missing: %', v_signature;
    end if;
    if position('is_tenant_owner' in v_definition) = 0 then
      v_rewritten := regexp_replace(
        v_definition,
        E'\nbegin\n',
        E'\nbegin\n  if not public.is_tenant_owner(p_tenant_id) then\n    raise exception ''هذا الإجراء متاح لمالك الشركة فقط.'' using errcode = ''42501'';\n  end if;\n',
        'i'
      );
      if v_rewritten = v_definition then
        raise exception 'Could not inject owner guard into %', v_signature;
      end if;
      execute v_rewritten;
    end if;
  end loop;

  select pg_get_functiondef(
    'public.confirm_processor_paperwork_cancellation(uuid,uuid,text)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    'public.can_manage_paperwork_requests(p_tenant_id)',
    'public.is_tenant_owner(p_tenant_id)'
  );
  if v_rewritten = v_definition then
    raise exception 'Processor cancellation did not contain the expected legacy capability check.';
  end if;
  execute v_rewritten;
end
$$;

drop function if exists public.can_manage_paperwork_requests(uuid);

-- Atomically persist an optional owner name and receive a request from the processor.
create or replace function public.receive_paperwork_request_from_processor_with_owner(
  p_tenant_id uuid,
  p_request_id uuid,
  p_document_owner_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_name text := nullif(btrim(coalesce(p_document_owner_name, '')), '');
  v_result jsonb;
begin
  perform public.require_paperwork_access(p_tenant_id);

  if p_request_id is null then
    raise exception 'تعذر تحديد طلب الأوراق.';
  end if;

  perform 1
  from public.paperwork_requests
  where tenant_id = p_tenant_id and id = p_request_id
  for update;
  if not found then
    raise exception 'طلب الأوراق غير موجود.';
  end if;

  if v_owner_name is not null then
    update public.paperwork_requests
    set document_owner_name = v_owner_name,
        updated_at = clock_timestamp()
    where tenant_id = p_tenant_id and id = p_request_id;
  end if;

  v_result := public.receive_paperwork_request_from_processor(p_tenant_id, p_request_id);
  return v_result;
end
$$;

revoke all on function public.receive_paperwork_request_from_processor_with_owner(uuid,uuid,text) from public, anon;
grant execute on function public.receive_paperwork_request_from_processor_with_owner(uuid,uuid,text) to authenticated;

-- Create/update the sale request and assign its processor in one database transaction.
create or replace function public.confirm_sale_paperwork_request_with_processor(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_sale_id uuid,
  p_sale_line_id uuid,
  p_tracking_unit_id uuid,
  p_customer_id uuid,
  p_document_owner_status text,
  p_document_owner_name text default null,
  p_document_owner_national_id text default null,
  p_document_owner_note text default null,
  p_owner_attachment jsonb default null,
  p_tracking_photos_ignored boolean default false,
  p_tracking_photos_ignore_reason text default null,
  p_processor_partner_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_request_id uuid;
begin
  perform public.require_paperwork_access(p_tenant_id);

  if p_processor_partner_id is not null and not exists (
    select 1 from public.partners
    where tenant_id = p_tenant_id and id = p_processor_partner_id
  ) then
    raise exception 'جهة إصدار الأوراق غير موجودة داخل الشركة.';
  end if;

  v_result := public.confirm_sale_paperwork_request(
    p_tenant_id,
    p_branch_id,
    p_sale_id,
    p_sale_line_id,
    p_tracking_unit_id,
    p_customer_id,
    p_document_owner_status,
    p_document_owner_name,
    p_document_owner_national_id,
    p_document_owner_note,
    p_owner_attachment,
    p_tracking_photos_ignored,
    p_tracking_photos_ignore_reason
  );

  v_request_id := nullif(v_result ->> 'id', '')::uuid;
  if p_processor_partner_id is not null then
    update public.paperwork_requests
    set processor_partner_id = p_processor_partner_id,
        updated_at = clock_timestamp()
    where tenant_id = p_tenant_id and id = v_request_id;
    if not found then
      raise exception 'تعذر ربط جهة الإصدار بطلب الأوراق.';
    end if;

    if p_tracking_unit_id is not null then
      update public.stock_tracking_units
      set paperwork_processor_partner_id = p_processor_partner_id,
          updated_at = clock_timestamp()
      where tenant_id = p_tenant_id and id = p_tracking_unit_id;
      if not found then
        raise exception 'تعذر ربط جهة الإصدار بالقطعة.';
      end if;
    end if;
  end if;

  return v_result || jsonb_build_object('processor_partner_id', p_processor_partner_id);
end
$$;

revoke all on function public.confirm_sale_paperwork_request_with_processor(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,boolean,text,uuid) from public, anon;
grant execute on function public.confirm_sale_paperwork_request_with_processor(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,boolean,text,uuid) to authenticated;

-- Business writes are RPC-only. Preserve tenant-wide reads behind the app boundary.
do $$
declare
  v_policy record;
  v_table text;
begin
  foreach v_table in array array[
    'paperwork_requests',
    'paperwork_request_events',
    'paperwork_documents',
    'paperwork_document_moves'
  ] loop
    for v_policy in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and cmd <> 'SELECT'
        and policyname <> 'paperwork_app_access_boundary'
    loop
      execute format('drop policy if exists %I on public.%I', v_policy.policyname, v_table);
    end loop;
  end loop;
end
$$;

drop policy if exists paperwork_documents_read_access on public.paperwork_documents;
create policy paperwork_documents_read_access on public.paperwork_documents
for select to authenticated using (public.can_access_paperwork(tenant_id));

drop policy if exists paperwork_document_moves_read_access on public.paperwork_document_moves;
create policy paperwork_document_moves_read_access on public.paperwork_document_moves
for select to authenticated using (public.can_access_paperwork(tenant_id));

revoke insert, update, delete on table public.paperwork_requests from public, anon, authenticated;
revoke insert, update, delete on table public.paperwork_request_events from public, anon, authenticated;
revoke insert, update, delete on table public.paperwork_documents from public, anon, authenticated;
revoke insert, update, delete on table public.paperwork_document_moves from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
