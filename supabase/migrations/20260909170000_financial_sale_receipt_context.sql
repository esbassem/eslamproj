begin;
create or replace function public.get_sale_receipt_context(p_sale_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid; v_sale public.sales; v_move uuid; v_ar uuid; v_receivable numeric:=0; v_residual numeric:=0; v_ops jsonb;
begin
  v_tenant:=public.current_tenant_id();
  if v_tenant is null or auth.uid() is null then raise exception using errcode='42501',message='FINANCIAL_RECEIPT_AUTH_REQUIRED'; end if;
  if not public.has_permission('accountant_app.access',v_tenant) and not public.has_permission('financial.audit.view',v_tenant) then raise exception using errcode='42501',message='FINANCIAL_RECEIPT_READ_DENIED'; end if;
  select * into v_sale from public.sales where id=p_sale_id and tenant_id=v_tenant;
  if v_sale.id is null then raise exception using errcode='P0002',message='SALE_NOT_FOUND'; end if;
  if not public.has_financial_resource_access(v_tenant,'accountant_app.access',null,'read',v_sale.branch_id,true) then raise exception using errcode='42501',message='FINANCIAL_RECEIPT_SCOPE_DENIED'; end if;
  select coalesce((select financial_account_move_id from public.sale_historical_sources where tenant_id=v_tenant and sale_id=v_sale.id),(select account_move_id from public.financial_sale_postings where tenant_id=v_tenant and source_id=v_sale.id::text and state='posted' order by posted_at desc limit 1)) into v_move;
  if v_move is not null then
    select coalesce(sum(debit),0),coalesce(sum(amount_residual),0) into v_receivable,v_residual from public.account_move_lines where tenant_id=v_tenant and move_id=v_move and debit>0 and partner_id=v_sale.customer_id;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('operation_id',r.id,'occurred_at',r.create_date,'amount',r.amount,'direction','in','payment_method',null,'money_destination',null,'reference',m.ref,'status',m.state,'allocated_to_sale',r.amount,'is_reversal_or_refund',m.move_type in ('refund','reversal')) order by r.create_date,r.id),'[]'::jsonb)
  into v_ops from public.account_move_lines ar join public.account_partial_reconcile r on r.debit_move_id=ar.id join public.account_move_lines cr on cr.id=r.credit_move_id join public.account_moves m on m.id=cr.move_id where ar.tenant_id=v_tenant and ar.move_id=v_move and ar.debit>0;
  return jsonb_build_object('sale_id',v_sale.id,'display_number',v_sale.sale_number,'sale_date',v_sale.effective_sale_date,'customer',coalesce((select name from public.partners where id=v_sale.customer_id and tenant_id=v_tenant),'عميل غير محدد'),'total_amount',v_sale.total_amount,'receivable_amount',v_receivable,'residual',v_residual,'allocated_total',greatest(v_receivable-v_residual,0),'historical',v_sale.is_historical,'status',v_sale.status,'operations',v_ops);
end $$;
revoke all on function public.get_sale_receipt_context(uuid) from public,anon;
grant execute on function public.get_sale_receipt_context(uuid) to authenticated;
comment on function public.get_sale_receipt_context(uuid) is 'Financial-owned business-safe canonical Sale receipt and allocation chronology; read-only and ledger-internal identifiers are never returned.';
commit;
