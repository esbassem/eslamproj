begin;
create or replace function public.get_financial_source_context(p_move_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.current_tenant_id(); v_move public.account_moves; v_original uuid;
  v_sale uuid; v_sale_count int:=0; v_relation text:='unrelated'; v_resolution text:='unresolved';
  v_source_type text:='accounting_move'; v_source_id text; v_historical boolean:=false; v_number text;
begin
  if auth.uid() is null or v_tenant is null then raise exception using errcode='42501',message='FINANCIAL_SOURCE_AUTH_REQUIRED'; end if;
  if not public.has_permission('accountant_app.access',v_tenant) and not public.has_permission('financial.audit.view',v_tenant) then raise exception using errcode='42501',message='FINANCIAL_SOURCE_READ_DENIED'; end if;
  select * into v_move from public.account_moves where id=p_move_id and tenant_id=v_tenant;
  if v_move.id is null then raise exception using errcode='P0002',message='FINANCIAL_MOVE_NOT_FOUND'; end if;
  if not public.has_financial_resource_access(v_tenant,'accountant_app.access',null,'read',v_move.branch_id,true) then raise exception using errcode='42501',message='FINANCIAL_SOURCE_SCOPE_DENIED'; end if;
  v_original:=coalesce(v_move.reversed_entry_id,v_move.id);

  select count(distinct x.sale_id),min(x.sale_id) into v_sale_count,v_sale from (
    select fp.source_id::uuid sale_id from public.financial_sale_postings fp where fp.tenant_id=v_tenant and fp.account_move_id=v_original and fp.source_model='sale' and fp.source_id ~* '^[0-9a-f-]{36}$'
    union all select hs.sale_id from public.sale_historical_sources hs where hs.tenant_id=v_tenant and hs.financial_account_move_id=v_original
  ) x;
  if v_sale_count=1 then v_relation:=case when v_move.reversed_entry_id is not null then 'reversal' else 'sale_posting' end; v_resolution:='explicit_provenance'; end if;

  if v_move.move_type='payment' or v_move.payment_id is not null then
    select count(distinct x.sale_id),min(x.sale_id) into v_sale_count,v_sale from (
      select coalesce(fp.source_id::uuid,hs.sale_id) sale_id
      from public.financial_payment_allocations a
      join public.account_move_lines target_line on target_line.id=a.target_account_line_id and target_line.tenant_id=a.tenant_id
      left join public.financial_sale_postings fp on fp.account_move_id=target_line.move_id and fp.tenant_id=a.tenant_id and fp.source_model='sale' and fp.source_id ~* '^[0-9a-f-]{36}$'
      left join public.sale_historical_sources hs on hs.financial_account_move_id=target_line.move_id and hs.tenant_id=a.tenant_id
      where a.tenant_id=v_tenant and a.payment_id=v_move.payment_id and a.status='allocated' and coalesce(fp.source_id::uuid,hs.sale_id) is not null
      union
      select coalesce(fp.source_id::uuid,hs.sale_id)
      from public.account_move_lines credit_line join public.account_partial_reconcile pr on pr.credit_move_id=credit_line.id
      join public.account_move_lines debit_line on debit_line.id=pr.debit_move_id
      left join public.financial_sale_postings fp on fp.account_move_id=debit_line.move_id and fp.tenant_id=pr.tenant_id and fp.source_model='sale' and fp.source_id ~* '^[0-9a-f-]{36}$'
      left join public.sale_historical_sources hs on hs.financial_account_move_id=debit_line.move_id and hs.tenant_id=pr.tenant_id
      where credit_line.move_id=v_move.id and pr.tenant_id=v_tenant and coalesce(fp.source_id::uuid,hs.sale_id) is not null
    ) x;
    if v_sale_count=1 then v_relation:='payment';v_resolution:='explicit_allocation';
    elsif v_sale_count>1 then v_sale:=null;v_relation:='allocation';v_resolution:='ambiguous_multiple_sales';
    else v_sale:=null;v_relation:='unapplied_customer_credit';v_resolution:='unallocated'; end if;
  end if;

  if v_sale is null and v_move.move_type not in ('payment') then
    select hs.sale_id into v_sale from public.sale_historical_sources hs where hs.tenant_id=v_tenant and v_move.ref='showroom_sale:'||hs.source_sale_id::text limit 1;
    if v_sale is not null then v_relation:=case when v_move.move_type in ('refund','reversal') then v_move.move_type else 'sale_posting' end;v_resolution:='financial_historical_adapter'; end if;
  end if;
  if v_sale is not null then select s.sale_number,s.is_historical into v_number,v_historical from public.sales s where s.id=v_sale and s.tenant_id=v_tenant; end if;
  v_source_type:=case when v_sale is not null then 'sale' when v_move.move_type='payment' then 'payment' else v_move.move_type end;
  v_source_id:=case when v_sale is not null then v_sale::text when v_move.payment_id is not null then v_move.payment_id::text else v_move.id::text end;
  return jsonb_build_object('move_id',v_move.id,'source_type',v_source_type,'source_id',v_source_id,'canonical_sale_id',v_sale,'sale_display_number',v_number,'historical',v_historical,'operation_type',v_move.move_type,'operation_status',v_move.state,'occurred_at',coalesce(v_move.date,v_move.created_at),'amount',v_move.amount_total,'relation_to_sale',v_relation,'resolution_state',v_resolution,'can_open_sale',v_sale is not null);
end $$;
revoke all on function public.get_financial_source_context(uuid) from public,anon;
grant execute on function public.get_financial_source_context(uuid) to authenticated;
comment on function public.get_financial_source_context(uuid) is 'Financial-owned deterministic move-to-business-source resolver. Payment allocation truth outranks legacy textual references.';
commit;
