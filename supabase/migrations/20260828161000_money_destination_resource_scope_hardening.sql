begin;

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
      and (
        account.money_destination_id is null
        or exists (
          select 1 from public.money_destinations destination
          where destination.id = account.money_destination_id
            and destination.tenant_id = account.tenant_id
            and destination.status = 'active'
            and destination.ledger_account_id = account.id
        )
      )
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
          select 1 from public.user_financial_account_access access
          where access.tenant_id = caller.tenant_id
            and access.user_id = caller.id
            and access.account_id = resource.id
            and access.access_type = p_access_type
            and (access.branch_id is null or access.branch_id = p_branch_id)
        )
      )
  )
$$;

comment on function public.has_financial_resource_access(uuid, uuid, text, uuid) is
  'Phase 1 account-backed scope with Phase 3B lifecycle enforcement: resource accounts are operational only while their linked Money Destination is active.';

commit;
