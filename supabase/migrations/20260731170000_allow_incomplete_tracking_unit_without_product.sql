begin;

-- An incomplete tracking unit may not have a known product yet. Its business
-- state is represented by data_status/incomplete_reason, never by NULL alone.
alter table public.stock_tracking_units
  alter column product_product_id drop not null;

comment on column public.stock_tracking_units.product_product_id is
  'Nullable only while product data is genuinely unavailable. Use data_status as the source of truth for completeness.';

commit;
