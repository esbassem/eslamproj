begin;

create or replace function public.resolve_financial_payment_allocation_source(
  p_tenant_id uuid, p_payment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  payment public.financial_payments%rowtype;
  source_line public.account_move_lines%rowtype;
  posting_move public.account_moves%rowtype;
  expected_account_id uuid;
  matching_count integer;
begin
  select * into payment from public.financial_payments item
  where item.id=p_payment_id and item.tenant_id=p_tenant_id;
  if not found then raise exception using errcode='P0002', message='FINANCIAL_PAYMENT_NOT_FOUND'; end if;
  if payment.status <> 'confirmed' or payment.accounting_state <> 'posted' then
    raise exception using errcode='23514', message='FINANCIAL_PAYMENT_NOT_POSTED';
  end if;
  if payment.payment_purpose not in ('inbound_customer_unallocated','outbound_supplier_unallocated') then
    raise exception using errcode='23514', message='PAYMENT_PURPOSE_REQUIRES_FUTURE_RECLASSIFICATION';
  end if;
  if payment.partner_id is null then
    raise exception using errcode='23514', message='ALLOCATABLE_PAYMENT_REQUIRES_PARTNER';
  end if;
  select move.* into posting_move
  from public.financial_payment_accounting_links link
  join public.account_moves move on move.id=link.account_move_id and move.tenant_id=link.tenant_id
  where link.tenant_id=p_tenant_id and link.payment_id=p_payment_id
    and link.entry_type='posting' and move.state='posted';
  if not found then raise exception using errcode='23514', message='POSTED_FINANCIAL_PAYMENT_LINK_MISSING'; end if;
  select public.resolve_functional_account(
    p_tenant_id, purpose.counterpart_functional_role, payment.branch_id
  ) into expected_account_id
  from public.financial_payment_purposes purpose
  where purpose.code=payment.payment_purpose and purpose.is_active;
  select count(*), (array_agg(line.id))[1] into matching_count, source_line.id
  from public.account_move_lines line
  join public.account_accounts account on account.id=line.account_id and account.tenant_id=line.tenant_id
  where line.tenant_id=p_tenant_id and line.move_id=posting_move.id
    and line.account_id=expected_account_id and line.partner_id=payment.partner_id
    and line.line_type='open_item' and account.reconcile and account.open_item_reconcile
    and ((payment.payment_purpose='inbound_customer_unallocated' and line.credit>0 and line.debit=0)
      or (payment.payment_purpose='outbound_supplier_unallocated' and line.debit>0 and line.credit=0));
  if matching_count <> 1 then
    raise exception using errcode='23514', message='PAYMENT_SOURCE_OPEN_ITEM_NOT_UNIQUE';
  end if;
  select * into source_line from public.account_move_lines where id=source_line.id;
  return jsonb_build_object(
    'payment_id',payment.id,'payment_number',payment.payment_number,
    'payment_purpose',payment.payment_purpose,'branch_id',payment.branch_id,
    'partner_id',payment.partner_id,'source_line_id',source_line.id,
    'account_id',source_line.account_id,'currency_code',source_line.currency_code,
    'polarity',case when source_line.debit>0 then 'debit' else 'credit' end,
    'original_amount',round(source_line.debit+source_line.credit,2),
    'residual_amount',round(source_line.amount_residual,2)
  );
end
$$;

revoke all on function public.resolve_financial_payment_allocation_source(uuid,uuid)
from public,anon,authenticated;

commit;
