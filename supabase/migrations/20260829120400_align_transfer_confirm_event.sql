begin;

alter table public.financial_internal_transfer_events
  drop constraint financial_internal_transfer_events_event_type_check,
  add constraint financial_internal_transfer_events_event_type_check
    check(event_type in ('created','sent','received','confirm'));

comment on column public.financial_internal_transfer_events.event_type is
  'Append-only command outcome: created, sent, received, or confirm. confirm is the idempotency action name; to_status records the canonical confirmed state.';

commit;
