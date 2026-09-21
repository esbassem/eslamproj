begin;

-- Do not mask unrelated constraint failures as source-identity conflicts.
do $$
declare
  v_definition text;
  v_rewritten text;
begin
  select pg_get_functiondef(
    'public.reserve_inventory(uuid,uuid,text,text,jsonb,text)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'exception when unique_violation then\n  raise exception using errcode = ''23514'', message = ''INVENTORY_SOURCE_ALREADY_RESERVED'';\nend\n$function$',
    E'end\n$function$'
  );
  if v_rewritten <> v_definition then
    execute v_rewritten;
  end if;

  select pg_get_functiondef(
    'public.receive_inventory_return(uuid,uuid,text,text,jsonb,text)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'exception when unique_violation then\n  raise exception using errcode = ''23514'', message = ''INVENTORY_RETURN_SOURCE_ALREADY_USED'';\nend\n$function$',
    E'end\n$function$'
  );
  if v_rewritten <> v_definition then
    execute v_rewritten;
  end if;
end
$$;

commit;
