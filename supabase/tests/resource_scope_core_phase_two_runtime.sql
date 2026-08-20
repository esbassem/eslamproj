begin;

create temporary table scope_test_context as
select
  owner_user.id owner_user_id,
  owner_user.auth_user_id owner_auth_user_id,
  member_user.id member_user_id,
  member_user.auth_user_id member_auth_user_id,
  owner_user.tenant_id,
  other_tenant.id other_tenant_id
from public.tenant_users owner_user
join lateral (
  select candidate.* from public.tenant_users candidate
  where candidate.tenant_id = owner_user.tenant_id
    and candidate.role <> 'owner'
    and candidate.is_active
    and candidate.auth_user_id is not null
  limit 1
) member_user on true
join lateral (
  select tenant.id from public.tenants tenant
  where tenant.id <> owner_user.tenant_id
  limit 1
) other_tenant on true
where owner_user.role = 'owner'
  and owner_user.is_active
  and owner_user.auth_user_id is not null
limit 1;

do $$
begin
  if not exists (select 1 from scope_test_context) then
    raise exception 'scope tests require owner/member in one tenant and a second tenant';
  end if;
end
$$;

create temporary table scope_test_resources (
  branch_a uuid,
  branch_b uuid,
  other_branch uuid,
  pos_a uuid,
  pos_b uuid,
  other_pos uuid,
  stock_a uuid,
  stock_b uuid,
  other_stock uuid,
  account_a uuid,
  account_b uuid,
  other_account uuid
);

do $$
declare
  context scope_test_context%rowtype;
  resources scope_test_resources%rowtype;
  suffix text := replace(gen_random_uuid()::text, '-', '');
begin
  select * into context from scope_test_context;

  insert into public.branches (tenant_id, name, code)
  values (context.tenant_id, 'Scope Branch A ' || suffix, 'SBA' || left(suffix, 8))
  returning id into resources.branch_a;
  insert into public.branches (tenant_id, name, code)
  values (context.tenant_id, 'Scope Branch B ' || suffix, 'SBB' || left(suffix, 8))
  returning id into resources.branch_b;
  insert into public.branches (tenant_id, name, code)
  values (context.other_tenant_id, 'Scope Other Branch ' || suffix, 'SBO' || left(suffix, 8))
  returning id into resources.other_branch;

  insert into public.pos_configs (tenant_id, branch_id, name, code)
  values (context.tenant_id, resources.branch_a, 'Scope POS A ' || suffix, 'SPA' || left(suffix, 8))
  returning id into resources.pos_a;
  insert into public.pos_configs (tenant_id, branch_id, name, code)
  values (context.tenant_id, resources.branch_b, 'Scope POS B ' || suffix, 'SPB' || left(suffix, 8))
  returning id into resources.pos_b;
  insert into public.pos_configs (tenant_id, branch_id, name, code)
  values (context.other_tenant_id, resources.other_branch, 'Scope Other POS ' || suffix, 'SPO' || left(suffix, 8))
  returning id into resources.other_pos;

  insert into public.stock_locations (tenant_id, branch_id, name, code)
  values (context.tenant_id, resources.branch_a, 'Scope Stock A ' || suffix, 'SSA' || left(suffix, 8))
  returning id into resources.stock_a;
  insert into public.stock_locations (tenant_id, branch_id, name, code)
  values (context.tenant_id, resources.branch_b, 'Scope Stock B ' || suffix, 'SSB' || left(suffix, 8))
  returning id into resources.stock_b;
  insert into public.stock_locations (tenant_id, branch_id, name, code)
  values (context.other_tenant_id, resources.other_branch, 'Scope Other Stock ' || suffix, 'SSO' || left(suffix, 8))
  returning id into resources.other_stock;

  insert into public.account_accounts (tenant_id, name, code, account_type, responsible_user_id)
  values (context.tenant_id, 'Scope Responsible Account ' || suffix, 'SAA' || left(suffix, 8), 'asset', context.member_user_id)
  returning id into resources.account_a;
  insert into public.account_accounts (tenant_id, name, code, account_type)
  values (context.tenant_id, 'Scope Account B ' || suffix, 'SAB' || left(suffix, 8), 'asset')
  returning id into resources.account_b;
  insert into public.account_accounts (tenant_id, name, code, account_type)
  values (context.other_tenant_id, 'Scope Other Account ' || suffix, 'SAO' || left(suffix, 8), 'asset')
  returning id into resources.other_account;

  insert into scope_test_resources values (resources.*);
end
$$;

grant select on scope_test_context, scope_test_resources to authenticated;

-- Owner manages valid assignments through the same grants/RLS used by PostgREST.
select set_config('request.jwt.claim.sub', owner_auth_user_id::text, true) from scope_test_context;
set local role authenticated;

insert into public.user_branch_access (tenant_id, user_id, branch_id)
select context.tenant_id, context.member_user_id, resources.branch_a
from scope_test_context context cross join scope_test_resources resources;

do $$
declare
  context scope_test_context%rowtype;
  resources scope_test_resources%rowtype;
  blocked boolean;
begin
  select * into context from scope_test_context;
  select * into resources from scope_test_resources;

  blocked := false;
  begin
    insert into public.user_branch_access (tenant_id, user_id, branch_id)
    values (context.tenant_id, context.member_user_id, resources.other_branch);
  exception when foreign_key_violation then blocked := true;
  end;
  if not blocked then raise exception 'cross-tenant branch assignment succeeded'; end if;

  blocked := false;
  begin
    insert into public.user_pos_access (tenant_id, user_id, pos_id, branch_id)
    values (context.tenant_id, context.member_user_id, resources.pos_b, resources.branch_b);
  exception when foreign_key_violation then blocked := true;
  end;
  if not blocked then raise exception 'POS assignment without parent branch succeeded'; end if;

  blocked := false;
  begin
    insert into public.user_pos_access (tenant_id, user_id, pos_id, branch_id)
    values (context.tenant_id, context.member_user_id, resources.other_pos, resources.other_branch);
  exception when foreign_key_violation then blocked := true;
  end;
  if not blocked then raise exception 'cross-tenant POS assignment succeeded'; end if;

  blocked := false;
  begin
    insert into public.user_stock_location_access (tenant_id, user_id, stock_location_id, branch_id)
    values (context.tenant_id, context.member_user_id, resources.stock_b, resources.branch_b);
  exception when foreign_key_violation then blocked := true;
  end;
  if not blocked then raise exception 'stock assignment without parent branch succeeded'; end if;

  blocked := false;
  begin
    insert into public.user_stock_location_access (tenant_id, user_id, stock_location_id, branch_id)
    values (context.tenant_id, context.member_user_id, resources.other_stock, resources.other_branch);
  exception when foreign_key_violation then blocked := true;
  end;
  if not blocked then raise exception 'cross-tenant stock assignment succeeded'; end if;

  blocked := false;
  begin
    insert into public.user_account_access (tenant_id, user_id, account_id)
    values (context.tenant_id, context.member_user_id, resources.other_account);
  exception when foreign_key_violation then blocked := true;
  end;
  if not blocked then raise exception 'cross-tenant account assignment succeeded'; end if;
end
$$;

insert into public.user_pos_access (tenant_id, user_id, pos_id, branch_id)
select context.tenant_id, context.member_user_id, resources.pos_a, resources.branch_a
from scope_test_context context cross join scope_test_resources resources;
insert into public.user_stock_location_access (tenant_id, user_id, stock_location_id, branch_id)
select context.tenant_id, context.member_user_id, resources.stock_a, resources.branch_a
from scope_test_context context cross join scope_test_resources resources;

-- responsible_user_id is metadata and must not grant account scope.
reset role;
select set_config('request.jwt.claim.sub', member_auth_user_id::text, true) from scope_test_context;
set local role authenticated;
do $$
declare resources scope_test_resources%rowtype;
begin
  select * into resources from scope_test_resources;
  if public.has_account_access(resources.account_a) then
    raise exception 'responsible_user_id incorrectly granted account access';
  end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', owner_auth_user_id::text, true) from scope_test_context;
set local role authenticated;
insert into public.user_account_access (tenant_id, user_id, account_id)
select context.tenant_id, context.member_user_id, resources.account_a
from scope_test_context context cross join scope_test_resources resources;

insert into public.user_operational_defaults (
  tenant_id, user_id, default_branch_id, default_pos_id, default_stock_location_id
)
select context.tenant_id, context.member_user_id,
  resources.branch_a, resources.pos_a, resources.stock_a
from scope_test_context context cross join scope_test_resources resources;

do $$
declare
  context scope_test_context%rowtype;
  resources scope_test_resources%rowtype;
  blocked boolean;
begin
  select * into context from scope_test_context;
  select * into resources from scope_test_resources;

  blocked := false;
  begin
    update public.user_operational_defaults
    set default_branch_id = resources.branch_b,
        default_pos_id = null,
        default_stock_location_id = null
    where tenant_id = context.tenant_id and user_id = context.member_user_id;
  exception when check_violation then blocked := true;
  end;
  if not blocked then raise exception 'unauthorized default branch succeeded'; end if;

  blocked := false;
  begin
    update public.user_operational_defaults
    set default_pos_id = resources.pos_b
    where tenant_id = context.tenant_id and user_id = context.member_user_id;
  exception when foreign_key_violation or check_violation then blocked := true;
  end;
  if not blocked then raise exception 'unauthorized/inconsistent default POS succeeded'; end if;

  blocked := false;
  begin
    update public.user_operational_defaults
    set default_stock_location_id = resources.stock_b
    where tenant_id = context.tenant_id and user_id = context.member_user_id;
  exception when foreign_key_violation or check_violation then blocked := true;
  end;
  if not blocked then raise exception 'unauthorized/inconsistent default stock succeeded'; end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', member_auth_user_id::text, true) from scope_test_context;
set local role authenticated;

do $$
declare
  context scope_test_context%rowtype;
  resources scope_test_resources%rowtype;
  scope jsonb;
  blocked boolean;
  affected_rows integer;
begin
  select * into context from scope_test_context;
  select * into resources from scope_test_resources;

  if not public.has_branch_access(resources.branch_a) then raise exception 'assigned branch denied'; end if;
  if public.has_branch_access(resources.branch_b) then raise exception 'unassigned branch allowed'; end if;
  if not public.has_pos_access(resources.pos_a) then raise exception 'assigned POS denied'; end if;
  if public.has_pos_access(resources.pos_b) then raise exception 'unassigned POS allowed'; end if;
  if not public.has_stock_location_access(resources.stock_a) then raise exception 'assigned stock denied'; end if;
  if public.has_stock_location_access(resources.stock_b) then raise exception 'unassigned stock allowed'; end if;
  if not public.has_account_access(resources.account_a) then raise exception 'assigned account denied'; end if;
  if public.has_account_access(resources.account_b) then raise exception 'unassigned account allowed'; end if;
  if public.has_branch_access(resources.other_branch)
     or public.has_pos_access(resources.other_pos)
     or public.has_stock_location_access(resources.other_stock)
     or public.has_account_access(resources.other_account) then
    raise exception 'cross-tenant scope API access';
  end if;

  scope := public.get_my_resource_scope();
  if not (scope->'allowed_branch_ids' ? resources.branch_a::text)
     or not (scope->'allowed_pos_ids' ? resources.pos_a::text)
     or not (scope->'allowed_stock_location_ids' ? resources.stock_a::text)
     or not (scope->'allowed_account_ids' ? resources.account_a::text) then
    raise exception 'scope aggregate is missing allowed resources';
  end if;
  if scope->>'default_branch_id' <> resources.branch_a::text
     or scope->>'default_pos_id' <> resources.pos_a::text
     or scope->>'default_stock_location_id' <> resources.stock_a::text then
    raise exception 'scope aggregate defaults are incorrect';
  end if;

  blocked := false;
  begin
    insert into public.user_branch_access (tenant_id, user_id, branch_id)
    values (context.tenant_id, context.member_user_id, resources.branch_b);
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'member granted own branch'; end if;

  blocked := false;
  begin
    insert into public.user_pos_access (tenant_id, user_id, pos_id, branch_id)
    values (context.tenant_id, context.member_user_id, resources.pos_b, resources.branch_b);
  exception when insufficient_privilege or foreign_key_violation then blocked := true;
  end;
  if not blocked then raise exception 'member granted own POS'; end if;

  blocked := false;
  begin
    insert into public.user_stock_location_access (tenant_id, user_id, stock_location_id, branch_id)
    values (context.tenant_id, context.member_user_id, resources.stock_b, resources.branch_b);
  exception when insufficient_privilege or foreign_key_violation then blocked := true;
  end;
  if not blocked then raise exception 'member granted own stock location'; end if;

  blocked := false;
  begin
    insert into public.user_account_access (tenant_id, user_id, account_id)
    values (context.tenant_id, context.member_user_id, resources.account_b);
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'member granted own account'; end if;

  blocked := false;
  begin
    update public.user_operational_defaults set default_branch_id = resources.branch_b
    where tenant_id = context.tenant_id and user_id = context.member_user_id;
    get diagnostics affected_rows = row_count;
    blocked := affected_rows = 0;
  exception when insufficient_privilege then
    blocked := true;
  end;
  if not blocked then raise exception 'member changed own defaults'; end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', owner_auth_user_id::text, true) from scope_test_context;
set local role authenticated;
do $$
declare
  resources scope_test_resources%rowtype;
begin
  select * into resources from scope_test_resources;
  if not public.has_branch_access(resources.branch_a)
     or not public.has_branch_access(resources.branch_b)
     or not public.has_pos_access(resources.pos_b)
     or not public.has_stock_location_access(resources.stock_b)
     or not public.has_account_access(resources.account_b) then
    raise exception 'owner did not receive all own-tenant resources';
  end if;
  if public.has_branch_access(resources.other_branch)
     or public.has_pos_access(resources.other_pos)
     or public.has_stock_location_access(resources.other_stock)
     or public.has_account_access(resources.other_account) then
    raise exception 'owner scope crossed tenant boundary';
  end if;
end
$$;

reset role;
set local role anon;
do $$
declare blocked boolean := false;
begin
  begin perform 1 from public.user_branch_access limit 1;
  exception when insufficient_privilege then blocked := true;
  end;
  if not blocked then raise exception 'anon read scope core'; end if;
end
$$;

rollback;
