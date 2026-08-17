begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_locations_id_tenant_unique'
      and conrelid = 'public.stock_locations'::regclass
  ) then
    alter table public.stock_locations
      add constraint stock_locations_id_tenant_unique unique (id, tenant_id);
  end if;
end
$$;

alter table public.stock_quants
  add column if not exists location_id uuid;

alter table public.stock_tracking_units
  add column if not exists current_location_id uuid;

alter table public.stock_moves
  add column if not exists source_location_id uuid,
  add column if not exists destination_location_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_quants_location_tenant_fkey'
      and conrelid = 'public.stock_quants'::regclass
  ) then
    alter table public.stock_quants
      add constraint stock_quants_location_tenant_fkey
      foreign key (location_id, tenant_id)
      references public.stock_locations(id, tenant_id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_tracking_units_current_location_tenant_fkey'
      and conrelid = 'public.stock_tracking_units'::regclass
  ) then
    alter table public.stock_tracking_units
      add constraint stock_tracking_units_current_location_tenant_fkey
      foreign key (current_location_id, tenant_id)
      references public.stock_locations(id, tenant_id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_moves_source_location_tenant_fkey'
      and conrelid = 'public.stock_moves'::regclass
  ) then
    alter table public.stock_moves
      add constraint stock_moves_source_location_tenant_fkey
      foreign key (source_location_id, tenant_id)
      references public.stock_locations(id, tenant_id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_moves_destination_location_tenant_fkey'
      and conrelid = 'public.stock_moves'::regclass
  ) then
    alter table public.stock_moves
      add constraint stock_moves_destination_location_tenant_fkey
      foreign key (destination_location_id, tenant_id)
      references public.stock_locations(id, tenant_id)
      on delete restrict;
  end if;
end
$$;

alter table public.stock_quants
  drop constraint if exists stock_quants_tenant_product_template_unique,
  drop constraint if exists stock_quants_tenant_product_product_unique;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'stock_quants_tenant_location_product_unique'
      and conrelid = 'public.stock_quants'::regclass
  ) then
    alter table public.stock_quants
      add constraint stock_quants_tenant_location_product_unique
      unique (tenant_id, location_id, product_product_id);
  end if;
end
$$;

-- A regular UNIQUE constraint treats NULL values as distinct. Keep the legacy,
-- unassigned bucket unique per product until every quant has been distributed.
create unique index if not exists stock_quants_unassigned_tenant_product_unique
  on public.stock_quants (tenant_id, product_product_id)
  where location_id is null;

create index if not exists stock_tracking_units_tenant_location_status_idx
  on public.stock_tracking_units (tenant_id, current_location_id, status);

create index if not exists stock_moves_tenant_source_location_created_at_idx
  on public.stock_moves (tenant_id, source_location_id, created_at desc);

create index if not exists stock_moves_tenant_destination_location_created_at_idx
  on public.stock_moves (tenant_id, destination_location_id, created_at desc);

commit;
