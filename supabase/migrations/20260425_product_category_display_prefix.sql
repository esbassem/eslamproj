begin;

alter table if exists public.product_categories
  add column if not exists display_prefix text;

comment on column public.product_categories.display_prefix is
'Optional commercial prefix injected into product and variant display names, such as New, Used, Outlet, or Refurbished.';

commit;
