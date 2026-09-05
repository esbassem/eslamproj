-- Phase 2D rollback-safe runtime contract.  All fixtures live in the dedicated
-- Financial Core test tenant and the outer transaction always rolls back.
begin;

create temporary table phase2d_baseline as
select
  (select count(*) from public.account_moves) moves,
  (select count(*) from public.account_move_lines) lines,
  (select count(*) from public.account_partial_reconcile) partials,
  (select count(*) from public.financial_sale_postings) postings,
  (select count(*) from public.financial_engine_bindings) bindings,
  (select count(*) from public.financial_payments) payments,
  (select count(*) from public.financial_payment_allocations) allocations,
  (select md5(string_agg(row_to_json(s)::text, '' order by s.id))
   from public.showroom_sales s
   where s.tenant_id = '4ee5f357-8cf5-4770-8772-64de99532dac') historical_sales;

insert into public.showroom_financial_cutovers (
  tenant_id, source_app, source_model, canonical_generation, activation_origin
) values (
  '10b40000-0000-4000-8000-000000000002', 'showroom', 'sale', 2,
  'phase_2d_runtime_test'
);

insert into public.tenant_modules (tenant_id, module_id, state, enabled_by)
values (
  '10b40000-0000-4000-8000-000000000002',
  (select id from public.ir_modules where technical_name = 'inventory'),
  'installed', '10b40000-0000-4000-8000-000000000003'
);

insert into public.showroom_configs (id, tenant_id, branch_id, name, code)
values (
  '10b40000-0000-4000-8000-000000000020',
  '10b40000-0000-4000-8000-000000000002',
  '10b40000-0000-4000-8000-000000000010',
  'Phase 2D rollback showroom', 'P2D-RB'
);

insert into public.product_templates (
  id, tenant_id, name, internal_reference, product_type, tracking, sale_price
) values
  ('10b40000-0000-4000-8000-000000000021',
   '10b40000-0000-4000-8000-000000000002', 'Phase 2D serial product',
   'P2D-SERIAL', 'goods', 'serial', 60000),
  ('10b40000-0000-4000-8000-000000000031',
   '10b40000-0000-4000-8000-000000000002', 'Phase 2D service product',
   'P2D-SERVICE', 'service', 'none', 1000);

insert into public.product_products (
  id, tenant_id, product_template_id, display_name, sku, tracking, sale_price
) values
  ('10b40000-0000-4000-8000-000000000022',
   '10b40000-0000-4000-8000-000000000002',
   '10b40000-0000-4000-8000-000000000021', 'Phase 2D serial product',
   'P2D-SERIAL', 'serial', 60000),
  ('10b40000-0000-4000-8000-000000000032',
   '10b40000-0000-4000-8000-000000000002',
   '10b40000-0000-4000-8000-000000000031', 'Phase 2D service product',
   'P2D-SERVICE', 'none', 1000);

update public.product_templates template
set default_product_product_id = case template.id
  when '10b40000-0000-4000-8000-000000000021'::uuid
    then '10b40000-0000-4000-8000-000000000022'::uuid
  else '10b40000-0000-4000-8000-000000000032'::uuid end
where template.id in (
  '10b40000-0000-4000-8000-000000000021',
  '10b40000-0000-4000-8000-000000000031'
);

insert into public.showroom_sales (
  id, tenant_id, branch_id, customer_id, sale_date, status,
  showroom_config_id, created_by, notes
) values (
  '10b40000-0000-4000-8000-000000000024',
  '10b40000-0000-4000-8000-000000000002',
  '10b40000-0000-4000-8000-000000000010',
  '10b40000-0000-4000-8000-000000000011', current_date,
  'pending_payment', '10b40000-0000-4000-8000-000000000020',
  '10b40000-0000-4000-8000-000000000003', 'Phase 2D rollback fixture'
);

insert into public.stock_tracking_units (
  id, tenant_id, tracking_type, tracking_number, status, notes,
  product_product_id, product_template_id
) values (
  '10b40000-0000-4000-8000-000000000023',
  '10b40000-0000-4000-8000-000000000002', 'serial',
  'P2D-ROLLBACK-SERIAL', 'reserved',
  'showroom_sale:10b40000-0000-4000-8000-000000000024',
  '10b40000-0000-4000-8000-000000000022',
  '10b40000-0000-4000-8000-000000000021'
);

insert into public.showroom_sale_lines (
  id, tenant_id, sale_id, product_product_id, tracking_unit_id,
  description, quantity, unit_price, total
) values (
  '10b40000-0000-4000-8000-000000000025',
  '10b40000-0000-4000-8000-000000000002',
  '10b40000-0000-4000-8000-000000000024',
  '10b40000-0000-4000-8000-000000000022',
  '10b40000-0000-4000-8000-000000000023',
  'Phase 2D serial line', 1, 60000, 60000
);

select set_config(
  'request.jwt.claim.sub', '10b40000-0000-4000-8000-000000000001', true
);
set local role authenticated;

create temporary table phase2d_first_result as
select public.complete_showroom_sale(
  '10b40000-0000-4000-8000-000000000024', 0, null, '[]'::jsonb
) result;

reset role;
do $$
declare
  result jsonb := (select phase2d_first_result.result from phase2d_first_result);
  v_move_id uuid := (result ->> 'sale_account_move_id')::uuid;
  posting_id uuid := (result ->> 'financial_posting_id')::uuid;
begin
  if result ->> 'financial_engine' <> 'canonical'
     or result ->> 'status' <> 'confirmed'
     or (result ->> 'accounting_paid_amount')::numeric <> 0
     or (result ->> 'accounting_remaining_amount')::numeric <> 60000 then
    raise exception 'PHASE2D_A_RESULT_INVALID: %', result;
  end if;
  if (select financial_confirmation_generation from public.showroom_sales
      where id = '10b40000-0000-4000-8000-000000000024') <> 2
     or (select status from public.stock_tracking_units
         where id = '10b40000-0000-4000-8000-000000000023') <> 'sold'
     or (select count(*) from public.stock_moves
         where reference_type = 'showroom_sale'
           and reference_id = '10b40000-0000-4000-8000-000000000024') <> 1
     or (select count(*) from public.financial_sale_postings where id = posting_id) <> 1
     or (select count(*) from public.financial_engine_bindings
         where tenant_id = '10b40000-0000-4000-8000-000000000002'
           and source_app = 'showroom' and source_model = 'sale'
           and source_id = '10b40000-0000-4000-8000-000000000024'
           and financial_engine = 'canonical') <> 1
     or (select count(*) from public.account_move_lines line
         where line.move_id = v_move_id) <> 2
     or (select round(sum(line.debit), 2) from public.account_move_lines line
         where line.move_id = v_move_id) <> 60000
     or (select round(sum(line.credit), 2) from public.account_move_lines line
         where line.move_id = v_move_id) <> 60000 then
    raise exception 'PHASE2D_A_LEDGER_OR_INVENTORY_INVALID';
  end if;
end
$$;

set local role authenticated;
create temporary table phase2d_replay_result as
select public.complete_showroom_sale(
  '10b40000-0000-4000-8000-000000000024', 0, null, '[]'::jsonb
) result;

reset role;
do $$
declare
  first_result jsonb := (select result from phase2d_first_result);
  replay_result jsonb := (select result from phase2d_replay_result);
begin
  if replay_result ->> 'sale_account_move_id' <> first_result ->> 'sale_account_move_id'
     or replay_result ->> 'financial_posting_id' <> first_result ->> 'financial_posting_id'
     or replay_result ->> 'sale_number' <> first_result ->> 'sale_number'
     or (select count(*) from public.stock_moves
         where reference_id = '10b40000-0000-4000-8000-000000000024') <> 1 then
    raise exception 'PHASE2D_B_REPLAY_NOT_IDEMPOTENT';
  end if;
end
$$;

set local role authenticated;
do $$
begin
  begin
    perform public.complete_showroom_sale(
      '10b40000-0000-4000-8000-000000000024', 100, 'paid now', '[]'::jsonb
    );
    raise exception 'PHASE2D_N_NONZERO_PAYMENT_WAS_ACCEPTED';
  exception when feature_not_supported then
    if sqlerrm <> 'CANONICAL_SHOWROOM_PAYMENT_DEFERRED_CONFIRM_WITH_ZERO_PAYMENT' then
      raise;
    end if;
  end;
end
$$;

do $$
begin
  begin
    perform public.complete_showroom_sale_canonical_engine_impl(
      '10b40000-0000-4000-8000-000000000024'
    );
    raise exception 'PHASE2D_E_INTERNAL_COMMAND_EXPOSED';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.complete_showroom_sale_legacy_engine_impl(
      '10b40000-0000-4000-8000-000000000024', 0, null, '[]'::jsonb
    );
    raise exception 'PHASE2D_E_LEGACY_WRITER_EXPOSED';
  exception when insufficient_privilege then null;
  end;
end
$$;

reset role;
do $$
begin
  if (select count(*) from public.financial_payments)
       <> (select payments from phase2d_baseline)
     or (select count(*) from public.financial_payment_allocations)
       <> (select allocations from phase2d_baseline)
     or (select count(*) from public.account_partial_reconcile)
       <> (select partials from phase2d_baseline) then
    raise exception 'PHASE2D_N_PAYMENT_SIDE_EFFECT_DETECTED';
  end if;
end
$$;

-- P: a row born before activation remains generation 1 even if it later enters
-- pending_payment; deployment cannot silently Canonicalize it.
insert into public.showroom_sales (
  id, tenant_id, branch_id, customer_id, sale_date, status,
  showroom_config_id, created_by
) values (
  '10b40000-0000-4000-8000-000000000034',
  '10b40000-0000-4000-8000-000000000002',
  '10b40000-0000-4000-8000-000000000010',
  '10b40000-0000-4000-8000-000000000011', current_date, 'draft',
  '10b40000-0000-4000-8000-000000000020',
  '10b40000-0000-4000-8000-000000000003'
);
update public.showroom_sales set status = 'pending_payment'
where id = '10b40000-0000-4000-8000-000000000034';
insert into public.showroom_sale_lines (
  tenant_id, sale_id, product_product_id, description, quantity, unit_price, total
) values (
  '10b40000-0000-4000-8000-000000000002',
  '10b40000-0000-4000-8000-000000000034',
  '10b40000-0000-4000-8000-000000000032', 'Legacy compatibility line', 1, 1000, 1000
);

select set_config(
  'request.jwt.claim.sub', '10b40000-0000-4000-8000-000000000001', true
);
set local role authenticated;
do $$
declare result jsonb;
begin
  if (select financial_confirmation_generation from public.showroom_sales
      where id = '10b40000-0000-4000-8000-000000000034') <> 1 then
    raise exception 'PHASE2D_P_EXISTING_GENERATION_CHANGED';
  end if;
  result := public.complete_showroom_sale(
    '10b40000-0000-4000-8000-000000000034', 0, null, '[]'::jsonb
  );
  if result ->> 'financial_engine' <> 'legacy'
     or exists (
       select 1 from public.financial_sale_postings posting
       where posting.source_app = 'showroom' and posting.source_model = 'sale'
         and posting.source_id = '10b40000-0000-4000-8000-000000000034'
     ) then
    raise exception 'PHASE2D_P_LEGACY_COMPATIBILITY_INVALID';
  end if;
end
$$;

reset role;
do $$
begin
  if (select md5(string_agg(row_to_json(s)::text, '' order by s.id))
      from public.showroom_sales s
      where s.tenant_id = '4ee5f357-8cf5-4770-8772-64de99532dac')
       is distinct from (select historical_sales from phase2d_baseline) then
    raise exception 'PHASE2D_O_HISTORICAL_SALES_CHANGED';
  end if;
end
$$;

rollback;
