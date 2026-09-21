begin;

do $$
declare v_definition text; v_rewritten text;
begin
  select pg_get_functiondef('public.get_sale_receipt_context(uuid)'::regprocedure)
  into v_definition;
  v_rewritten := replace(v_definition,
    E'    select coalesce(sum(debit),0),coalesce(sum(amount_residual),0) into v_receivable,v_residual from public.account_move_lines where tenant_id=v_tenant and move_id=v_move and debit>0 and partner_id=v_sale.customer_id;',
    E'    select (array_agg(account_id order by id))[1],coalesce(sum(debit),0),coalesce(sum(amount_residual),0) into v_ar,v_receivable,v_residual from public.account_move_lines where tenant_id=v_tenant and move_id=v_move and debit>0 and partner_id=v_sale.customer_id;');
  v_rewritten := replace(v_rewritten,
    E'public.has_financial_resource_access(v_tenant,''accountant_app.access'',null,''read'',v_sale.branch_id,true)',
    E'public.has_financial_resource_access(v_tenant,v_ar,''view'',v_sale.branch_id)');
  v_rewritten := replace(v_rewritten,
    E'  if not public.has_financial_resource_access(v_tenant,v_ar,''view'',v_sale.branch_id) then raise exception using errcode=''42501'',message=''FINANCIAL_RECEIPT_SCOPE_DENIED''; end if;\n',
    '');
  v_rewritten := replace(v_rewritten,
    E'  end if;\n  select coalesce(jsonb_agg',
    E'  end if;\n  if not public.has_branch_access(v_sale.branch_id) or (v_ar is not null and not public.has_financial_resource_access(v_tenant,v_ar,''view'',v_sale.branch_id)) then raise exception using errcode=''42501'',message=''FINANCIAL_RECEIPT_SCOPE_DENIED''; end if;\n  select coalesce(jsonb_agg');
  if v_rewritten = v_definition then
    raise exception 'SALE_RECEIPT_RESOURCE_SCOPE_FIX_NOT_APPLIED';
  end if;
  execute v_rewritten;

  select pg_get_functiondef('public.get_financial_source_context(uuid)'::regprocedure)
  into v_definition;
  v_rewritten := replace(v_definition,
    E'  v_tenant uuid:=public.current_tenant_id(); v_move public.account_moves; v_original uuid;',
    E'  v_tenant uuid:=public.current_tenant_id(); v_move public.account_moves; v_original uuid; v_scope_account uuid;');
  v_rewritten := replace(v_rewritten,
    E'  if not public.has_financial_resource_access(v_tenant,''accountant_app.access'',null,''read'',v_move.branch_id,true) then',
    E'  select line.account_id into v_scope_account from public.account_move_lines line where line.tenant_id=v_tenant and line.move_id=v_move.id order by (line.partner_id is not null) desc,line.id limit 1;\n  if v_scope_account is null or not public.has_financial_resource_access(v_tenant,v_scope_account,''view'',v_move.branch_id) then');
  if v_rewritten = v_definition then
    raise exception 'FINANCIAL_SOURCE_RESOURCE_SCOPE_FIX_NOT_APPLIED';
  end if;
  execute v_rewritten;
end
$$;

commit;
