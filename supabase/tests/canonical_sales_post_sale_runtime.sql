-- Final Hardening Phase 2: Cancel -> Return -> Refund -> Exchange.
-- Every fixture and side effect is isolated inside this transaction and rolled back.
begin;

set local lock_timeout = '20s';

create temporary table canonical_post_sale_context as
select owner.tenant_id, owner.id owner_id, owner.auth_user_id owner_auth
from public.tenant_users owner
left join public.financial_period_locks period on period.tenant_id = owner.tenant_id
where owner.role = 'owner' and owner.is_active and owner.auth_user_id is not null
  and not coalesce(period.active, false)
  and exists (
    select 1 from public.account_functional_accounts configuration
    where configuration.tenant_id = owner.tenant_id
      and configuration.functional_role = 'customer_receivable'
      and configuration.is_active
  )
  and exists (
    select 1 from public.account_functional_accounts configuration
    where configuration.tenant_id = owner.tenant_id
      and configuration.functional_role = 'sales_revenue'
      and configuration.is_active
  )
order by owner.tenant_id limit 1;

do $$ begin
  if not exists (select 1 from canonical_post_sale_context) then
    raise exception 'CANONICAL_POST_SALE_ISOLATED_TENANT_UNAVAILABLE';
  end if;
end $$;

create temporary table canonical_post_sale_resources (
  branch_id uuid,
  location_id uuid,
  customer_id uuid,
  product_template_id uuid,
  product_id uuid,
  cancel_serial_id uuid,
  settled_cancel_serial_id uuid,
  delivered_cancel_serial_id uuid,
  return_serial_id uuid,
  exchange_original_serial_id uuid,
  exchange_replacement_serial_id uuid,
  payment_method_id uuid,
  money_destination_id uuid
);
grant select on canonical_post_sale_context to authenticated;
grant select, update on canonical_post_sale_resources to authenticated;

do $$
declare
  context canonical_post_sale_context%rowtype;
  resources canonical_post_sale_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  receivable_account_id uuid;
  revenue_account_id uuid;
begin
  select * into context from canonical_post_sale_context;
  resources.branch_id := gen_random_uuid();
  resources.location_id := gen_random_uuid();
  resources.customer_id := gen_random_uuid();
  resources.product_template_id := gen_random_uuid();
  resources.product_id := gen_random_uuid();
  resources.cancel_serial_id := gen_random_uuid();
  resources.settled_cancel_serial_id := gen_random_uuid();
  resources.delivered_cancel_serial_id := gen_random_uuid();
  resources.return_serial_id := gen_random_uuid();
  resources.exchange_original_serial_id := gen_random_uuid();
  resources.exchange_replacement_serial_id := gen_random_uuid();
  resources.payment_method_id := gen_random_uuid();

  receivable_account_id := public.resolve_functional_account(
    context.tenant_id, 'customer_receivable', null
  );
  revenue_account_id := public.resolve_functional_account(
    context.tenant_id, 'sales_revenue', null
  );
  insert into public.branches (id, tenant_id, name, code, is_active)
  values (resources.branch_id, context.tenant_id,
    'Canonical Post Sale Runtime', 'CPS' || left(suffix, 5), true);
  insert into public.account_functional_accounts (
    tenant_id, branch_id, functional_role, account_id
  ) values
    (context.tenant_id, resources.branch_id, 'customer_receivable', receivable_account_id),
    (context.tenant_id, resources.branch_id, 'sales_revenue', revenue_account_id);
  perform public.resolve_financial_journal(context.tenant_id, 'sale', resources.branch_id, null);

  insert into public.stock_locations (
    id, tenant_id, branch_id, code, name, location_type, is_active
  ) values (resources.location_id, context.tenant_id, resources.branch_id,
    'CPSL' || left(suffix, 4), 'Canonical Post Sale Stock', 'internal', true);
  insert into public.partners (
    id, tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values (resources.customer_id, context.tenant_id, resources.branch_id,
    'Canonical Post Sale Customer', 'person', false, true, 1, 0, 0, true);
  insert into public.product_templates (
    id, tenant_id, name, internal_reference, product_type, tracking,
    can_be_sold, is_active, sale_price
  ) values (resources.product_template_id, context.tenant_id,
    'Canonical Post Sale Serial Product', 'CPSP-' || suffix,
    'goods', 'serial', true, true, 50000);
  insert into public.product_products (
    id, tenant_id, product_template_id, display_name, sku,
    tracking, is_active, sale_price
  ) values (resources.product_id, context.tenant_id, resources.product_template_id,
    'Canonical Post Sale Serial Product', 'CPSP-' || suffix,
    'serial', true, 50000);
  update public.product_templates set default_product_product_id = resources.product_id
  where id = resources.product_template_id;

  insert into public.stock_tracking_units (
    id, tenant_id, product_product_id, product_template_id,
    tracking_type, tracking_number, status, data_status,
    incomplete_reason, current_location_id
  ) values
    (resources.cancel_serial_id, context.tenant_id, resources.product_id,
      resources.product_template_id, 'serial', 'CPS-CANCEL-' || suffix,
      'in_stock', 'complete', null, resources.location_id),
    (resources.settled_cancel_serial_id, context.tenant_id, resources.product_id,
      resources.product_template_id, 'serial', 'CPS-SETTLED-' || suffix,
      'in_stock', 'complete', null, resources.location_id),
    (resources.delivered_cancel_serial_id, context.tenant_id, resources.product_id,
      resources.product_template_id, 'serial', 'CPS-DELIVERED-' || suffix,
      'in_stock', 'complete', null, resources.location_id),
    (resources.return_serial_id, context.tenant_id, resources.product_id,
      resources.product_template_id, 'serial', 'CPS-RETURN-' || suffix,
      'in_stock', 'complete', null, resources.location_id),
    (resources.exchange_original_serial_id, context.tenant_id, resources.product_id,
      resources.product_template_id, 'serial', 'CPS-EXCHANGE-A-' || suffix,
      'in_stock', 'complete', null, resources.location_id),
    (resources.exchange_replacement_serial_id, context.tenant_id, resources.product_id,
      resources.product_template_id, 'serial', 'CPS-EXCHANGE-B-' || suffix,
      'in_stock', 'complete', null, resources.location_id);

  insert into public.financial_payment_methods (
    id, tenant_id, name, semantic_key, method_type, settlement_mode,
    is_active, requires_reference, requires_confirmation, created_by
  ) values (resources.payment_method_id, context.tenant_id,
    'Canonical Post Sale Cash', 'canonical_post_sale_' || suffix,
    'cash', 'direct', true, false, false, context.owner_id);
  insert into canonical_post_sale_resources values (resources.*);
end $$;

select set_config('request.jwt.claim.sub', owner_auth::text, true)
from canonical_post_sale_context;

do $$
declare
  context canonical_post_sale_context%rowtype;
  resources canonical_post_sale_resources%rowtype;
  provisioned jsonb;
begin
  select * into context from canonical_post_sale_context;
  select * into resources from canonical_post_sale_resources;
  provisioned := public.create_and_provision_money_destination(
    context.tenant_id,
    'canonical_post_sale_' || left(replace(resources.branch_id::text, '-', ''), 10),
    'Canonical Post Sale Cashbox', 'cashbox', resources.branch_id,
    null, null, null, null, null, '{}'::jsonb, true
  );
  update canonical_post_sale_resources
  set money_destination_id = (provisioned ->> 'destination_id')::uuid;
end $$;

create function pg_temp.make_confirmed_serial_sale(
  p_key text,
  p_tracking_unit_id uuid,
  p_amount numeric default 50000
)
returns table(sale_id uuid, sale_line_id uuid, posting_id uuid, reservation_id uuid)
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  resources canonical_post_sale_resources%rowtype;
  created jsonb;
begin
  select * into resources from canonical_post_sale_resources;
  created := public.create_sale(
    resources.branch_id, resources.customer_id, current_date,
    'EGP', p_key, p_key || ':create'
  );
  sale_id := (created ->> 'sale_id')::uuid;
  perform public.update_sale_draft(
    sale_id, 1, resources.branch_id, resources.customer_id,
    current_date, 'EGP', p_key,
    jsonb_build_array(jsonb_build_object(
      'product_id', resources.product_id, 'quantity', 1, 'unit_price', p_amount
    )), p_key || ':update'
  );
  select line.id into sale_line_id from public.sale_lines line
  where line.sale_id = make_confirmed_serial_sale.sale_id;
  perform public.confirm_sale(
    sale_id, 2,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', sale_line_id,
      'location_id', resources.location_id,
      'tracking_unit_id', p_tracking_unit_id,
      'quantity', 1
    )), p_key || ':confirm'
  );
  select confirmation.financial_sale_posting_id,
    confirmation.inventory_reservation_id
  into posting_id, reservation_id
  from public.sale_confirmation_links confirmation
  where confirmation.sale_id = make_confirmed_serial_sale.sale_id;
  return next;
end $$;

create function pg_temp.settle_sale(p_sale_id uuid, p_amount numeric, p_key text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare resources canonical_post_sale_resources%rowtype;
begin
  select * into resources from canonical_post_sale_resources;
  return public.settle_obligation(
    'sale', p_sale_id::text, 'money_payment', p_amount,
    resources.payment_method_id, p_key, resources.money_destination_id,
    null, p_key
  );
end $$;

create function pg_temp.deliver_serial_sale(
  p_sale_id uuid, p_sale_line_id uuid, p_tracking_unit_id uuid,
  p_expected_version bigint, p_key text
)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  return public.deliver_sale(
    p_sale_id, p_expected_version,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', p_sale_line_id,
      'tracking_unit_id', p_tracking_unit_id,
      'quantity', 1
    )), p_key
  );
end $$;

-- Unpaid, undelivered cancellation and exact retry.
do $$
declare
  context canonical_post_sale_context%rowtype;
  resources canonical_post_sale_resources%rowtype;
  sale record;
  result jsonb;
  replay jsonb;
  created_reversal_id uuid;
  created_reversal_move_id uuid;
begin
  select * into context from canonical_post_sale_context;
  select * into resources from canonical_post_sale_resources;
  select * into sale from pg_temp.make_confirmed_serial_sale(
    'cps-cancel', resources.cancel_serial_id
  );
  result := public.cancel_sale(sale.sale_id, 3, 'Runtime cancellation', 'cps-cancel:command');
  replay := public.cancel_sale(sale.sale_id, 3, 'Runtime cancellation', 'cps-cancel:command');
  select reversal.id into created_reversal_id
  from public.financial_accounting_reversals reversal
  where reversal.domain_type = 'sale_posting' and reversal.domain_id = sale.posting_id;
  select link.reversal_move_id into created_reversal_move_id
  from public.financial_accounting_reversal_move_links link
  where link.reversal_id = created_reversal_id and link.stage = 'sale_posting';
  if result ->> 'status' <> 'cancelled'
     or not coalesce((replay ->> 'idempotent_replay')::boolean, false)
     or (select status from public.sales where id = sale.sale_id) <> 'cancelled'
     or (select state from public.inventory_reservations where id = sale.reservation_id) <> 'released'
     or (select state from public.inventory_tracking_unit_states
         where tracking_unit_id = resources.cancel_serial_id) <> 'available'
     or (select status from public.stock_tracking_units
         where id = resources.cancel_serial_id) <> 'in_stock'
     or (select amount_residual from public.account_move_lines receivable
         join public.financial_sale_postings posting on posting.receivable_line_id = receivable.id
         where posting.id = sale.posting_id) <> 0
     or (select count(*) from public.financial_sale_postings where id = sale.posting_id) <> 1
     or (select state from public.financial_sale_postings where id = sale.posting_id) <> 'posted'
     or created_reversal_id is null or created_reversal_move_id is null
     or exists (
       select 1 from public.account_move_lines line
       where line.move_id = created_reversal_move_id
       group by line.move_id having round(sum(line.debit), 2) <> round(sum(line.credit), 2)
     )
     or (select count(*) from public.financial_accounting_reversals
         where domain_type = 'sale_posting' and domain_id = sale.posting_id) <> 1
     or (select count(*) from public.sale_events
         where sale_id = sale.sale_id and event_type = 'sale_cancelled') <> 1 then
    raise exception 'CANONICAL_CANCEL_RUNTIME_FAILED';
  end if;
end $$;

-- Cancellation must reject an already-settled Sale.
do $$
declare
  resources canonical_post_sale_resources%rowtype;
  sale record;
  rejected boolean := false;
begin
  select * into resources from canonical_post_sale_resources;
  select * into sale from pg_temp.make_confirmed_serial_sale(
    'cps-cancel-settled', resources.settled_cancel_serial_id
  );
  perform pg_temp.settle_sale(sale.sale_id, 1000, 'cps-cancel-settled:payment');
  begin
    perform public.cancel_sale(
      sale.sale_id, 3, 'Must reject settled Sale', 'cps-cancel-settled:cancel'
    );
  exception when check_violation then
    rejected := sqlerrm = 'SALE_CANCELLATION_HAS_SETTLEMENT';
  end;
  if not rejected
     or (select status from public.sales where id = sale.sale_id) <> 'confirmed'
     or (select state from public.inventory_reservations where id = sale.reservation_id) <> 'active'
     or exists (select 1 from public.financial_accounting_reversals
       where domain_type = 'sale_posting' and domain_id = sale.posting_id) then
    raise exception 'SETTLED_SALE_CANCELLATION_WAS_NOT_REJECTED';
  end if;
end $$;

-- Cancellation must reject a delivered Sale.
do $$
declare
  resources canonical_post_sale_resources%rowtype;
  sale record;
  rejected boolean := false;
begin
  select * into resources from canonical_post_sale_resources;
  select * into sale from pg_temp.make_confirmed_serial_sale(
    'cps-cancel-delivered', resources.delivered_cancel_serial_id
  );
  perform pg_temp.deliver_serial_sale(
    sale.sale_id, sale.sale_line_id, resources.delivered_cancel_serial_id,
    3, 'cps-cancel-delivered:delivery'
  );
  begin
    perform public.cancel_sale(
      sale.sale_id, 4, 'Must reject delivered Sale', 'cps-cancel-delivered:cancel'
    );
  exception when check_violation then
    rejected := sqlerrm = 'SALE_CANCELLATION_HAS_DELIVERY';
  end;
  if not rejected
     or (select status from public.sales where id = sale.sale_id) <> 'confirmed'
     or (select count(*) from public.sale_deliveries where sale_id = sale.sale_id) <> 1
     or exists (select 1 from public.financial_accounting_reversals
       where domain_type = 'sale_posting' and domain_id = sale.posting_id) then
    raise exception 'DELIVERED_SALE_CANCELLATION_WAS_NOT_REJECTED';
  end if;
end $$;

-- Paid, delivered Return followed by canonical Refund.
do $$
declare
  context canonical_post_sale_context%rowtype;
  resources canonical_post_sale_resources%rowtype;
  sale record;
  return_result jsonb;
  return_replay jsonb;
  refund_result jsonb;
  refund_replay jsonb;
  return_id uuid;
  return_posting public.financial_sale_return_postings%rowtype;
  created_refund_id uuid;
  refund_move_id uuid;
  original_sale_number text;
  rejected boolean := false;
begin
  select * into context from canonical_post_sale_context;
  select * into resources from canonical_post_sale_resources;
  select * into sale from pg_temp.make_confirmed_serial_sale(
    'cps-return-refund', resources.return_serial_id
  );
  select sale_number into original_sale_number from public.sales where id = sale.sale_id;
  perform pg_temp.settle_sale(sale.sale_id, 50000, 'cps-return-refund:payment');
  perform pg_temp.deliver_serial_sale(
    sale.sale_id, sale.sale_line_id, resources.return_serial_id,
    3, 'cps-return-refund:delivery'
  );
  return_result := public.return_sale(
    sale.sale_id, 4,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', sale.sale_line_id,
      'tracking_unit_id', resources.return_serial_id,
      'quantity', 1
    )), resources.location_id, 'Runtime paid Return', 'cps-return-refund:return'
  );
  return_replay := public.return_sale(
    sale.sale_id, 4,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', sale.sale_line_id,
      'tracking_unit_id', resources.return_serial_id,
      'quantity', 1
    )), resources.location_id, 'Runtime paid Return', 'cps-return-refund:return'
  );
  return_id := (return_result ->> 'return_id')::uuid;
  select * into return_posting from public.financial_sale_return_postings
  where sale_return_id = return_id;
  if (return_result ->> 'amount')::numeric <> 50000
     or (return_result ->> 'ar_applied_amount')::numeric <> 0
     or (return_result ->> 'refundable_amount')::numeric <> 50000
     or not coalesce((return_replay ->> 'idempotent_replay')::boolean, false)
     or (select status from public.sales where id = sale.sale_id) <> 'confirmed'
     or (select sale_number from public.sales where id = sale.sale_id) <> original_sale_number
     or (select status from public.sale_returns where id = return_id) <> 'completed'
     or (select state from public.inventory_tracking_unit_states
         where tracking_unit_id = resources.return_serial_id) <> 'available'
     or (select status from public.stock_tracking_units
         where id = resources.return_serial_id) <> 'in_stock'
     or (select amount_residual from public.account_move_lines
         where id = return_posting.customer_credit_line_id) <> 50000
     or (select count(*) from public.sale_returns where sale_id = sale.sale_id) <> 1
     or (select count(*) from public.sale_return_inventory_links
         where sale_return_id = return_id) <> 1
     or (select count(*) from public.financial_sale_return_postings
         where sale_return_id = return_id) <> 1
     or (select count(*) from public.sale_deliveries where sale_id = sale.sale_id) <> 1
     or (select count(*) from public.financial_sale_postings where id = sale.posting_id) <> 1
     or exists (
       select 1 from public.account_move_lines line
       where line.move_id = return_posting.account_move_id
       group by line.move_id having round(sum(line.debit), 2) <> round(sum(line.credit), 2)
     ) then
    raise exception 'CANONICAL_RETURN_RUNTIME_FAILED';
  end if;

  begin
    perform public.return_sale(
      sale.sale_id, 5,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', sale.sale_line_id,
        'tracking_unit_id', resources.return_serial_id,
        'quantity', 1
      )), resources.location_id, 'Must reject duplicate Return',
      'cps-return-refund:return-duplicate'
    );
  exception when check_violation then
    rejected := sqlerrm = 'SALE_RETURN_SERIAL_NOT_RETURNABLE';
  end;
  if not rejected then raise exception 'DUPLICATE_SERIAL_RETURN_WAS_NOT_REJECTED'; end if;

  refund_result := public.refund_sale_return(
    return_id, 50000, resources.payment_method_id, resources.money_destination_id,
    'Runtime customer refund', null, 'Final Hardening Refund',
    'cps-return-refund:refund'
  );
  refund_replay := public.refund_sale_return(
    return_id, 50000, resources.payment_method_id, resources.money_destination_id,
    'Runtime customer refund', null, 'Final Hardening Refund',
    'cps-return-refund:refund'
  );
  select financial_refund_id into created_refund_id from public.sale_refund_commands
  where sale_return_id = return_id and idempotency_key = 'cps-return-refund:refund';
  select account_move_id into refund_move_id from public.financial_refund_accounting_links
  where refund_id = created_refund_id and entry_type = 'posting';
  rejected := false;
  begin
    perform public.refund_sale_return(
      return_id, 1, resources.payment_method_id, resources.money_destination_id,
      'Must reject exhausted credit', null, null, 'cps-return-refund:refund-over'
    );
  exception when check_violation then
    rejected := sqlerrm = 'SALES_REFUND_EXCEEDS_REFUNDABLE';
  end;
  if refund_result ->> 'status' <> 'posted'
     or not coalesce((refund_replay ->> 'idempotent_replay')::boolean, false)
     or not rejected
     or created_refund_id is null or refund_move_id is null
     or (select status from public.financial_refunds where id = created_refund_id) <> 'confirmed'
     or (select accounting_state from public.financial_refunds where id = created_refund_id) <> 'posted'
     or (select direction from public.financial_refunds where id = created_refund_id) <> 'outbound'
     or (select money_destination_id from public.financial_refunds where id = created_refund_id)
       <> resources.money_destination_id
     or (select payment_method_id from public.financial_refunds where id = created_refund_id)
       <> resources.payment_method_id
     or (select amount_residual from public.account_move_lines
         where id = return_posting.customer_credit_line_id) <> 0
     or (select count(*) from public.financial_refunds where id = created_refund_id) <> 1
     or (select count(*) from public.financial_refund_accounting_links
         where refund_id = created_refund_id and entry_type = 'posting') <> 1
     or (select count(*) from public.sale_events
         where sale_id = sale.sale_id and event_type = 'customer_refund_created') <> 1
     or (select status from public.sale_returns where id = return_id) <> 'completed'
     or (select status from public.sales where id = sale.sale_id) <> 'confirmed'
     or (select sale_number from public.sales where id = sale.sale_id) <> original_sale_number
     or exists (
       select 1 from public.account_move_lines line
       where line.move_id = refund_move_id
       group by line.move_id having round(sum(line.debit), 2) <> round(sum(line.credit), 2)
     ) then
    raise exception 'CANONICAL_REFUND_RUNTIME_FAILED';
  end if;
end $$;

-- Exchange is Return + ordinary Replacement Draft. Confirmation stays normal.
do $$
declare
  context canonical_post_sale_context%rowtype;
  resources canonical_post_sale_resources%rowtype;
  original record;
  exchange_result jsonb;
  exchange_replay jsonb;
  created_exchange_id uuid;
  created_return_id uuid;
  created_replacement_sale_id uuid;
  replacement_line_id uuid;
  replacement_posting_id uuid;
  replacement_reservation_id uuid;
  credit_line_id uuid;
  original_sale_number text;
begin
  select * into context from canonical_post_sale_context;
  select * into resources from canonical_post_sale_resources;
  select * into original from pg_temp.make_confirmed_serial_sale(
    'cps-exchange', resources.exchange_original_serial_id
  );
  select sale_number into original_sale_number from public.sales where id = original.sale_id;
  perform pg_temp.settle_sale(original.sale_id, 50000, 'cps-exchange:payment');
  perform pg_temp.deliver_serial_sale(
    original.sale_id, original.sale_line_id, resources.exchange_original_serial_id,
    3, 'cps-exchange:delivery'
  );
  exchange_result := public.start_sale_exchange(
    original.sale_id, 4,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', original.sale_line_id,
      'tracking_unit_id', resources.exchange_original_serial_id,
      'quantity', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'product_id', resources.product_id,
      'description', 'Canonical replacement product',
      'quantity', 1, 'unit_price', 60000,
      'tracking_unit_id', resources.exchange_replacement_serial_id
    )),
    resources.location_id, resources.location_id,
    'Runtime Exchange', 'cps-exchange:command'
  );
  exchange_replay := public.start_sale_exchange(
    original.sale_id, 4,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', original.sale_line_id,
      'tracking_unit_id', resources.exchange_original_serial_id,
      'quantity', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'product_id', resources.product_id,
      'description', 'Canonical replacement product',
      'quantity', 1, 'unit_price', 60000,
      'tracking_unit_id', resources.exchange_replacement_serial_id
    )),
    resources.location_id, resources.location_id,
    'Runtime Exchange', 'cps-exchange:command'
  );
  created_exchange_id := (exchange_result ->> 'exchange_id')::uuid;
  created_return_id := (exchange_result ->> 'return_id')::uuid;
  created_replacement_sale_id := (exchange_result ->> 'replacement_sale_id')::uuid;
  select id into replacement_line_id from public.sale_lines
  where sale_id = created_replacement_sale_id;
  select posting.customer_credit_line_id into credit_line_id
  from public.financial_sale_return_postings posting
  where posting.sale_return_id = created_return_id;

  if exchange_result ->> 'status' <> 'replacement_draft'
     or not coalesce((exchange_replay ->> 'idempotent_replay')::boolean, false)
     or (select count(*) from public.sale_exchanges where id = created_exchange_id) <> 1
     or (select count(*) from public.sale_returns where id = created_return_id) <> 1
     or (select count(*) from public.sales where id = created_replacement_sale_id) <> 1
     or (select original_sale_id from public.sale_exchanges where id = created_exchange_id)
       <> original.sale_id
     or (select sale_return_id from public.sale_exchanges where id = created_exchange_id) <> created_return_id
     or (select replacement_sale_id from public.sale_exchanges where id = created_exchange_id)
       <> created_replacement_sale_id
     or (select status from public.sales where id = created_replacement_sale_id) <> 'draft'
     or (select version from public.sales where id = created_replacement_sale_id) <> 2
     or (select sale_number from public.sales where id = created_replacement_sale_id) is not null
     or (select total_amount from public.sales where id = created_replacement_sale_id) <> 60000
     or exists (select 1 from public.sale_confirmation_links
       where sale_id = created_replacement_sale_id)
     or exists (select 1 from public.inventory_reservations
       where source_type = 'sale' and source_id = created_replacement_sale_id::text)
     or exists (select 1 from public.financial_sale_postings
       where source_app = 'sales_core' and source_id = created_replacement_sale_id::text)
     or exists (select 1 from public.financial_payments
       where source_model = 'sale' and source_id = created_replacement_sale_id::text)
     or exists (select 1 from public.financial_refunds
       where source_model = 'sale' and source_id = created_replacement_sale_id)
     or (select amount_residual from public.account_move_lines where id = credit_line_id) <> 50000
     or (select state from public.inventory_tracking_unit_states
         where tracking_unit_id = resources.exchange_original_serial_id) <> 'available'
     or exists (select 1 from public.inventory_tracking_unit_states
       where tracking_unit_id = resources.exchange_replacement_serial_id)
     or (select status from public.sales where id = original.sale_id) <> 'confirmed'
     or (select sale_number from public.sales where id = original.sale_id) <> original_sale_number
     or (select count(*) from public.sale_events
         where sale_id = original.sale_id and event_type = 'sale_exchange_started') <> 1 then
    raise exception 'CANONICAL_EXCHANGE_DRAFT_RUNTIME_FAILED';
  end if;

  perform public.confirm_sale(
    created_replacement_sale_id, 2,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', replacement_line_id,
      'location_id', resources.location_id,
      'tracking_unit_id', resources.exchange_replacement_serial_id,
      'quantity', 1
    )), 'cps-exchange:replacement-confirm'
  );
  select financial_sale_posting_id, inventory_reservation_id
  into replacement_posting_id, replacement_reservation_id
  from public.sale_confirmation_links where sale_id = created_replacement_sale_id;
  if (select status from public.sales where id = created_replacement_sale_id) <> 'confirmed'
     or (select sale_number from public.sales where id = created_replacement_sale_id) is null
     or replacement_posting_id = original.posting_id
     or (select amount_residual from public.account_move_lines receivable
         join public.financial_sale_postings posting on posting.receivable_line_id = receivable.id
         where posting.id = replacement_posting_id) <> 60000
     or (select state from public.inventory_reservations
         where id = replacement_reservation_id) <> 'active'
     or (select state from public.inventory_tracking_unit_states
         where tracking_unit_id = resources.exchange_replacement_serial_id) <> 'reserved'
     or exists (select 1 from public.sale_deliveries where sale_id = created_replacement_sale_id)
     or exists (select 1 from public.financial_payments
       where source_model = 'sale' and source_id = created_replacement_sale_id::text)
     or (select amount_residual from public.account_move_lines where id = credit_line_id) <> 50000
     or exists (
       select 1 from public.account_move_lines line
       join public.financial_sale_postings posting on posting.account_move_id = line.move_id
       where posting.id = replacement_posting_id
       group by line.move_id having round(sum(line.debit), 2) <> round(sum(line.credit), 2)
     ) then
    raise exception 'CANONICAL_EXCHANGE_CONFIRM_RUNTIME_FAILED';
  end if;
end $$;

rollback;

select jsonb_build_object(
  'status', 'passed',
  'transaction', 'rolled_back',
  'cancel', 'reversed and released; settled/delivered rejected',
  'return_refund', 'returned, credited, refunded without duplication',
  'exchange', 'return + draft; normal confirm; delivery remains separate'
) as canonical_post_sale_runtime;
