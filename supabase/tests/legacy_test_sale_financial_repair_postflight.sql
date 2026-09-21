select r.id reversal_id,r.reversal_number,r.domain_type,r.domain_id original_move_id,r.reason,r.idempotency_key,
 r.metadata->>'legacy_sale_id' legacy_sale_id,r.metadata->>'disposition' disposition,
 ml.reversal_move_id,m.name reversal_move_name,m.move_type,m.journal_id,j.code journal_code,m.state,m.reversed_entry_id,
 (select sum(debit) from public.account_move_lines where move_id=m.id) reversal_debit,
 (select sum(credit) from public.account_move_lines where move_id=m.id) reversal_credit,
 rl.partial_reconcile_id,pr.amount reconciliation_amount,
 (select amount_residual from public.account_move_lines where id='c290939c-38f6-44f5-8056-a80e06e6a5cd') original_ar_residual,
 (select amount_residual from public.account_move_lines where id=ll.reversal_line_id) reversal_ar_residual,
 (select amount_residual from public.account_move_lines where id='51bcc530-1f84-4054-996b-57e3e51077bf') customer_credit_residual,
 (select count(*) from public.account_moves) account_moves,(select count(*) from public.account_move_lines) account_move_lines,
 (select count(*) from public.account_partial_reconcile) reconciliations,(select count(*) from public.financial_payments) financial_payments,
 (select sum(debit) from public.account_move_lines where parent_state='posted') ledger_debit,
 (select sum(credit) from public.account_move_lines where parent_state='posted') ledger_credit,
 (select count(*) from public.stock_moves) stock_moves,(select count(*) from public.inventory_reservations) reservations,
 (select md5(string_agg(id::text||':'||status,',' order by id)) from public.stock_tracking_units) tracking_hash,
 (select count(*) from public.sales where id='43c00089-d7dd-4119-b0e7-cd89c1d97343') canonical_sale,
 (select count(*) from public.sale_historical_sources where source_system='showroom') historical_sales
 ,(select state from public.account_moves where id='c09713d3-2da3-4f66-ba38-780dea3ae8df') original_state
 ,(select journal_id from public.account_moves where id='c09713d3-2da3-4f66-ba38-780dea3ae8df') original_journal
 ,(select amount_total from public.account_moves where id='c09713d3-2da3-4f66-ba38-780dea3ae8df') original_amount
from public.financial_accounting_reversals r
join public.financial_accounting_reversal_move_links ml on ml.reversal_id=r.id and ml.tenant_id=r.tenant_id and ml.stage='legacy_missing_journal'
join public.account_moves m on m.id=ml.reversal_move_id and m.tenant_id=ml.tenant_id
join public.account_journals j on j.id=m.journal_id and j.tenant_id=m.tenant_id
join public.financial_accounting_reversal_line_links ll on ll.reversal_id=r.id and ll.tenant_id=r.tenant_id and ll.original_line_id='c290939c-38f6-44f5-8056-a80e06e6a5cd'
join public.financial_accounting_reversal_reconcile_links rl on rl.reversal_id=r.id and rl.tenant_id=r.tenant_id and rl.role='legacy_receivable_cleanup'
join public.account_partial_reconcile pr on pr.id=rl.partial_reconcile_id and pr.tenant_id=rl.tenant_id
where r.idempotency_key='legacy-repair:test-sale-reversal:43c00089-d7dd-4119-b0e7-cd89c1d97343';
