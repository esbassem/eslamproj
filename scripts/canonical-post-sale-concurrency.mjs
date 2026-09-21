import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const executable = process.platform === 'win32' ? process.execPath : 'npx';
const executableArguments = process.platform === 'win32'
  ? [join(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js')]
  : [];
const baseArguments = [...executableArguments, 'db', 'query', '--linked'];

const syncQuery = (sql) => {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = spawnSync(executable, [...baseArguments, '--output', 'json', sql], {
      cwd: process.cwd(), encoding: 'utf8', windowsHide: true,
    });
    if (result.status === 0) {
      const jsonStart = result.stdout.indexOf('[');
      return jsonStart >= 0 ? JSON.parse(result.stdout.slice(jsonStart)) : [];
    }
    const message = result.stderr || result.stdout || 'Supabase query failed';
    if (attempt === 3 || !message.includes('TransportError')) throw new Error(message);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_500);
  }
  return [];
};

const asyncQuery = (sql) => new Promise((resolve) => {
  const child = spawn(executable, [...baseArguments, sql], {
    cwd: process.cwd(), windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  let settled = false;
  const finish = (status, fallbackError = '') => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolve({ status, stdout, stderr: stderr || fallbackError });
  };
  const timeout = setTimeout(() => {
    child.kill();
    finish(-1, 'Supabase concurrency query process timed out after 45 seconds');
  }, 45_000);
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('exit', (status) => finish(status));
  child.on('close', (status) => finish(status));
  child.on('error', (error) => finish(-1, error.message));

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
if (!context) throw new Error('No isolated financially ready owner exists for post-sale concurrency proof');

const marker = randomUUID().replaceAll('-', '').slice(0, 12);
const branchId = randomUUID();
const locationId = randomUUID();
const customerId = randomUUID();
const templateId = randomUUID();
const productId = randomUUID();
const returnSerialId = randomUUID();
const exchangeSerialId = randomUUID();
const replacementSerialId = randomUUID();
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

const createDeliveredSale = (name, trackingUnitId) => {
  const createKey = `post-sale-race-${name}-create-${marker}`;
  const updateKey = `post-sale-race-${name}-update-${marker}`;
  const confirmKey = `post-sale-race-${name}-confirm-${marker}`;
  const deliveryKey = `post-sale-race-${name}-delivery-${marker}`;
  commandKeys.push(createKey, updateKey, confirmKey, deliveryKey);
  const [created] = syncQuery(`
    begin;
    select set_config('request.jwt.claim.sub', '${context.owner_auth}', true);
    set local role authenticated;
    select public.create_sale(
      '${branchId}'::uuid, '${customerId}'::uuid, current_date,
      'EGP', '${name}', '${createKey}'
    ) ->> 'sale_id' id;
    commit;
  `);
  if (!created?.id) throw new Error(`Failed to create ${name} Sale`);
  syncQuery(`
    begin;
    select set_config('request.jwt.claim.sub', '${context.owner_auth}', true);
    set local role authenticated;
    select public.update_sale_draft(
      '${created.id}'::uuid, 1, '${branchId}'::uuid, '${customerId}'::uuid,
      current_date, 'EGP', '${name}',
      jsonb_build_array(jsonb_build_object(
        'product_id', '${productId}'::uuid, 'quantity', 1, 'unit_price', 100
      )), '${updateKey}'
    );
    commit;
  `);
  const [line] = syncQuery(`select id from public.sale_lines where sale_id = '${created.id}'::uuid`);
  syncQuery(`
    begin;
    select set_config('request.jwt.claim.sub', '${context.owner_auth}', true);
    set local role authenticated;
    select public.confirm_sale(
      '${created.id}'::uuid, 2,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', '${line.id}'::uuid,
        'location_id', '${locationId}'::uuid,
        'tracking_unit_id', '${trackingUnitId}'::uuid,
        'quantity', 1
      )), '${confirmKey}'
    );
    select public.deliver_sale(
      '${created.id}'::uuid, 3,
      jsonb_build_array(jsonb_build_object(
        'sale_line_id', '${line.id}'::uuid,
        'tracking_unit_id', '${trackingUnitId}'::uuid,
        'quantity', 1
      )), '${deliveryKey}'
    );
    commit;
  `);
  const sale = { id: created.id, lineId: line.id, trackingUnitId, name };
  sales.push(sale);
  return sale;
};

const assertLockRace = async (name, winnerSql, competitorSql) => {
  // Management API session startup can take several seconds; keep the winner
  // open long enough for the second independent session to reach the row lock.
  const first = asyncQuery(authTransaction(winnerSql, 20, 30));
  await delay(1_500);
  const secondStarted = Date.now();
  const second = asyncQuery(authTransaction(competitorSql, 0, 2));
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
  return { winner: 'one_effect_executed_inside_transaction', competitor: 'lock_rejected', competitor_wait_ms: secondElapsedMs };
};

const cleanup = () => {
  const saleIds = sales.length
    ? sales.map((sale) => `'${sale.id}'::uuid`).join(',')
    : "'00000000-0000-0000-0000-000000000000'::uuid";
  const saleSourceIds = sales.length ? sales.map((sale) => `'${sale.id}'`).join(',') : "''";
  const keyValues = commandKeys.length ? commandKeys.map((key) => `'${key}'`).join(',') : "''";
  const expectedSequence = Number(sequenceBefore.last_value) + sales.length;
  syncQuery(`
    begin;
    create temporary table cleanup_post_sale_postings as
      select id, account_move_id from public.financial_sale_postings
      where source_app = 'sales_core' and source_model = 'sale'
        and source_id in (${saleSourceIds});
    create temporary table cleanup_post_sale_reservations as
      select id from public.inventory_reservations
      where source_type = 'sale' and source_id in (${saleSourceIds});
    set local session_replication_role = replica;
    delete from public.sale_delivery_lines where sale_id in (${saleIds});
    delete from public.sale_deliveries where sale_id in (${saleIds});
    delete from public.sale_confirmation_links where sale_id in (${saleIds});
    delete from public.sale_inventory_selections where sale_id in (${saleIds});
    delete from public.inventory_events where reservation_id in (select id from cleanup_post_sale_reservations);
    delete from public.inventory_delivery_lines where delivery_id in (
      select id from public.inventory_deliveries
      where reservation_id in (select id from cleanup_post_sale_reservations)
    );
    delete from public.inventory_deliveries
      where reservation_id in (select id from cleanup_post_sale_reservations);
    delete from public.inventory_command_requests
      where result ->> 'reservation_id' in (select id::text from cleanup_post_sale_reservations);
    delete from public.inventory_reservation_lines
      where reservation_id in (select id from cleanup_post_sale_reservations);
    delete from public.inventory_reservations where id in (select id from cleanup_post_sale_reservations);
    delete from public.inventory_tracking_unit_states
      where tracking_unit_id in ('${returnSerialId}'::uuid, '${exchangeSerialId}'::uuid, '${replacementSerialId}'::uuid);
    delete from public.financial_engine_bindings
      where source_app = 'sales_core' and source_model = 'sale' and source_id in (${saleSourceIds});
    delete from public.account_move_lines
      where move_id in (select account_move_id from cleanup_post_sale_postings);
    delete from public.account_moves
      where id in (select account_move_id from cleanup_post_sale_postings);
    delete from public.financial_sale_postings where id in (select id from cleanup_post_sale_postings);
    delete from public.sale_events where sale_id in (${saleIds});
    delete from public.sale_lines where sale_id in (${saleIds});
    delete from public.sales where id in (${saleIds});
    delete from public.sales_command_requests
      where tenant_id = '${context.tenant_id}'::uuid and idempotency_key in (${keyValues});
    delete from public.stock_tracking_units
      where id in ('${returnSerialId}'::uuid, '${exchangeSerialId}'::uuid, '${replacementSerialId}'::uuid);
    update public.product_templates set default_product_product_id = null where id = '${templateId}'::uuid;
    delete from public.product_products where id = '${productId}'::uuid;
    delete from public.product_templates where id = '${templateId}'::uuid;
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
    values ('${branchId}', '${context.tenant_id}', 'Post-sale race ${marker}', 'PSR${marker.slice(0, 5)}', true);
    insert into public.stock_locations (id, tenant_id, branch_id, code, name, location_type, is_active)
    values ('${locationId}', '${context.tenant_id}', '${branchId}', 'PSR${marker.slice(0, 5)}', 'Post-sale race location', 'internal', true);
    insert into public.partners (
      id, tenant_id, branch_id, name, contact_type, is_company,
      is_external_contact, customer_rank, supplier_rank, financer_rank, active
    ) values (
      '${customerId}', '${context.tenant_id}', '${branchId}', 'Post-sale race customer',
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
    ) values ('${templateId}', '${context.tenant_id}', 'Post-sale race serial ${marker}', 'PSR${marker}', 'goods', 'serial', true, true, 100);
    insert into public.product_products (
      id, tenant_id, product_template_id, display_name, sku, tracking, is_active, sale_price
    ) values ('${productId}', '${context.tenant_id}', '${templateId}', 'Post-sale race serial ${marker}', 'PSR${marker}', 'serial', true, 100);
    update public.product_templates set default_product_product_id = '${productId}'::uuid where id = '${templateId}'::uuid;
    insert into public.stock_tracking_units (
      id, tenant_id, product_product_id, product_template_id,
      tracking_type, tracking_number, status, data_status, incomplete_reason, current_location_id
    ) values
      ('${returnSerialId}', '${context.tenant_id}', '${productId}', '${templateId}', 'serial', 'PSR-R-${marker}', 'in_stock', 'complete', null, '${locationId}'),
      ('${exchangeSerialId}', '${context.tenant_id}', '${productId}', '${templateId}', 'serial', 'PSR-E-${marker}', 'in_stock', 'complete', null, '${locationId}'),
      ('${replacementSerialId}', '${context.tenant_id}', '${productId}', '${templateId}', 'serial', 'PSR-N-${marker}', 'in_stock', 'complete', null, '${locationId}');
    commit;
  `);

  const returnSale = createDeliveredSale('return', returnSerialId);
  const exchangeSale = createDeliveredSale('exchange', exchangeSerialId);
  const returnKeyA = `post-sale-race-return-a-${marker}`;
  const returnKeyB = `post-sale-race-return-b-${marker}`;
  const returnLines = `jsonb_build_array(jsonb_build_object(
    'sale_line_id', '${returnSale.lineId}'::uuid,
    'tracking_unit_id', '${returnSerialId}'::uuid, 'quantity', 1
  ))`;
  const returnRace = await assertLockRace('return', `
    select public.return_sale(
      '${returnSale.id}'::uuid, 4, ${returnLines}, '${locationId}'::uuid,
      'Concurrent Return A', '${returnKeyA}'
    );
    reset role;
    do $race$
    begin
      if (select count(*) from public.sale_returns where sale_id = '${returnSale.id}'::uuid) <> 1
         or (select count(*) from public.sale_return_inventory_links link
             join public.sale_returns returned on returned.id = link.sale_return_id
             where returned.sale_id = '${returnSale.id}'::uuid) <> 1
         or (select count(*) from public.financial_sale_return_postings posting
             join public.sale_returns returned on returned.id = posting.sale_return_id
             where returned.sale_id = '${returnSale.id}'::uuid) <> 1
         or (select state from public.inventory_tracking_unit_states
             where tracking_unit_id = '${returnSerialId}'::uuid) <> 'available' then
        raise exception 'RETURN_CONCURRENCY_WINNER_CARDINALITY_INVALID';
      end if;
    end $race$;
  `, `
    select public.return_sale(
      '${returnSale.id}'::uuid, 4, ${returnLines}, '${locationId}'::uuid,
      'Concurrent Return B', '${returnKeyB}'
    );
  `);

  const exchangeKeyA = `post-sale-race-exchange-a-${marker}`;
  const exchangeKeyB = `post-sale-race-exchange-b-${marker}`;
  const exchangeArgs = (reason, key) => `
    '${exchangeSale.id}'::uuid, 4,
    jsonb_build_array(jsonb_build_object(
      'sale_line_id', '${exchangeSale.lineId}'::uuid,
      'tracking_unit_id', '${exchangeSerialId}'::uuid, 'quantity', 1
    )),
    jsonb_build_array(jsonb_build_object(
      'product_id', '${productId}'::uuid, 'description', 'Concurrent replacement',
      'quantity', 1, 'unit_price', 100,
      'tracking_unit_id', '${replacementSerialId}'::uuid
    )),
    '${locationId}'::uuid, '${locationId}'::uuid, '${reason}', '${key}'
  `;
  const exchangeRace = await assertLockRace('exchange', `
    select public.start_sale_exchange(${exchangeArgs('Concurrent Exchange A', exchangeKeyA)});
    reset role;
    do $race$
    begin
      if (select count(*) from public.sale_exchanges where original_sale_id = '${exchangeSale.id}'::uuid) <> 1
         or (select count(*) from public.sale_returns where sale_id = '${exchangeSale.id}'::uuid) <> 1
         or (select count(*) from public.sales replacement
             join public.sale_exchanges exchange on exchange.replacement_sale_id = replacement.id
             where exchange.original_sale_id = '${exchangeSale.id}'::uuid
               and replacement.status = 'draft' and replacement.sale_number is null) <> 1 then
        raise exception 'EXCHANGE_CONCURRENCY_WINNER_CARDINALITY_INVALID';
      end if;
    end $race$;
  `, `
    select public.start_sale_exchange(${exchangeArgs('Concurrent Exchange B', exchangeKeyB)});
  `);

  const [postState] = syncQuery(`
    select
      (select count(*)::integer from public.sales
        where id in ('${returnSale.id}'::uuid, '${exchangeSale.id}'::uuid)
          and (status <> 'confirmed' or version <> 4)) changed_sales,
      (select count(*)::integer from public.sale_returns
        where sale_id in ('${returnSale.id}'::uuid, '${exchangeSale.id}'::uuid)) sale_returns,
      (select count(*)::integer from public.sale_exchanges
        where original_sale_id = '${exchangeSale.id}'::uuid) sale_exchanges,
      (select count(*)::integer from public.inventory_tracking_unit_states
        where tracking_unit_id in ('${returnSerialId}'::uuid, '${exchangeSerialId}'::uuid)
          and state <> 'issued') changed_serials
  `);
  if (postState.changed_sales !== 0 || postState.sale_returns !== 0
      || postState.sale_exchanges !== 0 || postState.changed_serials !== 0) {
    throw new Error(`Post-sale concurrency proof leaked race state: ${JSON.stringify(postState)}`);
  }

  console.log(JSON.stringify({
    independent_sessions_per_race: 2,
    return: returnRace,
    exchange: exchangeRace,
    double_return_prevented: true,
    double_exchange_prevented: true,
    race_transactions_rolled_back: true,
  }));
} finally {
  cleanup();
  const [leak] = syncQuery(`
    select (
      (select count(*) from public.sales where id in (${sales.length
        ? sales.map((sale) => `'${sale.id}'::uuid`).join(',')
        : "'00000000-0000-0000-0000-000000000000'::uuid"}))
      + (select count(*) from public.product_products where id = '${productId}'::uuid)
      + (select count(*) from public.product_templates where id = '${templateId}'::uuid)
      + (select count(*) from public.stock_tracking_units
          where id in ('${returnSerialId}'::uuid, '${exchangeSerialId}'::uuid, '${replacementSerialId}'::uuid))
      + (select count(*) from public.stock_locations where branch_id = '${branchId}'::uuid)
      + (select count(*) from public.partners where id = '${customerId}'::uuid)
      + (select count(*) from public.branches where id = '${branchId}'::uuid)
    )::integer leaked
  `);
  if (leak.leaked !== 0) throw new Error(`Post-sale concurrency cleanup leaked ${leak.leaked} rows`);
}
