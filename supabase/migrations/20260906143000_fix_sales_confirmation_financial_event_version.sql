begin;

do $$
declare v_definition text; v_rewritten text;
begin
  select pg_get_functiondef(
    'public.confirm_sale(uuid,bigint,jsonb,text)'::regprocedure
  ) into v_definition;
  if position(
    E'v_sale.id::text, v_new_version::integer,' in v_definition
  ) = 0 then
    v_rewritten := replace(
      v_definition,
      E'    v_tenant_id, ''sales_core'', ''sale'', v_sale.id::text, v_new_version,',
      E'    v_tenant_id, ''sales_core'', ''sale'', v_sale.id::text, v_new_version::integer,'
    );
    if v_rewritten = v_definition then
      raise exception 'SALES_CONFIRMATION_EVENT_VERSION_CAST_NOT_APPLIED';
    end if;
    execute v_rewritten;
  end if;
end
$$;

commit;
