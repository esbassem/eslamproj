begin;

do $$
declare
  v_definition text := pg_get_functiondef(
    'public.cancel_paperwork_request(uuid,uuid,text,text,boolean)'::regprocedure
  );
begin
  if position('p_processor_cancellation_confirmed' in v_definition) = 0 then
    raise exception 'TEST_FAILED: issuer confirmation is not required';
  end if;
  if position('v_request.current_stage not in' in v_definition) = 0
     or position('sent_to_processor' in v_definition) = 0 then
    raise exception 'TEST_FAILED: cancellable-stage allowlist is missing';
  end if;
  if position('paperwork_documents' in v_definition) = 0 then
    raise exception 'TEST_FAILED: linked document guard is missing';
  end if;
  if position('paperwork_request_events' in v_definition) = 0 then
    raise exception 'TEST_FAILED: cancellation audit event is missing';
  end if;
  if position('require_paperwork_action(p_tenant_id, ''paperwork.cancel'')' in v_definition) = 0
     or position('is_tenant_owner' in v_definition) > 0 then
    raise exception 'TEST_FAILED: paperwork.cancel authorization is missing';
  end if;
end;
$$;

rollback;
