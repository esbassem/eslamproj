begin;

alter table public.financial_internal_transfer_events
  drop constraint financial_internal_transfer_events_event_type_check,
  add constraint financial_internal_transfer_events_event_type_check
    check(event_type in ('created','send','receive','confirm'));

comment on column public.financial_internal_transfer_events.event_type is
  'Append-only idempotent command outcome: created, send, receive, or confirm. to_status records draft, sent, received, or confirmed lifecycle state.';

commit;
