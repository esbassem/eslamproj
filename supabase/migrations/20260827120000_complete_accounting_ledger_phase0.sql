begin;

do $$
begin
  if exists (
    select 1
    from public.account_moves move
    left join public.account_move_lines line on line.move_id = move.id
    where move.state = 'posted'
    group by move.id
    having count(line.id) < 2 or coalesce(sum(line.debit), 0) <> coalesce(sum(line.credit), 0)
  ) then
    raise exception using errcode = '23514', message = 'Phase 0 preflight found an invalid posted journal entry';
  end if;

  if exists (
    select 1
    from public.account_move_lines line
    join public.account_moves move on move.id = line.move_id
    join public.account_accounts account on account.id = line.account_id
    where line.tenant_id <> move.tenant_id
       or line.tenant_id <> account.tenant_id
  ) then
    raise exception using errcode = '23514', message = 'Phase 0 preflight found a move-line tenant mismatch';
  end if;

  if exists (
    select 1
    from public.account_partial_reconcile partial
    join public.account_move_lines debit_line on debit_line.id = partial.debit_move_id
    join public.account_move_lines credit_line on credit_line.id = partial.credit_move_id
    join public.account_moves debit_move on debit_move.id = debit_line.move_id
    join public.account_moves credit_move on credit_move.id = credit_line.move_id
    join public.account_accounts account on account.id = debit_line.account_id
    where partial.tenant_id <> debit_line.tenant_id
       or partial.tenant_id <> credit_line.tenant_id
       or debit_line.account_id <> credit_line.account_id
       or account.tenant_id <> partial.tenant_id
       or not account.reconcile
       or debit_move.state <> 'posted'
       or credit_move.state <> 'posted'
       or debit_line.debit <= 0 or debit_line.credit <> 0
       or credit_line.credit <= 0 or credit_line.debit <> 0
       or debit_line.currency_code <> credit_line.currency_code
       or partial.amount <= 0
  ) then
    raise exception using errcode = '23514', message = 'Phase 0 preflight found an invalid reconciliation';
  end if;

  if exists (
    select 1 from (
      select debit_line.id
      from public.account_move_lines debit_line
      join public.account_partial_reconcile partial on partial.debit_move_id = debit_line.id
      group by debit_line.id, debit_line.debit
      having sum(partial.amount) > debit_line.debit
      union all
      select credit_line.id
      from public.account_move_lines credit_line
      join public.account_partial_reconcile partial on partial.credit_move_id = credit_line.id
      group by credit_line.id, credit_line.credit
      having sum(partial.amount) > credit_line.credit
    ) over_reconciled
  ) then
    raise exception using errcode = '23514', message = 'Phase 0 preflight found an over-reconciled move line';
  end if;

  if exists (
    select 1
    from public.account_move_lines line
    join public.account_accounts account on account.id = line.account_id and account.reconcile
    cross join lateral (
      select round(greatest(
        case when line.debit > 0
          then line.debit - coalesce((select sum(amount) from public.account_partial_reconcile where debit_move_id = line.id), 0)
          else line.credit - coalesce((select sum(amount) from public.account_partial_reconcile where credit_move_id = line.id), 0)
        end, 0
      ), 2) residual
    ) derived
    where line.amount_residual is distinct from derived.residual
       or line.amount_residual_currency is distinct from derived.residual
       or line.is_reconciled is distinct from (derived.residual = 0)
  ) then
    raise exception using errcode = '23514', message = 'Phase 0 preflight found stale reconciliation caches';
  end if;
end
$$;

create or replace function public.accounting_guard_move_line_tenant()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  parent_tenant_id uuid;
  account_tenant_id uuid;
begin
  select tenant_id into parent_tenant_id
  from public.account_moves
  where id = new.move_id;

  if parent_tenant_id is null or parent_tenant_id <> new.tenant_id then
    raise exception using errcode = '23514', message = 'Move line tenant must match its journal entry tenant';
  end if;

  select tenant_id into account_tenant_id
  from public.account_accounts
  where id = new.account_id;

  if account_tenant_id is null or account_tenant_id <> new.tenant_id then
    raise exception using errcode = '23514', message = 'Move line tenant must match its account tenant';
  end if;

  return new;
end
$$;

create or replace function public.accounting_sync_reconciliation_cache(p_line_ids uuid[])
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.account_move_lines line
  set amount_residual = derived.residual,
      amount_residual_currency = derived.residual,
      is_reconciled = derived.residual = 0
  from (
    select candidate.id,
      round(greatest(
        case
          when candidate.debit > 0 then candidate.debit - coalesce((
            select sum(partial.amount)
            from public.account_partial_reconcile partial
            where partial.debit_move_id = candidate.id
          ), 0)
          else candidate.credit - coalesce((
            select sum(partial.amount)
            from public.account_partial_reconcile partial
            where partial.credit_move_id = candidate.id
          ), 0)
        end,
        0
      ), 2) residual
    from public.account_move_lines candidate
    join public.account_accounts account on account.id = candidate.account_id
    where candidate.id = any(coalesce(p_line_ids, array[]::uuid[]))
      and account.reconcile = true
  ) derived
  where line.id = derived.id
    and (
      line.amount_residual is distinct from derived.residual
      or line.amount_residual_currency is distinct from derived.residual
      or line.is_reconciled is distinct from (derived.residual = 0)
    );
end
$$;

create or replace function public.accounting_guard_partial_reconcile()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  debit_line public.account_move_lines%rowtype;
  credit_line public.account_move_lines%rowtype;
  debit_move public.account_moves%rowtype;
  credit_move public.account_moves%rowtype;
  reconcile_account public.account_accounts%rowtype;
  used_debit numeric;
  used_credit numeric;
begin
  if tg_op = 'DELETE' then
    perform 1
    from public.account_move_lines line
    where line.id in (old.debit_move_id, old.credit_move_id)
    order by line.id
    for update;
    return old;
  end if;

  if new.amount <= 0 or new.debit_move_id = new.credit_move_id then
    raise exception using errcode = '23514', message = 'Reconciliation amount and line polarity are invalid';
  end if;

  perform 1
  from public.account_move_lines line
  where line.id = any(
    case when tg_op = 'UPDATE'
      then array[new.debit_move_id, new.credit_move_id, old.debit_move_id, old.credit_move_id]
      else array[new.debit_move_id, new.credit_move_id]
    end
  )
  order by line.id
  for update;

  select * into debit_line from public.account_move_lines where id = new.debit_move_id;
  select * into credit_line from public.account_move_lines where id = new.credit_move_id;

  if debit_line.id is null or credit_line.id is null then
    raise exception using errcode = '23503', message = 'Reconciliation lines were not found';
  end if;
  if new.tenant_id <> debit_line.tenant_id
     or new.tenant_id <> credit_line.tenant_id
     or debit_line.tenant_id <> credit_line.tenant_id then
    raise exception using errcode = '23514', message = 'Reconciliation tenant must match both move lines';
  end if;
  if debit_line.account_id <> credit_line.account_id then
    raise exception using errcode = '23514', message = 'Reconciliation lines must use the same account';
  end if;
  if debit_line.debit <= 0 or debit_line.credit <> 0
     or credit_line.credit <= 0 or credit_line.debit <> 0 then
    raise exception using errcode = '23514', message = 'Reconciliation requires a debit line and a credit line';
  end if;
  if debit_line.currency_code <> credit_line.currency_code then
    raise exception using errcode = '23514', message = 'Reconciliation line currencies must match';
  end if;

  select * into reconcile_account
  from public.account_accounts
  where id = debit_line.account_id;

  if reconcile_account.id is null
     or reconcile_account.tenant_id <> new.tenant_id
     or not reconcile_account.reconcile then
    raise exception using errcode = '23514', message = 'Account is not available for reconciliation';
  end if;

  select * into debit_move from public.account_moves where id = debit_line.move_id;
  select * into credit_move from public.account_moves where id = credit_line.move_id;
  if debit_move.state <> 'posted' or credit_move.state <> 'posted' then
    raise exception using errcode = '23514', message = 'Only posted journal entry lines can be reconciled';
  end if;
  if debit_move.tenant_id <> new.tenant_id or credit_move.tenant_id <> new.tenant_id then
    raise exception using errcode = '23514', message = 'Reconciliation parent move tenant mismatch';
  end if;

  select coalesce(sum(amount), 0) into used_debit
  from public.account_partial_reconcile
  where debit_move_id = new.debit_move_id
    and (tg_op <> 'UPDATE' or id <> old.id);

  select coalesce(sum(amount), 0) into used_credit
  from public.account_partial_reconcile
  where credit_move_id = new.credit_move_id
    and (tg_op <> 'UPDATE' or id <> old.id);

  if used_debit + new.amount > debit_line.debit
     or used_credit + new.amount > credit_line.credit then
    raise exception using errcode = '23514', message = 'Reconciliation exceeds the available residual amount';
  end if;

  return new;
end
$$;

create or replace function public.accounting_sync_partial_reconcile_cache()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.accounting_sync_reconciliation_cache(array[new.debit_move_id, new.credit_move_id]);
  elsif tg_op = 'DELETE' then
    perform public.accounting_sync_reconciliation_cache(array[old.debit_move_id, old.credit_move_id]);
  else
    perform public.accounting_sync_reconciliation_cache(array[
      old.debit_move_id, old.credit_move_id, new.debit_move_id, new.credit_move_id
    ]);
  end if;
  return null;
end
$$;

drop trigger if exists account_move_lines_tenant_guard on public.account_move_lines;
create trigger account_move_lines_tenant_guard
before insert or update of tenant_id, move_id, account_id on public.account_move_lines
for each row execute function public.accounting_guard_move_line_tenant();

drop trigger if exists account_partial_reconcile_guard on public.account_partial_reconcile;
create trigger account_partial_reconcile_guard
before insert or update or delete on public.account_partial_reconcile
for each row execute function public.accounting_guard_partial_reconcile();

drop trigger if exists account_partial_reconcile_sync_cache on public.account_partial_reconcile;
create trigger account_partial_reconcile_sync_cache
after insert or update or delete on public.account_partial_reconcile
for each row execute function public.accounting_sync_partial_reconcile_cache();

revoke all on function public.accounting_guard_move_line_tenant() from public, anon, authenticated;
revoke all on function public.accounting_guard_partial_reconcile() from public, anon, authenticated;
revoke all on function public.accounting_sync_partial_reconcile_cache() from public, anon, authenticated;
revoke all on function public.accounting_sync_reconciliation_cache(uuid[]) from public, anon, authenticated;

revoke insert, update, delete, truncate, references, trigger
on public.account_moves, public.account_move_lines, public.account_partial_reconcile
from authenticated;

grant select on public.account_moves, public.account_move_lines, public.account_partial_reconcile
to authenticated;

-- Legacy one-time migration helpers are not operational write boundaries.
revoke execute on function public.migrate_old_showroom_sale_payments() from public, anon, authenticated;
revoke execute on function public.migrate_old_showroom_sales_invoice_moves() from public, anon, authenticated;

comment on function public.accounting_guard_partial_reconcile() is
  'Serializes and validates same-tenant, same-account, posted debit/credit reconciliation without over-allocation.';
comment on function public.accounting_sync_reconciliation_cache(uuid[]) is
  'Derives residual cache values exclusively from account_partial_reconcile for reconcile-enabled accounts.';

commit;
