begin;

drop policy if exists tenant_modules_insert_member on public.tenant_modules;
create policy tenant_modules_insert_member
on public.tenant_modules
for insert
to authenticated
with check (public.is_tenant_member(tenant_id));

drop policy if exists tenant_modules_update_member on public.tenant_modules;
create policy tenant_modules_update_member
on public.tenant_modules
for update
to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

commit;
