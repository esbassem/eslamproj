begin;

do $$
begin
  if to_regclass('public.product_category_attributes') is not null
    and exists (
      select 1
      from pg_constraint
      where conname = 'product_category_attributes_unique'
        and conrelid = 'public.product_category_attributes'::regclass
    )
  then
    alter table public.product_category_attributes
      drop constraint product_category_attributes_unique;
  end if;

  if to_regclass('public.product_category_attributes') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'product_category_attributes_tenant_category_attribute_unique'
        and conrelid = 'public.product_category_attributes'::regclass
    )
  then
    alter table public.product_category_attributes
      add constraint product_category_attributes_tenant_category_attribute_unique
      unique (tenant_id, category_id, attribute_id);
  end if;
end $$;

commit;
