import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const executable = process.platform === 'win32' ? process.execPath : 'npx';
const executableArguments = process.platform === 'win32'
  ? [join(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js')]
  : [];
const baseArguments = [...executableArguments, 'db', 'query', '--linked'];

const syncQuery = (sql) => {
  const result = spawnSync(executable, [...baseArguments, '--output', 'json', sql], {
    cwd: process.cwd(), encoding: 'utf8', windowsHide: true,
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || 'Supabase query failed');
  const jsonStart = result.stdout.indexOf('[');
  return jsonStart >= 0 ? JSON.parse(result.stdout.slice(jsonStart)) : [];
};

const asyncQuery = (sql) => new Promise((resolve) => {
  const child = spawn(executable, [...baseArguments, sql], {
    cwd: process.cwd(), windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('close', (status) => resolve({ status, stdout, stderr }));
  child.on('error', (error) => resolve({ status: -1, stdout, stderr: error.message }));
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const [context] = syncQuery(`
  select owner.tenant_id, owner.auth_user_id owner_auth
  from public.tenant_users owner
  left join public.financial_period_locks period on period.tenant_id = owner.tenant_id
  where owner.role = 'owner' and owner.is_active and owner.auth_user_id is not null
    and not coalesce(period.active, false)
    and exists (select 1 from public.account_functional_accounts configuration
      where configuration.tenant_id = owner.tenant_id
        and configuration.functional_role = 'customer_receivable' and configuration.is_active)
    and exists (select 1 from public.account_functional_accounts configuration
      where configuration.tenant_id = owner.tenant_id
        and configuration.functional_role = 'sales_revenue' and configuration.is_active)
  order by owner.tenant_id limit 1
`);
if (!context) throw new Error('No financially ready owner exists for Sales delivery concurrency proof');

const marker = randomUUID().replaceAll('-', '').slice(0, 12);
const branchId = randomUUID();
const locationId = randomUUID();
const customerId = randomUUID();
const serialTemplateId = randomUUID();
const serialProductId = randomUUID();
const serialUnitId = randomUUID();
const quantityTemplateId = randomUUID();
const quantityProductId = randomUUID();
const sales = [];
const commandKeys = [];
const saleYear = new Date().getUTCFullYear();
const [sequenceBefore] = syncQuery(`
  select exists(select 1 from public.sale_number_sequences
    where tenant_id = '${context.tenant_id}'::uuid and sale_year = ${saleYear}) had_row,
    coalesce((select last_value from public.sale_number_sequences
      where tenant_id = '${context.tenant_id}'::uuid and sale_year = ${saleYear}), 0)::integer last_value
`);

const authTransaction = (body, holdSeconds = 0, lockTimeout = 20) => `
  begin;
  set local lock_timeout = '${lockTimeout}s';
  select set_config('request.jwt.claim.sub', '${context.owner_auth}', true);
  set local role authenticated;
  ${body}
  reset role;
  ${holdSeconds ? `select pg_sleep(${holdSeconds});` : ''}
  rollback;
`;

const createConfirmedSale = (name, productId, quantity, trackingUnitId = null) => {
  const createKey = `sales-deliver-race-${name}-create-${marker}`;
  const updateKey = `sales-deliver-race-${name}-update-${marker}`;
  const confirmKey = `sales-deliver-race-${name}-confirm-${marker}`;
  commandKeys.push(createKey, updateKey, confirmKey);
  syncQuery(`
    begin;
    select set_config('request.jwt.claim.sub', '${context.owner_auth}', true);
    set local role authenticated;
    select public.create_sale(
      '${branchId}'::uuid, '${customerId}'::uuid, current_date,
      'EGP', '${name}', '${createKey}'
    );
    commit;
  `);
  const [sale] = syncQuery(`select id from public.sales
    where tenant_id = '${context.tenant_id}'::uuid
      and create_idempotency_key = '${createKey}'`);
  if (!sale) throw new Error(`Failed to create race Sale ${name}`);
  syncQuery(`
    begin;
    select set_config('request.jwt.claim.sub', '${context.owner_auth}', true);
    set local role authenticated;
    select public.update_sale_draft(
      '${sale.id}'::uuid, 1, '${branchId}'::uuid, '${customerId}'::uuid,
      current_date, 'EGP', '${name}',
      jsonb_build_array(jsonb_build_object(
        'product_id', '${productId}'::uuid,
        'quantity', ${quantity}, 'unit_price', 100
      )), '${updateKey}'
    );
    commit;
  `);
  const [line] = syncQuery(`select id from public.sale_lines where sale_id = '${sale.id}'::uuid`);
  syncQuery(`
    begin;
    select set_config('request.jwt.claim.sub', '${context.owner_auth}', true);
    set local role authenticated;
    select public.confirm_sale(
      '${sale.id}'::uuid, 2,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', '${line.id}'::uuid,
        'location_id', '${locationId}'::uuid,
        ${trackingUnitId ? `'tracking_unit_id', '${trackingUnitId}'::uuid,` : ''}
        'quantity', ${quantity}
      )), '${confirmKey}'
    );
    commit;
  `);
  const value = { id: sale.id, lineId: line.id, name };
  sales.push(value);
  return value;
};

const deliveryLines = (sale, quantity, trackingUnitId = null) => `jsonb_build_array(jsonb_build_object(
  'sale_line_id', '${sale.lineId}'::uuid,
  ${trackingUnitId ? `'tracking_unit_id', '${trackingUnitId}'::uuid,` : ''}
  'quantity', ${quantity}
))`;

const runRace = async ({ name, sale, lines, expectedFulfillment }) => {
  const firstKey = `sales-deliver-race-${name}-a-${marker}`;
  const secondKey = `sales-deliver-race-${name}-b-${marker}`;
  commandKeys.push(firstKey, secondKey);
  const first = asyncQuery(authTransaction(`
    select public.deliver_sale('${sale.id}'::uuid, 3, ${lines}, '${firstKey}');
    reset role;
    do $concurrency$
    begin
      if (select status <> 'confirmed' or version <> 4
          from public.sales where id = '${sale.id}'::uuid)
         or (select count(*) from public.sale_deliveries
             where sale_id = '${sale.id}'::uuid) <> 1
         or (select count(*) from public.inventory_deliveries delivery
             join public.sale_confirmation_links confirmation
               on confirmation.inventory_reservation_id = delivery.reservation_id
              and confirmation.tenant_id = delivery.tenant_id
             where confirmation.sale_id = '${sale.id}'::uuid) <> 1
         or (select count(*) from public.sale_events
             where sale_id = '${sale.id}'::uuid
               and event_type in ('sale_partially_delivered', 'sale_delivered')) <> 1
         or (select fulfillment_status from public.sale_deliveries
             where sale_id = '${sale.id}'::uuid) <> '${expectedFulfillment}' then
        raise exception 'DELIVERY_CONCURRENCY_WINNER_CARDINALITY_INVALID';
      end if;
    end
    $concurrency$;
  `, 7, 20));
  await delay(1_500);
  const secondStarted = Date.now();
  const second = asyncQuery(authTransaction(`
    select public.deliver_sale('${sale.id}'::uuid, 3, ${lines}, '${secondKey}');
  `, 0, 2));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const secondElapsedMs = Date.now() - secondStarted;
  if (firstResult.status !== 0) {
    throw new Error(`${name} writer A failed:\n${firstResult.stderr}\n${firstResult.stdout}`);
  }
  const secondMessage = `${secondResult.stderr}\n${secondResult.stdout}`;
  if (secondResult.status === 0 || !secondMessage.toLowerCase().includes('lock timeout')) {
    throw new Error(`${name} writer B did not fail closed on the Sale lock: ${secondMessage}`);
  }
  if (secondElapsedMs < 1_800) {
    throw new Error(`${name} writer B did not contend on a database lock (${secondElapsedMs}ms)`);
  }
  return {
    winner: 'one_delivery_executed_inside_transaction',
    competitor: 'lock_rejected',
    competitor_wait_ms: secondElapsedMs,
  };
};

const cleanup = () => {
  const saleIds = sales.length
    ? sales.map((sale) => `'${sale.id}'::uuid`).join(',')
    : "'00000000-0000-0000-0000-000000000000'::uuid";
  const keyValues = commandKeys.length ? commandKeys.map((key) => `'${key}'`).join(',') : "''";
  const expectedSequence = Number(sequenceBefore.last_value) + sales.length;
  syncQuery(`
    begin;
    create temporary table cleanup_delivery_postings as
      select id, account_move_id from public.financial_sale_postings
      where source_app = 'sales_core' and source_model = 'sale'
        and source_id in (${sales.map((sale) => `'${sale.id}'`).join(',') || "''"});
    create temporary table cleanup_delivery_reservations as
      select id from public.inventory_reservations
      where source_type = 'sale'
        and source_id in (${sales.map((sale) => `'${sale.id}'`).join(',') || "''"});
    set local session_replication_role = replica;
    delete from public.sale_delivery_lines where sale_id in (${saleIds});
    delete from public.sale_deliveries where sale_id in (${saleIds});
    delete from public.sale_confirmation_links where sale_id in (${saleIds});
    delete from public.sale_inventory_selections where sale_id in (${saleIds});
    delete from public.inventory_events where reservation_id in (select id from cleanup_delivery_reservations);
    delete from public.inventory_delivery_lines where delivery_id in (
      select id from public.inventory_deliveries
      where reservation_id in (select id from cleanup_delivery_reservations)
    );
    delete from public.inventory_deliveries
      where reservation_id in (select id from cleanup_delivery_reservations);
    delete from public.inventory_command_requests
      where result ->> 'reservation_id' in (select id::text from cleanup_delivery_reservations);
    delete from public.inventory_reservation_lines
      where reservation_id in (select id from cleanup_delivery_reservations);
    delete from public.inventory_reservations where id in (select id from cleanup_delivery_reservations);
    delete from public.inventory_tracking_unit_states where tracking_unit_id = '${serialUnitId}'::uuid;
    delete from public.financial_engine_bindings
      where source_app = 'sales_core' and source_model = 'sale'
        and source_id in (${sales.map((sale) => `'${sale.id}'`).join(',') || "''"});
    delete from public.account_move_lines
      where move_id in (select account_move_id from cleanup_delivery_postings);
    delete from public.account_moves
      where id in (select account_move_id from cleanup_delivery_postings);
    delete from public.financial_sale_postings where id in (select id from cleanup_delivery_postings);
    delete from public.sale_events where sale_id in (${saleIds});
    delete from public.sale_lines where sale_id in (${saleIds});
    delete from public.sales where id in (${saleIds});
    delete from public.sales_command_requests
      where tenant_id = '${context.tenant_id}'::uuid and idempotency_key in (${keyValues});
    delete from public.stock_tracking_units where id = '${serialUnitId}'::uuid;
    delete from public.stock_quants
      where product_product_id = '${quantityProductId}'::uuid and location_id = '${locationId}'::uuid;
    update public.product_templates set default_product_product_id = null
      where id in ('${serialTemplateId}'::uuid, '${quantityTemplateId}'::uuid);
    delete from public.product_products where id in ('${serialProductId}'::uuid, '${quantityProductId}'::uuid);
    delete from public.product_templates where id in ('${serialTemplateId}'::uuid, '${quantityTemplateId}'::uuid);
    delete from public.account_functional_accounts where branch_id = '${branchId}'::uuid;
    delete from public.account_journals where branch_id = '${branchId}'::uuid;
    delete from public.partners where id = '${customerId}'::uuid;
    delete from public.stock_locations where branch_id = '${branchId}'::uuid;
    delete from public.branches where id = '${branchId}'::uuid;
    ${sequenceBefore.had_row
      ? `update public.sale_number_sequences set last_value = ${sequenceBefore.last_value}, updated_at = now()
           where tenant_id = '${context.tenant_id}'::uuid and sale_year = ${saleYear}
             and last_value = ${expectedSequence};`
      : `delete from public.sale_number_sequences
           where tenant_id = '${context.tenant_id}'::uuid and sale_year = ${saleYear}
             and last_value = ${expectedSequence};`}
    set local session_replication_role = origin;
    commit;
  `);
};

try {
  syncQuery(`
    begin;
    insert into public.branches (id, tenant_id, name, code, is_active)
    values ('${branchId}', '${context.tenant_id}', 'Sales delivery race ${marker}', 'SDR${marker.slice(0, 5)}', true);
    insert into public.stock_locations (id, tenant_id, branch_id, code, name, location_type, is_active)
    values ('${locationId}', '${context.tenant_id}', '${branchId}', 'SDR${marker.slice(0, 5)}', 'Sales delivery race location', 'internal', true);
    insert into public.partners (
      id, tenant_id, branch_id, name, contact_type, is_company,
      is_external_contact, customer_rank, supplier_rank, financer_rank, active
    ) values (
      '${customerId}', '${context.tenant_id}', '${branchId}', 'Sales delivery race customer',
      'person', false, true, 1, 0, 0, true
    );
    insert into public.account_functional_accounts (tenant_id, branch_id, functional_role, account_id)
    values
      ('${context.tenant_id}', '${branchId}', 'customer_receivable', public.resolve_functional_account('${context.tenant_id}', 'customer_receivable', null)),
      ('${context.tenant_id}', '${branchId}', 'sales_revenue', public.resolve_functional_account('${context.tenant_id}', 'sales_revenue', null));
    select public.resolve_financial_journal('${context.tenant_id}', 'sale', '${branchId}', null);
    insert into public.product_templates (
      id, tenant_id, name, internal_reference, product_type, tracking,
      can_be_sold, is_active, sale_price
    ) values
      ('${serialTemplateId}', '${context.tenant_id}', 'Sales delivery serial ${marker}', 'SDRS${marker}', 'goods', 'serial', true, true, 100),
      ('${quantityTemplateId}', '${context.tenant_id}', 'Sales delivery quantity ${marker}', 'SDRQ${marker}', 'goods', 'none', true, true, 100);
    insert into public.product_products (
      id, tenant_id, product_template_id, display_name, sku, tracking, is_active, sale_price
    ) values
      ('${serialProductId}', '${context.tenant_id}', '${serialTemplateId}', 'Sales delivery serial ${marker}', 'SDRS${marker}', 'serial', true, 100),
      ('${quantityProductId}', '${context.tenant_id}', '${quantityTemplateId}', 'Sales delivery quantity ${marker}', 'SDRQ${marker}', 'none', true, 100);
    update public.product_templates template set default_product_product_id = product.id
    from public.product_products product
    where template.id in ('${serialTemplateId}'::uuid, '${quantityTemplateId}'::uuid)
      and product.product_template_id = template.id;
    insert into public.stock_tracking_units (
      id, tenant_id, product_product_id, product_template_id,
      tracking_type, tracking_number, status, data_status,
      incomplete_reason, current_location_id
    ) values (
      '${serialUnitId}', '${context.tenant_id}', '${serialProductId}', '${serialTemplateId}',
      'serial', 'SDRS-${marker}', 'in_stock', 'complete', null, '${locationId}'
    );
    insert into public.stock_quants (
      tenant_id, product_product_id, product_template_id, location_id,
      quantity_on_hand, reserved_quantity
    ) values ('${context.tenant_id}', '${quantityProductId}', '${quantityTemplateId}', '${locationId}', 10, 0);
    commit;
  `);

  const serialSale = createConfirmedSale('serial', serialProductId, 1, serialUnitId);
  const quantitySale = createConfirmedSale('quantity', quantityProductId, 2);

  const sameSaleRace = await runRace({
    name: 'same-sale', sale: quantitySale,
    lines: deliveryLines(quantitySale, 1), expectedFulfillment: 'partially_delivered',
  });
  const serialRace = await runRace({
    name: 'same-serial', sale: serialSale,
    lines: deliveryLines(serialSale, 1, serialUnitId), expectedFulfillment: 'delivered',
  });
  const quantityRace = await runRace({
    name: 'reserved-quantity', sale: quantitySale,
    lines: deliveryLines(quantitySale, 2), expectedFulfillment: 'delivered',
  });

  const [postState] = syncQuery(`
    select
      (select count(*)::integer from public.sales
        where id in ('${serialSale.id}'::uuid, '${quantitySale.id}'::uuid)
          and (status <> 'confirmed' or version <> 3)) changed_sales,
      (select count(*)::integer from public.sale_deliveries
        where sale_id in ('${serialSale.id}'::uuid, '${quantitySale.id}'::uuid)) sales_deliveries,
      (select count(*)::integer from public.inventory_deliveries delivery
        join public.sale_confirmation_links confirmation
          on confirmation.inventory_reservation_id = delivery.reservation_id
         and confirmation.tenant_id = delivery.tenant_id
        where confirmation.sale_id in ('${serialSale.id}'::uuid, '${quantitySale.id}'::uuid)) inventory_deliveries,
      (select count(*)::integer from public.sale_events
        where sale_id in ('${serialSale.id}'::uuid, '${quantitySale.id}'::uuid)
          and event_type in ('sale_partially_delivered', 'sale_delivered')) delivery_events,
      (select state from public.inventory_tracking_unit_states
        where tracking_unit_id = '${serialUnitId}'::uuid) serial_state,
      (select quantity_on_hand from public.stock_quants
        where product_product_id = '${quantityProductId}'::uuid
          and location_id = '${locationId}'::uuid) quantity_on_hand
  `);
  if (postState.changed_sales !== 0 || postState.sales_deliveries !== 0
      || postState.inventory_deliveries !== 0 || postState.delivery_events !== 0
      || postState.serial_state !== 'reserved' || Number(postState.quantity_on_hand) !== 10) {
    throw new Error(`Delivery concurrency proof leaked state: ${JSON.stringify(postState)}`);
  }

  console.log(JSON.stringify({
    independent_sessions_per_race: 2,
    same_sale: sameSaleRace,
    same_serialized_unit: serialRace,
    reserved_quantity: quantityRace,
    one_delivery_executed_per_race: true,
    competitor_failed_on_database_lock: true,
    duplicate_sales_deliveries_after_rollback: postState.sales_deliveries,
    duplicate_inventory_deliveries_after_rollback: postState.inventory_deliveries,
    duplicate_delivery_events_after_rollback: postState.delivery_events,
    over_delivery_after_rollback: 0,
    rollback_safe: true,
  }));
} finally {
  cleanup();
  const [leak] = syncQuery(`
    select (
      (select count(*) from public.sales where id in (${sales.length
        ? sales.map((sale) => `'${sale.id}'::uuid`).join(',')
        : "'00000000-0000-0000-0000-000000000000'::uuid"}))
      + (select count(*) from public.product_products
          where id in ('${serialProductId}'::uuid, '${quantityProductId}'::uuid))
      + (select count(*) from public.product_templates
          where id in ('${serialTemplateId}'::uuid, '${quantityTemplateId}'::uuid))
      + (select count(*) from public.stock_locations where branch_id = '${branchId}'::uuid)
      + (select count(*) from public.partners where id = '${customerId}'::uuid)
      + (select count(*) from public.branches where id = '${branchId}'::uuid)
    )::integer leaked
  `);
  if (leak.leaked !== 0) throw new Error(`Sales delivery concurrency cleanup leaked ${leak.leaked} rows`);
}
