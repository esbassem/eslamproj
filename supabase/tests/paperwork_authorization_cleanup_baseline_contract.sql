begin;

do $$
declare
  v_name text;
  v_definition text;
  v_table text;
begin
  if to_regprocedure('public.can_manage_paperwork_requests(uuid)') is not null then
    raise exception 'Legacy role capability still exists.';
  end if;

  foreach v_name in array array[
    'public.cancel_paperwork_request(uuid,uuid,text,text,boolean)',
    'public.reopen_cancelled_paperwork_request(uuid,uuid,text)',
    'public.record_previous_customer_paperwork_delivery(uuid,uuid,text,text)',
    'public.link_existing_vault_document_to_request(uuid,uuid,uuid,text)',
    'public.confirm_processor_paperwork_cancellation(uuid,uuid,text)',
    'public.create_legacy_delivered_paperwork_request(uuid,uuid,uuid,uuid,uuid,uuid,text)',
    'public.record_previous_customer_paperwork_delivery_bulk(uuid,uuid[],text,text)'
  ] loop
    select pg_get_functiondef(to_regprocedure(v_name)) into v_definition;
    if v_definition is null or position('require_paperwork_action' in v_definition) = 0
       or position('is_tenant_owner' in v_definition) > 0 then
      raise exception 'Exceptional request function is not action-permission protected: %', v_name;
    end if;
    if position('can_manage_paperwork_requests' in v_definition) > 0 then
      raise exception 'Exceptional function still references legacy capability: %', v_name;
    end if;
  end loop;

  if to_regprocedure('public.receive_paperwork_request_from_processor_with_owner(uuid,uuid,text)') is null
     or to_regprocedure('public.confirm_sale_paperwork_request_with_processor(uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,jsonb,boolean,text,uuid)') is null then
    raise exception 'Atomic Paperwork commands are missing.';
  end if;

  foreach v_table in array array['paperwork_requests', 'paperwork_request_events', 'paperwork_documents', 'paperwork_document_moves'] loop
    if exists (select 1 from pg_policies where schemaname='public' and tablename=v_table and cmd<>'SELECT' and policyname<>'paperwork_app_access_boundary') then
      raise exception 'Direct-write RLS policy remains on %', v_table;
    end if;
    if has_table_privilege('authenticated', format('public.%I',v_table), 'INSERT')
       or has_table_privilege('authenticated', format('public.%I',v_table), 'UPDATE')
       or has_table_privilege('authenticated', format('public.%I',v_table), 'DELETE')
       or has_table_privilege('authenticated', format('public.%I',v_table), 'TRUNCATE')
       or has_table_privilege('authenticated', format('public.%I',v_table), 'REFERENCES')
       or has_table_privilege('authenticated', format('public.%I',v_table), 'TRIGGER') then
      raise exception 'Authenticated direct-write grant remains on %', v_table;
    end if;
    if not has_table_privilege('authenticated', format('public.%I',v_table), 'SELECT') then
      raise exception 'Authenticated read grant is missing on %', v_table;
    end if;
  end loop;
end
$$;

rollback;
