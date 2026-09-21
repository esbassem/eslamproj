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
if (!context) throw new Error('No financially ready owner exists for Sales confirmation concurrency proof');

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

const authTransaction = (body, holdSeconds = 0, lockTimeout = 20) => `
  begin;
  set local lock_timeout = '${lockTimeout}s';
  select set_config('request.jwt.claim.sub', '${context.owner_auth}', true);
  set local role authenticated;
  ${body}
  ${holdSeconds ? `select pg_sleep(${holdSeconds});` : ''}
  rollback;
`;

const createReadySale = (name, productId, quantity, unitPrice) => {
  const createKey = `sales-confirm-race-${name}-create-${marker}`;
  const updateKey = `sales-confirm-race-${name}-update-${marker}`;
  commandKeys.push(createKey, updateKey);
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
  const [sale] = syncQuery(`
    select id from public.sales
    where tenant_id = '${context.tenant_id}'::uuid
      and create_idempotency_key = '${createKey}'
  `);
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
        'quantity', ${quantity}, 'unit_price', ${unitPrice}
      )), '${updateKey}'
    );
    commit;
  `);
  const [line] = syncQuery(`select id from public.sale_lines where sale_id = '${sale.id}'::uuid`);
  if (!line) throw new Error(`Failed to create race Sale line ${name}`);
  const value = { id: sale.id, lineId: line.id, name };
  sales.push(value);
  return value;
};

const selection = (sale, trackingUnitId = null) => `jsonb_build_array(jsonb_build_object(
  'sale_line_id', '${sale.lineId}'::uuid,
  'location_id', '${locationId}'::uuid,
  ${trackingUnitId ? `'tracking_unit_id', '${trackingUnitId}'::uuid,` : ''}
  'quantity', 1
))`;

const runRace = async ({ name, firstSale, secondSale, firstSelection, secondSelection }) => {
  const firstKey = `sales-confirm-race-${name}-a-${marker}`;
  const secondKey = `sales-confirm-race-${name}-b-${marker}`;
  const first = asyncQuery(authTransaction(`
    select public.confirm_sale(
      '${firstSale.id}'::uuid, 2, ${firstSelection}, '${firstKey}'
    );
    reset role;
    do $concurrency$
    begin
      if (select status <> 'confirmed' or sale_number is null
          from public.sales where id = '${firstSale.id}'::uuid)
         or (select count(*) from public.inventory_reservations
             where source_type = 'sale' and source_id = '${firstSale.id}') <> 1
         or (select count(*) from public.financial_sale_postings
             where source_app = 'sales_core' and source_model = 'sale'
               and source_id = '${firstSale.id}') <> 1
         or (select count(*) from public.financial_engine_bindings
             where source_app = 'sales_core' and source_model = 'sale'
               and source_id = '${firstSale.id}') <> 1
         or (select count(*) from public.sale_confirmation_links
             where sale_id = '${firstSale.id}'::uuid) <> 1
         or (select count(*) from public.sale_events
             where sale_id = '${firstSale.id}'::uuid
               and event_type = 'sale_confirmed') <> 1 then
        raise exception 'CONCURRENCY_WINNER_CARDINALITY_INVALID';
      end if;
      if '${firstSale.id}'::uuid <> '${secondSale.id}'::uuid
         and (select status from public.sales
              where id = '${secondSale.id}'::uuid) <> 'draft' then
        raise exception 'CONCURRENCY_LOSER_NOT_DRAFT';
      end if;
    end
    $concurrency$;
  `, 7, 20));
  await delay(1_500);
  const secondStarted = Date.now();
  const second = asyncQuery(authTransaction(`
    select public.confirm_sale(
      '${secondSale.id}'::uuid, 2, ${secondSelection}, '${secondKey}'
    );
  `, 0, 2));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const secondElapsedMs = Date.now() - secondStarted;
  if (firstResult.status !== 0) {
    throw new Error(`${name} writer A did not complete confirmation:\n${firstResult.stderr}\n${firstResult.stdout}`);
  }
  if (secondResult.status === 0) throw new Error(`${name} writer B unexpectedly confirmed`);
  const secondMessage = `${secondResult.stderr}\n${secondResult.stdout}`;
  if (!secondMessage.toLowerCase().includes('lock timeout')) {
    throw new Error(`${name} writer B failed for an unexpected reason: ${secondMessage}`);
  }
  if (secondElapsedMs < 1_800) {
    throw new Error(`${name} writer B did not contend on a database lock (${secondElapsedMs}ms)`);
  }
  return {
    first_confirmation: 'succeeded_inside_transaction',
    competing_confirmation: 'lock_rejected',
    competing_wait_ms: secondElapsedMs,
  };
};

const cleanup = () => {
  const saleIds = sales.length ? sales.map((sale) => `'${sale.id}'::uuid`).join(',') : "'00000000-0000-0000-0000-000000000000'::uuid";
  const keyValues = commandKeys.length ? commandKeys.map((key) => `'${key}'`).join(',') : "''";
  syncQuery(`
    begin;
    select set_config('app.canonical_sales_maintenance', 'authorized', true);
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
    delete from public.partners where id = '${customerId}'::uuid;
    delete from public.stock_locations where branch_id = '${branchId}'::uuid;
    delete from public.branches where id = '${branchId}'::uuid;
    commit;
  `);
};

try {
  syncQuery(`
    begin;
    insert into public.branches (id, tenant_id, name, code, is_active)
    values ('${branchId}', '${context.tenant_id}', 'Sales confirmation race ${marker}', 'SCC${marker.slice(0, 5)}', true);
    insert into public.stock_locations (id, tenant_id, branch_id, code, name, location_type, is_active)
    values ('${locationId}', '${context.tenant_id}', '${branchId}', 'SCC${marker.slice(0, 5)}', 'Sales confirmation race location', 'internal', true);
    insert into public.partners (
      id, tenant_id, branch_id, name, contact_type, is_company,
      is_external_contact, customer_rank, supplier_rank, financer_rank, active
    ) values (
      '${customerId}', '${context.tenant_id}', '${branchId}', 'Sales confirmation race customer',
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
      ('${serialTemplateId}', '${context.tenant_id}', 'Sales race serial ${marker}', 'SCRS${marker}', 'goods', 'serial', true, true, 100),
      ('${quantityTemplateId}', '${context.tenant_id}', 'Sales race quantity ${marker}', 'SCRQ${marker}', 'goods', 'none', true, true, 100);
    insert into public.product_products (
      id, tenant_id, product_template_id, display_name, sku, tracking, is_active, sale_price
    ) values
      ('${serialProductId}', '${context.tenant_id}', '${serialTemplateId}', 'Sales race serial ${marker}', 'SCRS${marker}', 'serial', true, 100),
      ('${quantityProductId}', '${context.tenant_id}', '${quantityTemplateId}', 'Sales race quantity ${marker}', 'SCRQ${marker}', 'none', true, 100);
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
      'serial', 'SCRU${marker}', 'in_stock', 'complete', null, '${locationId}'
    );
    insert into public.stock_quants (
      tenant_id, product_product_id, product_template_id, location_id,
      quantity_on_hand, reserved_quantity
    ) values ('${context.tenant_id}', '${quantityProductId}', '${quantityTemplateId}', '${locationId}', 1, 0);
    commit;
  `);

  const sameSale = createReadySale('same-sale', quantityProductId, 1, 100);
  const serialSaleA = createReadySale('serial-a', serialProductId, 1, 100);
  const serialSaleB = createReadySale('serial-b', serialProductId, 1, 100);
  const quantitySaleA = createReadySale('quantity-a', quantityProductId, 1, 100);
  const quantitySaleB = createReadySale('quantity-b', quantityProductId, 1, 100);

  const sameSaleRace = await runRace({
    name: 'same-sale', firstSale: sameSale, secondSale: sameSale,
    firstSelection: selection(sameSale), secondSelection: selection(sameSale),
  });
  const serialRace = await runRace({
    name: 'same-serial', firstSale: serialSaleA, secondSale: serialSaleB,
    firstSelection: selection(serialSaleA, serialUnitId),
    secondSelection: selection(serialSaleB, serialUnitId),
  });
  const quantityRace = await runRace({
    name: 'insufficient-quantity', firstSale: quantitySaleA, secondSale: quantitySaleB,
    firstSelection: selection(quantitySaleA), secondSelection: selection(quantitySaleB),
  });

  const [postState] = syncQuery(`
    select
      (select count(*)::integer from public.sales where id in (${sales.map((sale) => `'${sale.id}'::uuid`).join(',')}) and status <> 'draft') non_drafts,
      (select count(*)::integer from public.inventory_reservations where source_type = 'sale' and source_id in (${sales.map((sale) => `'${sale.id}'`).join(',')})) reservations,
      (select count(*)::integer from public.financial_sale_postings where source_app = 'sales_core' and source_id in (${sales.map((sale) => `'${sale.id}'`).join(',')})) postings,
      (select count(*)::integer from public.financial_engine_bindings where source_app = 'sales_core' and source_id in (${sales.map((sale) => `'${sale.id}'`).join(',')})) bindings,
      (select count(*)::integer from public.sale_confirmation_links where sale_id in (${sales.map((sale) => `'${sale.id}'::uuid`).join(',')})) links,
      (select count(*)::integer from public.sale_events where sale_id in (${sales.map((sale) => `'${sale.id}'::uuid`).join(',')}) and event_type = 'sale_confirmed') confirmation_events,
      (select status from public.stock_tracking_units where id = '${serialUnitId}'::uuid) serial_status,
      (select quantity_on_hand from public.stock_quants where product_product_id = '${quantityProductId}'::uuid and location_id = '${locationId}'::uuid) quantity_on_hand
  `);
  if (postState.non_drafts !== 0 || postState.reservations !== 0
      || postState.postings !== 0 || postState.bindings !== 0
      || postState.links !== 0 || postState.confirmation_events !== 0
      || postState.serial_status !== 'in_stock' || Number(postState.quantity_on_hand) !== 1) {
    throw new Error(`Concurrency proof leaked state: ${JSON.stringify(postState)}`);
  }

  console.log(JSON.stringify({
    independent_sessions_per_race: 2,
    same_sale: sameSaleRace,
    same_tracking_unit: serialRace,
    quantity_on_hand_one: quantityRace,
    one_confirmation_executed_per_race: true,
    competing_confirmation_failed_on_database_lock: true,
    duplicate_reservations: postState.reservations,
    duplicate_financial_postings: postState.postings,
    duplicate_confirmation_events: postState.confirmation_events,
    losing_sales_persisted_as_confirmed: postState.non_drafts,
    rollback_safe: true,
  }));
} finally {
  cleanup();
  const [leak] = syncQuery(`
    select (
      (select count(*) from public.sales where id in (${sales.length ? sales.map((sale) => `'${sale.id}'::uuid`).join(',') : "'00000000-0000-0000-0000-000000000000'::uuid"}))
      + (select count(*) from public.product_products where id in ('${serialProductId}'::uuid, '${quantityProductId}'::uuid))
      + (select count(*) from public.product_templates where id in ('${serialTemplateId}'::uuid, '${quantityTemplateId}'::uuid))
      + (select count(*) from public.stock_locations where branch_id = '${branchId}'::uuid)
      + (select count(*) from public.partners where id = '${customerId}'::uuid)
      + (select count(*) from public.branches where id = '${branchId}'::uuid)
    )::integer leaked
  `);
  if (leak.leaked !== 0) throw new Error(`Sales confirmation concurrency cleanup leaked ${leak.leaked} rows`);
}
