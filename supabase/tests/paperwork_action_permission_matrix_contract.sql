begin;

do $$
declare
  v_mapping record;
  v_function record;
  v_count integer := 0;
  v_expected_codes constant text[] := array[
    'paperwork.send', 'paperwork.receive', 'paperwork.deliver',
    'paperwork.cancel', 'paperwork.correct', 'paperwork.authorize_release'
  ];
begin
  if (select count(*) from public.auth_permissions where code='paperwork.access' and active and permission_type='app_access') <> 1
     or (select count(*) from public.auth_permissions where module_code='paperwork' and active and permission_type='action') <> 6
     or (select count(*) from public.auth_permissions where module_code='paperwork' and active) <> 7 then
    raise exception 'TEST_FAILED: Paperwork catalog must contain one app access and six actions.';
  end if;
  if exists (
    select 1 from public.auth_permissions
    where module_code='paperwork' and active and permission_type='action'
      and not (code=any(v_expected_codes))
  ) then raise exception 'TEST_FAILED: unexpected Paperwork action code.'; end if;
  if exists (
    select 1 from public.auth_group_permissions grant_row
    join public.auth_permissions permission on permission.id=grant_row.permission_id
    where permission.code=any(v_expected_codes)
  ) then raise exception 'TEST_FAILED: action permission was automatically granted.'; end if;

  for v_mapping in select * from (values
    ('send_paperwork_request_to_processor','paperwork.send'),
    ('confirm_sale_paperwork_request','paperwork.send'),
    ('confirm_sale_paperwork_request_with_processor','paperwork.send'),
    ('receive_paperwork_request_from_processor','paperwork.receive'),
    ('receive_paperwork_request_from_processor_with_owner','paperwork.receive'),
    ('create_manual_paperwork_receipt','paperwork.receive'),
    ('deliver_paperwork_to_customer','paperwork.deliver'),
    ('cancel_paperwork_request','paperwork.cancel'),
    ('reopen_cancelled_paperwork_request','paperwork.cancel'),
    ('confirm_processor_paperwork_cancellation','paperwork.cancel'),
    ('cancel_paperwork_document','paperwork.cancel'),
    ('link_existing_vault_document_to_request','paperwork.correct'),
    ('record_previous_customer_paperwork_delivery','paperwork.correct'),
    ('record_previous_customer_paperwork_delivery_bulk','paperwork.correct'),
    ('record_previous_paperwork_document_delivery','paperwork.correct'),
    ('set_paperwork_document_owner_partner','paperwork.correct'),
    ('create_legacy_delivered_paperwork_request','paperwork.correct'),
    ('link_vault_paperwork_request','paperwork.correct'),
    ('authorize_paperwork_document_release','paperwork.authorize_release')
  ) mapping(function_name,permission_code)
  loop
    for v_function in
      select p.oid,pg_get_functiondef(p.oid) definition from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.prokind='f' and p.proname=v_mapping.function_name
        and pg_get_function_identity_arguments(p.oid) ilike '%p_tenant_id uuid%'
    loop
      v_count:=v_count+1;
      if position('require_paperwork_access(p_tenant_id)' in v_function.definition)=0
         or position('require_paperwork_action(p_tenant_id, '''||v_mapping.permission_code||''')' in v_function.definition)=0
         or position('is_tenant_owner(p_tenant_id)' in v_function.definition)>0 then
        raise exception 'TEST_FAILED: incorrect authorization mapping for %',v_function.oid::regprocedure;
      end if;
    end loop;
  end loop;
  if v_count<>20 then raise exception 'TEST_FAILED: expected 20 mapped RPC signatures, found %',v_count; end if;

  if exists (
    select 1 from information_schema.role_table_grants
    where grantee='authenticated' and table_schema='public'
      and table_name=any(array['paperwork_requests','paperwork_request_events','paperwork_documents','paperwork_document_moves'])
      and privilege_type<>'SELECT'
  ) then raise exception 'TEST_FAILED: Paperwork business tables are not SELECT-only.'; end if;
end
$$;

rollback;
