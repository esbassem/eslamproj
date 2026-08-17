begin;

alter table public.branches enable row level security;

drop policy if exists branches_select_tenant_member on public.branches;
create policy branches_select_tenant_member
on public.branches
for select
to authenticated
using (public.is_tenant_member(tenant_id));

drop policy if exists branches_insert_tenant_owner on public.branches;
create policy branches_insert_tenant_owner
on public.branches
for insert
to authenticated
with check (public.is_tenant_owner(tenant_id));

drop policy if exists branches_update_tenant_owner on public.branches;
create policy branches_update_tenant_owner
on public.branches
for update
to authenticated
using (public.is_tenant_owner(tenant_id))
with check (public.is_tenant_owner(tenant_id));

-- No DELETE policy by design. Branches are deactivated through is_active so historical
-- references remain intact. No inventory or operational records are changed here.

commit;
