-- Phase 2E.2.5 rollback-safe runtime contract. All fixtures and probe payments roll back.
begin;

create temporary table phase2e25_context as
select owner.tenant_id, owner.id owner_id, owner.auth_user_id owner_auth,
  unassigned.id operator_auth, foreign_member.auth_user_id foreign_auth,
  marker.canonical_generation
from public.showroom_financial_cutovers marker
join public.tenant_users owner
  on owner.tenant_id = marker.tenant_id
 and owner.role = 'owner' and owner.is_active
 and owner.auth_user_id is not null
join lateral (
  select auth_user.id
  from auth.users auth_user
  where not exists (
    select 1 from public.tenant_users member
    where member.auth_user_id = auth_user.id
  )
  order by auth_user.created_at, auth_user.id
  limit 1
) unassigned on true
join lateral (
  select member.auth_user_id
  from public.tenant_users member
  where member.tenant_id <> marker.tenant_id
    and member.is_active and member.auth_user_id is not null
    and not exists (
      select 1 from public.tenant_users target_member
      where target_member.tenant_id = marker.tenant_id
        and target_member.auth_user_id = member.auth_user_id
        and target_member.is_active
    )
  order by member.tenant_id, member.id
  limit 1
) foreign_member on true
where marker.source_app = 'showroom' and marker.source_model = 'sale'
  and exists (
    select 1 from public.account_functional_accounts item
    where item.tenant_id = marker.tenant_id
      and item.functional_role = 'customer_receivable' and item.is_active
  )
  and exists (
    select 1 from public.account_functional_accounts item
    where item.tenant_id = marker.tenant_id
      and item.functional_role = 'sales_revenue' and item.is_active
  )
order by owner.tenant_id
limit 1;

do $$
begin
  if not exists (select 1 from phase2e25_context) then
    raise exception 'PHASE2E25_RUNTIME_FIXTURE_UNAVAILABLE';
  end if;
end
$$;

create temporary table phase2e25_resources (
  branch_id uuid, forbidden_branch_id uuid, operator_id uuid,
  showroom_config_id uuid, forbidden_config_id uuid,
  customer_id uuid, payment_method_id uuid, inactive_method_id uuid,
  destination_id uuid, forbidden_destination_id uuid,
  sale_id uuid, wrong_branch_sale_id uuid, noncanonical_sale_id uuid,
  permission_group_id uuid
);
grant select on phase2e25_context to authenticated;
grant select, update on phase2e25_resources to authenticated;
grant select on phase2e25_resources to anon;

do $$
declare
  context phase2e25_context%rowtype;
  resources phase2e25_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
begin
  select * into context from phase2e25_context;
  resources.branch_id := gen_random_uuid();
  resources.forbidden_branch_id := gen_random_uuid();
  resources.operator_id := gen_random_uuid();
  resources.showroom_config_id := gen_random_uuid();
  resources.forbidden_config_id := gen_random_uuid();
  resources.customer_id := gen_random_uuid();
  resources.payment_method_id := gen_random_uuid();
  resources.inactive_method_id := gen_random_uuid();
  resources.sale_id := gen_random_uuid();
  resources.wrong_branch_sale_id := gen_random_uuid();
  resources.noncanonical_sale_id := gen_random_uuid();

  insert into public.branches (id, tenant_id, name, code, is_active) values
    (resources.branch_id, context.tenant_id, 'Phase 2E.2.5 Branch',
      'E25' || left(suffix, 5), true),
    (resources.forbidden_branch_id, context.tenant_id,
      'Phase 2E.2.5 Forbidden Branch', 'E2F' || left(suffix, 5), true);
  insert into public.showroom_configs (id, tenant_id, branch_id, name, code) values
    (resources.showroom_config_id, context.tenant_id, resources.branch_id,
      'Phase 2E.2.5 Showroom', 'E25-' || left(suffix, 6)),
    (resources.forbidden_config_id, context.tenant_id, resources.forbidden_branch_id,
      'Phase 2E.2.5 Forbidden Showroom', 'E2F-' || left(suffix, 6));
  insert into public.partners (
    id, tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values (
    resources.customer_id, context.tenant_id, resources.branch_id,
    'Phase 2E.2.5 Customer', 'person', false, true, 1, 0, 0, true
  );
  insert into public.tenant_users (
    id, tenant_id, auth_user_id, full_name, role, is_active
  ) values (
    resources.operator_id, context.tenant_id, context.operator_auth,
    'Phase 2E.2.5 Showroom Operator', 'sales', true
  );
  insert into public.res_groups (
    tenant_id, name, code, category, is_system, active
  ) values (
    context.tenant_id, 'Phase 2E.2.5 Showroom Access',
    'phase2e25_showroom_' || suffix, 'showroom', false, true
  ) returning id into resources.permission_group_id;
  insert into public.auth_group_permissions (group_id, permission_id)
  select resources.permission_group_id, permission.id
  from public.auth_permissions permission
  where permission.code = 'showroom_point.access';
  insert into public.res_users_groups (tenant_id, user_id, group_id)
  values (context.tenant_id, resources.operator_id, resources.permission_group_id);
  insert into public.user_branch_access (tenant_id, user_id, branch_id)
  values (context.tenant_id, resources.operator_id, resources.branch_id);

  insert into public.financial_payment_methods (
    id, tenant_id, name, semantic_key, method_type, settlement_mode,
    is_active, requires_reference, requires_confirmation, created_by
  ) values
    (resources.payment_method_id, context.tenant_id,
      'Phase 2E.2.5 Cash', 'phase2e25_cash_' || suffix, 'cash', 'direct',
      true, false, false, context.owner_id),
    (resources.inactive_method_id, context.tenant_id,
      'Phase 2E.2.5 Inactive', 'phase2e25_inactive_' || suffix, 'cash', 'direct',
      false, false, false, context.owner_id);
  insert into phase2e25_resources values (resources.*);
end
$$;

-- Provision one destination in scope and one otherwise compatible destination
-- in a branch the Showroom operator cannot access.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from phase2e25_context;
set local role authenticated;
do $$
declare
  context phase2e25_context%rowtype;
  resources phase2e25_resources%rowtype;
  result jsonb;
begin
  select * into context from phase2e25_context;
  select * into resources from phase2e25_resources;
  result := public.create_and_provision_money_destination(
    context.tenant_id, 'phase2e25_cashbox_' ||
      left(replace(resources.branch_id::text, '-', ''), 8),
    'Phase 2E.2.5 Cashbox', 'cashbox', resources.branch_id,
    null, null, null, null, null, '{}'::jsonb, true
  );
  resources.destination_id := (result ->> 'destination_id')::uuid;
  result := public.create_and_provision_money_destination(
    context.tenant_id, 'phase2e25_forbidden_' ||
      left(replace(resources.forbidden_branch_id::text, '-', ''), 8),
    'Phase 2E.2.5 Forbidden Cashbox', 'cashbox', resources.forbidden_branch_id,
    null, null, null, null, null, '{}'::jsonb, true
  );
  resources.forbidden_destination_id := (result ->> 'destination_id')::uuid;
  update phase2e25_resources set
    destination_id = resources.destination_id,
    forbidden_destination_id = resources.forbidden_destination_id;
end
$$;
reset role;

create function pg_temp.make_phase2e25_canonical_sale(
  p_sale_id uuid, p_branch_id uuid, p_config_id uuid, p_amount numeric
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  context phase2e25_context%rowtype;
  resources phase2e25_resources%rowtype;
  result jsonb;
begin
  select * into context from phase2e25_context;
  select * into resources from phase2e25_resources;
  insert into public.showroom_sales (
    id, tenant_id, branch_id, customer_id, sale_date, status,
    total_amount, showroom_config_id, created_by, notes
  ) values (
    p_sale_id, context.tenant_id, p_branch_id, resources.customer_id,
    current_date, 'pending_payment', p_amount, p_config_id,
    context.owner_id, 'Phase 2E.2.5 Canonical options fixture'
  );
  result := public.post_financial_sale(
    context.tenant_id, 'showroom', 'sale', p_sale_id::text, 1,
    'phase2e25-sale-' || p_sale_id::text, repeat('d', 64),
    resources.customer_id, p_amount, 'EGP', current_date,
    p_branch_id, 'E25-' || left(replace(p_sale_id::text, '-', ''), 12)
  );
  update public.showroom_sales
  set status = 'confirmed', account_move_id = (result ->> 'account_move_id')::uuid
  where id = p_sale_id and tenant_id = context.tenant_id;
end
$$;

select set_config('request.jwt.claim.sub', owner_auth::text, true)
from phase2e25_context;
do $$
declare resources phase2e25_resources%rowtype;
begin
  select * into resources from phase2e25_resources;
  perform pg_temp.make_phase2e25_canonical_sale(
    resources.sale_id, resources.branch_id, resources.showroom_config_id, 50000
  );
  perform pg_temp.make_phase2e25_canonical_sale(
    resources.wrong_branch_sale_id, resources.forbidden_branch_id,
    resources.forbidden_config_id, 50000
  );
  insert into public.showroom_sales (
    id, tenant_id, branch_id, customer_id, sale_date, status,
    total_amount, showroom_config_id, created_by, notes
  ) select resources.noncanonical_sale_id, context.tenant_id,
    resources.branch_id, resources.customer_id, current_date, 'confirmed',
    50000, resources.showroom_config_id, context.owner_id,
    'Phase 2E.2.5 non-Canonical fixture'
  from phase2e25_context context;
end
$$;

select set_config('request.jwt.claim.sub', operator_auth::text, true)
from phase2e25_context;
set local role authenticated;

-- A. Authorized Showroom-only operator receives the usable method and only the
-- destination in branch scope. The DTO contains business fields only.
create temporary table phase2e25_options as
select public.list_showroom_sale_payment_options(resources.sale_id) result
from phase2e25_resources resources;

do $$
declare
  context phase2e25_context%rowtype;
  resources phase2e25_resources%rowtype;
  result jsonb := (select item.result from phase2e25_options item);
  returned_method jsonb;
  forbidden_key text;
begin
  select * into context from phase2e25_context;
  select * into resources from phase2e25_resources;
  if not public.has_permission('showroom_point.access', context.tenant_id) then
    raise exception 'PHASE2E25_SHOWROOM_PERMISSION_MISSING';
  end if;
  if exists (
    select 1 from unnest(array[
      'financial.payment.create', 'financial.payment.submit',
      'financial.payment.confirm', 'financial.payment.post',
      'financial.payment.allocate', 'financial.payment_method.manage'
    ]) permission_code
    where public.has_permission(permission_code, context.tenant_id)
  ) then
    raise exception 'PHASE2E25_OPERATOR_HAS_GENERIC_FINANCIAL_PERMISSION';
  end if;

  if result ->> 'sale_id' <> resources.sale_id::text
     or jsonb_array_length(result -> 'payment_methods') < 1 then
    raise exception 'PHASE2E25_AUTHORIZED_OPTIONS_INVALID: %', result;
  end if;
  select item.value into returned_method
  from jsonb_array_elements(result -> 'payment_methods') item
  where item.value ->> 'id' = resources.payment_method_id::text;
  if returned_method is null
     or returned_method ->> 'id' <> resources.payment_method_id::text
     or returned_method ->> 'name' <> 'Phase 2E.2.5 Cash'
     or returned_method ->> 'type' <> 'cash'
     or (returned_method ->> 'requires_reference')::boolean
     or not (returned_method ->> 'requires_money_destination')::boolean
     or not exists (
       select 1
       from jsonb_array_elements(returned_method -> 'money_destinations') item
       where item.value ->> 'id' = resources.destination_id::text
         and item.value ->> 'name' = 'Phase 2E.2.5 Cashbox'
         and item.value ->> 'type' = 'cashbox'
     )
     or result::text like '%' || resources.forbidden_destination_id::text || '%'
     or result::text like '%' || resources.inactive_method_id::text || '%'
  then
    raise exception 'PHASE2E25_OPTION_FILTER_INVALID: %', result;
  end if;

  foreach forbidden_key in array array[
    'account_id', 'journal_id', 'receivable_line_id', 'ledger_account_id',
    'account_move_id', 'canonical_sale_posting_id', 'debit', 'credit'
  ] loop
    if result::text ~ ('"' || forbidden_key || '"[[:space:]]*:') then
      raise exception 'PHASE2E25_SENSITIVE_KEY_EXPOSED: %', forbidden_key;
    end if;
  end loop;
end
$$;

-- G. Every returned direct method/destination passes the real command. The
-- entire test transaction rolls this probe payment and its accounting back.
do $$
declare
  resources phase2e25_resources%rowtype;
  method jsonb;
  destination jsonb;
  result jsonb;
begin
  select * into resources from phase2e25_resources;
  for method in select value from jsonb_array_elements(
    (select options.result -> 'payment_methods' from phase2e25_options options)
  ) loop
    if (method ->> 'requires_money_destination')::boolean then
      for destination in select value from jsonb_array_elements(
        method -> 'money_destinations'
      ) loop
        result := public.collect_showroom_sale_payment(
          resources.sale_id, 1,
          (method ->> 'id')::uuid,
          'phase2e25-option-' || (method ->> 'id') || '-' || (destination ->> 'id'),
          (destination ->> 'id')::uuid,
          'E25-PROBE', 'Phase 2E.2.5 compatibility probe'
        );
        if not coalesce((result ->> 'success')::boolean, false)
           or result ->> 'payment_status' <> 'confirmed'
           or result ->> 'accounting_state' <> 'posted' then
          raise exception 'PHASE2E25_COMMAND_COMPATIBILITY_FAILED: %', result;
        end if;
      end loop;
    else
      result := public.collect_showroom_sale_payment(
        resources.sale_id, 1,
        (method ->> 'id')::uuid,
        'phase2e25-option-' || (method ->> 'id'),
        null, 'E25-PROBE', 'Phase 2E.2.5 compatibility probe'
      );
      if not coalesce((result ->> 'success')::boolean, false)
         or result ->> 'payment_status' <> 'confirmed'
         or result ->> 'accounting_state' <> 'posted' then
        raise exception 'PHASE2E25_COMMAND_COMPATIBILITY_FAILED: %', result;
      end if;
    end if;
  end loop;
end
$$;

-- B. A sale outside the operator's branch scope is rejected.
do $$
declare resources phase2e25_resources%rowtype; blocked boolean := false;
begin
  select * into resources from phase2e25_resources;
  begin
    perform public.list_showroom_sale_payment_options(resources.wrong_branch_sale_id);
  exception when insufficient_privilege then
    blocked := sqlerrm = 'SHOWROOM_BRANCH_ACCESS_REQUIRED';
  end;
  if not blocked then raise exception 'PHASE2E25_WRONG_BRANCH_ACCEPTED'; end if;
end
$$;

-- F. Invalid and non-Canonical sales are rejected.
do $$
declare resources phase2e25_resources%rowtype; blocked boolean;
begin
  select * into resources from phase2e25_resources;
  blocked := false;
  begin
    perform public.list_showroom_sale_payment_options(gen_random_uuid());
  exception when no_data_found then blocked := sqlerrm = 'SHOWROOM_SALE_NOT_FOUND'; end;
  if not blocked then raise exception 'PHASE2E25_MISSING_SALE_ACCEPTED'; end if;

  blocked := false;
  begin
    perform public.list_showroom_sale_payment_options(resources.noncanonical_sale_id);
  exception when check_violation then
    blocked := sqlerrm = 'SHOWROOM_SALE_NOT_CANONICAL_GENERATION';
  end;
  if not blocked then raise exception 'PHASE2E25_NONCANONICAL_SALE_ACCEPTED'; end if;
end
$$;

reset role;

-- C. A user from another tenant cannot use a guessed sale id.
select set_config('request.jwt.claim.sub', foreign_auth::text, true)
from phase2e25_context;
set local role authenticated;
do $$
declare resources phase2e25_resources%rowtype; blocked boolean := false;
begin
  select * into resources from phase2e25_resources;
  begin
    perform public.list_showroom_sale_payment_options(resources.sale_id);
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'PHASE2E25_WRONG_TENANT_ACCEPTED'; end if;
end
$$;
reset role;

-- D. Active membership without Showroom permission is insufficient.
delete from public.res_users_groups link
using phase2e25_context context, phase2e25_resources resources
where link.tenant_id = context.tenant_id
  and link.user_id = resources.operator_id
  and link.group_id = resources.permission_group_id;
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from phase2e25_context;
set local role authenticated;
do $$
declare resources phase2e25_resources%rowtype; blocked boolean := false;
begin
  select * into resources from phase2e25_resources;
  begin
    perform public.list_showroom_sale_payment_options(resources.sale_id);
  exception when insufficient_privilege then
    blocked := sqlerrm = 'SHOWROOM_PAYMENT_PERMISSION_REQUIRED';
  end;
  if not blocked then raise exception 'PHASE2E25_MISSING_PERMISSION_ACCEPTED'; end if;
end
$$;
reset role;

-- E. An inactive tenant membership is rejected before options are returned.
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from phase2e25_context;
update public.tenant_users member
set is_active = false
from phase2e25_resources resources
where member.id = resources.operator_id;
select set_config('request.jwt.claim.sub', operator_auth::text, true)
from phase2e25_context;
set local role authenticated;
do $$
declare resources phase2e25_resources%rowtype; blocked boolean := false;
begin
  select * into resources from phase2e25_resources;
  begin
    perform public.list_showroom_sale_payment_options(resources.sale_id);
  exception when insufficient_privilege then
    blocked := sqlerrm = 'ACTIVE_TENANT_MEMBERSHIP_REQUIRED';
  end;
  if not blocked then raise exception 'PHASE2E25_INACTIVE_MEMBERSHIP_ACCEPTED'; end if;
end
$$;
reset role;

-- Public/anonymous callers have no execute grant; authenticated is the sole
-- client role allowed to call the sale-bound contract.
set local role anon;
do $$
declare resources phase2e25_resources%rowtype;
begin
  select * into resources from phase2e25_resources;
  begin
    perform public.list_showroom_sale_payment_options(resources.sale_id);
    raise exception 'PHASE2E25_ANON_EXECUTE_EXPOSED';
  exception when insufficient_privilege then null;
  end;
end
$$;
reset role;

do $$
begin
  raise notice 'PHASE2E25_RUNTIME_OK authorized=true branch=true tenant=true permission=true membership=true compatibility=true safe_dto=true';
end
$$;

rollback;
