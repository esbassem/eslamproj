begin;

alter table if exists public.sales_operations
  add column if not exists contract_note text;

comment on column public.sales_operations.contract_note is
'Optional sale-level note intended to appear on the generated showroom contract.';

commit;
