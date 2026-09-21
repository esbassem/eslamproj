begin;

create temporary table phase3b_context as
select owner_user.tenant_id, owner_user.id owner_user_id,
  owner_user.auth_user_id owner_auth_user_id,
  member_user.id member_user_id, member_user.auth_user_id member_auth_user_id
from public.tenant_users owner_user
join lateral (
  select candidate.* from public.tenant_users candidate
  where candidate.tenant_id = owner_user.tenant_id and candidate.is_active
    and candidate.role <> 'owner' and candidate.auth_user_id is not null
    and not public.has_permission('financial.destination.manage', candidate.tenant_id)
  order by candidate.id limit 1
) member_user on true
where owner_user.role = 'owner' and owner_user.is_active
  and owner_user.auth_user_id is not null
order by owner_user.tenant_id limit 1;

do $$ begin
  if not exists (select 1 from phase3b_context) then
    raise exception 'PHASE3B_AUTH_FIXTURE_UNAVAILABLE';
  end if;
end $$;

create temporary table phase3b_resources (
  branch_id uuid, pos_id uuid, cashbox_id uuid, cashbox_account uuid,
  cashbox_journal uuid, unauthorized_destination uuid,
  moves_before bigint, accounts_before bigint, journals_before bigint
);

do $$
declare c phase3b_context%rowtype; r phase3b_resources%rowtype;
begin
  select * into c from phase3b_context;
  r.branch_id := gen_random_uuid(); r.pos_id := gen_random_uuid();
  select count(*) into r.moves_before from public.account_moves;
  select count(*) into r.accounts_before from public.account_accounts;
  select count(*) into r.journals_before from public.account_journals;
  insert into public.branches(id, tenant_id, name, code, is_active)
  values(r.branch_id, c.tenant_id, 'Phase 3B Branch', 'P3B' || left(replace(r.branch_id::text,'-',''),6), true);
  insert into public.pos_configs(id, tenant_id, branch_id, name, code, is_active)
  values(r.pos_id, c.tenant_id, r.branch_id, 'Phase 3B POS', 'P3BPOS', true);
  insert into public.money_destinations(
    tenant_id, destination_key, name, destination_type, status, branch_id
  ) values(c.tenant_id, 'phase3b_unauthorized', 'Unauthorized fixture',
    'cashbox', 'draft', r.branch_id) returning id into r.unauthorized_destination;
  insert into phase3b_resources values(r.*);
end $$;

grant select, update on phase3b_resources to authenticated;
grant select on phase3b_context to authenticated;

select set_config('request.jwt.claim.sub', member_auth_user_id::text, true)
from phase3b_context;
set local role authenticated;
do $$
declare c phase3b_context%rowtype; r phase3b_resources%rowtype; blocked boolean := false;
begin
  select * into c from phase3b_context; select * into r from phase3b_resources;
  begin perform public.provision_money_destination(c.tenant_id, r.unauthorized_destination, true);
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'UNAUTHORIZED_PROVISIONING_ACCEPTED'; end if;
end $$;

reset role;
select set_config('request.jwt.claim.sub', owner_auth_user_id::text, true)
from phase3b_context;
set local role authenticated;

do $$
declare
  c phase3b_context%rowtype; r phase3b_resources%rowtype;
  result jsonb; repeated jsonb; kind text; destination_id uuid;
  destination_account uuid; destination_journal uuid; employee_id uuid;
  account_count integer; journal_count integer;
begin
  select * into c from phase3b_context; select * into r from phase3b_resources;
  begin
    insert into public.account_accounts(
      tenant_id, code, name, account_type, reconcile, active,
      canonical_account_type, statement_section, reporting_category,
      normal_balance, open_item_reconcile, statement_reconcile, is_posting,
      semantic_key, account_origin, money_destination_id
    ) values (
      c.tenant_id, '999998', 'Direct resource bypass', 'asset', false, true,
      'liquidity', 'balance_sheet', 'cash_and_cash_equivalents', 'debit',
      false, false, true, 'phase3b_direct_bypass', 'resource',
      r.unauthorized_destination
    );
    raise exception 'DIRECT_RESOURCE_ACCOUNT_CREATION_ACCEPTED';
  exception when insufficient_privilege then null;
  end;
  select id into employee_id from public.tenant_users u
  where u.tenant_id = c.tenant_id and u.is_active
    and not exists (select 1 from public.account_accounts a
      where a.tenant_id = u.tenant_id and a.responsible_user_id = u.id and a.active)
  order by u.id limit 1;
  if employee_id is null then raise exception 'PHASE3B_CUSTODY_USER_UNAVAILABLE'; end if;

  foreach kind in array array['cashbox','bank','employee_cash_custody','pos_drawer','wallet'] loop
    result := public.create_and_provision_money_destination(
      c.tenant_id, 'phase3b_' || kind, 'Phase 3B ' || kind, kind, r.branch_id,
      case when kind in ('cashbox','pos_drawer','employee_cash_custody') then employee_id end,
      case when kind = 'pos_drawer' then r.pos_id end,
      case when kind = 'bank' then 'Phase 3B Bank' end,
      case when kind = 'bank' then 'Masked Account' end,
      null, '{}'::jsonb, true
    );
    destination_id := (result->>'destination_id')::uuid;
    destination_account := (result->>'account_id')::uuid;
    destination_journal := (result->>'journal_id')::uuid;
    if result->>'status' <> 'active' then raise exception 'DESTINATION_NOT_ACTIVATED: %', kind; end if;
    if not exists (
      select 1 from public.account_accounts a
      join public.money_destinations d on d.id = a.money_destination_id and d.tenant_id = a.tenant_id
      join public.money_destination_types definition on definition.code = d.destination_type
      where a.id = destination_account and d.id = destination_id
        and a.account_origin = 'resource' and a.is_posting and a.active
        and a.code ~ '^[0-9]{6}$'
        and a.code::integer between definition.account_code_min and definition.account_code_max
        and a.canonical_account_type = definition.required_account_type
        and a.reporting_category = definition.required_reporting_category
        and a.open_item_reconcile = definition.required_open_item_reconcile
        and a.statement_reconcile = definition.required_statement_reconcile
        and (kind <> 'employee_cash_custody' or a.responsible_user_id = employee_id)
    ) then raise exception 'RESOURCE_ACCOUNT_INVALID: %', kind; end if;
    if not exists (
      select 1 from public.account_journals j
      join public.money_destination_types definition on definition.code = kind
      where j.id = destination_journal and j.money_destination_id = destination_id
        and j.journal_origin = 'resource' and j.default_account_id = destination_account
        and j.type = definition.required_journal_type
    ) then raise exception 'RESOURCE_JOURNAL_INVALID: %', kind; end if;
    repeated := public.provision_money_destination(c.tenant_id, destination_id, true);
    if repeated->>'account_id' <> result->>'account_id'
       or repeated->>'journal_id' <> result->>'journal_id' then
      raise exception 'PROVISIONING_NOT_IDEMPOTENT: %', kind;
    end if;
    if kind = 'cashbox' then
      r.cashbox_id := destination_id; r.cashbox_account := destination_account;
      r.cashbox_journal := destination_journal;
    end if;
  end loop;

  begin
    perform public.create_and_provision_money_destination(
      c.tenant_id, 'phase3b_invalid_custody', 'Invalid custody',
      'employee_cash_custody', r.branch_id, null, null,
      null, null, null, '{}'::jsonb, true
    );
    raise exception 'INVALID_CUSTODY_PROVISIONED';
  exception when check_violation then null;
  end;
  if exists (select 1 from public.money_destinations
    where tenant_id=c.tenant_id and destination_key='phase3b_invalid_custody') then
    raise exception 'FAILED_PROVISIONING_LEFT_PARTIAL_DESTINATION';
  end if;

  select count(*) into account_count from public.account_accounts a
  where a.tenant_id = c.tenant_id and a.money_destination_id in (
    select d.id from public.money_destinations d
    where d.tenant_id = c.tenant_id and d.destination_key like 'phase3b_%'
      and d.destination_key <> 'phase3b_unauthorized'
  );
  select count(*) into journal_count from public.account_journals j
  where j.tenant_id = c.tenant_id and j.money_destination_id in (
    select d.id from public.money_destinations d
    where d.tenant_id = c.tenant_id and d.destination_key like 'phase3b_%'
      and d.destination_key <> 'phase3b_unauthorized'
  );
  if account_count <> 5 or journal_count <> 5 then
    raise exception 'DEDICATED_RESOURCE_CARDINALITY_INVALID: accounts %, journals %', account_count, journal_count;
  end if;

  perform public.rename_money_destination(c.tenant_id, r.cashbox_id, 'Renamed Phase 3B Cashbox');
  if (select ledger_account_id from public.money_destinations where id = r.cashbox_id) <> r.cashbox_account
     or (select journal_id from public.money_destinations where id = r.cashbox_id) <> r.cashbox_journal then
    raise exception 'RENAME_RECREATED_ACCOUNTING_IDENTITY';
  end if;
  update phase3b_resources set cashbox_id=r.cashbox_id, cashbox_account=r.cashbox_account,
    cashbox_journal=r.cashbox_journal;
end $$;

reset role;

do $$
declare c phase3b_context%rowtype; r phase3b_resources%rowtype; failed boolean := false;
  new_tenant uuid := gen_random_uuid(); suffix text := left(replace(gen_random_uuid()::text,'-',''),12);
begin
  select * into c from phase3b_context; select * into r from phase3b_resources;
  begin
    update public.money_destinations set destination_type='wallet' where id=r.cashbox_id;
  exception when check_violation then failed := true; end;
  if not failed then raise exception 'ACTIVATED_TYPE_MUTATION_ACCEPTED'; end if;
  update public.money_destinations set status='inactive' where id=r.cashbox_id;
  if public.has_financial_resource_access(c.tenant_id, r.cashbox_account, 'view', r.branch_id) then
    raise exception 'INACTIVE_DESTINATION_REMAINED_AVAILABLE_THROUGH_ACCOUNT_SCOPE';
  end if;
  update public.money_destinations set status='archived' where id=r.cashbox_id;
  if not exists(select 1 from public.account_accounts where id=r.cashbox_account)
     or not exists(select 1 from public.account_journals where id=r.cashbox_journal) then
    raise exception 'ARCHIVE_REMOVED_LEDGER_REPRESENTATION';
  end if;
  if (select count(*) from public.account_moves) <> r.moves_before then
    raise exception 'DESTINATION_PROVISIONING_CREATED_ACCOUNTING_MOVE';
  end if;

  insert into public.tenants(id,name,slug)
  values(new_tenant,'Phase 3B New Tenant','phase3b-new-'||suffix);
  if exists(select 1 from public.money_destinations where tenant_id=new_tenant)
     or exists(select 1 from public.account_accounts where tenant_id=new_tenant and account_origin='resource')
     or exists(select 1 from public.account_journals where tenant_id=new_tenant and journal_origin='resource') then
    raise exception 'NEW_TENANT_AUTO_PROVISIONED_FINANCIAL_RESOURCE';
  end if;
end $$;

rollback;
