begin;

alter table public.auth_permissions
  drop constraint if exists auth_permissions_code_format;
alter table public.auth_permissions
  add constraint auth_permissions_code_format
  check (code ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$');

insert into public.auth_permissions (
  code, name, description, resource, action,
  module_code, permission_type, sort_order, active
)
values
  ('financial.payment.create', 'إنشاء دفعة', 'بدء تسجيل واقعة قبض أو دفع.', 'financial.payment', 'create', 'accountant_app', 'action', 100, true),
  ('financial.payment.submit', 'إرسال دفعة للاعتماد', 'إرسال مسودة الدفعة إلى دورة الاعتماد.', 'financial.payment', 'submit', 'accountant_app', 'action', 110, true),
  ('financial.payment.confirm', 'تأكيد دفعة', 'تأكيد واقعة الدفع وترحيل أثرها المالي.', 'financial.payment', 'confirm', 'accountant_app', 'action', 120, true),
  ('financial.payment.reject', 'رفض دفعة', 'رفض دفعة قبل ترحيلها.', 'financial.payment', 'reject', 'accountant_app', 'action', 130, true),
  ('financial.payment.reverse', 'عكس دفعة', 'إنشاء عكس محاسبي لدفعة مرحلة.', 'financial.payment', 'reverse', 'accountant_app', 'action', 140, true),
  ('financial.payment.refund', 'رد دفعة', 'صرف رد مالي مقابل رصيد مستحق.', 'financial.payment', 'refund', 'accountant_app', 'action', 150, true),
  ('financial.payment.allocate', 'تخصيص دفعة', 'تخصيص دفعة أو رصيد مفتوح على مستندات.', 'financial.payment', 'allocate', 'accountant_app', 'action', 160, true),
  ('financial.transfer.create', 'إنشاء تحويل مالي', 'إنشاء تحويل بين موردين ماليين.', 'financial.transfer', 'create', 'accountant_app', 'action', 200, true),
  ('financial.transfer.send', 'إرسال تحويل مالي', 'تأكيد خروج تحويل من المصدر.', 'financial.transfer', 'send', 'accountant_app', 'action', 210, true),
  ('financial.transfer.receive', 'استلام تحويل مالي', 'تأكيد استلام تحويل في الوجهة.', 'financial.transfer', 'receive', 'accountant_app', 'action', 220, true),
  ('financial.transfer.confirm', 'اعتماد تحويل مالي', 'اعتماد تحويل مالي حسب دورة الموافقة.', 'financial.transfer', 'confirm', 'accountant_app', 'action', 230, true),
  ('financial.reconciliation.manage', 'إدارة التسويات', 'إنشاء أو فك تسوية مالية مخولة.', 'financial.reconciliation', 'manage', 'accountant_app', 'action', 300, true),
  ('financial.move.create_manual', 'إنشاء قيد يدوي', 'إنشاء مسودة قيد محاسبي يدوي.', 'financial.move', 'create_manual', 'accountant_app', 'action', 400, true),
  ('financial.move.post', 'ترحيل قيد', 'ترحيل قيد محاسبي مستوف للشروط.', 'financial.move', 'post', 'accountant_app', 'action', 410, true),
  ('financial.audit.view', 'عرض التدقيق المالي', 'عرض السجل المالي وآثار الاعتماد.', 'financial.audit', 'view', 'accountant_app', 'action', 500, true),
  ('financial.destination.manage', 'إدارة الموارد المالية', 'إدارة إعدادات الموارد المالية ونطاقاتها.', 'financial.destination', 'manage', 'accountant_app', 'action', 600, true),
  ('financial.journal.manage', 'إدارة الدفاتر', 'إدارة إعدادات الدفاتر المحاسبية.', 'financial.journal', 'manage', 'accountant_app', 'action', 610, true)
on conflict (code) do update
set name = excluded.name,
    description = excluded.description,
    resource = excluded.resource,
    action = excluded.action,
    module_code = excluded.module_code,
    permission_type = excluded.permission_type,
    sort_order = excluded.sort_order,
    active = true,
    updated_at = now();

create table public.user_financial_account_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  account_id uuid not null,
  branch_id uuid,
  access_type text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint user_financial_account_access_type_check
    check (access_type in ('view', 'initiate', 'confirm', 'pay_out', 'transfer_from', 'transfer_to', 'reconcile')),
  constraint user_financial_account_access_user_fkey
    foreign key (user_id, tenant_id)
    references public.tenant_users (id, tenant_id) on delete cascade,
  constraint user_financial_account_access_account_fkey
    foreign key (account_id, tenant_id)
    references public.account_accounts (id, tenant_id) on delete cascade,
  constraint user_financial_account_access_branch_fkey
    foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete cascade,
  constraint user_financial_account_access_created_by_fkey
    foreign key (created_by, tenant_id)
    references public.tenant_users (id, tenant_id) on delete set null,
  constraint user_financial_account_access_unique
    unique nulls not distinct (tenant_id, user_id, account_id, branch_id, access_type)
);

create index user_financial_account_access_user_idx
  on public.user_financial_account_access (tenant_id, user_id, access_type);
create index user_financial_account_access_account_idx
  on public.user_financial_account_access (tenant_id, account_id, access_type);
create index user_financial_account_access_branch_idx
  on public.user_financial_account_access (tenant_id, branch_id)
  where branch_id is not null;

-- Compatibility bridge: legacy account assignments become view-only. No broad
-- financial operation is inferred from the old all-or-nothing scope.
insert into public.user_financial_account_access (
  tenant_id, user_id, account_id, branch_id, access_type
)
select legacy.tenant_id, legacy.user_id, legacy.account_id, null, 'view'
from public.user_account_access legacy
on conflict do nothing;

create or replace function public.has_financial_resource_access(
  p_tenant_id uuid,
  p_account_id uuid,
  p_access_type text,
  p_branch_id uuid default null
)
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
      and tenant_user.tenant_id = p_tenant_id
      and tenant_user.is_active = true
    limit 1
  ), resource as (
    select account.id, account.tenant_id, account.responsible_user_id
    from public.account_accounts account
    where account.id = p_account_id
      and account.tenant_id = p_tenant_id
      and account.active = true
  )
  select exists (
    select 1
    from caller cross join resource
    where p_access_type in ('view', 'initiate', 'confirm', 'pay_out', 'transfer_from', 'transfer_to', 'reconcile')
      and (
        p_branch_id is null
        or (
          exists (
            select 1 from public.branches branch
            where branch.id = p_branch_id and branch.tenant_id = caller.tenant_id and branch.is_active = true
          )
          and (
            caller.role = 'owner'
            or exists (
              select 1 from public.user_branch_access branch_access
              where branch_access.tenant_id = caller.tenant_id
                and branch_access.user_id = caller.id
                and branch_access.branch_id = p_branch_id
            )
          )
        )
      )
      and (
        caller.role = 'owner'
        or (
          resource.responsible_user_id = caller.id
          and p_access_type in ('view', 'initiate')
        )
        or exists (
          select 1
          from public.user_financial_account_access access
          where access.tenant_id = caller.tenant_id
            and access.user_id = caller.id
            and access.account_id = resource.id
            and access.access_type = p_access_type
            and (access.branch_id is null or access.branch_id = p_branch_id)
        )
      )
  )
$$;

create or replace function public.can_perform_financial_action(
  p_tenant_id uuid,
  p_permission_code text,
  p_account_id uuid default null,
  p_access_type text default null,
  p_branch_id uuid default null,
  p_state_transition_valid boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select coalesce(p_state_transition_valid, false)
    and p_permission_code like 'financial.%'
    and public.current_tenant_id() = p_tenant_id
    and public.has_permission(p_permission_code, p_tenant_id)
    and (
      p_branch_id is null
      or public.has_branch_access(p_branch_id)
    )
    and (
      (p_account_id is null and p_access_type is null)
      or (
        p_account_id is not null
        and p_access_type is not null
        and public.has_financial_resource_access(p_tenant_id, p_account_id, p_access_type, p_branch_id)
      )
    )
$$;

create or replace function public.assert_financial_authorized(
  p_tenant_id uuid,
  p_permission_code text,
  p_account_id uuid default null,
  p_access_type text default null,
  p_branch_id uuid default null,
  p_state_transition_valid boolean default true
)
returns void
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
begin
  if not public.can_perform_financial_action(
    p_tenant_id, p_permission_code, p_account_id, p_access_type,
    p_branch_id, p_state_transition_valid
  ) then
    raise exception using errcode = '42501', message = 'FINANCIAL_AUTHORIZATION_DENIED';
  end if;
end
$$;

create or replace function public.set_user_financial_account_access(
  p_tenant_id uuid,
  p_user_id uuid,
  p_account_id uuid,
  p_branch_id uuid,
  p_access_types text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  caller_user_id uuid := public.current_tenant_user_id();
  access_type text;
begin
  if not public.is_current_tenant_owner(p_tenant_id) then
    raise exception using errcode = '42501', message = 'Only the tenant owner can manage financial resource access';
  end if;
  if not exists (
    select 1 from public.tenant_users
    where id = p_user_id and tenant_id = p_tenant_id and is_active = true
  ) then
    raise exception using errcode = '23514', message = 'Financial scope target user is missing or inactive';
  end if;
  if not exists (
    select 1 from public.account_accounts
    where id = p_account_id and tenant_id = p_tenant_id and active = true
  ) then
    raise exception using errcode = '23514', message = 'Financial scope account is missing or inactive';
  end if;
  if p_branch_id is not null and not exists (
    select 1 from public.user_branch_access
    where tenant_id = p_tenant_id and user_id = p_user_id and branch_id = p_branch_id
  ) and not exists (
    select 1 from public.tenant_users
    where id = p_user_id and tenant_id = p_tenant_id and role = 'owner'
  ) then
    raise exception using errcode = '23514', message = 'Financial resource branch is outside the target user branch scope';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_access_types, array[]::text[])) requested
    where requested not in ('view', 'initiate', 'confirm', 'pay_out', 'transfer_from', 'transfer_to', 'reconcile')
  ) then
    raise exception using errcode = '22023', message = 'Unknown financial resource access type';
  end if;

  delete from public.user_financial_account_access access
  where access.tenant_id = p_tenant_id
    and access.user_id = p_user_id
    and access.account_id = p_account_id
    and access.branch_id is not distinct from p_branch_id;

  foreach access_type in array coalesce(p_access_types, array[]::text[]) loop
    insert into public.user_financial_account_access (
      tenant_id, user_id, account_id, branch_id, access_type, created_by
    ) values (
      p_tenant_id, p_user_id, p_account_id, p_branch_id, access_type, caller_user_id
    ) on conflict do nothing;
  end loop;

  return jsonb_build_object(
    'tenant_id', p_tenant_id,
    'user_id', p_user_id,
    'account_id', p_account_id,
    'branch_id', p_branch_id,
    'access_types', to_jsonb(coalesce(p_access_types, array[]::text[]))
  );
end
$$;

alter table public.user_financial_account_access enable row level security;
revoke all on public.user_financial_account_access from public, anon, authenticated;

create policy user_financial_account_access_read
on public.user_financial_account_access for select to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (user_id = public.current_tenant_user_id() or public.is_current_tenant_owner(tenant_id))
);
create policy user_financial_account_access_insert_owner
on public.user_financial_account_access for insert to authenticated
with check (public.is_current_tenant_owner(tenant_id));
create policy user_financial_account_access_delete_owner
on public.user_financial_account_access for delete to authenticated
using (public.is_current_tenant_owner(tenant_id));

grant select, insert, delete on public.user_financial_account_access to authenticated;

revoke all on function public.has_financial_resource_access(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.can_perform_financial_action(uuid, text, uuid, text, uuid, boolean) from public, anon;
revoke all on function public.assert_financial_authorized(uuid, text, uuid, text, uuid, boolean) from public, anon;
revoke all on function public.set_user_financial_account_access(uuid, uuid, uuid, uuid, text[]) from public, anon;
grant execute on function public.has_financial_resource_access(uuid, uuid, text, uuid) to authenticated;
grant execute on function public.can_perform_financial_action(uuid, text, uuid, text, uuid, boolean) to authenticated;
grant execute on function public.assert_financial_authorized(uuid, text, uuid, text, uuid, boolean) to authenticated;
grant execute on function public.set_user_financial_account_access(uuid, uuid, uuid, uuid, text[]) to authenticated;

comment on table public.user_financial_account_access is
  'Phase 1 hybrid financial-resource scope on ledger accounts; migrates later to Money Destinations without broadening legacy user_account_access.';
comment on function public.can_perform_financial_action(uuid, text, uuid, text, uuid, boolean) is
  'Canonical financial authorization: tenant membership AND action permission AND branch scope AND financial resource scope AND valid state transition.';
comment on function public.has_financial_resource_access(uuid, uuid, text, uuid) is
  'Checks account-backed financial resource scope. Own custody grants view/initiate only; owner is an in-tenant override.';

commit;
