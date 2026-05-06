begin;

alter table if exists public.product_attributes
  add column if not exists behavior text,
  add column if not exists creates_variant boolean,
  add column if not exists show_in_variant_name boolean,
  add column if not exists display_type text,
  add column if not exists is_filterable boolean,
  add column if not exists use_in_sku boolean,
  add column if not exists sort_order integer;

alter table if exists public.product_attribute_values
  add column if not exists code text,
  add column if not exists color_hex text,
  add column if not exists image_url text,
  add column if not exists show_in_variant_name boolean;

update public.product_attributes
set
  behavior = coalesce(nullif(trim(behavior), ''), 'variant'),
  creates_variant = coalesce(creates_variant, true),
  show_in_variant_name = coalesce(show_in_variant_name, true),
  display_type = coalesce(nullif(trim(display_type), ''), 'select'),
  is_filterable = coalesce(is_filterable, false),
  use_in_sku = coalesce(use_in_sku, false),
  sort_order = coalesce(sort_order, 0);

update public.product_attribute_values
set
  show_in_variant_name = coalesce(show_in_variant_name, true);

alter table if exists public.product_attributes
  alter column behavior set default 'variant',
  alter column behavior set not null,
  alter column creates_variant set default true,
  alter column creates_variant set not null,
  alter column show_in_variant_name set default true,
  alter column show_in_variant_name set not null,
  alter column display_type set default 'select',
  alter column display_type set not null,
  alter column is_filterable set default false,
  alter column is_filterable set not null,
  alter column use_in_sku set default false,
  alter column use_in_sku set not null,
  alter column sort_order set default 0,
  alter column sort_order set not null;

alter table if exists public.product_attribute_values
  alter column show_in_variant_name set default true,
  alter column show_in_variant_name set not null;

do $$
begin
  if to_regclass('public.product_attributes') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_attributes_behavior_check'
        and conrelid = 'public.product_attributes'::regclass
    )
  then
    alter table public.product_attributes
      add constraint product_attributes_behavior_check
      check (behavior in ('variant', 'commercial', 'informational')) not valid;
  end if;

  if to_regclass('public.product_attributes') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_attributes_display_type_check'
        and conrelid = 'public.product_attributes'::regclass
    )
  then
    alter table public.product_attributes
      add constraint product_attributes_display_type_check
      check (display_type in ('select', 'buttons', 'radio', 'color')) not valid;
  end if;
end $$;

create index if not exists product_attributes_tenant_sort_order_idx
  on public.product_attributes (tenant_id, sort_order, name);

create index if not exists product_attribute_values_attribute_sort_order_idx
  on public.product_attribute_values (attribute_id, sort_order, name);

comment on column public.product_attributes.behavior is
'Controls whether the attribute is variant-defining, commercial, or informational only.';

comment on column public.product_attributes.creates_variant is
'When true, chosen values from this attribute participate in product variant resolution.';

comment on column public.product_attributes.show_in_variant_name is
'When true, values from this attribute may appear in the generated variant display name.';

comment on column public.product_attributes.display_type is
'Preferred UI presentation for the attribute values.';

comment on column public.product_attributes.is_filterable is
'When true, the attribute may appear in product and inventory filters.';

comment on column public.product_attributes.use_in_sku is
'When true, the selected value code can participate in SKU generation.';

comment on column public.product_attribute_values.code is
'Short code for the value, suitable for SKU generation.';

comment on column public.product_attribute_values.color_hex is
'Hex color used when the parent attribute display type is color.';

comment on column public.product_attribute_values.image_url is
'Optional representative image URL for the value.';

comment on column public.product_attribute_values.show_in_variant_name is
'Overrides whether the specific value appears inside the generated variant display name.';

commit;
