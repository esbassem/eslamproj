begin;

do $$
declare
  v_list_oid oid;
  v_list_definition text;
  v_report_oid oid;
  v_report_definition text;
  v_historical_residual text := $fragment$case
            when sale.is_historical then greatest(sale.total_amount - coalesce(historical_finance.paid_amount, 0), 0)
            else coalesce(receivable.amount_residual, sale.total_amount)
          end$fragment$;
begin
  select procedure.oid into v_list_oid
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public' and procedure.proname = 'list_sales'
    and pg_get_function_identity_arguments(procedure.oid) =
      'p_page integer, p_page_size integer, p_search text, p_status text, p_branch_id uuid, p_date_from date, p_date_to date, p_payment_status text, p_fulfillment_status text';

  if v_list_oid is null then raise exception 'list_sales contract was not found'; end if;
  v_list_definition := pg_get_functiondef(v_list_oid);

  if position('historical_finance.paid_amount' in v_list_definition) = 0 then
    if position('left join public.sale_confirmation_links confirmation' in v_list_definition) = 0
       or position('coalesce(receivable.amount_residual, sale.total_amount)' in v_list_definition) = 0 then
      raise exception 'list_sales contract shape is not compatible with historical residual alignment';
    end if;

    v_list_definition := replace(
      v_list_definition,
      'left join public.sale_confirmation_links confirmation',
      $fragment$left join public.sale_historical_sources historical_source
      on historical_source.sale_id = sale.id
     and historical_source.tenant_id = sale.tenant_id
     and sale.is_historical
    left join lateral (
      select round(coalesce(sum(reconcile.amount), 0), 2) as paid_amount
      from public.account_move_lines move_line
      join public.account_accounts account
        on account.id = move_line.account_id
       and account.tenant_id = move_line.tenant_id
       and account.code = '114001'
      left join public.account_partial_reconcile reconcile
        on reconcile.tenant_id = move_line.tenant_id
       and reconcile.debit_move_id = move_line.id
      where move_line.tenant_id = historical_source.tenant_id
        and move_line.move_id = historical_source.financial_account_move_id
        and move_line.debit > 0
    ) historical_finance on sale.is_historical
    left join public.sale_confirmation_links confirmation$fragment$
    );
    v_list_definition := replace(
      v_list_definition,
      'coalesce(receivable.amount_residual, sale.total_amount)',
      v_historical_residual
    );
    execute v_list_definition;
  end if;

  select procedure.oid into v_report_oid
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public' and procedure.proname = 'get_sales_monthly_branch_reports'
    and pg_get_function_identity_arguments(procedure.oid) = 'p_month date';

  if v_report_oid is null then raise exception 'branch report contract was not found'; end if;
  v_report_definition := pg_get_functiondef(v_report_oid);

  if position('historical_finance.paid_amount' in v_report_definition) = 0 then
    if position('left join latest_postings posting on posting.source_id = sale.id::text' in v_report_definition) = 0
       or position('coalesce(posting.outstanding_amount, 0)::numeric(18,2) as outstanding_amount' in v_report_definition) = 0 then
      raise exception 'branch report contract shape is not compatible with historical residual alignment';
    end if;

    v_report_definition := replace(
      v_report_definition,
      'posting.currency_code as posting_currency_code,',
      'case when sale.is_historical then sale.currency_code else posting.currency_code end as posting_currency_code,'
    );
    v_report_definition := replace(
      v_report_definition,
      'coalesce(posting.outstanding_amount, 0)::numeric(18,2) as outstanding_amount',
      $fragment$(case
        when sale.is_historical then greatest(sale.total_amount - coalesce(historical_finance.paid_amount, 0), 0)
        else coalesce(posting.outstanding_amount, 0)
      end)::numeric(18,2) as outstanding_amount$fragment$
    );
    v_report_definition := replace(
      v_report_definition,
      'left join latest_postings posting on posting.source_id = sale.id::text',
      $fragment$left join public.sale_historical_sources historical_source
      on historical_source.sale_id = sale.id
     and historical_source.tenant_id = sale.tenant_id
     and sale.is_historical
    left join lateral (
      select round(coalesce(sum(reconcile.amount), 0), 2) as paid_amount
      from public.account_move_lines move_line
      join public.account_accounts account
        on account.id = move_line.account_id
       and account.tenant_id = move_line.tenant_id
       and account.code = '114001'
      left join public.account_partial_reconcile reconcile
        on reconcile.tenant_id = move_line.tenant_id
       and reconcile.debit_move_id = move_line.id
      where move_line.tenant_id = historical_source.tenant_id
        and move_line.move_id = historical_source.financial_account_move_id
        and move_line.debit > 0
    ) historical_finance on sale.is_historical
    left join latest_postings posting on posting.source_id = sale.id::text$fragment$
    );
    execute v_report_definition;
  end if;
end;
$$;

comment on function public.list_sales(integer, integer, text, text, uuid, date, date, text, text) is
  'Canonical paginated Sales list aligned with immutable historical financial evidence for residual balances.';
comment on function public.get_sales_monthly_branch_reports(date) is
  'Monthly branch reports and lifetime outstanding aligned with canonical and historical financial evidence.';

commit;
