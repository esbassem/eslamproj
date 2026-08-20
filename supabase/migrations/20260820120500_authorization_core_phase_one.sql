begin;

create extension if not exists pgcrypto;

-- Phase 1 permission registry. Existing groups remain the compatibility bridge.
create table if not exists public.auth_permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  resource text not null,
  action text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint auth_permissions_code_format check (code ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  constraint auth_permissions_resource_action_key unique (resource, action)
);

create table if not exists public.auth_group_permissions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.res_groups(id) on delete cascade,
  permission_id uuid not null references public.auth_permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint auth_group_permissions_group_permission_key unique (group_id, permission_id)
);

create index if not exists auth_group_permissions_group_idx
  on public.auth_group_permissions (group_id);
create index if not exists auth_group_permissions_permission_idx
  on public.auth_group_permissions (permission_id);

insert into public.auth_permissions (code, name, description, resource, action)
values
  ('showroom.read', 'عرض المعرض', 'قراءة بيانات تطبيق المعرض.', 'showroom', 'read'),
  ('showroom.create', 'إنشاء بيع', 'إنشاء عمليات بيع في المعرض.', 'showroom', 'create'),
  ('showroom.cancel', 'إلغاء بيع', 'إلغاء عملية بيع مؤكدة.', 'showroom', 'cancel'),
  ('pos.open', 'فتح نقطة البيع', 'فتح جلسة نقطة بيع.', 'pos', 'open'),
  ('pos.sell', 'البيع من نقطة البيع', 'إنشاء طلبات نقطة البيع.', 'pos', 'sell'),
  ('pos.close', 'إغلاق نقطة البيع', 'إغلاق وتسوية جلسة نقطة البيع.', 'pos', 'close'),
  ('inventory.read', 'عرض المخزون', 'قراءة بيانات المخزون.', 'inventory', 'read'),
  ('inventory.transfer', 'نقل المخزون', 'تنفيذ حركات النقل.', 'inventory', 'transfer'),
  ('inventory.adjust', 'تسوية المخزون', 'تنفيذ تسويات واستكمال بيانات المخزون.', 'inventory', 'adjust'),
  ('accounting.read', 'عرض المحاسبة', 'قراءة البيانات المحاسبية.', 'accounting', 'read'),
  ('accounting.post', 'ترحيل القيود', 'إنشاء وترحيل العمليات المحاسبية.', 'accounting', 'post'),
  ('accounting.reverse', 'عكس القيود', 'عكس أو حذف العمليات المحاسبية المسموح بها.', 'accounting', 'reverse'),
  ('paperwork.read', 'عرض الأوراق', 'قراءة طلبات ومستندات الأوراق.', 'paperwork', 'read'),
  ('paperwork.deliver', 'تسليم الأوراق', 'تنفيذ تسليم الأوراق.', 'paperwork', 'deliver'),
  ('crm.read', 'عرض CRM', 'قراءة العملاء المحتملين المسموح بهم.', 'crm', 'read'),
  ('crm.read_all', 'عرض كل CRM', 'قراءة جميع العملاء المحتملين داخل الشركة.', 'crm', 'read_all'),
  ('crm.assign', 'توزيع CRM', 'تعيين العملاء المحتملين لموظفي المبيعات.', 'crm', 'assign'),
  ('receivables.read', 'عرض المديونيات', 'قراءة المديونيات والاستحقاقات.', 'receivables', 'read'),
  ('receivables.manage', 'إدارة المديونيات', 'إنشاء وتعديل المديونيات والاستحقاقات.', 'receivables', 'manage')
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    resource = excluded.resource,
    action = excluded.action,
    active = true,
    updated_at = now();

-- Backward-compatible grants from the existing application groups.
with mappings(group_code, permission_code) as (
  values
    ('showroom_point_user', 'showroom.read'),
    ('showroom_point_user', 'showroom.create'),
    ('pos_user', 'pos.open'),
    ('pos_user', 'pos.sell'),
    ('pos_user', 'pos.close'),
    ('products_user', 'inventory.read'),
    ('inventory_user', 'inventory.read'),
    ('inventory_user', 'inventory.transfer'),
    ('inventory_user', 'inventory.adjust'),
    ('inventory_complete_tracking_unit', 'inventory.adjust'),
    ('accountant_app_user', 'accounting.read'),
    ('accountant_app_user', 'accounting.post'),
    ('accountant_app_manager', 'accounting.read'),
    ('accountant_app_manager', 'accounting.post'),
    ('accountant_app_manager', 'accounting.reverse'),
    ('moto_customer_care_user', 'paperwork.read'),
    ('moto_customer_care_user', 'paperwork.deliver'),
    ('receivables_user', 'receivables.read'),
    ('receivables_manager', 'receivables.read'),
    ('receivables_manager', 'receivables.manage')
)
insert into public.auth_group_permissions (group_id, permission_id)
select groups.id, permissions.id
from mappings
join public.res_groups groups on groups.code = mappings.group_code and groups.active = true
join public.auth_permissions permissions on permissions.code = mappings.permission_code
on conflict (group_id, permission_id) do nothing;

-- The project currently enforces one tenant_users row per auth user.
create or replace function public.current_tenant_user_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select tenant_user.id
  from public.tenant_users tenant_user
  where tenant_user.auth_user_id = auth.uid()
    and tenant_user.is_active = true
  limit 1
$$;

create or replace function public.current_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select tenant_user.tenant_id
  from public.tenant_users tenant_user
  where tenant_user.auth_user_id = auth.uid()
    and tenant_user.is_active = true
  limit 1
$$;

create or replace function public.is_current_tenant_owner(p_tenant_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.tenant_users tenant_user
    where tenant_user.auth_user_id = auth.uid()
      and tenant_user.is_active = true
      and tenant_user.role = 'owner'
      and tenant_user.tenant_id = coalesce(p_tenant_id, tenant_user.tenant_id)
  )
$$;

create or replace function public.has_permission(p_permission_code text, p_tenant_id uuid default null)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with caller as (
    select tenant_user.id, tenant_user.tenant_id, tenant_user.role
    from public.tenant_users tenant_user
    where tenant_user.auth_user_id = auth.uid()
      and tenant_user.is_active = true
      and (p_tenant_id is null or tenant_user.tenant_id = p_tenant_id)
    limit 1
  )
  select exists (select 1 from caller where role = 'owner')
    or exists (
      select 1
      from caller
      join public.res_users_groups membership
        on membership.user_id = caller.id
       and membership.tenant_id = caller.tenant_id
      join public.res_groups permission_group
        on permission_group.id = membership.group_id
       and permission_group.active = true
       and (permission_group.tenant_id is null or permission_group.tenant_id = caller.tenant_id)
      join public.auth_group_permissions group_permission
        on group_permission.group_id = permission_group.id
      join public.auth_permissions permission
        on permission.id = group_permission.permission_id
       and permission.active = true
      where permission.code = p_permission_code
    )
$$;

create or replace function public.get_my_permissions()
returns text[]
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with caller as (
    select tenant_user.id, tenant_user.tenant_id, tenant_user.role
    from public.tenant_users tenant_user
    where tenant_user.auth_user_id = auth.uid()
      and tenant_user.is_active = true
    limit 1
  )
  select coalesce(array_agg(distinct permission.code order by permission.code), array[]::text[])
  from public.auth_permissions permission
  cross join caller
  where permission.active = true
    and (
      caller.role = 'owner'
      or exists (
        select 1
        from public.res_users_groups membership
        join public.res_groups permission_group
          on permission_group.id = membership.group_id
         and permission_group.active = true
         and (permission_group.tenant_id is null or permission_group.tenant_id = caller.tenant_id)
        join public.auth_group_permissions group_permission
          on group_permission.group_id = permission_group.id
        where membership.user_id = caller.id
          and membership.tenant_id = caller.tenant_id
          and group_permission.permission_id = permission.id
      )
    )
$$;

-- Defence in depth: even if an UPDATE policy is later broadened, a caller may not
-- change the security identity of their own tenant_users row.
create or replace function public.guard_tenant_user_security_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null
     and old.auth_user_id = auth.uid()
     and (
       new.tenant_id is distinct from old.tenant_id
       or new.auth_user_id is distinct from old.auth_user_id
       or new.role is distinct from old.role
       or new.is_active is distinct from old.is_active
       or new.partner_id is distinct from old.partner_id
     ) then
    raise exception 'AUTHORIZATION_SECURITY_FIELDS_IMMUTABLE'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists tenant_users_guard_security_fields on public.tenant_users;
create trigger tenant_users_guard_security_fields
before update on public.tenant_users
for each row execute function public.guard_tenant_user_security_fields();

-- Core tables are never writable by anon.
do $$
declare v_table_name text;
begin
  foreach v_table_name in array array[
    'tenant_users', 'res_groups', 'res_users_groups', 'ir_model_access',
    'ir_modules', 'ir_module_dependencies', 'ir_ui_menus', 'ir_ui_menu_groups',
    'tenant_modules', 'auth_permissions', 'auth_group_permissions'
  ] loop
    if to_regclass('public.' || v_table_name) is not null then
      execute format('revoke all privileges on table public.%I from anon', v_table_name);
    end if;
  end loop;
end
$$;

alter table public.auth_permissions enable row level security;
alter table public.auth_group_permissions enable row level security;
alter table public.res_groups enable row level security;
alter table public.res_users_groups enable row level security;
alter table public.ir_model_access enable row level security;
alter table public.ir_modules enable row level security;
alter table public.ir_module_dependencies enable row level security;
alter table public.ir_ui_menus enable row level security;
alter table public.ir_ui_menu_groups enable row level security;
alter table public.tenant_modules enable row level security;

drop policy if exists auth_permissions_read on public.auth_permissions;
create policy auth_permissions_read on public.auth_permissions
for select to authenticated using (active = true and public.current_tenant_user_id() is not null);

drop policy if exists auth_group_permissions_read on public.auth_group_permissions;
create policy auth_group_permissions_read on public.auth_group_permissions
for select to authenticated using (
  public.current_tenant_user_id() is not null
  and exists (
    select 1 from public.res_groups permission_group
    where permission_group.id = auth_group_permissions.group_id
      and permission_group.active = true
      and (permission_group.tenant_id is null or permission_group.tenant_id = public.current_tenant_id())
  )
);

drop policy if exists res_groups_select_member on public.res_groups;
create policy res_groups_select_member on public.res_groups
for select to authenticated using (
  active = true and (tenant_id is null or tenant_id = public.current_tenant_id())
);

drop policy if exists res_users_groups_select_member on public.res_users_groups;
create policy res_users_groups_select_member on public.res_users_groups
for select to authenticated using (tenant_id = public.current_tenant_id());

drop policy if exists res_users_groups_insert_owner on public.res_users_groups;
create policy res_users_groups_insert_owner on public.res_users_groups
for insert to authenticated with check (
  public.is_current_tenant_owner(tenant_id)
  and exists (
    select 1 from public.tenant_users target_user
    where target_user.id = user_id and target_user.tenant_id = res_users_groups.tenant_id
  )
  and exists (
    select 1 from public.res_groups target_group
    where target_group.id = group_id
      and target_group.active = true
      and (target_group.tenant_id is null or target_group.tenant_id = res_users_groups.tenant_id)
  )
);

drop policy if exists res_users_groups_delete_owner on public.res_users_groups;
create policy res_users_groups_delete_owner on public.res_users_groups
for delete to authenticated using (public.is_current_tenant_owner(tenant_id));

drop policy if exists ir_model_access_select_authenticated on public.ir_model_access;
create policy ir_model_access_select_authenticated on public.ir_model_access
for select to authenticated using (active = true and public.current_tenant_user_id() is not null);

drop policy if exists ir_modules_read_authenticated on public.ir_modules;
create policy ir_modules_read_authenticated on public.ir_modules
for select to authenticated using (public.current_tenant_user_id() is not null);

drop policy if exists ir_module_dependencies_read_authenticated on public.ir_module_dependencies;
create policy ir_module_dependencies_read_authenticated on public.ir_module_dependencies
for select to authenticated using (public.current_tenant_user_id() is not null);

drop policy if exists ir_ui_menus_read_authenticated on public.ir_ui_menus;
create policy ir_ui_menus_read_authenticated on public.ir_ui_menus
for select to authenticated using (public.current_tenant_user_id() is not null);

drop policy if exists ir_ui_menu_groups_read_authenticated on public.ir_ui_menu_groups;
create policy ir_ui_menu_groups_read_authenticated on public.ir_ui_menu_groups
for select to authenticated using (public.current_tenant_user_id() is not null);

drop policy if exists tenant_modules_read_member on public.tenant_modules;
create policy tenant_modules_read_member on public.tenant_modules
for select to authenticated using (tenant_id = public.current_tenant_id());

drop policy if exists tenant_modules_insert_member on public.tenant_modules;
drop policy if exists tenant_modules_insert_owner on public.tenant_modules;
create policy tenant_modules_insert_owner on public.tenant_modules
for insert to authenticated with check (public.is_current_tenant_owner(tenant_id));

drop policy if exists tenant_modules_update_member on public.tenant_modules;
drop policy if exists tenant_modules_update_owner on public.tenant_modules;
create policy tenant_modules_update_owner on public.tenant_modules
for update to authenticated
using (public.is_current_tenant_owner(tenant_id))
with check (public.is_current_tenant_owner(tenant_id));

drop policy if exists tenant_modules_delete_owner on public.tenant_modules;
create policy tenant_modules_delete_owner on public.tenant_modules
for delete to authenticated using (public.is_current_tenant_owner(tenant_id));

-- Catalog mutations are reserved for migrations/service_role. Membership and
-- tenant module changes keep their current owner-managed frontend behavior.
revoke insert, update, delete on public.auth_permissions from authenticated;
revoke insert, update, delete on public.auth_group_permissions from authenticated;
revoke insert, update, delete on public.res_groups from authenticated;
revoke insert, update, delete on public.ir_model_access from authenticated;
revoke insert, update, delete on public.ir_modules from authenticated;
revoke insert, update, delete on public.ir_module_dependencies from authenticated;
revoke insert, update, delete on public.ir_ui_menus from authenticated;
revoke insert, update, delete on public.ir_ui_menu_groups from authenticated;

grant select on public.auth_permissions, public.auth_group_permissions to authenticated;
grant select on public.res_groups, public.ir_model_access, public.ir_modules,
  public.ir_module_dependencies, public.ir_ui_menus, public.ir_ui_menu_groups to authenticated;
grant select, insert, delete on public.res_users_groups to authenticated;
grant select, insert, update, delete on public.tenant_modules to authenticated;

-- Block anonymous access to sensitive business data, independently of RLS.
do $$
declare v_table_name text;
begin
  foreach v_table_name in array array[
    'account_accounts', 'account_groups', 'account_journals', 'account_moves',
    'account_move_lines', 'account_partial_reconcile', 'account_payment_methods',
    'account_payment_method_lines', 'account_payments', 'payment_settings',
    'old_cashbox_transactions', 'showroom_configs', 'showroom_sales', 'showroom_sale_lines',
    'showroom_sale_number_sequences', 'stock_locations', 'stock_moves', 'stock_quants',
    'stock_tracking_units', 'stock_tracking_unit_attributes',
    'stock_tracking_unit_identifiers', 'stock_tracking_unit_licenses',
    'stock_tracking_unit_ownerships', 'stock_tracking_unit_events',
    'product_templates', 'product_products', 'product_categories', 'product_brands',
    'product_attributes', 'product_attribute_values', 'product_category_attributes',
    'product_category_required_documents', 'product_category_tracking_identifiers',
    'product_product_attribute_values', 'product_tracking_identifier_types',
    'transaction_line_attributes',
    'receivables', 'receivable_installments', 'receivable_events',
    'receivable_guarantors', 'receivable_payment_plans', 'pos_configs',
    'pos_config_payment_methods', 'pos_sessions', 'pos_orders', 'pos_order_lines',
    'pos_payments', 'pos_payment_methods', 'partners', 'ir_attachments',
    'paperwork_requests',
    'paperwork_documents', 'paperwork_document_moves', 'crm_leads', 'crm_sales_users'
  ] loop
    if to_regclass('public.' || v_table_name) is not null then
      execute format('revoke all privileges on table public.%I from anon', v_table_name);
    end if;
  end loop;
end
$$;

-- Temporary tenant-wide isolation for previously unprotected critical tables.
-- Application/action-level policies are intentionally deferred to later phases.
do $$
declare v_table_name text;
begin
  foreach v_table_name in array array[
    'account_accounts', 'account_groups', 'account_journals', 'account_moves',
    'account_move_lines', 'account_partial_reconcile', 'account_payment_method_lines',
    'account_payments', 'payment_settings', 'old_cashbox_transactions',
    'showroom_configs', 'showroom_sales', 'showroom_sale_lines',
    'showroom_sale_number_sequences', 'stock_moves', 'stock_quants',
    'stock_tracking_units', 'stock_tracking_unit_attributes',
    'stock_tracking_unit_identifiers', 'stock_tracking_unit_licenses',
    'stock_tracking_unit_ownerships', 'product_templates', 'product_products',
    'product_categories', 'product_brands', 'product_attributes',
    'product_attribute_values', 'product_category_attributes',
    'product_category_required_documents', 'product_category_tracking_identifiers',
    'product_product_attribute_values', 'product_tracking_identifier_types',
    'transaction_line_attributes', 'receivables', 'receivable_installments',
    'receivable_events', 'receivable_guarantors', 'receivable_payment_plans',
    'pos_configs', 'pos_config_payment_methods', 'pos_sessions', 'pos_orders',
    'pos_order_lines', 'pos_payments', 'pos_payment_methods', 'partners', 'ir_attachments'
  ] loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and information_schema.columns.table_name = v_table_name
        and column_name = 'tenant_id'
    ) then
      execute format('alter table public.%I enable row level security', v_table_name);
      execute format('drop policy if exists phase1_tenant_member_all on public.%I', v_table_name);
      execute format(
        'create policy phase1_tenant_member_all on public.%I for all to authenticated using (public.is_tenant_member(tenant_id)) with check (public.is_tenant_member(tenant_id))',
        v_table_name
      );
    end if;
  end loop;
end
$$;

-- RPCs form the trusted API boundary: no implicit PUBLIC/anon execution.
revoke all on function public.current_tenant_user_id() from public, anon;
revoke all on function public.current_tenant_id() from public, anon;
revoke all on function public.is_current_tenant_owner(uuid) from public, anon;
revoke all on function public.has_permission(text, uuid) from public, anon;
revoke all on function public.get_my_permissions() from public, anon;
revoke all on function public.guard_tenant_user_security_fields() from public, anon, authenticated;

grant execute on function public.current_tenant_user_id() to authenticated;
grant execute on function public.current_tenant_id() to authenticated;
grant execute on function public.is_current_tenant_owner(uuid) to authenticated;
grant execute on function public.has_permission(text, uuid) to authenticated;
grant execute on function public.get_my_permissions() to authenticated;

-- Existing sensitive RPCs must not inherit PostgreSQL's default PUBLIC execute.
-- Their application-specific authorization remains unchanged in this phase.
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
        'authorize_paperwork_document_release', 'cancel_paperwork_document',
        'cancel_paperwork_request', 'cancel_showroom_sale',
        'complete_incomplete_tracking_unit', 'complete_showroom_sale',
        'confirm_processor_paperwork_cancellation', 'confirm_sale_paperwork_request',
        'create_accountant_payment_entity_credit', 'create_cash_location_operation',
        'create_confirmed_showroom_sale_return', 'create_employee_custody_account',
        'create_legacy_delivered_paperwork_request', 'create_manual_paperwork_receipt',
        'create_manual_receivable', 'delete_account_move_atomic',
        'delete_pending_showroom_sale', 'delete_unused_employee_custody_account',
        'deliver_paperwork_to_customer', 'link_existing_vault_document_to_request',
        'link_vault_paperwork_request', 'notify_paperwork_customer',
        'pay_showroom_sale_accounting', 'receive_paperwork_request_from_processor',
        'record_previous_customer_paperwork_delivery',
        'record_previous_customer_paperwork_delivery_bulk',
        'record_previous_paperwork_document_delivery',
        'send_paperwork_request_to_processor', 'set_paperwork_document_owner_partner',
        'settle_showroom_sale_balance', 'settle_showroom_sale_with_open_credits'
      ])
  loop
    execute format('revoke all on function %s from public, anon', function_record.signature);
    execute format('grant execute on function %s to authenticated', function_record.signature);
  end loop;
end
$$;

comment on table public.auth_permissions is 'Canonical phase-one action permission registry.';
comment on table public.auth_group_permissions is 'Many-to-many bridge from existing res_groups to canonical permissions.';
comment on function public.has_permission(text, uuid) is 'Checks the authenticated active tenant user; owner is an in-tenant override.';

commit;
