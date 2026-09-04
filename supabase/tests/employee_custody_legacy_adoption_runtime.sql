begin;

create temporary table custody_adoption_before as
select
  (select count(*) from public.account_moves where state = 'posted') posted_moves,
  (select count(*) from public.account_move_lines where parent_state = 'posted') posted_lines,
  (select count(*) from public.account_partial_reconcile) partials,
  (select coalesce(sum(debit), 0) from public.account_move_lines where parent_state = 'posted') total_debit,
  (select coalesce(sum(credit), 0) from public.account_move_lines where parent_state = 'posted') total_credit;

create temporary table custody_adoption_context as
with eligible as (
  select owner.tenant_id, owner.id owner_id, owner.auth_user_id owner_auth,
    liquidity.id liquidity_group_id,
    row_number() over (partition by owner.tenant_id order by employee.id) employee_number,
    employee.id employee_id
  from public.tenant_users owner
  join public.account_groups liquidity
    on liquidity.tenant_id = owner.tenant_id
   and liquidity.template_group_key = 'liquidity_resources'
  join public.tenant_users employee
    on employee.tenant_id = owner.tenant_id and employee.is_active
   and employee.id <> owner.id
   and not exists (
     select 1 from public.account_accounts account
     where account.tenant_id = employee.tenant_id
       and account.responsible_user_id = employee.id and account.active
   )
  where owner.role = 'owner' and owner.is_active and owner.auth_user_id is not null
), selected as (
  select tenant_id, min(owner_id::text)::uuid owner_id,
    min(owner_auth::text)::uuid owner_auth,
    min(liquidity_group_id::text)::uuid liquidity_group_id,
    array_agg(employee_id order by employee_number) employees
  from eligible where employee_number <= 5
  group by tenant_id having count(*) >= 5
)
select * from selected order by tenant_id limit 1;

do $$
begin
  if not exists (select 1 from custody_adoption_context) then
    raise exception 'CUSTODY_ADOPTION_FIXTURE_UNAVAILABLE';
  end if;
end
$$;

create temporary table custody_adoption_resources (
  legacy_group_id uuid,
  compatible_account_id uuid,
  compatible_account_code text,
  historical_move_id uuid,
  incompatible_account_id uuid,
  rollback_account_id uuid,
  compatible_destination_id uuid,
  compatible_journal_id uuid,
  new_destination_id uuid,
  new_account_id uuid
);

do $$
declare
  context custody_adoption_context%rowtype;
  resources custody_adoption_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  counterpart_id uuid;
begin
  select * into context from custody_adoption_context;
  resources.legacy_group_id := gen_random_uuid();
  resources.compatible_account_id := gen_random_uuid();
  resources.compatible_account_code := '8' || left(suffix, 5);
  resources.historical_move_id := gen_random_uuid();
  resources.incompatible_account_id := gen_random_uuid();
  resources.rollback_account_id := gen_random_uuid();

  insert into public.account_groups(id, tenant_id, parent_id, code, name)
  values(resources.legacy_group_id, context.tenant_id, context.liquidity_group_id,
    'TCA' || suffix, 'Employee custody adoption fixture');

  select id into counterpart_id from public.account_accounts
  where tenant_id = context.tenant_id and active and is_posting
    and responsible_user_id is null
  order by id limit 1;
  if counterpart_id is null then raise exception 'CUSTODY_COUNTERPART_UNAVAILABLE'; end if;

  insert into public.account_accounts(
    id, tenant_id, group_id, code, name, account_type, reconcile, active,
    responsible_user_id, open_item_reconcile, statement_reconcile,
    is_posting, account_origin
  ) values
    (resources.compatible_account_id, context.tenant_id, resources.legacy_group_id,
      resources.compatible_account_code, 'Compatible legacy custody', 'asset', false, true,
      context.employees[2], false, false, true, 'legacy'),
    (resources.incompatible_account_id, context.tenant_id, resources.legacy_group_id,
      '7' || left(suffix, 5), 'Incompatible legacy custody', 'asset', true, true,
      context.employees[3], false, false, true, 'legacy'),
    (resources.rollback_account_id, context.tenant_id, resources.legacy_group_id,
      '6' || left(suffix, 5), 'Rollback legacy custody', 'asset', false, true,
      context.employees[5], false, false, true, 'legacy');

  insert into public.account_moves(
    id, tenant_id, name, move_type, date, amount_total, state, ref, created_by
  ) values (
    resources.historical_move_id, context.tenant_id, 'Custody adoption history',
    'journal', current_date, 100, 'posted', 'custody_adoption_fixture', context.owner_id
  );
  insert into public.account_move_lines(
    tenant_id, move_id, account_id, label, quantity, unit_price,
    debit, credit, line_type, is_reconciled, amount_residual,
    amount_residual_currency, parent_state, created_by
  ) values
    (context.tenant_id, resources.historical_move_id, resources.compatible_account_id,
      'Employee-held cash', 1, 100, 100, 0, 'other', true, 0, 0, 'posted', context.owner_id),
    (context.tenant_id, resources.historical_move_id, counterpart_id,
      'Fixture counterpart', 1, 100, 0, 100, 'other', false, 0, 0, 'posted', context.owner_id);

  insert into custody_adoption_resources values(resources.*);
end
$$;

grant select on custody_adoption_context to authenticated;
grant select, update on custody_adoption_resources to authenticated;

select set_config('request.jwt.claim.sub', owner_auth::text, true)
from custody_adoption_context;
set local role authenticated;

do $$
declare
  context custody_adoption_context%rowtype;
  resources custody_adoption_resources%rowtype;
  result jsonb;
  replay jsonb;
  failure_message text;
  blocked boolean;
  account_count bigint;
begin
  select * into context from custody_adoption_context;
  select * into resources from custody_adoption_resources;

  -- No legacy account: preserve normal canonical creation.
  result := public.create_and_provision_money_destination(
    context.tenant_id, 'custody_new_fixture', 'New employee custody',
    'employee_cash_custody', null, context.employees[1], null,
    null, null, null, '{}'::jsonb, true
  );
  resources.new_destination_id := (result->>'destination_id')::uuid;
  resources.new_account_id := (result->>'account_id')::uuid;
  if result->>'status' <> 'active' or result->>'account_provisioning' <> 'created'
     or not exists (
       select 1 from public.account_accounts account
       where account.id = resources.new_account_id
         and account.money_destination_id = resources.new_destination_id
         and account.account_origin = 'resource'
     ) then raise exception 'NEW_CUSTODY_CANONICAL_CREATION_FAILED'; end if;

  -- Compatible legacy account: preserve identity, code and historical line.
  select count(*) into account_count from public.account_accounts
  where tenant_id = context.tenant_id;
  result := public.create_and_provision_money_destination(
    context.tenant_id, 'custody_adopt_fixture', 'Adopted employee custody',
    'employee_cash_custody', null, context.employees[2], null,
    null, null, null, '{}'::jsonb, true
  );
  resources.compatible_destination_id := (result->>'destination_id')::uuid;
  resources.compatible_journal_id := (result->>'journal_id')::uuid;
  if (result->>'account_id')::uuid is distinct from resources.compatible_account_id
     or result->>'account_provisioning' <> 'adopted'
     or (select count(*) from public.account_accounts
         where tenant_id = context.tenant_id) <> account_count
     or (select account_id from public.account_move_lines
         where move_id = resources.historical_move_id
           and account_id = resources.compatible_account_id limit 1)
        is distinct from resources.compatible_account_id
     or not exists (
       select 1 from public.money_destinations destination
       join public.account_accounts account
         on account.id = destination.ledger_account_id
        and account.tenant_id = destination.tenant_id
       join public.account_journals journal
         on journal.id = destination.journal_id
        and journal.tenant_id = destination.tenant_id
       where destination.id = resources.compatible_destination_id
         and destination.status = 'active'
         and account.id = resources.compatible_account_id
         and account.code = resources.compatible_account_code
         and account.account_origin = 'resource'
         and account.canonical_account_type = 'liquidity'
         and journal.default_account_id = account.id
         and journal.journal_origin = 'resource'
     ) then raise exception 'COMPATIBLE_LEGACY_CUSTODY_NOT_ADOPTED'; end if;
  if (select count(*) from public.money_destination_account_adoptions
      where tenant_id = context.tenant_id
        and destination_id = resources.compatible_destination_id
        and account_id = resources.compatible_account_id) <> 1 then
    raise exception 'CUSTODY_ADOPTION_PROVENANCE_MISSING';
  end if;

  -- Same key/payload replays; a different key for the same employee conflicts.
  replay := public.create_and_provision_money_destination(
    context.tenant_id, 'custody_adopt_fixture', 'Adopted employee custody',
    'employee_cash_custody', null, context.employees[2], null,
    null, null, null, '{}'::jsonb, true
  );
  if replay->>'destination_id' <> result->>'destination_id'
     or replay->>'account_id' <> result->>'account_id' then
    raise exception 'CUSTODY_ADOPTION_RETRY_NOT_IDEMPOTENT';
  end if;
  blocked := false; failure_message := null;
  begin
    perform public.create_and_provision_money_destination(
      context.tenant_id, 'custody_second_key_fixture', 'Second custody',
      'employee_cash_custody', null, context.employees[2], null,
      null, null, null, '{}'::jsonb, true
    );
  exception when check_violation then
    blocked := true; get stacked diagnostics failure_message = message_text;
  end;
  if not blocked or failure_message <> 'MONEY_DESTINATION_EMPLOYEE_CUSTODY_ALREADY_EXISTS' then
    raise exception 'SECOND_CUSTODY_KEY_NOT_REJECTED: %', failure_message;
  end if;

  blocked := false; failure_message := null;
  begin
    perform public.create_and_provision_money_destination(
      context.tenant_id, 'custody_incompatible_fixture', 'Incompatible custody',
      'employee_cash_custody', null, context.employees[3], null,
      null, null, null, '{}'::jsonb, true
    );
  exception when check_violation then
    blocked := true; get stacked diagnostics failure_message = message_text;
  end;
  if not blocked or failure_message <> 'MONEY_DESTINATION_LEGACY_CUSTODY_INCOMPATIBLE'
     or exists (select 1 from public.money_destinations
       where tenant_id = context.tenant_id and destination_key = 'custody_incompatible_fixture') then
    raise exception 'INCOMPATIBLE_CUSTODY_NOT_ATOMIC: %', failure_message;
  end if;

  update custody_adoption_resources
  set compatible_destination_id = resources.compatible_destination_id,
      compatible_journal_id = resources.compatible_journal_id,
      new_destination_id = resources.new_destination_id,
      new_account_id = resources.new_account_id;
end
$$;

reset role;

-- A later journal failure must roll back the account adoption and destination.
alter table public.account_journals add constraint custody_adoption_forced_late_failure
  check (journal_origin <> 'resource') not valid;
select set_config('request.jwt.claim.sub', owner_auth::text, true)
from custody_adoption_context;
set local role authenticated;
do $$
declare context custody_adoption_context%rowtype;
  resources custody_adoption_resources%rowtype;
  blocked boolean := false;
begin
  select * into context from custody_adoption_context;
  select * into resources from custody_adoption_resources;
  begin
    perform public.create_and_provision_money_destination(
      context.tenant_id, 'custody_rollback_fixture', 'Rollback custody',
      'employee_cash_custody', null, context.employees[5], null,
      null, null, null, '{}'::jsonb, true
    );
  exception when check_violation then blocked := true; end;
  if not blocked
     or (select account_origin from public.account_accounts
         where id = resources.rollback_account_id) <> 'legacy'
     or (select money_destination_id from public.account_accounts
         where id = resources.rollback_account_id) is not null
     or exists (select 1 from public.money_destinations
       where tenant_id = context.tenant_id and destination_key = 'custody_rollback_fixture')
     or exists (select 1 from public.money_destination_account_adoptions
       where tenant_id = context.tenant_id and account_id = resources.rollback_account_id) then
    raise exception 'LATE_FAILURE_DID_NOT_ROLL_BACK_ADOPTION';
  end if;
end
$$;
reset role;
alter table public.account_journals drop constraint custody_adoption_forced_late_failure;

-- Multiple active legacy candidates fail closed. The production unique index is
-- restored automatically by the outer rollback after this isolated proof.
drop index public.uq_account_accounts_active_responsible_user;
do $$
declare context custody_adoption_context%rowtype;
  resources custody_adoption_resources%rowtype;
  destination_id uuid := gen_random_uuid();
  failure_message text;
  blocked boolean := false;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 5);
begin
  select * into context from custody_adoption_context;
  select * into resources from custody_adoption_resources;
  insert into public.account_accounts(
    tenant_id, group_id, code, name, account_type, reconcile, active,
    responsible_user_id, open_item_reconcile, statement_reconcile,
    is_posting, account_origin
  ) values
    (context.tenant_id, resources.legacy_group_id, '51' || suffix,
      'Ambiguous custody A', 'asset', false, true, context.employees[4], false, false, true, 'legacy'),
    (context.tenant_id, resources.legacy_group_id, '52' || suffix,
      'Ambiguous custody B', 'asset', false, true, context.employees[4], false, false, true, 'legacy');
  insert into public.money_destinations(
    id, tenant_id, destination_key, name, destination_type, status,
    responsible_user_id, created_by
  ) values(destination_id, context.tenant_id, 'custody_ambiguous_fixture',
    'Ambiguous custody', 'employee_cash_custody', 'draft', context.employees[4], context.owner_id);
  perform set_config('request.jwt.claim.sub', context.owner_auth::text, true);
  begin
    perform public.provision_money_destination(context.tenant_id, destination_id, true);
  exception when check_violation then
    blocked := true; get stacked diagnostics failure_message = message_text;
  end;
  if not blocked or failure_message <> 'MONEY_DESTINATION_LEGACY_CUSTODY_AMBIGUOUS' then
    raise exception 'AMBIGUOUS_CUSTODY_NOT_REJECTED: %', failure_message;
  end if;
end
$$;

do $$
declare before_snapshot custody_adoption_before%rowtype;
begin
  select * into before_snapshot from custody_adoption_before;
  if exists (
    select 1 from public.account_moves move
    join public.account_move_lines line
      on line.move_id = move.id and line.tenant_id = move.tenant_id
    where move.state = 'posted'
    group by move.id having round(sum(line.debit - line.credit), 2) <> 0
  ) then raise exception 'CUSTODY_ADOPTION_LEFT_UNBALANCED_MOVE'; end if;
  raise notice 'CUSTODY_ADOPTION_BASELINE moves=% lines=% partials=% debit=% credit=%',
    before_snapshot.posted_moves, before_snapshot.posted_lines,
    before_snapshot.partials, before_snapshot.total_debit,
    before_snapshot.total_credit;
end
$$;

rollback;
