begin;

-- Availability must report the full eligible serial count. The response is a
-- business contract, so silently capping both count and candidates at 100 is
-- incorrect for larger locations.
do $$
declare
  v_definition text;
  v_rewritten text;
begin
  select pg_get_functiondef(
    'public.get_inventory_availability(uuid,uuid,numeric,uuid,uuid)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'      order by unit.tracking_number, unit.id\n      limit 100',
    E'      order by unit.tracking_number, unit.id'
  );
  if v_rewritten <> v_definition then
    execute v_rewritten;
  end if;
end
$$;

commit;
