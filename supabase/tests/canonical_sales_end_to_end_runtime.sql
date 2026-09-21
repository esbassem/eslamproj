-- Final Hardening Phase 1: the canonical Sales happy path in one isolated,
-- rollback-only transaction. No pre-existing Sale, customer, product, stock,
-- payment, or destination record is mutated.
begin;

set local lock_timeout = '20s';

create temporary table canonical_sales_e2e_context as
select owner.tenant_id, owner.id owner_id, owner.auth_user_id owner_auth
from public.tenant_users owner
left join public.financial_period_locks period
  on period.tenant_id = owner.tenant_id
where owner.role = 'owner'
  and owner.is_active
  and owner.auth_user_id is not null
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
order by owner.tenant_id
limit 1;

do $$
begin
  if not exists (select 1 from canonical_sales_e2e_context) then
    raise exception 'CANONICAL_SALES_E2E_ISOLATED_TENANT_UNAVAILABLE';
  end if;
end
$$;

create temporary table canonical_sales_e2e_resources (
  branch_id uuid,
  location_id uuid,
  customer_id uuid,
  product_template_id uuid,
  product_id uuid,
  paid_serial_id uuid,
  unpaid_serial_id uuid,
  payment_method_id uuid,
  money_destination_id uuid,
  paid_sale_id uuid,
  paid_sale_line_id uuid,
  unpaid_sale_id uuid,
  unpaid_sale_line_id uuid
);

grant select on canonical_sales_e2e_context to authenticated;
grant select, update on canonical_sales_e2e_resources to authenticated;

do $$
declare
  context canonical_sales_e2e_context%rowtype;
  resources canonical_sales_e2e_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  receivable_account_id uuid;
  revenue_account_id uuid;
begin
  select * into context from canonical_sales_e2e_context;
  resources.branch_id := gen_random_uuid();
  resources.location_id := gen_random_uuid();
  resources.customer_id := gen_random_uuid();
  resources.product_template_id := gen_random_uuid();
  resources.product_id := gen_random_uuid();
  resources.paid_serial_id := gen_random_uuid();
  resources.unpaid_serial_id := gen_random_uuid();
  resources.payment_method_id := gen_random_uuid();

  receivable_account_id := public.resolve_functional_account(
    context.tenant_id, 'customer_receivable', null
  );
  revenue_account_id := public.resolve_functional_account(
    context.tenant_id, 'sales_revenue', null
  );

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (
    resources.branch_id, context.tenant_id,
    'Canonical Sales E2E Runtime', 'CSE' || left(suffix, 5), true
  );
  insert into public.account_functional_accounts (
    tenant_id, branch_id, functional_role, account_id
  ) values
    (context.tenant_id, resources.branch_id, 'customer_receivable', receivable_account_id),
    (context.tenant_id, resources.branch_id, 'sales_revenue', revenue_account_id);
  perform public.resolve_financial_journal(
    context.tenant_id, 'sale', resources.branch_id, null
  );

  insert into public.stock_locations (
    id, tenant_id, branch_id, code, name, location_type, is_active
  ) values (
    resources.location_id, context.tenant_id, resources.branch_id,
    'CSEL' || left(suffix, 4), 'Canonical Sales E2E Stock', 'internal', true
  );
  insert into public.partners (
    id, tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values (
    resources.customer_id, context.tenant_id, resources.branch_id,
    'Canonical Sales E2E Customer', 'person', false, true, 1, 0, 0, true
  );
  insert into public.product_templates (
    id, tenant_id, name, internal_reference, product_type, tracking,
    can_be_sold, is_active, sale_price
  ) values (
    resources.product_template_id, context.tenant_id,
    'Canonical Sales E2E Serial Product', 'CSEP-' || suffix,
    'goods', 'serial', true, true, 50000
  );
  insert into public.product_products (
    id, tenant_id, product_template_id, display_name, sku,
    tracking, is_active, sale_price
  ) values (
    resources.product_id, context.tenant_id, resources.product_template_id,
    'Canonical Sales E2E Serial Product', 'CSEP-' || suffix,
    'serial', true, 50000
  );
  update public.product_templates
  set default_product_product_id = resources.product_id
  where id = resources.product_template_id;
  insert into public.stock_tracking_units (
    id, tenant_id, product_product_id, product_template_id,
    tracking_type, tracking_number, status, data_status,
    incomplete_reason, current_location_id
  ) values
    (resources.paid_serial_id, context.tenant_id, resources.product_id,
      resources.product_template_id, 'serial', 'CSE-PAID-' || suffix,
      'in_stock', 'complete', null, resources.location_id),
    (resources.unpaid_serial_id, context.tenant_id, resources.product_id,
      resources.product_template_id, 'serial', 'CSE-UNPAID-' || suffix,
      'in_stock', 'complete', null, resources.location_id);

  insert into public.financial_payment_methods (
    id, tenant_id, name, semantic_key, method_type, settlement_mode,
    is_active, requires_reference, requires_confirmation, created_by
  ) values (
    resources.payment_method_id, context.tenant_id,
    'Canonical Sales E2E Cash', 'canonical_sales_e2e_' || suffix,
    'cash', 'direct', true, false, false, context.owner_id
  );

  insert into canonical_sales_e2e_resources values (resources.*);
end
$$;

select set_config('request.jwt.claim.sub', owner_auth::text, true)
from canonical_sales_e2e_context;

do $$
declare
  context canonical_sales_e2e_context%rowtype;
  resources canonical_sales_e2e_resources%rowtype;
  provisioned jsonb;
begin
  select * into context from canonical_sales_e2e_context;
  select * into resources from canonical_sales_e2e_resources;
  provisioned := public.create_and_provision_money_destination(
    context.tenant_id,
    'canonical_sales_e2e_' || left(replace(resources.branch_id::text, '-', ''), 10),
    'Canonical Sales E2E Cashbox', 'cashbox', resources.branch_id,
    null, null, null, null, null, '{}'::jsonb, true
  );
  update canonical_sales_e2e_resources
  set money_destination_id = (provisioned ->> 'destination_id')::uuid;
end
$$;

do $$
declare
  context canonical_sales_e2e_context%rowtype;
  resources canonical_sales_e2e_resources%rowtype;
  created jsonb;
  confirmed jsonb;
  confirm_replay jsonb;
  partial_payment jsonb;
  partial_replay jsonb;
  final_payment jsonb;
  final_replay jsonb;
  delivery jsonb;
  delivery_replay jsonb;
  settlement_options jsonb;
  paid_sale_id uuid;
  paid_line_id uuid;
  unpaid_sale_id uuid;
  unpaid_line_id uuid;
  reservation_id uuid;
  posting_id uuid;
  paid_move_count_before_delivery bigint;
  paid_payment_count_before_delivery bigint;
  paid_allocation_count_before_delivery bigint;
  rejected boolean := false;
begin
  select * into context from canonical_sales_e2e_context;
  select * into resources from canonical_sales_e2e_resources;

  created := public.create_sale(
    resources.branch_id, resources.customer_id, current_date,
    'EGP', 'Final Hardening paid happy path', 'cse2e-paid-create'
  );
  paid_sale_id := (created ->> 'sale_id')::uuid;
  perform public.update_sale_draft(
    paid_sale_id, 1, resources.branch_id, resources.customer_id,
    current_date, 'EGP', 'Final Hardening paid happy path',
    jsonb_build_array(jsonb_build_object(
      'product_id', resources.product_id, 'quantity', 1, 'unit_price', 50000
    )), 'cse2e-paid-update'
  );
  select id into paid_line_id from public.sale_lines
  where sale_id = paid_sale_id and tenant_id = context.tenant_id;
  confirmed := public.confirm_sale(
    paid_sale_id, 2,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', paid_line_id,
      'location_id', resources.location_id,
      'tracking_unit_id', resources.paid_serial_id,
      'quantity', 1
    )), 'cse2e-paid-confirm'
  );
  confirm_replay := public.confirm_sale(
    paid_sale_id, 2,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', paid_line_id,
      'location_id', resources.location_id,
      'tracking_unit_id', resources.paid_serial_id,
      'quantity', 1
    )), 'cse2e-paid-confirm'
  );

  select inventory_reservation_id, financial_sale_posting_id
  into reservation_id, posting_id
  from public.sale_confirmation_links
  where sale_id = paid_sale_id and tenant_id = context.tenant_id;

  if confirmed ->> 'status' <> 'confirmed'
     or (confirmed ->> 'version')::bigint <> 3
     or confirmed ->> 'sale_number' !~ '^SAL-[0-9]{4}-[0-9]{6,9}$'
     or not coalesce((confirm_replay ->> 'idempotent_replay')::boolean, false)
     or (select status from public.sales where id = paid_sale_id) <> 'confirmed'
     or (select state from public.inventory_reservations where id = reservation_id) <> 'active'
     or (select state from public.inventory_tracking_unit_states
         where tracking_unit_id = resources.paid_serial_id) <> 'reserved'
     or (select status from public.stock_tracking_units
         where id = resources.paid_serial_id) <> 'reserved'
     or (select state from public.financial_sale_postings where id = posting_id) <> 'posted'
     or (select amount_residual from public.account_move_lines receivable
         join public.financial_sale_postings posting
           on posting.receivable_line_id = receivable.id
         where posting.id = posting_id) <> 50000
     or exists (
       select 1 from public.account_moves move
       join public.account_move_lines line on line.move_id = move.id
       where move.id = (select account_move_id from public.financial_sale_postings where id = posting_id)
       group by move.id having round(sum(line.debit), 2) <> round(sum(line.credit), 2)
     )
     or (select count(*) from public.inventory_reservations
         where source_type = 'sale' and source_id = paid_sale_id::text) <> 1
     or (select count(*) from public.financial_sale_postings
         where source_app = 'sales_core' and source_id = paid_sale_id::text) <> 1
     or (select count(*)
         from public.inventory_reservation_lines reservation_line
         join public.inventory_reservations reservation
           on reservation.id = reservation_line.reservation_id
          and reservation.tenant_id = reservation_line.tenant_id
         where reservation_line.tracking_unit_id = resources.paid_serial_id
           and reservation.state in ('active', 'partially_delivered')
           and reservation_line.reserved_quantity
             > reservation_line.released_quantity + reservation_line.delivered_quantity) <> 1
     or exists (
       select 1
       from public.sale_confirmation_links confirmation
       join public.inventory_reservations reservation
         on reservation.id = confirmation.inventory_reservation_id
        and reservation.tenant_id = confirmation.tenant_id
       join public.financial_sale_postings posting
         on posting.id = confirmation.financial_sale_posting_id
        and posting.tenant_id = confirmation.tenant_id
       where confirmation.sale_id = paid_sale_id
         and (confirmation.tenant_id <> context.tenant_id
           or reservation.branch_id <> resources.branch_id
           or reservation.location_id <> resources.location_id
           or posting.branch_id <> resources.branch_id
           or posting.partner_id <> resources.customer_id)
     )
     or exists (select 1 from public.sale_deliveries where sale_id = paid_sale_id) then
    raise exception 'CANONICAL_SALES_E2E_CONFIRMATION_FAILED';
  end if;

  settlement_options := public.get_settlement_options('sale', paid_sale_id::text);
  if settlement_options ->> 'can_settle' <> 'true'
     or (settlement_options ->> 'outstanding_amount')::numeric <> 50000 then
    raise exception 'CANONICAL_SALES_E2E_SETTLEMENT_OPTIONS_FAILED: %', settlement_options;
  end if;

  partial_payment := public.settle_obligation(
    'sale', paid_sale_id::text, 'money_payment', 20000,
    resources.payment_method_id, 'cse2e-payment-partial',
    resources.money_destination_id, null, 'Final Hardening partial payment'
  );
  partial_replay := public.settle_obligation(
    'sale', paid_sale_id::text, 'money_payment', 20000,
    resources.payment_method_id, 'cse2e-payment-partial',
    resources.money_destination_id, null, 'Final Hardening partial payment'
  );
  if (partial_payment ->> 'outstanding_after')::numeric <> 30000
     or not coalesce((partial_replay ->> 'idempotent_replay')::boolean, false)
     or (public.get_settlement_options('sale', paid_sale_id::text)
         ->> 'outstanding_amount')::numeric <> 30000
     or (select state from public.inventory_tracking_unit_states
         where tracking_unit_id = resources.paid_serial_id) <> 'reserved'
     or (select state from public.inventory_reservations where id = reservation_id) <> 'active'
     or exists (select 1 from public.sale_deliveries where sale_id = paid_sale_id)
     or (select count(*) from public.financial_payments
         where source_app = 'settlement' and source_model = 'sale'
           and source_id = paid_sale_id::text) <> 1
     or (select count(*) from public.financial_payment_allocations allocation
         join public.financial_payments payment on payment.id = allocation.payment_id
         where payment.source_app = 'settlement' and payment.source_model = 'sale'
           and payment.source_id = paid_sale_id::text) <> 1 then
    raise exception 'CANONICAL_SALES_E2E_PARTIAL_PAYMENT_FAILED';
  end if;

  final_payment := public.settle_obligation(
    'sale', paid_sale_id::text, 'money_payment', 30000,
    resources.payment_method_id, 'cse2e-payment-final',
    resources.money_destination_id, null, 'Final Hardening final payment'
  );
  final_replay := public.settle_obligation(
    'sale', paid_sale_id::text, 'money_payment', 30000,
    resources.payment_method_id, 'cse2e-payment-final',
    resources.money_destination_id, null, 'Final Hardening final payment'
  );
  rejected := false;
  begin
    perform public.settle_obligation(
      'sale', paid_sale_id::text, 'money_payment', 1,
      resources.payment_method_id, 'cse2e-payment-over',
      resources.money_destination_id, null, 'Must reject after full settlement'
    );
  exception when check_violation then
    rejected := sqlerrm = 'OBLIGATION_ALREADY_SETTLED';
  end;
  if (final_payment ->> 'outstanding_after')::numeric <> 0
     or not coalesce((final_replay ->> 'idempotent_replay')::boolean, false)
     or not rejected
     or (select amount_residual from public.account_move_lines receivable
         join public.financial_sale_postings posting
           on posting.receivable_line_id = receivable.id
         where posting.id = posting_id) <> 0
     or (select count(*) from public.financial_payments
         where source_app = 'settlement' and source_model = 'sale'
           and source_id = paid_sale_id::text) <> 2
     or (select count(*) from public.financial_payment_allocations allocation
         join public.financial_payments payment on payment.id = allocation.payment_id
         where payment.source_app = 'settlement' and payment.source_model = 'sale'
           and payment.source_id = paid_sale_id::text) <> 2
     or (select count(*) from public.financial_payment_accounting_links link
         join public.financial_payments payment on payment.id = link.payment_id
         where payment.source_app = 'settlement' and payment.source_model = 'sale'
           and payment.source_id = paid_sale_id::text) <> 2
     or exists (
       select 1 from public.financial_payments payment
       where payment.source_app = 'settlement' and payment.source_model = 'sale'
         and payment.source_id = paid_sale_id::text
         and (payment.status <> 'confirmed' or payment.accounting_state <> 'posted')
     )
     or (select coalesce(sum(allocation.amount), 0)
         from public.financial_payment_allocations allocation
         join public.financial_payments payment on payment.id = allocation.payment_id
         where payment.source_app = 'settlement' and payment.source_model = 'sale'
           and payment.source_id = paid_sale_id::text) <> 50000
     or exists (
       select 1 from public.financial_payments payment
       where payment.source_app = 'settlement' and payment.source_model = 'sale'
         and payment.source_id = paid_sale_id::text
         and (payment.tenant_id <> context.tenant_id
           or payment.branch_id <> resources.branch_id
           or payment.partner_id <> resources.customer_id)
     )
     or exists (
       select 1
       from public.financial_payments payment
       join public.financial_payment_accounting_links link on link.payment_id = payment.id
       join public.account_move_lines line on line.move_id = link.account_move_id
       where payment.source_app = 'settlement' and payment.source_model = 'sale'
         and payment.source_id = paid_sale_id::text
       group by payment.id having round(sum(line.debit), 2) <> round(sum(line.credit), 2)
     )
     or exists (select 1 from public.sale_deliveries where sale_id = paid_sale_id)
     or (select state from public.inventory_tracking_unit_states
         where tracking_unit_id = resources.paid_serial_id) <> 'reserved' then
    raise exception 'CANONICAL_SALES_E2E_FINAL_PAYMENT_FAILED';
  end if;

  select count(*) into paid_move_count_before_delivery
  from public.financial_payment_accounting_links link
  join public.financial_payments payment on payment.id = link.payment_id
  where payment.source_app = 'settlement' and payment.source_model = 'sale'
    and payment.source_id = paid_sale_id::text;
  select count(*) into paid_payment_count_before_delivery
  from public.financial_payments
  where source_app = 'settlement' and source_model = 'sale'
    and source_id = paid_sale_id::text;
  select count(*) into paid_allocation_count_before_delivery
  from public.financial_payment_allocations allocation
  join public.financial_payments payment on payment.id = allocation.payment_id
  where payment.source_app = 'settlement' and payment.source_model = 'sale'
    and payment.source_id = paid_sale_id::text;

  delivery := public.deliver_sale(
    paid_sale_id, 3,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', paid_line_id,
      'tracking_unit_id', resources.paid_serial_id,
      'quantity', 1
    )), 'cse2e-paid-delivery'
  );
  delivery_replay := public.deliver_sale(
    paid_sale_id, 3,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', paid_line_id,
      'tracking_unit_id', resources.paid_serial_id,
      'quantity', 1
    )), 'cse2e-paid-delivery'
  );
  rejected := false;
  begin
    perform public.deliver_sale(
      paid_sale_id, 4,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', paid_line_id,
        'tracking_unit_id', resources.paid_serial_id,
        'quantity', 1
      )), 'cse2e-paid-delivery-duplicate'
    );
  exception when check_violation then
    rejected := true;
  end;
  if delivery ->> 'fulfillment_status' <> 'delivered'
     or not coalesce((delivery_replay ->> 'idempotent_replay')::boolean, false)
     or not rejected
     or (select count(*) from public.sale_deliveries where sale_id = paid_sale_id) <> 1
     or (select count(*) from public.inventory_deliveries inventory_delivery
         join public.sale_confirmation_links confirmation
           on confirmation.inventory_reservation_id = inventory_delivery.reservation_id
          and confirmation.tenant_id = inventory_delivery.tenant_id
         where confirmation.sale_id = paid_sale_id) <> 1
     or (select state from public.inventory_reservations where id = reservation_id) <> 'delivered'
     or (select state from public.inventory_tracking_unit_states
         where tracking_unit_id = resources.paid_serial_id) <> 'issued'
     or (select status from public.stock_tracking_units
         where id = resources.paid_serial_id) <> 'sold'
     or exists (
       select 1
       from public.inventory_deliveries inventory_delivery
       join public.sale_confirmation_links confirmation
         on confirmation.inventory_reservation_id = inventory_delivery.reservation_id
        and confirmation.tenant_id = inventory_delivery.tenant_id
       where confirmation.sale_id = paid_sale_id
         and (inventory_delivery.tenant_id <> context.tenant_id
           or inventory_delivery.branch_id <> resources.branch_id
           or inventory_delivery.source_location_id <> resources.location_id)
     )
     or exists (
       select 1
       from public.inventory_reservation_lines reservation_line
       join public.inventory_reservations reservation
         on reservation.id = reservation_line.reservation_id
        and reservation.tenant_id = reservation_line.tenant_id
       where reservation_line.tracking_unit_id = resources.paid_serial_id
         and reservation.state in ('active', 'partially_delivered')
         and reservation_line.reserved_quantity
           > reservation_line.released_quantity + reservation_line.delivered_quantity
     )
     or (select count(*) from public.financial_payments
         where source_app = 'settlement' and source_model = 'sale'
           and source_id = paid_sale_id::text) <> paid_payment_count_before_delivery
     or (select count(*) from public.financial_payment_accounting_links link
         join public.financial_payments payment on payment.id = link.payment_id
         where payment.source_app = 'settlement' and payment.source_model = 'sale'
           and payment.source_id = paid_sale_id::text) <> paid_move_count_before_delivery
     or (select count(*) from public.financial_payment_allocations allocation
         join public.financial_payments payment on payment.id = allocation.payment_id
         where payment.source_app = 'settlement' and payment.source_model = 'sale'
           and payment.source_id = paid_sale_id::text) <> paid_allocation_count_before_delivery
     or (select amount_residual from public.account_move_lines receivable
         join public.financial_sale_postings posting
           on posting.receivable_line_id = receivable.id
         where posting.id = posting_id) <> 0 then
    raise exception 'CANONICAL_SALES_E2E_DELIVERY_FAILED';
  end if;

  created := public.create_sale(
    resources.branch_id, resources.customer_id, current_date,
    'EGP', 'Final Hardening confirmed unpaid', 'cse2e-unpaid-create'
  );
  unpaid_sale_id := (created ->> 'sale_id')::uuid;
  perform public.update_sale_draft(
    unpaid_sale_id, 1, resources.branch_id, resources.customer_id,
    current_date, 'EGP', 'Final Hardening confirmed unpaid',
    jsonb_build_array(jsonb_build_object(
      'product_id', resources.product_id, 'quantity', 1, 'unit_price', 50000
    )), 'cse2e-unpaid-update'
  );
  select id into unpaid_line_id from public.sale_lines
  where sale_id = unpaid_sale_id and tenant_id = context.tenant_id;
  confirmed := public.confirm_sale(
    unpaid_sale_id, 2,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', unpaid_line_id,
      'location_id', resources.location_id,
      'tracking_unit_id', resources.unpaid_serial_id,
      'quantity', 1
    )), 'cse2e-unpaid-confirm'
  );
  select inventory_reservation_id, financial_sale_posting_id
  into reservation_id, posting_id
  from public.sale_confirmation_links
  where sale_id = unpaid_sale_id and tenant_id = context.tenant_id;
  if confirmed ->> 'status' <> 'confirmed'
     or confirmed ->> 'sale_number' is null
     or (select state from public.inventory_reservations where id = reservation_id) <> 'active'
     or (select state from public.inventory_tracking_unit_states
         where tracking_unit_id = resources.unpaid_serial_id) <> 'reserved'
     or (select amount_residual from public.account_move_lines receivable
         join public.financial_sale_postings posting
           on posting.receivable_line_id = receivable.id
         where posting.id = posting_id) <> 50000
     or exists (select 1 from public.sale_deliveries where sale_id = unpaid_sale_id)
     or exists (
       select 1 from public.financial_payments
       where source_app = 'settlement' and source_model = 'sale'
         and source_id = unpaid_sale_id::text
     )
     or exists (
       select 1
       from public.inventory_reservation_lines line
       join public.inventory_reservations reservation
         on reservation.id = line.reservation_id and reservation.tenant_id = line.tenant_id
       where line.tracking_unit_id = resources.unpaid_serial_id
         and reservation.tenant_id <> context.tenant_id
     ) then
    raise exception 'CANONICAL_SALES_E2E_CONFIRMED_UNPAID_FAILED';
  end if;

end
$$;

rollback;

select jsonb_build_object(
  'status', 'passed',
  'transaction', 'rolled_back',
  'paid_sale', '50000 -> 30000 -> 0 -> delivered',
  'unpaid_sale', '50000 residual -> reserved -> not delivered',
  'idempotency', 'confirm/payment/delivery replayed without duplication'
) as canonical_sales_end_to_end_runtime;
