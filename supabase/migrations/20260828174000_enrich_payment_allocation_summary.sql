begin;

create or replace function public.get_financial_payment_allocation_summary(
  p_tenant_id uuid, p_payment_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare source jsonb; original_amount numeric; residual_amount numeric; allocated_amount numeric; state text;
begin
  source := public.resolve_financial_payment_allocation_source(p_tenant_id,p_payment_id);
  if not (
    public.can_perform_financial_action(p_tenant_id,'financial.payment.allocate',
      (source->>'account_id')::uuid,'reconcile',nullif(source->>'branch_id','')::uuid,true)
    or public.can_perform_financial_action(p_tenant_id,'financial.reconciliation.manage',
      (source->>'account_id')::uuid,'reconcile',nullif(source->>'branch_id','')::uuid,true)
  ) then
    raise exception using errcode='42501', message='FINANCIAL_AUTHORIZATION_DENIED';
  end if;
  select round(line.debit+line.credit,2),round(line.amount_residual,2)
    into original_amount,residual_amount
  from public.account_move_lines line where line.id=(source->>'source_line_id')::uuid;
  allocated_amount := round(original_amount-residual_amount,2);
  state := case when residual_amount=original_amount then 'unallocated'
    when residual_amount=0 then 'fully_allocated' else 'partially_allocated' end;
  return jsonb_build_object(
    'payment_id',p_payment_id,'source_account_line_id',(source->>'source_line_id')::uuid,
    'payment_amount',(select amount from public.financial_payments where id=p_payment_id and tenant_id=p_tenant_id),
    'posted_open_item_amount',original_amount,'original_amount',original_amount,
    'allocated_amount',allocated_amount,'remaining_allocatable_amount',residual_amount,
    'residual_amount',residual_amount,'allocation_state',state,
    'active_allocation_count',(select count(*) from public.financial_payment_allocations item
      where item.tenant_id=p_tenant_id and item.payment_id=p_payment_id and item.status='active'),
    'allocation_history',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',item.id,'target_account_line_id',item.target_account_line_id,
      'partial_reconcile_id',item.partial_reconcile_id,'amount',item.amount,
      'status',item.status,'created_by',item.created_by,'created_at',item.created_at,
      'unallocated_by',item.unallocated_by,'unallocated_at',item.unallocated_at,
      'unallocation_reason',item.unallocation_reason,
      'target_open_item',jsonb_build_object(
        'account_move_id',target_move.id,'move_name',target_move.name,
        'move_type',target_move.move_type,'move_reference',target_move.ref,
        'move_date',target_move.date::date,'due_date',target_line.due_date
      )) order by item.created_at,item.id),'[]'::jsonb)
      from public.financial_payment_allocations item
      join public.account_move_lines target_line on target_line.id=item.target_account_line_id
      join public.account_moves target_move on target_move.id=target_line.move_id
      where item.tenant_id=p_tenant_id and item.payment_id=p_payment_id)
  );
end
$$;

revoke all on function public.get_financial_payment_allocation_summary(uuid,uuid) from public,anon;
grant execute on function public.get_financial_payment_allocation_summary(uuid,uuid) to authenticated;

commit;
