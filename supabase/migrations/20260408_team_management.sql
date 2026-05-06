begin;

create index if not exists tenant_users_tenant_id_idx on public.tenant_users (tenant_id);
create index if not exists tenant_users_auth_user_id_idx on public.tenant_users (auth_user_id);

alter table public.tenant_users
  drop constraint if exists tenant_users_role_check;

alter table public.tenant_users
  add constraint tenant_users_role_check
  check (role in ('owner', 'admin', 'cashier', 'sales', 'accountant', 'staff'));

create or replace function public.is_tenant_member(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = target_tenant_id
      and tu.auth_user_id = auth.uid()
      and tu.is_active = true
  );
$$;

create or replace function public.is_tenant_owner(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tenant_users tu
    where tu.tenant_id = target_tenant_id
      and tu.auth_user_id = auth.uid()
      and tu.role = 'owner'
      and tu.is_active = true
  );
$$;

alter table public.tenant_users enable row level security;

drop policy if exists tenant_users_select_same_tenant on public.tenant_users;
create policy tenant_users_select_same_tenant
on public.tenant_users
for select
to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists tenant_users_update_owner_same_tenant on public.tenant_users;
create policy tenant_users_update_owner_same_tenant
on public.tenant_users
for update
to authenticated
using (public.is_tenant_owner(tenant_id))
with check (public.is_tenant_owner(tenant_id));

comment on function public.is_tenant_member(uuid) is
'Returns true when the authenticated user belongs to the requested tenant.';

comment on function public.is_tenant_owner(uuid) is
'Returns true when the authenticated user is the active owner of the requested tenant.';

commit;
