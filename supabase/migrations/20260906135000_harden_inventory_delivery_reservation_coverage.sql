begin;

-- Preserve on-hand coverage if a parallel Legacy path changes its own
-- reserved_quantity after the Canonical reservation was created.
do $$
declare
  v_definition text;
  v_rewritten text;
begin
  select pg_get_functiondef(
    'public.commit_inventory_delivery(uuid,jsonb,text)'::regprocedure
  ) into v_definition;
  v_rewritten := replace(
    v_definition,
    E'  v_quant public.stock_quants%rowtype;\n  v_delivery_id uuid',
    E'  v_quant public.stock_quants%rowtype;\n  v_active_reserved numeric;\n  v_delivery_id uuid'
  );
  v_rewritten := replace(
    v_rewritten,
    E'      if not found or v_quant.quantity_on_hand < v_quantity then\n        raise exception using errcode = ''23514'', message = ''INVENTORY_NEGATIVE_STOCK_DENIED'';\n      end if;',
    E'      if not found then\n        raise exception using errcode = ''23514'', message = ''INVENTORY_NEGATIVE_STOCK_DENIED'';\n      end if;\n      select coalesce(sum(line.reserved_quantity - line.released_quantity - line.delivered_quantity), 0)\n      into v_active_reserved\n      from public.inventory_reservation_lines line\n      join public.inventory_reservations reservation\n        on reservation.id = line.reservation_id and reservation.tenant_id = line.tenant_id\n      where line.tenant_id = v_tenant_id and line.product_id = v_line.product_id\n        and line.tracking_unit_id is null\n        and reservation.location_id = v_reservation.location_id\n        and reservation.state in (''active'', ''partially_delivered'');\n      if v_quant.quantity_on_hand < v_quantity\n         or v_quant.quantity_on_hand - v_quant.reserved_quantity - v_active_reserved < 0 then\n        raise exception using errcode = ''23514'', message = ''INVENTORY_NEGATIVE_STOCK_DENIED'';\n      end if;'
  );
  if v_rewritten <> v_definition then
    execute v_rewritten;
  end if;
end
$$;

commit;
