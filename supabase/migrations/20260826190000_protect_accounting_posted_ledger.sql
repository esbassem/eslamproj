begin;

create or replace function public.accounting_assert_move_balanced(p_move_id uuid)
returns void
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  move_state text;
  total_debit numeric;
  total_credit numeric;
  line_count bigint;
begin
  if p_move_id is null then return; end if;

  select account_move.state
  into move_state
  from public.account_moves account_move
  where account_move.id = p_move_id;

  -- A deleted draft move no longer needs validation. Posted deletion is rejected
  -- by the immutability guard before its line cascade can occur.
  if not found or move_state <> 'posted' then return; end if;

  select count(*), coalesce(sum(move_line.debit), 0), coalesce(sum(move_line.credit), 0)
  into line_count, total_debit, total_credit
  from public.account_move_lines move_line
  where move_line.move_id = p_move_id;

  if line_count < 2 or total_debit <> total_credit then
    raise exception using
      errcode = '23514',
      message = 'Journal entry is not balanced';
  end if;
end
$$;

create or replace function public.accounting_validate_deferred_move_balance()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_table_name = 'account_move_lines' then
    if tg_op in ('UPDATE', 'DELETE') then
      perform public.accounting_assert_move_balanced(old.move_id);
    end if;
    if tg_op in ('INSERT', 'UPDATE') and (tg_op <> 'UPDATE' or new.move_id is distinct from old.move_id) then
      perform public.accounting_assert_move_balanced(new.move_id);
    end if;
  elsif tg_table_name = 'account_moves' and tg_op in ('INSERT', 'UPDATE') then
    perform public.accounting_assert_move_balanced(new.id);
  end if;
  return null;
end
$$;

create or replace function public.accounting_guard_posted_move()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' and old.state = 'posted' then
    raise exception using errcode = '55000', message = 'Posted journal entries cannot be deleted';
  end if;

  if tg_op = 'UPDATE' and old.state = 'posted' then
    raise exception using errcode = '55000', message = 'Posted journal entries are immutable';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create or replace function public.accounting_guard_posted_move_line()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  old_parent_state text;
  new_parent_state text;
  new_parent_created_in_current_transaction boolean := false;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select state into old_parent_state from public.account_moves where id = old.move_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select state, xmin::text::bigint = pg_current_xact_id()::text::bigint
    into new_parent_state, new_parent_created_in_current_transaction
    from public.account_moves where id = new.move_id;
  end if;

  if tg_op = 'INSERT' and new_parent_state = 'posted' then
    -- Existing RPCs create a posted header then its complete set of lines in one
    -- transaction. xmin proves that the header was physically inserted by this
    -- transaction; unlike a custom GUC, callers cannot spoof this condition.
    if not new_parent_created_in_current_transaction then
      raise exception using errcode = '55000', message = 'Posted journal entry lines cannot be modified';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' and old_parent_state = 'posted' then
    raise exception using errcode = '55000', message = 'Posted journal entry lines cannot be modified';
  end if;

  if tg_op = 'UPDATE' and (old_parent_state = 'posted' or new_parent_state = 'posted') then
    -- Current reconciliation/cancellation/return RPCs maintain these three cached
    -- values on posted lines. They do not change journal-entry substance; the
    -- reconciliation rows remain the financial source of truth.
    if new.move_id = old.move_id
      and (to_jsonb(new) - array['amount_residual','amount_residual_currency','is_reconciled','balance'])
        = (to_jsonb(old) - array['amount_residual','amount_residual_currency','is_reconciled','balance'])
    then
      return new;
    end if;
    raise exception using errcode = '55000', message = 'Posted journal entry lines cannot be modified';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger if exists account_moves_guard_posted on public.account_moves;
create trigger account_moves_guard_posted
before update or delete on public.account_moves
for each row execute function public.accounting_guard_posted_move();

drop trigger if exists account_move_lines_guard_posted on public.account_move_lines;
create trigger account_move_lines_guard_posted
before insert or update or delete on public.account_move_lines
for each row execute function public.accounting_guard_posted_move_line();

drop trigger if exists account_move_lines_balance_deferred on public.account_move_lines;
create constraint trigger account_move_lines_balance_deferred
after insert or update or delete on public.account_move_lines
deferrable initially deferred
for each row execute function public.accounting_validate_deferred_move_balance();

drop trigger if exists account_moves_balance_deferred on public.account_moves;
create constraint trigger account_moves_balance_deferred
after insert or update on public.account_moves
deferrable initially deferred
for each row execute function public.accounting_validate_deferred_move_balance();

-- The previous implementation only accepted posted payment/journal moves and then
-- permanently deleted them. There is therefore no non-posted behavior to preserve.
create or replace function public.delete_account_move_atomic(
  p_tenant_id uuid,
  p_move_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authentication is required';
  end if;
  if p_tenant_id is null or p_move_id is null then
    raise exception using errcode = '22023', message = 'Tenant and journal entry are required';
  end if;
  if not public.is_current_tenant_owner(p_tenant_id) then
    raise exception using errcode = '42501', message = 'Only the tenant owner can request this operation';
  end if;
  if not exists (
    select 1 from public.account_moves
    where id = p_move_id and tenant_id = p_tenant_id
  ) then
    raise exception using errcode = 'P0002', message = 'Journal entry was not found';
  end if;

  raise exception using
    errcode = '55000',
    message = 'Posted journal entries cannot be deleted; create a reversal entry instead';
end
$$;

revoke all on function public.accounting_validate_deferred_move_balance() from public, anon, authenticated;
revoke all on function public.accounting_guard_posted_move() from public, anon, authenticated;
revoke all on function public.accounting_guard_posted_move_line() from public, anon, authenticated;
revoke all on function public.accounting_assert_move_balanced(uuid) from public, anon;
grant execute on function public.accounting_assert_move_balanced(uuid) to authenticated;

revoke all on function public.delete_account_move_atomic(uuid, uuid) from public, anon;
grant execute on function public.delete_account_move_atomic(uuid, uuid) to authenticated;

comment on function public.accounting_assert_move_balanced(uuid) is
  'Deferred DB-level balance assertion for posted accounting moves.';
comment on function public.accounting_guard_posted_move() is
  'Rejects UPDATE and DELETE of posted accounting move headers.';
comment on function public.accounting_guard_posted_move_line() is
  'Rejects posted-line mutation except reconciliation residual cache maintenance and initial same-transaction construction.';

commit;
