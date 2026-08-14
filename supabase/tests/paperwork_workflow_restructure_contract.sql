begin;

do $$
declare
  v_legacy_count integer;
  v_open_delivered_count integer;
  v_stage_constraint text;
  v_send_definition text;
  v_receive_definition text;
begin
  select count(*) into v_legacy_count
  from public.paperwork_requests
  where current_stage in ('owner_confirmation', 'processor_ready', 'client_notified');
  if v_legacy_count <> 0 then
    raise exception 'Retired paperwork stages remain: %', v_legacy_count;
  end if;

  select count(*) into v_open_delivered_count
  from public.paperwork_requests r
  join public.paperwork_documents d
    on d.tenant_id = r.tenant_id and d.paperwork_request_id = r.id
  where r.status = 'open' and d.status = 'delivered';
  if v_open_delivered_count <> 0 then
    raise exception 'Open requests with delivered documents remain: %', v_open_delivered_count;
  end if;

  select pg_get_constraintdef(oid) into v_stage_constraint
  from pg_constraint
  where conrelid = 'public.paperwork_requests'::regclass
    and conname = 'paperwork_requests_current_stage_check';
  if v_stage_constraint is null
     or v_stage_constraint like '%owner_confirmation%'
     or v_stage_constraint like '%client_notified%' then
    raise exception 'Paperwork stage constraint still permits a retired stage.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'paperwork_requests'
      and column_name in ('processor_ready_at', 'processor_ready_by', 'processor_ready_notes')
  ) then
    raise exception 'Processor-ready metadata columns still exist.';
  end if;

  v_send_definition := pg_get_functiondef(
    'public.send_paperwork_request_to_processor(uuid,uuid,text)'::regprocedure
  );
  if position('current_stage = ''sent_to_processor''' in v_send_definition) = 0
     or position('paperwork_documents' in v_send_definition) = 0
     or position('insert into public.paperwork_documents' in lower(v_send_definition)) > 0 then
    raise exception 'Send RPC does not preserve the expected stage/document contract.';
  end if;

  v_receive_definition := pg_get_functiondef(
    'public.receive_paperwork_request_from_processor(uuid,uuid)'::regprocedure
  );
  if position('current_stage <> ''sent_to_processor''' in v_receive_definition) = 0
     or position('status <> ''open''' in v_receive_definition) = 0
     or position('insert into public.paperwork_documents' in lower(v_receive_definition)) = 0
     or position('insert into public.paperwork_document_moves' in lower(v_receive_definition)) = 0
     or position('received_from_processor' in v_receive_definition) = 0 then
    raise exception 'Receipt RPC does not implement the direct processor-to-vault transition.';
  end if;
end;
$$;

do $$
declare
  v_signature text;
begin
  foreach v_signature in array array[
    'public.send_paperwork_request_to_processor(uuid,uuid,text)',
    'public.notify_paperwork_customer(uuid,uuid,text,text)',
    'public.receive_paperwork_request_from_processor(uuid,uuid)',
    'public.deliver_paperwork_to_customer(uuid,uuid)'
  ] loop
    if to_regprocedure(v_signature) is null then
      raise exception 'Required paperwork RPC is missing: %', v_signature;
    end if;
  end loop;

  if to_regprocedure('public.mark_paperwork_processor_ready(uuid,uuid,text)') is not null then
    raise exception 'Removed processor-ready RPC is still callable.';
  end if;
end;
$$;

rollback;
