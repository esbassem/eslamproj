begin;

alter table public.showroom_sale_payments
  add column if not exists payment_type text default 'cash',
  add column if not exists financier_partner_id uuid null,
  add column if not exists approval_reference text null;

update public.showroom_sale_payments
set payment_type = coalesce(nullif(payment_type, ''), payment_method, 'cash')
where payment_type is null
   or payment_type = '';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'showroom_sale_payments_financier_partner_id_fkey'
      and conrelid = 'public.showroom_sale_payments'::regclass
  ) then
    alter table public.showroom_sale_payments
      add constraint showroom_sale_payments_financier_partner_id_fkey
      foreign key (financier_partner_id)
      references public.partners(id)
      on delete restrict;
  end if;
end $$;

create index if not exists showroom_sale_payments_financier_partner_idx
  on public.showroom_sale_payments (tenant_id, financier_partner_id)
  where financier_partner_id is not null;

commit;
