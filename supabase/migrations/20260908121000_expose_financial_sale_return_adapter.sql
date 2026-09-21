begin;

-- The adapter is a reusable Financial Core boundary. It remains fail-closed:
-- direct callers need financial.sale.return; return_sale uses its narrowly
-- matched in-transaction Sales command context.
grant execute on function public.post_financial_sale_return(uuid, uuid, text)
  to authenticated;

comment on function public.post_financial_sale_return(uuid, uuid, text) is
  'Reusable Financial Core Sale Return adapter. It accepts no account, journal or debit/credit input and derives all posting semantics from the immutable Sale Return fact.';

notify pgrst, 'reload schema';

commit;
