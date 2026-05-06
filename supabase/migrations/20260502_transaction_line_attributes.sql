begin;

-- Stores per-line attribute selections captured at sale time.
-- Used for No-Variant attributes (creates_variant = false) so they are
-- recorded on the transaction line rather than on the product variant.
-- transaction_line_id is a logical UUID stored inside the sale line JSON
-- (sales_operations.items[*].lineUuid) — no hard FK to keep it flexible.
create table if not exists public.transaction_line_attributes (
  id                   uuid        primary key default gen_random_uuid(),
  tenant_id            uuid        not null,
  transaction_line_id  uuid        not null,
  attribute_id         uuid        not null,
  attribute_value_id   uuid,
  value_text           text,
  created_at           timestamptz not null default now()
);

create index if not exists transaction_line_attributes_line_idx
  on public.transaction_line_attributes (transaction_line_id);

create index if not exists transaction_line_attributes_tenant_line_idx
  on public.transaction_line_attributes (tenant_id, transaction_line_id);

create index if not exists transaction_line_attributes_tenant_attribute_idx
  on public.transaction_line_attributes (tenant_id, attribute_id);

do $$
begin
  if to_regclass('public.transaction_line_attributes') is not null
    and to_regclass('public.product_attributes') is not null
    and not exists (
      select 1 from pg_constraint
      where conname = 'transaction_line_attributes_attribute_fk'
        and conrelid = 'public.transaction_line_attributes'::regclass
    )
  then
    alter table public.transaction_line_attributes
      add constraint transaction_line_attributes_attribute_fk
      foreign key (attribute_id) references public.product_attributes(id) on delete restrict not valid;
  end if;

  if to_regclass('public.transaction_line_attributes') is not null
    and to_regclass('public.product_attribute_values') is not null
    and not exists (
      select 1 from pg_constraint
      where conname = 'transaction_line_attributes_value_fk'
        and conrelid = 'public.transaction_line_attributes'::regclass
    )
  then
    alter table public.transaction_line_attributes
      add constraint transaction_line_attributes_value_fk
      foreign key (attribute_value_id) references public.product_attribute_values(id) on delete restrict not valid;
  end if;
end $$;

comment on table public.transaction_line_attributes is
'Per-line attribute selections for showroom (and future) sale lines. '
'Stores No-Variant attribute values chosen at sale time. '
'transaction_line_id references the lineUuid stored in sales_operations.items JSON.';

comment on column public.transaction_line_attributes.transaction_line_id is
'Logical UUID of the sale line. Matches lineUuid inside sales_operations.items JSON array.';

comment on column public.transaction_line_attributes.attribute_value_id is
'Set when the user selected a value from product_attribute_values. Null when value_text is used.';

comment on column public.transaction_line_attributes.value_text is
'Free-text value entered by the user. Null when attribute_value_id is set.';

commit;
