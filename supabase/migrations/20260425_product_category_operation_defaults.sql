alter table if exists public.product_categories
  add column if not exists default_tracking text not null default 'none',
  add column if not exists default_can_be_sold boolean not null default true,
  add column if not exists default_can_be_purchased boolean not null default true,
  add column if not exists default_is_active boolean not null default true;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_categories_default_tracking_check'
  ) then
    alter table public.product_categories
      add constraint product_categories_default_tracking_check
      check (default_tracking in ('none', 'serial', 'lot')) not valid;
  end if;
end $$;

alter table if exists public.product_categories
  validate constraint product_categories_default_tracking_check;

comment on column public.product_categories.default_tracking is
'Default tracking mode suggested when creating products under this category.';

comment on column public.product_categories.default_can_be_sold is
'Default sellability suggested when creating products under this category.';

comment on column public.product_categories.default_can_be_purchased is
'Default purchasability suggested when creating products under this category.';

comment on column public.product_categories.default_is_active is
'Default active status suggested when creating products under this category.';
