begin;

-- Extend the existing branch-scoped Sale Details contract without duplicating
-- its commercial, Financial, Inventory, or historical read logic.
create or replace function public.get_sale_details(
  p_sale_id uuid,
  p_include_customer_contact boolean
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.current_tenant_id();
  v_details jsonb;
  v_customer_id uuid;
  v_customer_address text;
begin
  -- The canonical overload remains authoritative for authentication,
  -- permissions, branch scope, and the complete Sale Details projection.
  v_details := public.get_sale_details(p_sale_id);

  if not coalesce(p_include_customer_contact, false) then
    return v_details;
  end if;

  v_customer_id := nullif(v_details #>> '{customer,id}', '')::uuid;

  select nullif(btrim(customer.address), '')
  into v_customer_address
  from public.partners customer
  where customer.id = v_customer_id
    and customer.tenant_id = v_tenant_id;

  return jsonb_set(
    v_details,
    '{customer,address}',
    to_jsonb(coalesce(v_customer_address, '')),
    true
  );
end
$$;

revoke all on function public.get_sale_details(uuid, boolean) from public, anon, service_role;
grant execute on function public.get_sale_details(uuid, boolean) to authenticated;

comment on function public.get_sale_details(uuid, boolean) is
  'Canonical Sale Details with the scoped customer contact summary used by detail surfaces.';

notify pgrst, 'reload schema';

commit;
