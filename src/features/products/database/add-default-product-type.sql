alter table public.product_categories
  add column if not exists default_product_type varchar(20);
