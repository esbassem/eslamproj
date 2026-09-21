-- Phase 7A rollback-only runtime: cancellation, settlement block and delivery block.
begin;

create temporary table sale_cancellation_context as
select owner.tenant_id, owner.id owner_id, owner.auth_user_id owner_auth,
  method.id payment_method_id
from public.tenant_users owner
join lateral (
  select candidate.id from public.financial_payment_methods candidate
  where candidate.tenant_id = owner.tenant_id and candidate.is_active
  order by candidate.created_at, candidate.id limit 1
) method on true
where owner.role = 'owner' and owner.is_active and owner.auth_user_id is not null
  and exists (select 1 from public.account_functional_accounts configuration
    where configuration.tenant_id = owner.tenant_id
      and configuration.functional_role = 'customer_receivable' and configuration.is_active)
  and exists (select 1 from public.account_functional_accounts configuration
    where configuration.tenant_id = owner.tenant_id
      and configuration.functional_role = 'sales_revenue' and configuration.is_active)
order by owner.tenant_id limit 1;

do $$ begin
  if not exists (select 1 from sale_cancellation_context) then
    raise exception 'SALE_CANCELLATION_RUNTIME_FIXTURE_UNAVAILABLE';
  end if;
end $$;

create temporary table sale_cancellation_resources (
  branch_id uuid, location_id uuid, customer_id uuid,
  template_id uuid, product_id uuid,
  cancellable_sale_id uuid, settled_sale_id uuid, delivered_sale_id uuid
);
grant select on sale_cancellation_context to authenticated;
grant select, update on sale_cancellation_resources to authenticated;

do $$
declare
  context sale_cancellation_context%rowtype;
  resources sale_cancellation_resources%rowtype;
  suffix text := left(replace(gen_random_uuid()::text, '-', ''), 10);
  receivable_account_id uuid;
  revenue_account_id uuid;
begin
  select * into context from sale_cancellation_context;
  resources.branch_id := gen_random_uuid();
  resources.location_id := gen_random_uuid();
  resources.customer_id := gen_random_uuid();
  resources.template_id := gen_random_uuid();
  resources.product_id := gen_random_uuid();
  receivable_account_id := public.resolve_functional_account(context.tenant_id, 'customer_receivable', null);
  revenue_account_id := public.resolve_functional_account(context.tenant_id, 'sales_revenue', null);

  insert into public.branches (id, tenant_id, name, code, is_active)
  values (resources.branch_id, context.tenant_id, 'Sale Cancellation Runtime', 'SCR' || left(suffix, 4), true);
  insert into public.stock_locations (id, tenant_id, branch_id, code, name, location_type, is_active)
  values (resources.location_id, context.tenant_id, resources.branch_id,
    'SCR' || left(suffix, 5), 'Sale Cancellation Stock', 'internal', true);
  insert into public.partners (
    id, tenant_id, branch_id, name, contact_type, is_company,
    is_external_contact, customer_rank, supplier_rank, financer_rank, active
  ) values (
    resources.customer_id, context.tenant_id, resources.branch_id,
    'Sale Cancellation Customer', 'person', false, true, 1, 0, 0, true
  );
  perform public.resolve_financial_journal(context.tenant_id, 'sale', resources.branch_id, null);
  insert into public.account_functional_accounts (tenant_id, branch_id, functional_role, account_id)
  values
    (context.tenant_id, resources.branch_id, 'customer_receivable', receivable_account_id),
    (context.tenant_id, resources.branch_id, 'sales_revenue', revenue_account_id);
  insert into public.product_templates (
    id, tenant_id, name, internal_reference, product_type, tracking,
    can_be_sold, is_active, sale_price
  ) values (
    resources.template_id, context.tenant_id, 'Sale Cancellation Product',
    'SCR-' || suffix, 'goods', 'none', true, true, 50000
  );
  insert into public.product_products (
    id, tenant_id, product_template_id, display_name, sku, tracking, is_active, sale_price
  ) values (
    resources.product_id, context.tenant_id, resources.template_id,
    'Sale Cancellation Product', 'SCR-' || suffix, 'none', true, 50000
  );
  update public.product_templates set default_product_product_id = resources.product_id
  where id = resources.template_id and tenant_id = context.tenant_id;
  insert into public.stock_quants (
    tenant_id, product_product_id, product_template_id, location_id,
    quantity_on_hand, reserved_quantity
  ) values (context.tenant_id, resources.product_id, resources.template_id, resources.location_id, 10, 0);
  insert into sale_cancellation_resources values (resources.*);
end
$$;

create function pg_temp.create_confirmed_cancellation_sale(p_key text)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public, pg_temp as $$
declare resources sale_cancellation_resources%rowtype; created jsonb; v_sale_id uuid; line_id uuid;
begin
  select * into resources from sale_cancellation_resources;
  created := public.create_sale(resources.branch_id, resources.customer_id,
    current_date, 'EGP', p_key, p_key || '-create');
  v_sale_id := (created ->> 'sale_id')::uuid;
  perform public.update_sale_draft(
    v_sale_id, 1, resources.branch_id, resources.customer_id, current_date, 'EGP', p_key,
    jsonb_build_array(jsonb_build_object(
      'product_id', resources.product_id, 'quantity', 1, 'unit_price', 50000
    )), p_key || '-update'
  );
  select id into strict line_id from public.sale_lines where sale_id = v_sale_id and tenant_id = (select tenant_id from sale_cancellation_context);
  perform public.confirm_sale(
    v_sale_id, 2,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', line_id, 'location_id', resources.location_id, 'quantity', 1
    )), p_key || '-confirm'
  );
  return v_sale_id;
end
$$;

select set_config('request.jwt.claim.sub', owner_auth::text, true) from sale_cancellation_context;
set local role authenticated;
select public.set_financial_period_lock(tenant_id, current_date, false, 'Sale cancellation rollback runtime')
from sale_cancellation_context;
select public.configure_financial_posting_policy(tenant_id, false, 'Sale cancellation rollback runtime')
from sale_cancellation_context;

-- 50,000 confirmed, reserved, AR 50,000 -> cancel -> released and net AR zero.
do $$
declare
  resources sale_cancellation_resources%rowtype;
  result jsonb; replay jsonb; eligibility jsonb;
  confirmation public.sale_confirmation_links%rowtype;
  posting public.financial_sale_postings%rowtype;
  original_number text; original_line_count bigint; v_reversal_id uuid;
begin
  select * into resources from sale_cancellation_resources;
  resources.cancellable_sale_id := pg_temp.create_confirmed_cancellation_sale('sale-cancel-success');
  update sale_cancellation_resources set cancellable_sale_id = resources.cancellable_sale_id;
  select * into strict confirmation from public.sale_confirmation_links where sale_id = resources.cancellable_sale_id;
  select * into strict posting from public.financial_sale_postings where id = confirmation.financial_sale_posting_id;
  select sale_number into original_number from public.sales where id = resources.cancellable_sale_id;
  select count(*) into original_line_count from public.sale_lines where sale_id = resources.cancellable_sale_id;
  eligibility := public.get_sale_cancellation_eligibility(resources.cancellable_sale_id);
  if not (eligibility ->> 'can_cancel')::boolean
     or (eligibility ->> 'has_delivery')::boolean
     or (eligibility ->> 'has_settlement')::boolean then
    raise exception 'CANCELLATION_ELIGIBILITY_INVALID: %', eligibility;
  end if;
  result := public.cancel_sale(resources.cancellable_sale_id, 3, 'طلب العميل', 'sale-cancel-success-command');
  replay := public.cancel_sale(resources.cancellable_sale_id, 3, 'طلب العميل', 'sale-cancel-success-command');
  select id into strict v_reversal_id from public.financial_accounting_reversals
  where domain_type = 'sale_posting' and domain_id = posting.id;
  if result ->> 'status' <> 'cancelled'
     or not (replay ->> 'idempotent_replay')::boolean
     or (select status from public.sales where id = resources.cancellable_sale_id) <> 'cancelled'
     or (select version from public.sales where id = resources.cancellable_sale_id) <> 4
     or (select sale_number from public.sales where id = resources.cancellable_sale_id) <> original_number
     or (select count(*) from public.sale_lines where sale_id = resources.cancellable_sale_id) <> original_line_count
     or (select state from public.inventory_reservations where id = confirmation.inventory_reservation_id) <> 'released'
     or (select released_quantity from public.inventory_reservation_lines where reservation_id = confirmation.inventory_reservation_id) <> 1
     or (select count(*) from public.financial_sale_postings where id = posting.id) <> 1
     or (select count(*) from public.financial_accounting_reversals where domain_type = 'sale_posting' and domain_id = posting.id) <> 1
     or (select count(*) from public.financial_accounting_reversal_move_links where reversal_id = v_reversal_id) <> 1
     or (select amount_residual from public.account_move_lines where id = posting.receivable_line_id) <> 0
     or (select count(*) from public.sale_events where sale_id = resources.cancellable_sale_id and event_type = 'sale_cancelled') <> 1
     or (select payload ->> 'reason' from public.sale_events where sale_id = resources.cancellable_sale_id and event_type = 'sale_cancelled') <> 'طلب العميل' then
    raise exception 'CANONICAL_CANCELLATION_RESULT_INVALID result=% replay=%', result, replay;
  end if;
end
$$;

-- A real 20,000 Canonical collection blocks cancellation; Phase 7A performs no refund.
do $$
declare
  resources sale_cancellation_resources%rowtype;
  options jsonb; method jsonb; destination_id uuid; rejected boolean := false;
begin
  select * into resources from sale_cancellation_resources;
  resources.settled_sale_id := pg_temp.create_confirmed_cancellation_sale('sale-cancel-settled');
  update sale_cancellation_resources set settled_sale_id = resources.settled_sale_id;
  options := public.get_settlement_options('sale', resources.settled_sale_id::text);
  method := options -> 'settlement_mechanisms' -> 0 -> 'payment_methods' -> 0;
  if not coalesce((options ->> 'can_settle')::boolean, false) or method is null then
    raise exception 'SALE_CANCELLATION_SETTLEMENT_OPTION_UNAVAILABLE: %', options;
  end if;
  if coalesce((method ->> 'requires_money_destination')::boolean, false) then
    destination_id := (method -> 'money_destinations' -> 0 ->> 'id')::uuid;
  end if;
  perform public.settle_obligation(
    'sale', resources.settled_sale_id::text, 'money_payment', 20000,
    (method ->> 'id')::uuid, 'sale-cancel-runtime-settlement', destination_id,
    case when coalesce((method ->> 'requires_reference')::boolean, false)
      then 'SALE-CANCEL-RUNTIME' else null end,
    'Canonical cancellation settlement blocker runtime'
  );
  if (public.get_settlement_options('sale', resources.settled_sale_id::text)
      ->> 'outstanding_amount')::numeric <> 30000 then
    raise exception 'SALE_CANCELLATION_SETTLEMENT_RESIDUAL_INVALID';
  end if;
  begin
    perform public.cancel_sale(resources.settled_sale_id, 3, 'محاولة غير مسموحة', 'sale-cancel-settled-command');
  exception when check_violation then
    rejected := sqlerrm = 'SALE_CANCELLATION_HAS_SETTLEMENT';
  end;
  if not rejected or (select status from public.sales where id = resources.settled_sale_id) <> 'confirmed' then
    raise exception 'SETTLED_SALE_CANCELLATION_NOT_REJECTED';
  end if;
end
$$;

-- Any physical delivery blocks Cancel and points to the future Return workflow.
do $$
declare resources sale_cancellation_resources%rowtype; line_id uuid; rejected boolean := false;
begin
  select * into resources from sale_cancellation_resources;
  resources.delivered_sale_id := pg_temp.create_confirmed_cancellation_sale('sale-cancel-delivered');
  update sale_cancellation_resources set delivered_sale_id = resources.delivered_sale_id;
  select id into strict line_id from public.sale_lines where sale_id = resources.delivered_sale_id;
  perform public.deliver_sale(
    resources.delivered_sale_id, 3,
    jsonb_build_array(jsonb_build_object('sale_line_id', line_id, 'quantity', 1)),
    'sale-cancel-runtime-delivery'
  );
  begin
    perform public.cancel_sale(resources.delivered_sale_id, 4, 'محاولة غير مسموحة', 'sale-cancel-delivered-command');
  exception when check_violation then
    rejected := sqlerrm = 'SALE_CANCELLATION_HAS_DELIVERY';
  end;
  if not rejected or (select status from public.sales where id = resources.delivered_sale_id) <> 'confirmed' then
    raise exception 'DELIVERED_SALE_CANCELLATION_NOT_REJECTED';
  end if;
end
$$;

reset role;
select jsonb_build_object(
  'confirmed_unpaid_undelivered_cancel', 'passed',
  'inventory_release', 'passed',
  'financial_reversal_and_net_ar_zero', 'passed',
  'idempotent_retry', 'passed',
  'settlement_block', 'passed',
  'delivery_block', 'passed'
) canonical_sale_cancellation_runtime;

rollback;
