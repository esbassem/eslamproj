begin;

alter table if exists public.product_category_attributes
  add column if not exists tenant_id uuid;

update public.product_category_attributes pca
set tenant_id = pc.tenant_id
from public.product_categories pc
where pca.category_id = pc.id
  and pca.tenant_id is null;

delete from public.product_category_attributes
where tenant_id is null;

do $$
declare
  legacy_constraint record;
begin
  if to_regclass('public.product_category_attributes') is null then
    return;
  end if;

  for legacy_constraint in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.product_category_attributes'::regclass
      and con.contype = 'u'
      and con.conkey = array(
        select att.attnum
        from pg_attribute att
        where att.attrelid = 'public.product_category_attributes'::regclass
          and att.attname in ('category_id', 'attribute_id')
        order by array_position(array['category_id', 'attribute_id'], att.attname)
      )
  loop
    execute format(
      'alter table public.product_category_attributes drop constraint %I',
      legacy_constraint.conname
    );
  end loop;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_category_attributes_tenant_fk'
      and conrelid = 'public.product_category_attributes'::regclass
  ) then
    alter table public.product_category_attributes
      add constraint product_category_attributes_tenant_fk
      foreign key (tenant_id) references public.tenants(id) on delete cascade not valid;
  end if;

  delete from public.product_category_attributes target
  where exists (
    select 1
    from public.product_category_attributes duplicate
    where duplicate.tenant_id = target.tenant_id
      and duplicate.category_id = target.category_id
      and duplicate.attribute_id = target.attribute_id
      and (
        duplicate.display_order < target.display_order
        or (
          duplicate.display_order = target.display_order
          and duplicate.created_at < target.created_at
        )
        or (
          duplicate.display_order = target.display_order
          and duplicate.created_at = target.created_at
          and duplicate.id < target.id
        )
      )
  );

  alter table public.product_category_attributes
    alter column tenant_id set not null;

  if exists (
    select 1
    from pg_constraint
    where conname = 'product_category_attributes_unique'
      and conrelid = 'public.product_category_attributes'::regclass
  ) then
    alter table public.product_category_attributes
      drop constraint product_category_attributes_unique;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_category_attributes_tenant_category_attribute_unique'
      and conrelid = 'public.product_category_attributes'::regclass
  ) then
    alter table public.product_category_attributes
      add constraint product_category_attributes_tenant_category_attribute_unique
      unique (tenant_id, category_id, attribute_id);
  end if;
end $$;

create index if not exists product_category_attributes_tenant_category_idx
  on public.product_category_attributes (tenant_id, category_id, display_order);

create index if not exists product_category_attributes_tenant_attribute_idx
  on public.product_category_attributes (tenant_id, attribute_id);

commit;
