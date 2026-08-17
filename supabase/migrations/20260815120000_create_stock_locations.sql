begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'branches_id_tenant_unique'
      and conrelid = 'public.branches'::regclass
  ) then
    alter table public.branches
      add constraint branches_id_tenant_unique unique (id, tenant_id);
  end if;
end
$$;

create table if not exists public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  name text not null,
  code text not null,
  location_type text not null default 'internal',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stock_locations_tenant_id_fkey
    foreign key (tenant_id) references public.tenants(id) on delete restrict,
  constraint stock_locations_branch_tenant_fkey
    foreign key (branch_id, tenant_id)
    references public.branches(id, tenant_id) on delete restrict,
  constraint stock_locations_name_not_empty
    check (length(btrim(name)) > 0),
  constraint stock_locations_code_not_empty
    check (length(btrim(code)) > 0),
  constraint stock_locations_type_check
    check (location_type in ('internal', 'showroom', 'returns', 'damaged', 'transit')),
  constraint stock_locations_branch_name_unique
    unique (tenant_id, branch_id, name),
  constraint stock_locations_branch_code_unique
    unique (tenant_id, branch_id, code)
);

create index if not exists stock_locations_tenant_idx
  on public.stock_locations (tenant_id);

create index if not exists stock_locations_branch_idx
  on public.stock_locations (tenant_id, branch_id);

create index if not exists stock_locations_active_idx
  on public.stock_locations (tenant_id, branch_id, name)
  where is_active = true;

create or replace function public.set_stock_location_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_stock_locations_set_updated_at on public.stock_locations;
create trigger trg_stock_locations_set_updated_at
before update on public.stock_locations
for each row execute function public.set_stock_location_updated_at();

create or replace function public.ensure_branch_default_stock_location()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.is_active, true) then
    insert into public.stock_locations (
      tenant_id,
      branch_id,
      name,
      code,
      location_type,
      is_active
    )
    values (
      new.tenant_id,
      new.id,
      'المخزن الرئيسي',
      'MAIN',
      'internal',
      true
    )
    on conflict (tenant_id, branch_id, code) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_branches_ensure_default_stock_location on public.branches;
create trigger trg_branches_ensure_default_stock_location
after insert or update of is_active on public.branches
for each row execute function public.ensure_branch_default_stock_location();

insert into public.stock_locations (
  tenant_id,
  branch_id,
  name,
  code,
  location_type,
  is_active
)
select
  branch.tenant_id,
  branch.id,
  'المخزن الرئيسي',
  'MAIN',
  'internal',
  true
from public.branches branch
where branch.is_active = true
on conflict (tenant_id, branch_id, code) do nothing;

alter table public.stock_locations enable row level security;

drop policy if exists stock_locations_select_tenant_member on public.stock_locations;
create policy stock_locations_select_tenant_member
on public.stock_locations
for select
to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists stock_locations_insert_tenant_owner on public.stock_locations;
create policy stock_locations_insert_tenant_owner
on public.stock_locations
for insert
to authenticated
with check (
  public.is_tenant_owner(tenant_id)
  and exists (
    select 1
    from public.branches branch
    where branch.id = stock_locations.branch_id
      and branch.tenant_id = stock_locations.tenant_id
  )
);

drop policy if exists stock_locations_update_tenant_owner on public.stock_locations;
create policy stock_locations_update_tenant_owner
on public.stock_locations
for update
to authenticated
using (public.is_tenant_owner(tenant_id))
with check (
  public.is_tenant_owner(tenant_id)
  and exists (
    select 1
    from public.branches branch
    where branch.id = stock_locations.branch_id
      and branch.tenant_id = stock_locations.tenant_id
  )
);

-- No DELETE policy by design. Locations are deactivated so future inventory
-- references can remain stable when location linkage is introduced.

commit;
