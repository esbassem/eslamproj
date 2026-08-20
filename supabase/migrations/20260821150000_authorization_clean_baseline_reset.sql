begin;

-- Sensitive inventory operation: fail closed until its action matrix is designed.
create or replace function public.can_complete_tracking_unit(p_tenant_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.tenant_users u where u.tenant_id=p_tenant_id and u.auth_user_id=auth.uid() and u.is_active and u.role='owner')
$$;
revoke all on function public.can_complete_tracking_unit(uuid) from public,anon;
grant execute on function public.can_complete_tracking_unit(uuid) to authenticated;

-- Preserve the accounting implementation but replace its legacy role/group gate
-- with a strict owner gate in the current function definition.
do $$
declare oid_value oid; definition text; start_at integer; relative_end integer;
begin
 select p.oid into oid_value from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='delete_account_move_atomic' and pg_get_function_identity_arguments(p.oid)='p_tenant_id uuid, p_move_id uuid';
 if oid_value is null then raise exception 'delete_account_move_atomic signature not found'; end if;
 definition:=pg_get_functiondef(oid_value); start_at:=strpos(definition,'  if coalesce(v_user.role');
 if start_at=0 then raise exception 'Legacy accounting authorization block not found'; end if;
 relative_end:=strpos(substring(definition from start_at),' then');
 if relative_end=0 then raise exception 'Legacy accounting authorization block end not found'; end if;
 definition:=substring(definition from 1 for start_at-1)||E'  if coalesce(v_user.role, '''') <> ''owner'' then'||substring(definition from start_at+relative_end+5);
 execute definition;
 if pg_get_functiondef(oid_value) ilike '%accountant_app_manager%' then raise exception 'Accounting legacy group reference remains'; end if;
end $$;

-- Receivables baseline: app permission permits reading; all mutations are
-- temporarily owner-only until action permissions are deliberately designed.
do $$ declare table_name text; policy_record record; begin
 foreach table_name in array array['receivables','receivable_installments','receivable_events','receivable_payment_plans','receivable_guarantors'] loop
  execute format('alter table public.%I enable row level security',table_name);
  for policy_record in select policyname from pg_policies where schemaname='public' and tablename=table_name loop
    execute format('drop policy if exists %I on public.%I',policy_record.policyname,table_name);
  end loop;
  execute format('create policy %I on public.%I for select to authenticated using (tenant_id=public.current_tenant_id() and (public.is_current_tenant_owner(tenant_id) or public.has_permission(''receivables.access'')))','baseline_'||table_name||'_read',table_name);
  execute format('create policy %I on public.%I for insert to authenticated with check (tenant_id=public.current_tenant_id() and public.is_current_tenant_owner(tenant_id))','baseline_'||table_name||'_insert_owner',table_name);
  execute format('create policy %I on public.%I for update to authenticated using (tenant_id=public.current_tenant_id() and public.is_current_tenant_owner(tenant_id)) with check (tenant_id=public.current_tenant_id() and public.is_current_tenant_owner(tenant_id))','baseline_'||table_name||'_update_owner',table_name);
  execute format('create policy %I on public.%I for delete to authenticated using (tenant_id=public.current_tenant_id() and public.is_current_tenant_owner(tenant_id))','baseline_'||table_name||'_delete_owner',table_name);
 end loop;
end $$;

-- Remove every dependency row explicitly before deleting groups.
delete from public.res_users_groups;
delete from public.auth_group_permissions;
delete from public.ir_model_access where group_id is not null;
delete from public.ir_ui_menu_groups;
delete from public.res_groups;

delete from public.auth_permissions
where code not in (
 'accountant_app.access','contacts.access','crm.access','moto_customer_care.access','old_cashbox.access','photos.access','pos.access','products.access','receivables.access','settings.access','showroom_point.access'
);

update public.auth_permissions set active=true,permission_type='app_access',action='access',sort_order=10,updated_at=now()
where code in ('accountant_app.access','contacts.access','crm.access','moto_customer_care.access','old_cashbox.access','photos.access','pos.access','products.access','receivables.access','settings.access','showroom_point.access');

drop function if exists public.provision_default_tenant_groups(uuid);

-- Non-negotiable transaction assertions.
do $$
declare approved text[]:=array['accountant_app.access','contacts.access','crm.access','moto_customer_care.access','old_cashbox.access','photos.access','pos.access','products.access','receivables.access','settings.access','showroom_point.access'];
begin
 if (select count(*) from public.res_groups)<>0 then raise exception 'Baseline assertion failed: groups'; end if;
 if (select count(*) from public.res_users_groups)<>0 then raise exception 'Baseline assertion failed: memberships'; end if;
 if (select count(*) from public.auth_group_permissions)<>0 then raise exception 'Baseline assertion failed: mappings'; end if;
 if (select count(*) from public.auth_permissions)<>11 then raise exception 'Baseline assertion failed: permission total'; end if;
 if (select count(*) from public.auth_permissions where permission_type='app_access' and active)<>11 then raise exception 'Baseline assertion failed: app access'; end if;
 if (select count(*) from public.auth_permissions where permission_type='action')<>0 then raise exception 'Baseline assertion failed: actions'; end if;
 if exists(select 1 from public.auth_permissions where not(code=any(approved))) then raise exception 'Baseline assertion failed: unexpected permission'; end if;
 if to_regprocedure('public.provision_default_tenant_groups(uuid)') is not null then raise exception 'Baseline assertion failed: provisioning remains'; end if;
end $$;

commit;
