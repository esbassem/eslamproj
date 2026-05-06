begin;

alter table if exists public.product_templates
  add column if not exists product_type text not null default 'goods',
  add column if not exists tracking text not null default 'none',
  add column if not exists can_be_sold boolean not null default true,
  add column if not exists can_be_purchased boolean not null default true;

alter table if exists public.stock_quants
  add column if not exists tenant_id uuid,
  add column if not exists product_template_id uuid,
  add column if not exists quantity_on_hand numeric not null default 0,
  add column if not exists reserved_quantity numeric not null default 0;

alter table if exists public.stock_tracking_units
  add column if not exists tenant_id uuid,
  add column if not exists product_template_id uuid,
  add column if not exists tracking_number text,
  add column if not exists tracking_type text not null default 'serial',
  add column if not exists status text not null default 'in_stock';

alter table if exists public.stock_moves
  add column if not exists tenant_id uuid,
  add column if not exists product_template_id uuid,
  add column if not exists move_type text not null default 'inventory',
  add column if not exists quantity numeric not null default 0,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists notes text;

do $$
begin
  if to_regclass('public.product_templates') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_templates_product_type_check'
        and conrelid = 'public.product_templates'::regclass
    )
  then
    alter table public.product_templates
      add constraint product_templates_product_type_check
      check (product_type in ('goods', 'service', 'consumable')) not valid;
  end if;

  if to_regclass('public.product_templates') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_templates_tracking_check'
        and conrelid = 'public.product_templates'::regclass
    )
  then
    alter table public.product_templates
      add constraint product_templates_tracking_check
      check (tracking in ('none', 'serial', 'lot')) not valid;
  end if;

  if to_regclass('public.stock_tracking_units') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'stock_tracking_units_status_check'
        and conrelid = 'public.stock_tracking_units'::regclass
    )
  then
    alter table public.stock_tracking_units
      add constraint stock_tracking_units_status_check
      check (status in ('in_stock', 'sold', 'reserved', 'damaged', 'returned')) not valid;
  end if;

  if to_regclass('public.stock_moves') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'stock_moves_move_type_check'
        and conrelid = 'public.stock_moves'::regclass
    )
  then
    alter table public.stock_moves
      add constraint stock_moves_move_type_check
      check (move_type in ('in', 'out', 'inventory', 'return', 'reserve', 'release')) not valid;
  end if;

  if to_regclass('public.stock_quants') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'stock_quants_tenant_product_template_unique'
        and conrelid = 'public.stock_quants'::regclass
    )
  then
    alter table public.stock_quants
      add constraint stock_quants_tenant_product_template_unique
      unique (tenant_id, product_template_id);
  end if;

  if to_regclass('public.stock_tracking_units') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'stock_tracking_units_tenant_tracking_number_unique'
        and conrelid = 'public.stock_tracking_units'::regclass
    )
  then
    alter table public.stock_tracking_units
      add constraint stock_tracking_units_tenant_tracking_number_unique
      unique (tenant_id, tracking_number);
  end if;
end $$;

create index if not exists product_templates_tenant_product_type_idx
  on public.product_templates (tenant_id, product_type);

create index if not exists product_templates_tenant_tracking_idx
  on public.product_templates (tenant_id, tracking);

create index if not exists stock_quants_tenant_product_template_idx
  on public.stock_quants (tenant_id, product_template_id);

create index if not exists stock_tracking_units_tenant_product_template_status_idx
  on public.stock_tracking_units (tenant_id, product_template_id, status);

create index if not exists stock_moves_tenant_product_template_created_at_idx
  on public.stock_moves (tenant_id, product_template_id, created_at desc);

comment on column public.product_templates.product_type is
'goods and consumable are stock-managed; service is sold without inventory.';

comment on column public.product_templates.tracking is
'none uses stock_quants, serial uses stock_tracking_units, lot is reserved for later.';

comment on table public.stock_quants is
'Quantity stock balance. Serial-tracked products should use stock_tracking_units as the primary balance source.';

commit;
