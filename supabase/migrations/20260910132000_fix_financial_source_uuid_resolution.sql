begin;

do $$
declare v_definition text; v_rewritten text;
begin
  select pg_get_functiondef('public.get_financial_source_context(uuid)'::regprocedure)
  into v_definition;
  v_rewritten := replace(
    v_definition,
    'select count(distinct x.sale_id),min(x.sale_id) into v_sale_count,v_sale',
    'select count(distinct x.sale_id),(array_agg(x.sale_id order by x.sale_id))[1] into v_sale_count,v_sale'
  );
  if v_rewritten = v_definition then
    raise exception 'FINANCIAL_SOURCE_UUID_AGGREGATION_FIX_NOT_APPLIED';
  end if;
  execute v_rewritten;
end
$$;

commit;
