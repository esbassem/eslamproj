begin;

do $$
declare
  v_auth_user_id uuid;
  v_tenant_id uuid;
  v_request_id uuid;
  v_document_id uuid;
  v_customer_id uuid;
  v_sale_id uuid;
  v_partner_name text;
  v_expected_document_name text := 'اسم صاحب الورق المستقل - اختبار';
  v_result jsonb;
begin
  select
    tu.auth_user_id,
    pr.tenant_id,
    pr.id,
    pd.id,
    pr.customer_id,
    coalesce(pr.sale_id, sale_line.sale_id),
    customer.name
  into
    v_auth_user_id,
    v_tenant_id,
    v_request_id,
    v_document_id,
    v_customer_id,
    v_sale_id,
    v_partner_name
  from public.paperwork_requests pr
  join public.paperwork_documents pd
    on pd.tenant_id = pr.tenant_id
   and pd.paperwork_request_id = pr.id
  join public.partners customer
    on customer.tenant_id = pr.tenant_id
   and customer.id = pr.customer_id
  left join public.showroom_sale_lines sale_line
    on sale_line.tenant_id = pr.tenant_id
   and sale_line.id = pr.sale_line_id
  join public.tenant_users tu
    on tu.tenant_id = pr.tenant_id
   and tu.is_active = true
   and tu.auth_user_id is not null
  where pr.status = 'open'
    and pr.current_stage in ('sent_to_processor', 'processor_ready')
    and pr.customer_id is not null
    and pd.source_type = 'paperwork_request'
  order by pr.created_at, pr.id
  limit 1;

  if v_request_id is null then
    raise exception 'TEST_SETUP: no processor-stage request with an existing paperwork document';
  end if;

  if v_partner_name = v_expected_document_name then
    v_expected_document_name := v_expected_document_name || ' 2';
  end if;

  perform set_config('request.jwt.claim.sub', v_auth_user_id::text, true);

  update public.paperwork_requests
  set document_owner_name = v_expected_document_name
  where id = v_request_id;

  update public.paperwork_documents
  set document_owner_name = 'قيمة قديمة يجب استبدالها'
  where id = v_document_id;

  v_result := public.receive_paperwork_request_from_processor(v_tenant_id, v_request_id);

  if (v_result ->> 'document_id')::uuid <> v_document_id then
    raise exception 'TEST_FAILED: receipt created another document instead of updating the existing one';
  end if;

  if not exists (
    select 1
    from public.paperwork_documents pd
    where pd.id = v_document_id
      and pd.paperwork_request_id = v_request_id
      and pd.source_type = 'paperwork_request'
      and pd.status = 'in_custody'
      and pd.sale_id is not distinct from v_sale_id
      and pd.owner_partner_id = v_customer_id
      and pd.document_owner_name = v_expected_document_name
  ) then
    raise exception 'TEST_FAILED: in-custody document identity does not match the request';
  end if;

  if (
    select pd.document_owner_name = customer.name
    from public.paperwork_documents pd
    join public.partners customer on customer.id = pd.owner_partner_id
    where pd.id = v_document_id
  ) then
    raise exception 'TEST_FAILED: partner name was used as the document owner name';
  end if;

  if (select current_stage from public.paperwork_requests where id = v_request_id) <> 'received_from_processor' then
    raise exception 'TEST_FAILED: request did not reach received_from_processor';
  end if;

  raise notice 'receive_paperwork_request_from_processor runtime tests passed';
end;
$$;

rollback;
