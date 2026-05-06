begin;

create extension if not exists pgcrypto;

create table if not exists public.product_category_attributes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  category_id uuid not null,
  attribute_id uuid not null,
  is_required boolean not null default false,
  display_order integer not null default 0,
  created_at timestamptz not null default now()
);

do $$
begin
  if to_regclass('public.product_category_attributes') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_category_attributes_category_fk'
        and conrelid = 'public.product_category_attributes'::regclass
    )
  then
    alter table public.product_category_attributes
      add constraint product_category_attributes_category_fk
      foreign key (category_id) references public.product_categories(id) on delete cascade not valid;
  end if;

  if to_regclass('public.product_category_attributes') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_category_attributes_attribute_fk'
        and conrelid = 'public.product_category_attributes'::regclass
    )
  then
    alter table public.product_category_attributes
      add constraint product_category_attributes_attribute_fk
      foreign key (attribute_id) references public.product_attributes(id) on delete cascade not valid;
  end if;

  if to_regclass('public.product_category_attributes') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_category_attributes_unique'
        and conrelid = 'public.product_category_attributes'::regclass
    )
  then
    alter table public.product_category_attributes
      add constraint product_category_attributes_unique
      unique (category_id, attribute_id);
  end if;
end $$;

create index if not exists product_category_attributes_tenant_category_idx
  on public.product_category_attributes (tenant_id, category_id, display_order);

create index if not exists product_category_attributes_tenant_attribute_idx
  on public.product_category_attributes (tenant_id, attribute_id);

insert into public.product_category_attributes (
  tenant_id,
  category_id,
  attribute_id,
  is_required,
  display_order
)
select distinct
  pt.tenant_id,
  pt.category_id,
  item.attribute_id,
  false,
  0
from public.product_templates pt
cross join lateral jsonb_to_recordset(
  case
    when jsonb_typeof(coalesce(pt.attributes_jsonb, '[]'::jsonb)) = 'array' then coalesce(pt.attributes_jsonb, '[]'::jsonb)
    else '[]'::jsonb
  end
) as item(attribute_id uuid, value_id uuid, attribute_name text, value_name text, extra_price numeric)
where pt.category_id is not null
  and item.attribute_id is not null
  and not exists (
    select 1
    from public.product_category_attributes pca
    where pca.category_id = pt.category_id
      and pca.attribute_id = item.attribute_id
  );

comment on table public.product_category_attributes is
'Maps product categories to the attributes that should be collected during stock receiving.';

commit;
