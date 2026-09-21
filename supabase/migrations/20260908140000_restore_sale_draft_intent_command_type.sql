begin;

-- Cancellation/return lifecycle migrations rebuilt this enum-like check after
-- the draft inventory-intent command had been introduced, but omitted its
-- command type. Exchange creates its replacement through the ordinary draft
-- contract, so retain every currently supported Sales command type here.
alter table public.sales_command_requests
  drop constraint sales_command_requests_type_check,
  add constraint sales_command_requests_type_check check (
    command_type in (
      'create',
      'update_draft',
      'update_draft_with_intent',
      'confirm',
      'deliver',
      'cancel',
      'return'
    )
  );

commit;
