begin;

create extension if not exists pgcrypto;

alter table if exists public.product_templates
  add column if not exists default_product_product_id uuid;

alter table if exists public.product_attributes
  add column if not exists show_in_pos_filter boolean not null default false;

create table if not exists public.product_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  product_template_id uuid not null,
  display_name text not null,
  sku text,
  barcode text,
  tracking text not null default 'none',
  sale_price numeric not null default 0,
  cost_price numeric not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_product_attribute_values (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  product_product_id uuid not null,
  attribute_id uuid not null,
  attribute_value_id uuid not null,
  created_at timestamptz not null default now()
);

alter table if exists public.stock_quants
  add column if not exists product_product_id uuid;

alter table if exists public.stock_moves
  add column if not exists product_product_id uuid;

alter table if exists public.stock_tracking_units
  add column if not exists product_product_id uuid;

alter table if exists public.pos_order_lines
  add column if not exists product_product_id uuid;

alter table if exists public.account_move_lines
  add column if not exists product_product_id uuid;

do $$
begin
  if to_regclass('public.product_products') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_products_tracking_check'
        and conrelid = 'public.product_products'::regclass
    )
  then
    alter table public.product_products
      add constraint product_products_tracking_check
      check (tracking in ('none', 'lot', 'serial')) not valid;
  end if;

  if to_regclass('public.product_products') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_products_template_fk'
        and conrelid = 'public.product_products'::regclass
    )
  then
    alter table public.product_products
      add constraint product_products_template_fk
      foreign key (product_template_id) references public.product_templates(id) on delete cascade not valid;
  end if;

  if to_regclass('public.product_product_attribute_values') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_product_attribute_values_variant_fk'
        and conrelid = 'public.product_product_attribute_values'::regclass
    )
  then
    alter table public.product_product_attribute_values
      add constraint product_product_attribute_values_variant_fk
      foreign key (product_product_id) references public.product_products(id) on delete cascade not valid;
  end if;

  if to_regclass('public.product_product_attribute_values') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_product_attribute_values_attribute_fk'
        and conrelid = 'public.product_product_attribute_values'::regclass
    )
  then
    alter table public.product_product_attribute_values
      add constraint product_product_attribute_values_attribute_fk
      foreign key (attribute_id) references public.product_attributes(id) on delete cascade not valid;
  end if;

  if to_regclass('public.product_product_attribute_values') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_product_attribute_values_value_fk'
        and conrelid = 'public.product_product_attribute_values'::regclass
    )
  then
    alter table public.product_product_attribute_values
      add constraint product_product_attribute_values_value_fk
      foreign key (attribute_value_id) references public.product_attribute_values(id) on delete cascade not valid;
  end if;

  if to_regclass('public.product_templates') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_templates_default_product_product_fk'
        and conrelid = 'public.product_templates'::regclass
    )
  then
    alter table public.product_templates
      add constraint product_templates_default_product_product_fk
      foreign key (default_product_product_id) references public.product_products(id) on delete set null not valid;
  end if;

  if to_regclass('public.product_product_attribute_values') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_product_attribute_values_variant_value_unique'
        and conrelid = 'public.product_product_attribute_values'::regclass
    )
  then
    alter table public.product_product_attribute_values
      add constraint product_product_attribute_values_variant_value_unique
      unique (product_product_id, attribute_value_id);
  end if;

  if to_regclass('public.stock_quants') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'stock_quants_tenant_product_product_unique'
        and conrelid = 'public.stock_quants'::regclass
    )
  then
    alter table public.stock_quants
      add constraint stock_quants_tenant_product_product_unique
      unique (tenant_id, product_product_id);
  end if;
end $$;

create index if not exists product_products_tenant_template_idx
  on public.product_products (tenant_id, product_template_id);

create index if not exists product_products_tenant_active_idx
  on public.product_products (tenant_id, is_active);

create index if not exists product_product_attribute_values_variant_idx
  on public.product_product_attribute_values (product_product_id);

create index if not exists product_product_attribute_values_value_idx
  on public.product_product_attribute_values (attribute_value_id);

create index if not exists stock_quants_tenant_product_product_idx
  on public.stock_quants (tenant_id, product_product_id);

create index if not exists stock_moves_tenant_product_product_created_at_idx
  on public.stock_moves (tenant_id, product_product_id, created_at desc);

create index if not exists stock_tracking_units_tenant_product_product_status_idx
  on public.stock_tracking_units (tenant_id, product_product_id, status);

create index if not exists pos_order_lines_tenant_product_product_idx
  on public.pos_order_lines (tenant_id, product_product_id);

create index if not exists account_move_lines_tenant_product_product_idx
  on public.account_move_lines (tenant_id, product_product_id);

insert into public.product_products (
  tenant_id,
  product_template_id,
  display_name,
  sku,
  barcode,
  tracking,
  sale_price,
  cost_price,
  is_active
)
select
  pt.tenant_id,
  pt.id,
  pt.name,
  nullif(trim(coalesce(pt.internal_reference, pt.default_code, '')), ''),
  nullif(trim(coalesce(pt.barcode, '')), ''),
  coalesce(pt.tracking, 'none'),
  coalesce(pt.sale_price, pt.list_price, 0),
  coalesce(pt.cost_price, pt.standard_price, 0),
  coalesce(pt.is_active, pt.active, true)
from public.product_templates pt
where not exists (
  select 1
  from public.product_products pp
  where pp.product_template_id = pt.id
);

with default_variants as (
  select distinct on (pp.product_template_id)
    pp.product_template_id,
    pp.id as product_product_id
  from public.product_products pp
  order by pp.product_template_id, pp.created_at asc, pp.id asc
)
update public.product_templates pt
set default_product_product_id = dv.product_product_id
from default_variants dv
where pt.id = dv.product_template_id
  and pt.default_product_product_id is null;

insert into public.product_product_attribute_values (
  tenant_id,
  product_product_id,
  attribute_id,
  attribute_value_id
)
select
  pt.tenant_id,
  pt.default_product_product_id,
  item.attribute_id,
  item.value_id
from public.product_templates pt
cross join lateral jsonb_to_recordset(
  case
    when jsonb_typeof(coalesce(pt.attributes_jsonb, '[]'::jsonb)) = 'array' then coalesce(pt.attributes_jsonb, '[]'::jsonb)
    else '[]'::jsonb
  end
) as item(attribute_id uuid, value_id uuid, attribute_name text, value_name text, extra_price numeric)
where pt.default_product_product_id is not null
  and item.attribute_id is not null
  and item.value_id is not null
  and not exists (
    select 1
    from public.product_product_attribute_values link
    where link.product_product_id = pt.default_product_product_id
      and link.attribute_value_id = item.value_id
  );

update public.stock_quants sq
set product_product_id = pt.default_product_product_id
from public.product_templates pt
where sq.product_template_id = pt.id
  and sq.product_product_id is null;

update public.stock_moves sm
set product_product_id = pt.default_product_product_id
from public.product_templates pt
where sm.product_template_id = pt.id
  and sm.product_product_id is null;

update public.stock_tracking_units stu
set product_product_id = pt.default_product_product_id
from public.product_templates pt
where stu.product_template_id = pt.id
  and stu.product_product_id is null;

update public.pos_order_lines pol
set product_product_id = pt.default_product_product_id
from public.product_templates pt
where pol.product_template_id = pt.id
  and pol.product_product_id is null;

update public.account_move_lines aml
set product_product_id = pt.default_product_product_id
from public.product_templates pt
where aml.product_template_id = pt.id
  and aml.product_product_id is null;

comment on table public.product_products is
'Sellable and stockable product variants generated from product templates.';

comment on table public.product_product_attribute_values is
'Links a product variant to the chosen attribute values that define it.';

comment on column public.product_attributes.show_in_pos_filter is
'When true, the attribute can be exposed as a quick filter inside the POS screen.';

comment on column public.product_templates.default_product_product_id is
'Compatibility pointer to the default variant associated with the template.';

commit;
