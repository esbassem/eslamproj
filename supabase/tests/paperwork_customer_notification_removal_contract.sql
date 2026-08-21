begin;

do $$
declare
  v_constraint_definition text;
  v_constraint_validated boolean;
  v_request record;
  v_event_type text;
begin
  if to_regprocedure('public.notify_paperwork_customer(uuid,uuid,text,text)') is not null
     or to_regprocedure('public.notify_paperwork_customer(uuid,uuid)') is not null then
    raise exception 'Removed customer-notification RPC still exists.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paperwork_requests'
      and column_name in (
        'customer_notified_at', 'customer_notified_by',
        'customer_notification_channel', 'customer_notification_notes'
      )
  ) then
    raise exception 'Removed customer-notification column still exists.';
  end if;

  if to_regclass('public.paperwork_requests_customer_notification_queue_idx') is not null then
    raise exception 'Removed customer-notification queue index still exists.';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.paperwork_requests'::regclass
      and conname in (
        'paperwork_requests_customer_notification_channel_check',
        'paperwork_requests_customer_notified_by_fkey'
      )
  ) then
    raise exception 'Removed customer-notification request constraint still exists.';
  end if;

  select pg_get_constraintdef(oid), convalidated
  into v_constraint_definition, v_constraint_validated
  from pg_constraint
  where conrelid = 'public.paperwork_request_events'::regclass
    and conname = 'paperwork_request_events_event_type_check';

  if v_constraint_definition is null
     or v_constraint_definition like '%customer_notified%'
     or v_constraint_definition like '%client_notified%'
     or v_constraint_validated then
    raise exception 'Paperwork event allow-list does not preserve history safely.';
  end if;

  -- Reading any retained legacy audit rows must continue to work.
  perform count(*)
  from public.paperwork_request_events
  where event_type in ('customer_notified', 'client_notified');

  select tenant_id, id into v_request
  from public.paperwork_requests
  limit 1;

  if v_request.id is not null then
    foreach v_event_type in array array['customer_notified', 'client_notified'] loop
      begin
        insert into public.paperwork_request_events (tenant_id, request_id, event_type)
        values (v_request.tenant_id, v_request.id, v_event_type);
        raise exception 'Removed event type was accepted: %', v_event_type;
      exception
        when check_violation then null;
      end;
    end loop;
  end if;
end;
$$;

rollback;
