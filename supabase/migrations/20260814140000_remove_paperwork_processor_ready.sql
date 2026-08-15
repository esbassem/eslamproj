begin;

-- Processor readiness was briefly introduced by 20260814130000. It is not part
-- of the final workflow. Refuse silent data loss if it was ever used.
do $$
declare
  v_metadata_rows integer;
  v_ready_events integer;
  v_runtime_dependencies text;
begin
  select count(*) into v_metadata_rows
  from public.paperwork_requests
  where processor_ready_at is not null
     or processor_ready_by is not null
     or processor_ready_notes is not null;

  if v_metadata_rows <> 0 then
    raise exception 'Processor-ready metadata exists on % request(s); review before removal.', v_metadata_rows;
  end if;

  select count(*) into v_ready_events
  from public.paperwork_request_events
  where event_type = 'processor_marked_ready';

  if v_ready_events <> 0 then
    raise exception 'Processor-ready history contains % event(s); review before changing the event constraint.', v_ready_events;
  end if;

  select string_agg(format('%I(%s)', p.proname, pg_get_function_identity_arguments(p.oid)), ', ')
  into v_runtime_dependencies
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and p.proname <> 'mark_paperwork_processor_ready'
    and (
      pg_get_functiondef(p.oid) ilike '%processor_ready%'
      or pg_get_functiondef(p.oid) ilike '%processor_marked_ready%'
    );

  if v_runtime_dependencies is not null then
    raise exception 'Live functions still depend on processor readiness: %', v_runtime_dependencies;
  end if;
end;
$$;

drop function if exists public.mark_paperwork_processor_ready(uuid, uuid, text);
drop index if exists public.paperwork_requests_processor_ready_queue_idx;

alter table public.paperwork_requests
  drop constraint if exists paperwork_requests_processor_ready_by_fkey;

alter table public.paperwork_requests
  drop column if exists processor_ready_at,
  drop column if exists processor_ready_by,
  drop column if exists processor_ready_notes;

alter table public.paperwork_request_events
  drop constraint if exists paperwork_request_events_event_type_check;

alter table public.paperwork_request_events
  add constraint paperwork_request_events_event_type_check
  check (event_type in (
    'created', 'stage_changed', 'assigned', 'supplier_selected',
    'sent_to_supplier', 'sent_to_processor', 'supplier_finished',
    'received_from_supplier', 'client_notified', 'customer_notified',
    'delivered_to_customer', 'blocked', 'unblocked', 'deferred', 'done',
    'cancelled', 'note',
    'processor_cancellation_required_by_sale_return',
    'processor_cancellation_confirmed',
    'paperwork_request_cancelled_by_sale_replacement',
    'paperwork_request_cancelled_by_sale_return',
    'created_from_sale_return_exchange'
  ));

do $$
declare
  v_receive_definition text;
begin
  v_receive_definition := pg_get_functiondef(
    'public.receive_paperwork_request_from_processor(uuid,uuid)'::regprocedure
  );

  if position('current_stage <> ''sent_to_processor''' in v_receive_definition) = 0
     or position('status <> ''open''' in v_receive_definition) = 0 then
    raise exception 'Receipt RPC no longer enforces direct sent_to_processor/open transition.';
  end if;
end;
$$;

notify pgrst, 'reload schema';
commit;
