begin;

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
    select state into old_parent_state
    from public.account_moves
    where id = old.move_id;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select
      state,
      pg_xact_status(xmin::text::xid8) = 'in progress'
    into new_parent_state, new_parent_created_in_current_transaction
    from public.account_moves
    where id = new.move_id;
  end if;

  if tg_op = 'INSERT' and new_parent_state = 'posted' then
    -- An uncommitted parent row visible to this statement can only belong to this
    -- transaction, including a PL/pgSQL subtransaction. Rows inserted by another
    -- uncommitted transaction are not visible under PostgreSQL MVCC.
    if not new_parent_created_in_current_transaction then
      raise exception using errcode = '55000', message = 'Posted journal entry lines cannot be modified';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' and old_parent_state = 'posted' then
    raise exception using errcode = '55000', message = 'Posted journal entry lines cannot be modified';
  end if;

  if tg_op = 'UPDATE' and (old_parent_state = 'posted' or new_parent_state = 'posted') then
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

revoke all on function public.accounting_guard_posted_move_line() from public, anon, authenticated;

comment on function public.accounting_guard_posted_move_line() is
  'Rejects posted-line mutation except controlled cache maintenance and initial construction in the current transaction, including subtransactions.';

commit;
