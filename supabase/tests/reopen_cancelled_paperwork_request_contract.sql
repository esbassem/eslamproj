begin;

do $$
declare
  v_definition text := pg_get_functiondef(
    'public.reopen_cancelled_paperwork_request(uuid,uuid,text)'::regprocedure
  );
begin
  if position('event_type = ''cancelled''' in v_definition) = 0 then
    raise exception 'TEST_FAILED: manual cancellation event guard is missing';
  end if;
  if position('v_cancellation_event.old_stage' in v_definition) = 0 then
    raise exception 'TEST_FAILED: previous stage restoration is missing';
  end if;
  if position('other_request.status <> ''cancelled''' in v_definition) = 0 then
    raise exception 'TEST_FAILED: duplicate active sale-line guard is missing';
  end if;
  if position('paperwork_documents' in v_definition) = 0 then
    raise exception 'TEST_FAILED: linked document guard is missing';
  end if;
  if position('is_tenant_owner' in v_definition) = 0 then
    raise exception 'TEST_FAILED: owner authorization is missing';
  end if;
  if position('''reopened''' in v_definition) = 0 then
    raise exception 'TEST_FAILED: reopen audit event is missing';
  end if;
end;
$$;

rollback;
