begin;

alter table public.showroom_sale_lines
  add column if not exists showroom_config_id uuid;

alter table public.showroom_sale_payments
  add column if not exists showroom_config_id uuid;

update public.showroom_sale_lines line
set showroom_config_id = sale.showroom_config_id
from public.showroom_sales sale
where line.sale_id = sale.id
  and line.tenant_id = sale.tenant_id
  and line.showroom_config_id is null;

update public.showroom_sale_payments payment
set showroom_config_id = sale.showroom_config_id
from public.showroom_sales sale
where payment.sale_id = sale.id
  and payment.tenant_id = sale.tenant_id
  and payment.showroom_config_id is null;

create index if not exists showroom_sale_lines_config_idx
  on public.showroom_sale_lines (tenant_id, showroom_config_id, sale_id);

create index if not exists showroom_sale_payments_config_idx
  on public.showroom_sale_payments (tenant_id, showroom_config_id, sale_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'showroom_sale_lines_showroom_config_id_fkey'
      and conrelid = 'public.showroom_sale_lines'::regclass
  ) then
    alter table public.showroom_sale_lines
      add constraint showroom_sale_lines_showroom_config_id_fkey
      foreign key (showroom_config_id)
      references public.showroom_configs(id)
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'showroom_sale_payments_showroom_config_id_fkey'
      and conrelid = 'public.showroom_sale_payments'::regclass
  ) then
    alter table public.showroom_sale_payments
      add constraint showroom_sale_payments_showroom_config_id_fkey
      foreign key (showroom_config_id)
      references public.showroom_configs(id)
      on delete restrict;
  end if;
end $$;

with ranked_configs as (
  select
    id,
    row_number() over (partition by tenant_id, code order by id) as duplicate_rank
  from public.showroom_configs
  where code is not null
)
update public.showroom_configs config
set code = left(config.code || '-' || replace(config.id::text, '-', ''), 255)
from ranked_configs ranked
where ranked.id = config.id
  and ranked.duplicate_rank > 1;

create unique index if not exists showroom_configs_tenant_code_key
  on public.showroom_configs (tenant_id, code);

update public.ir_ui_menus
set
  name = 'Configurations',
  route_path = '/app/showroom_point/settings',
  icon = 'Settings',
  active = true,
  updated_at = now()
where code = 'showroom_point.settings';

commit;
