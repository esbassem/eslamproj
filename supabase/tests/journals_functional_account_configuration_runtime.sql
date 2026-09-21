begin;

create temporary table phase2_snapshot as
select
  (select count(*) from public.account_moves) move_count,
  (select count(*) from public.account_moves where state = 'posted' and journal_id is null) legacy_posted_without_journal,
  (select coalesce(sum(line.debit), 0) from public.account_move_lines line join public.account_moves move on move.id = line.move_id where move.state = 'posted') posted_debit,
  (select coalesce(sum(line.credit), 0) from public.account_move_lines line join public.account_moves move on move.id = line.move_id where move.state = 'posted') posted_credit,
  (select count(*) from public.account_partial_reconcile) reconciliation_count;

create temporary table phase2_context as
select owner_user.tenant_id,
       owner_user.auth_user_id owner_auth_user_id,
       member_user.auth_user_id member_auth_user_id,
       other_journal.id other_tenant_journal_id,
       other_journal.tenant_id other_tenant_id
from public.tenant_users owner_user
join lateral (
  select candidate.auth_user_id
  from public.tenant_users candidate
  where candidate.tenant_id = owner_user.tenant_id
    and candidate.role <> 'owner'
    and candidate.is_active
    and candidate.auth_user_id is not null
    and not exists (
      select 1
      from public.res_users_groups membership
      join public.auth_group_permissions group_permission
        on group_permission.group_id = membership.group_id
      join public.auth_permissions permission
        on permission.id = group_permission.permission_id
      where membership.user_id = candidate.id
        and membership.tenant_id = candidate.tenant_id
        and permission.code = 'financial.journal.manage'
        and permission.active
    )
  order by candidate.id limit 1
) member_user on true
join lateral (
  select journal.id, journal.tenant_id
  from public.account_journals journal
  where journal.tenant_id <> owner_user.tenant_id
    and journal.is_active
  order by journal.id limit 1
) other_journal on true
where owner_user.role = 'owner'
  and owner_user.is_active
  and owner_user.auth_user_id is not null
limit 1;

do $$
begin
  if not exists (select 1 from phase2_context) then
    raise exception 'PHASE2_TEST_FIXTURE_UNAVAILABLE';
  end if;
end
$$;

do $$
declare
  context phase2_context%rowtype;
  kind text;
  resolved uuid;
  move_id uuid;
  failed boolean;
begin
  select * into context from phase2_context;

  foreach kind in array array['sale','purchase','cash','bank','general'] loop
    resolved := public.resolve_financial_journal(context.tenant_id, kind, null, null);
    if not exists (
      select 1 from public.account_journals journal
      where journal.id = resolved and journal.tenant_id = context.tenant_id
        and journal.type = kind and journal.is_active
    ) then raise exception 'JOURNAL_RESOLUTION_FAILED: %', kind; end if;
  end loop;

  failed := false;
  begin
    perform public.resolve_financial_journal(context.tenant_id, 'invalid', null, null);
  exception when invalid_parameter_value then failed := true;
  end;
  if not failed then raise exception 'INVALID_JOURNAL_TYPE_ACCEPTED'; end if;

  insert into public.account_moves(tenant_id, name, move_type, amount_total, state)
  values(context.tenant_id, 'PHASE2-SALE', 'sale', 0, 'posted') returning id into move_id;
  if (select journal.type from public.account_moves move join public.account_journals journal on journal.id = move.journal_id where move.id = move_id) <> 'sale'
  then raise exception 'SALE_JOURNAL_AUTO_SELECTION_FAILED'; end if;

  insert into public.account_moves(tenant_id, name, move_type, amount_total, state)
  values(context.tenant_id, 'PHASE2-PURCHASE', 'purchase', 0, 'posted') returning id into move_id;
  if (select journal.type from public.account_moves move join public.account_journals journal on journal.id = move.journal_id where move.id = move_id) <> 'purchase'
  then raise exception 'PURCHASE_JOURNAL_AUTO_SELECTION_FAILED'; end if;

  insert into public.account_moves(tenant_id, name, move_type, amount_total, state)
  values(context.tenant_id, 'PHASE2-GENERAL', 'journal', 0, 'posted') returning id into move_id;
  if (select journal.type from public.account_moves move join public.account_journals journal on journal.id = move.journal_id where move.id = move_id) <> 'general'
  then raise exception 'GENERAL_JOURNAL_AUTO_SELECTION_FAILED'; end if;

  failed := false;
  begin
    insert into public.account_moves(tenant_id, name, move_type, amount_total, state, journal_id)
    values(context.tenant_id, 'PHASE2-CROSS-TENANT', 'sale', 0, 'posted', context.other_tenant_journal_id);
  exception when check_violation or foreign_key_violation then failed := true;
  end;
  if not failed then raise exception 'CROSS_TENANT_JOURNAL_ACCEPTED'; end if;

  resolved := public.resolve_financial_journal(context.tenant_id, 'general', null, null);
  update public.account_journals set is_active = false where id = resolved;
  failed := false;
  begin
    insert into public.account_moves(tenant_id, name, move_type, amount_total, state, journal_id)
    values(context.tenant_id, 'PHASE2-INACTIVE', 'journal', 0, 'posted', resolved);
  exception when check_violation then failed := true;
  end;
  if not failed then raise exception 'INACTIVE_JOURNAL_ACCEPTED'; end if;
  update public.account_journals set is_active = true where id = resolved;
end
$$;

grant select on phase2_context to authenticated;

select set_config('request.jwt.claim.sub', member_auth_user_id::text, true) from phase2_context;
set local role authenticated;

do $$
declare
  context phase2_context%rowtype;
  failed boolean := false;
begin
  select * into context from phase2_context;
  begin
    insert into public.account_journals(tenant_id, name, code, type)
    values(context.tenant_id, 'Unauthorized', 'NOAUTH', 'general');
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'DIRECT_JOURNAL_WRITE_ALLOWED'; end if;

  failed := false;
  begin
    perform public.save_account_journal(
      context.tenant_id, null, 'Unauthorized', 'NOAUTH', 'general', null, null, true
    );
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'UNAUTHORIZED_JOURNAL_MANAGEMENT_ALLOWED'; end if;

  failed := false;
  begin
    perform public.resolve_financial_journal(context.other_tenant_id, 'sale', null, null);
  exception when insufficient_privilege then failed := true;
  end;
  if not failed then raise exception 'CROSS_TENANT_RESOLVER_ACCESS_ALLOWED'; end if;
end
$$;

reset role;
select set_config('request.jwt.claim.sub', owner_auth_user_id::text, true) from phase2_context;
set local role authenticated;

do $$
declare
  context phase2_context%rowtype;
  saved uuid;
begin
  select * into context from phase2_context;
  saved := public.save_account_journal(
    context.tenant_id, null, 'Phase 2 owner test',
    'T' || left(replace(gen_random_uuid()::text, '-', ''), 10),
    'general', null, null, true
  );
  if saved is null then raise exception 'OWNER_JOURNAL_MANAGEMENT_FAILED'; end if;
end
$$;

reset role;

do $$
declare
  before_snapshot phase2_snapshot%rowtype;
begin
  select * into before_snapshot from phase2_snapshot;
  if (select count(*) from public.account_partial_reconcile) <> before_snapshot.reconciliation_count
  then raise exception 'RECONCILIATION_COUNT_CHANGED'; end if;
  if (select coalesce(sum(line.debit), 0) from public.account_move_lines line join public.account_moves move on move.id = line.move_id where move.state = 'posted') <> before_snapshot.posted_debit
  then raise exception 'POSTED_DEBIT_CHANGED'; end if;
  if (select coalesce(sum(line.credit), 0) from public.account_move_lines line join public.account_moves move on move.id = line.move_id where move.state = 'posted') <> before_snapshot.posted_credit
  then raise exception 'POSTED_CREDIT_CHANGED'; end if;
  if (select count(*) from public.account_moves where state = 'posted' and journal_id is null) <> before_snapshot.legacy_posted_without_journal
  then raise exception 'LEGACY_POSTED_HISTORY_CHANGED'; end if;
end
$$;

rollback;
