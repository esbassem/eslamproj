begin;

do $$
begin
  if exists (select 1 from public.crm_leads where sale_id is not null)
     or exists (select 1 from public.showroom_sales where crm_lead_id is not null)
     or exists (select 1 from public.showroom_sales where crm_installment_application_id is not null) then
    raise exception using message = 'CRM_SHOWROOM_LINKED_DATA_REQUIRES_REVIEW';
  end if;
end
$$;

-- Preserve CRM business rows, but retire the module and all menu entry points.
update public.ir_ui_menus menu
set active = false,
    updated_at = now()
from public.ir_modules module
where module.id = menu.module_id
  and module.technical_name = 'crm'
  and menu.active;

update public.tenant_modules tenant_module
set state = 'uninstalled',
    uninstalled_at = coalesce(tenant_module.uninstalled_at, now()),
    updated_at = now()
from public.ir_modules module
where module.id = tenant_module.module_id
  and module.technical_name = 'crm'
  and tenant_module.state <> 'uninstalled';

update public.ir_modules
set active = false,
    installable = false,
    state = 'uninstalled',
    updated_at = now()
where technical_name = 'crm';

-- Empty cross-domain relations are removed without deleting either side's data.
alter table public.crm_leads
  drop constraint if exists crm_leads_sale_fk;
alter table public.showroom_sales
  drop constraint if exists showroom_sales_crm_lead_fk,
  drop constraint if exists showroom_sales_crm_application_fk;

-- Retire only RPCs whose contract crosses the CRM/Legacy Showroom boundary.
drop function if exists public.crm_get_installment_application(uuid, uuid);
drop function if exists public.crm_list_installment_applications(uuid, text, jsonb, uuid, integer, integer);
drop function if exists public.crm_mark_lead_sold(uuid, uuid, uuid, uuid);
drop function if exists public.complete_showroom_sale(uuid, numeric, text, jsonb, uuid, uuid);

comment on column public.crm_leads.sale_id is
  'Retired CRM legacy Showroom UUID slot. Inert historical field; no FK and no runtime writer.';
comment on column public.showroom_sales.crm_lead_id is
  'Retired CRM integration slot. Inert UUID with no FK; retained until Final Showroom Retirement.';
comment on column public.showroom_sales.crm_installment_application_id is
  'Retired CRM integration slot. Inert UUID with no FK; retained until Final Showroom Retirement.';

commit;
