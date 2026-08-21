-- Customer notification is no longer part of the Paperwork runtime workflow.
-- Historical event rows are deliberately retained for audit continuity.

drop function if exists public.notify_paperwork_customer(uuid, uuid, text, text);
drop function if exists public.notify_paperwork_customer(uuid, uuid);

drop index if exists public.paperwork_requests_customer_notification_queue_idx;

alter table public.paperwork_requests
  drop constraint if exists paperwork_requests_customer_notification_channel_check,
  drop constraint if exists paperwork_requests_customer_notified_by_fkey;

alter table public.paperwork_requests
  drop column if exists customer_notification_notes,
  drop column if exists customer_notification_channel,
  drop column if exists customer_notified_by,
  drop column if exists customer_notified_at;

alter table public.paperwork_request_events
  drop constraint if exists paperwork_request_events_event_type_check;

-- NOT VALID preserves pre-existing customer_notified/client_notified audit rows,
-- while PostgreSQL still enforces this allow-list for every new or updated row.
alter table public.paperwork_request_events
  add constraint paperwork_request_events_event_type_check
  check (event_type in (
    'created', 'stage_changed', 'assigned', 'supplier_selected',
    'sent_to_supplier', 'sent_to_processor', 'supplier_finished',
    'received_from_supplier', 'delivered_to_customer', 'blocked',
    'unblocked', 'deferred', 'done', 'cancelled', 'reopened', 'note',
    'processor_cancellation_required_by_sale_return',
    'processor_cancellation_confirmed',
    'paperwork_request_cancelled_by_sale_replacement',
    'paperwork_request_cancelled_by_sale_return',
    'created_from_sale_return_exchange'
  )) not valid;
