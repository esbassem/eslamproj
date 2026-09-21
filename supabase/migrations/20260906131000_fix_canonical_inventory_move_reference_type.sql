begin;

-- The live stock_moves.reference_id contract is UUID. The initial Inventory
-- Core function bodies compiled before the mismatch was exercised at runtime.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'public.commit_inventory_delivery(uuid,jsonb,text)'::regprocedure
  ) into v_definition;
  v_definition := replace(v_definition, 'v_delivery_id::text', 'v_delivery_id');
  execute v_definition;

  select pg_get_functiondef(
    'public.receive_inventory_return(uuid,uuid,text,text,jsonb,text)'::regprocedure
  ) into v_definition;
  v_definition := replace(v_definition, 'v_return_id::text', 'v_return_id');
  execute v_definition;
end
$$;

commit;
