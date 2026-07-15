begin;

alter table public.showroom_sales
  drop constraint if exists showroom_sales_status_check;

alter table public.showroom_sales
  add constraint showroom_sales_status_check
  check (status = any (array['draft'::text, 'pending_payment'::text, 'confirmed'::text, 'cancelled'::text]));

commit;
