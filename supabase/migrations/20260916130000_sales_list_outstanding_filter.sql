begin;

do $$
declare
  v_function_oid oid;
  v_definition text;
  v_validation_anchor text := 'v_payment_status not in (''unpaid'', ''partially_paid'', ''paid'')';
  v_filter_anchor text := '(v_payment_status is null or row_data.payment_status = v_payment_status)';
begin
  select procedure.oid
  into v_function_oid
  from pg_proc procedure
  join pg_namespace namespace on namespace.oid = procedure.pronamespace
  where namespace.nspname = 'public'
    and procedure.proname = 'list_sales'
    and pg_get_function_identity_arguments(procedure.oid) =
      'p_page integer, p_page_size integer, p_search text, p_status text, p_branch_id uuid, p_date_from date, p_date_to date, p_payment_status text, p_fulfillment_status text';

  if v_function_oid is null then
    raise exception 'list_sales contract was not found';
  end if;

  v_definition := pg_get_functiondef(v_function_oid);

  if position('v_payment_status = ''outstanding''' in v_definition) = 0 then
    if position(v_validation_anchor in v_definition) = 0 or position(v_filter_anchor in v_definition) = 0 then
      raise exception 'list_sales contract shape is not compatible with the outstanding filter upgrade';
    end if;

    v_definition := replace(
      v_definition,
      v_validation_anchor,
      'v_payment_status not in (''unpaid'', ''partially_paid'', ''paid'', ''outstanding'')'
    );
    v_definition := replace(
      v_definition,
      v_filter_anchor,
      '(v_payment_status is null
        or (v_payment_status = ''outstanding'' and row_data.status = ''confirmed'' and row_data.outstanding_amount > 0)
        or row_data.payment_status = v_payment_status)'
    );

    execute v_definition;
  end if;
end;
$$;

comment on function public.list_sales(integer, integer, text, text, uuid, date, date, text, text) is
  'Canonical paginated Sales list with an outstanding token for confirmed sales carrying a positive residual.';

commit;
