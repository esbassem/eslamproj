-- Final Inventory Operations hardening.
-- Unknown serialized identities must enter Inventory through the canonical
-- receiving/opening-adoption contracts, never through a count adjustment.

create or replace function public.reject_inventory_adjustment_operational_adoption()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.adjustment_type = 'operational_adoption' then
    raise exception using
      errcode = '23514',
      message = 'INVENTORY_ADJUSTMENT_IDENTITY_REQUIRES_CANONICAL_ADOPTION';
  end if;
  return new;
end;
$$;

revoke all on function public.reject_inventory_adjustment_operational_adoption()
  from public, anon, authenticated;

drop trigger if exists inventory_adjustment_lines_reject_operational_adoption
  on public.inventory_adjustment_lines;
create trigger inventory_adjustment_lines_reject_operational_adoption
before insert on public.inventory_adjustment_lines
for each row execute function public.reject_inventory_adjustment_operational_adoption();

drop policy if exists inventory_adjustment_lines_read
  on public.inventory_adjustment_lines;
create policy inventory_adjustment_lines_read
on public.inventory_adjustment_lines
for select
to authenticated
using (
  tenant_id = public.current_tenant_id()
  and exists (
    select 1
    from public.inventory_adjustments adjustment
    where adjustment.id = inventory_adjustment_lines.adjustment_id
      and adjustment.tenant_id = inventory_adjustment_lines.tenant_id
      and public.has_stock_location_access(adjustment.location_id)
  )
);

comment on function public.reject_inventory_adjustment_operational_adoption() is
  'Prevents count adjustments from creating serialized units; use canonical Receiving or Opening Adoption.';
