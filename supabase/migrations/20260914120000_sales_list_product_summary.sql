begin;

do $$
declare
  v_function_oid oid;
  v_definition text;
  v_select_anchor text := 'creator.full_name as created_by_name,';
  v_json_anchor text := '''created_by'', jsonb_build_object(';
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

  if position('product_summary' in v_definition) = 0 then
    if position(v_select_anchor in v_definition) = 0 or position(v_json_anchor in v_definition) = 0 then
      raise exception 'list_sales contract shape is not compatible with the product summary upgrade';
    end if;

    v_definition := replace(
      v_definition,
      v_select_anchor,
      v_select_anchor || $fragment$
      coalesce((
        select string_agg(product_line.product_name, '، ' order by product_line.line_position)
        from (
          select coalesce(nullif(btrim(line.description), ''), product.display_name) as product_name,
                 line.line_position
          from public.sale_lines line
          join public.product_products product
            on product.id = line.product_id and product.tenant_id = line.tenant_id
          where line.tenant_id = sale.tenant_id and line.sale_id = sale.id
          order by line.line_position, line.id
          limit 2
        ) product_line
      ), '') as product_summary,$fragment$
    );

    v_definition := replace(
      v_definition,
      v_json_anchor,
      '''product_summary'', row_data.product_summary,' || chr(10) || '          ' || v_json_anchor
    );

    execute v_definition;
  end if;
end;
$$;

comment on function public.list_sales(integer, integer, text, text, uuid, date, date, text, text) is
  'Canonical paginated Sales list including a bounded two-product display summary per sale.';

commit;
