begin;

create or replace function public.assert_financial_payment_partner_role(
  p_tenant uuid, p_partner uuid, p_purpose text
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare purpose public.financial_payment_purposes%rowtype;
begin
  select * into purpose from public.financial_payment_purposes
  where code = p_purpose and is_active;
  if not found then
    raise exception using errcode = '23514', message = 'FINANCIAL_PAYMENT_PURPOSE_INVALID';
  end if;
  if purpose.requires_partner and p_partner is null then
    raise exception using errcode = '23514', message = 'PAYMENT_PARTNER_REQUIRED';
  end if;
  if p_partner is not null and not exists (
    select 1 from public.partners
    where id = p_partner and tenant_id = p_tenant and active
      and (
        purpose.partner_role is null
        or (purpose.partner_role = 'customer' and customer_rank > 0)
        or (purpose.partner_role = 'supplier' and supplier_rank > 0)
      )
  ) then
    raise exception using errcode = '23514', message = 'PARTNER_ROLE_MISMATCH';
  end if;
end
$$;

revoke all on function public.assert_financial_payment_partner_role(uuid,uuid,text)
  from public, anon, authenticated;

commit;
