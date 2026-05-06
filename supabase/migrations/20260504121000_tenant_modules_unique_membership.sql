begin;

with ranked_tenant_modules as (
  select
    id,
    row_number() over (
      partition by tenant_id, module_id
      order by
        case when state = 'installed' then 0 else 1 end,
        coalesce(updated_at, created_at, installed_at, uninstalled_at) desc nulls last,
        id
    ) as row_rank
  from public.tenant_modules
)
delete from public.tenant_modules tenant_module
using ranked_tenant_modules ranked
where tenant_module.id = ranked.id
  and ranked.row_rank > 1;

create unique index if not exists tenant_modules_tenant_module_key
  on public.tenant_modules (tenant_id, module_id);

commit;
