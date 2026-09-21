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
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || 'Supabase query failed');
  }
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

const delay = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});

const tenantId = '10b40000-0000-4000-8000-000000000002';
const ownerId = '10b40000-0000-4000-8000-000000000003';
const ownerAuthId = '10b40000-0000-4000-8000-000000000001';
const branchId = '10b40000-0000-4000-8000-000000000010';
const customerId = '10b40000-0000-4000-8000-000000000011';
const configId = randomUUID();
const templateId = randomUUID();
const productId = randomUUID();
const unitId = randomUUID();
const saleId = randomUUID();
const lineId = randomUUID();
const marker = randomUUID().replaceAll('-', '').slice(0, 16);

const cleanupSql = `
  begin;
  delete from public.showroom_sale_lines where id = '${lineId}'::uuid;
  delete from public.showroom_sales where id = '${saleId}'::uuid;
  delete from public.stock_tracking_units where id = '${unitId}'::uuid;
  update public.product_templates set default_product_product_id = null
    where id = '${templateId}'::uuid;
  delete from public.product_products where id = '${productId}'::uuid;
  delete from public.product_templates where id = '${templateId}'::uuid;
  delete from public.showroom_configs where id = '${configId}'::uuid;
  delete from public.tenant_modules
    where tenant_id = '${tenantId}'::uuid
      and module_id = (select id from public.ir_modules where technical_name = 'inventory');
  select set_config('app.showroom_financial_cutover_maintenance', 'authorized', true);
  delete from public.showroom_financial_cutovers
    where tenant_id = '${tenantId}'::uuid
      and source_app = 'showroom' and source_model = 'sale';
  commit;
`;

try {
  const [{ fixtures_present: fixturesPresent }] = syncQuery(`
    select (
      (select count(*) from public.showroom_financial_cutovers
       where tenant_id = '${tenantId}'::uuid
         and source_app = 'showroom' and source_model = 'sale')
      + (select count(*) from public.tenant_modules tenant_module
         join public.ir_modules module on module.id = tenant_module.module_id
         where tenant_module.tenant_id = '${tenantId}'::uuid
           and module.technical_name = 'inventory')
    )::integer as fixtures_present
  `);
  if (fixturesPresent !== 0) {
    throw new Error('Dedicated test tenant already has a Showroom cutover marker');
  }

  syncQuery(`
    begin;
    insert into public.showroom_financial_cutovers (
      tenant_id, source_app, source_model, canonical_generation, activation_origin
    ) values ('${tenantId}', 'showroom', 'sale', 2, 'phase_2d_concurrency_test');
    insert into public.tenant_modules (tenant_id, module_id, state, enabled_by)
    values ('${tenantId}',
      (select id from public.ir_modules where technical_name = 'inventory'),
      'installed', '${ownerId}');
    insert into public.showroom_configs (id, tenant_id, branch_id, name, code)
    values ('${configId}', '${tenantId}', '${branchId}',
      'Phase 2D concurrency ${marker}', 'P2D-${marker}');
    insert into public.product_templates (
      id, tenant_id, name, internal_reference, product_type, tracking, sale_price
    ) values ('${templateId}', '${tenantId}', 'Phase 2D concurrency ${marker}',
      'P2D-${marker}', 'goods', 'serial', 60000);
    insert into public.product_products (
      id, tenant_id, product_template_id, display_name, sku, tracking, sale_price
    ) values ('${productId}', '${tenantId}', '${templateId}',
      'Phase 2D concurrency ${marker}', 'P2D-${marker}', 'serial', 60000);
    update public.product_templates set default_product_product_id = '${productId}'
      where id = '${templateId}';
    insert into public.showroom_sales (
      id, tenant_id, branch_id, customer_id, sale_date, status,
      showroom_config_id, created_by, notes
    ) values ('${saleId}', '${tenantId}', '${branchId}', '${customerId}',
      current_date, 'pending_payment', '${configId}', '${ownerId}',
      'Phase 2D concurrency ${marker}');
    insert into public.stock_tracking_units (
      id, tenant_id, tracking_type, tracking_number, status, notes,
      product_product_id, product_template_id
    ) values ('${unitId}', '${tenantId}', 'serial', 'P2D-${marker}', 'reserved',
      'showroom_sale:${saleId}', '${productId}', '${templateId}');
    insert into public.showroom_sale_lines (
      id, tenant_id, sale_id, product_product_id, tracking_unit_id,
      description, quantity, unit_price, total
    ) values ('${lineId}', '${tenantId}', '${saleId}', '${productId}', '${unitId}',
      'Phase 2D concurrent line', 1, 60000, 60000);
    commit;
  `);

  const confirmationSql = (holdSeconds) => `
    begin;
    set local lock_timeout = '20s';
    select set_config('request.jwt.claim.sub', '${ownerAuthId}', true);
    set local role authenticated;
    select public.complete_showroom_sale('${saleId}', 0, null, '[]'::jsonb);
    ${holdSeconds ? `select pg_sleep(${holdSeconds});` : ''}
    rollback;
  `;

  const firstStarted = Date.now();
  const first = asyncQuery(confirmationSql(10));
  await delay(2_500);
  const secondStarted = Date.now();
  const second = asyncQuery(confirmationSql(0));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const secondElapsedMs = Date.now() - secondStarted;
  const totalElapsedMs = Date.now() - firstStarted;

  if (firstResult.status !== 0 || secondResult.status !== 0) {
    throw new Error(
      `Concurrent confirmation failed:\n${firstResult.stderr}${secondResult.stderr}`,
    );
  }
  if (secondElapsedMs < 6_000) {
    throw new Error(`Second session did not serialize on the sale lock (${secondElapsedMs}ms)`);
  }

  const [postState] = syncQuery(`
    select
      (select status from public.showroom_sales where id = '${saleId}') sale_status,
      (select account_move_id from public.showroom_sales where id = '${saleId}') account_move_id,
      (select status from public.stock_tracking_units where id = '${unitId}') unit_status,
      (select count(*)::integer from public.stock_moves where reference_id = '${saleId}') stock_moves,
      (select count(*)::integer from public.financial_sale_postings
        where source_app = 'showroom' and source_model = 'sale'
          and source_id = '${saleId}') postings,
      (select count(*)::integer from public.financial_engine_bindings
        where source_app = 'showroom' and source_model = 'sale'
          and source_id = '${saleId}') bindings
  `);
  if (postState.sale_status !== 'pending_payment'
      || postState.account_move_id !== null
      || postState.unit_status !== 'reserved'
      || postState.stock_moves !== 0
      || postState.postings !== 0
      || postState.bindings !== 0) {
    throw new Error(`Rollback state leaked: ${JSON.stringify(postState)}`);
  }

  console.log(JSON.stringify({
    independent_sessions: 2,
    same_sale_row_lock_serialized: true,
    deterministic_second_session_success_after_first_rollback: true,
    no_deadlock: true,
    second_waited_ms: secondElapsedMs,
    total_elapsed_ms: totalElapsedMs,
    duplicate_postings_after_rollback: postState.postings,
    duplicate_stock_moves_after_rollback: postState.stock_moves,
  }));
} finally {
  syncQuery(cleanupSql);
  const [{ leaked }] = syncQuery(`
    select (
      (select count(*) from public.showroom_sales where id = '${saleId}')
      + (select count(*) from public.showroom_sale_lines where id = '${lineId}')
      + (select count(*) from public.stock_tracking_units where id = '${unitId}')
      + (select count(*) from public.product_products where id = '${productId}')
      + (select count(*) from public.product_templates where id = '${templateId}')
      + (select count(*) from public.showroom_configs where id = '${configId}')
      + (select count(*) from public.showroom_financial_cutovers
          where tenant_id = '${tenantId}' and source_app = 'showroom'
            and source_model = 'sale')
    )::integer as leaked
  `);
  if (leaked !== 0) {
    throw new Error(`Concurrency fixture cleanup leaked ${leaked} rows`);
  }
}
