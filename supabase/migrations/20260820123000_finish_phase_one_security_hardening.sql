begin;

-- Close remaining tenant-aware public-table findings without changing in-tenant
-- behavior. The legacy old_cashbox table has no tenant_id and is intentionally
-- left for a later data migration; anon access was already revoked in phase one.
alter table public.res_partner_banks enable row level security;
drop policy if exists phase1_tenant_member_all on public.res_partner_banks;
create policy phase1_tenant_member_all on public.res_partner_banks
for all to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

alter table public.user_push_subscriptions enable row level security;
drop policy if exists phase1_tenant_member_all on public.user_push_subscriptions;
create policy phase1_tenant_member_all on public.user_push_subscriptions
for all to authenticated
using (public.is_tenant_member(tenant_id))
with check (public.is_tenant_member(tenant_id));

do $$
declare v_table_name text;
begin
  foreach v_table_name in array array[
    'system_account_group_templates', 'system_account_templates',
    'system_journal_templates', 'system_pos_payment_method_templates'
  ] loop
    execute format('alter table public.%I enable row level security', v_table_name);
    execute format('drop policy if exists phase1_authenticated_read on public.%I', v_table_name);
    execute format(
      'create policy phase1_authenticated_read on public.%I for select to authenticated using (public.current_tenant_user_id() is not null)',
      v_table_name
    );
    execute format('revoke all privileges on table public.%I from anon, authenticated', v_table_name);
    execute format('grant select on table public.%I to authenticated', v_table_name);
  end loop;
end
$$;

revoke all privileges on table public.res_partner_banks from anon;
revoke all privileges on table public.user_push_subscriptions from anon;

-- Remove implicit PUBLIC/anon execution from callable helpers and compatibility
-- RPCs that remain part of the authenticated runtime.
do $$
declare function_record record;
begin
  for function_record in
    select function_row.oid::regprocedure as signature
    from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.prokind = 'f'
      and function_row.proname = any(array[
        'can_complete_tracking_unit', 'can_use_photos_storage_file',
        'create_financial_partner_for_tenant_user',
        'create_financial_partners_for_unlinked_tenant_users',
        'current_user_tenant_ids', 'ensure_current_user_financial_partner',
        'get_allowed_apps', 'is_owner', 'is_tenant_member', 'is_tenant_owner'
      ])
  loop
    execute format('revoke all on function %s from public, anon', function_record.signature);
    execute format('grant execute on function %s to authenticated', function_record.signature);
  end loop;
end
$$;

-- Trigger-only SECURITY DEFINER functions are not API endpoints.
do $$
declare function_record record;
begin
  for function_record in
    select function_row.oid::regprocedure as signature
    from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.prokind = 'f'
      and function_row.proname = any(array[
        'ensure_branch_default_stock_location',
        'ensure_tenant_user_financial_partner',
        'guard_paperwork_processor_cancellation', 'handle_new_user'
      ])
  loop
    execute format('revoke all on function %s from public, anon, authenticated', function_record.signature);
  end loop;
end
$$;

commit;
