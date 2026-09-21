begin;

do $$
begin
  if exists (
    select 1
    from public.account_partial_reconcile partial
    join public.account_move_lines debit_line on debit_line.id = partial.debit_move_id
    join public.account_move_lines credit_line on credit_line.id = partial.credit_move_id
    join public.account_accounts debit_account on debit_account.id = debit_line.account_id
    join public.account_accounts credit_account on credit_account.id = credit_line.account_id
    where debit_account.code in ('700001', '700002', '700003', '700004')
       or credit_account.code in ('700001', '700002', '700003', '700004')
  ) then
    raise exception using
      errcode = '23514',
      message = 'Operational accounts 700001-700004 have reconciliation history';
  end if;
end
$$;

update public.account_accounts
set reconcile = false
where code in ('700001', '700002', '700003', '700004')
  and reconcile = true;

comment on column public.account_accounts.reconcile is
  'Whether move lines on the account may participate in open-item reconciliation. Operational intermediary accounts 700001-700004 are intentionally excluded.';

commit;
