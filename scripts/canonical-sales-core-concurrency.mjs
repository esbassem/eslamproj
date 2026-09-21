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

const [context] = syncQuery(`
  select tenant_id, id owner_id, auth_user_id owner_auth
  from public.tenant_users
  where role = 'owner' and is_active and auth_user_id is not null
  order by tenant_id limit 1
`);
if (!context) throw new Error('No eligible owner exists for Sales concurrency proof');

const branchId = randomUUID();
const customerId = randomUUID();
const templateId = randomUUID();
const productId = randomUUID();
const marker = randomUUID().replaceAll('-', '').slice(0, 12);
const createKey = `sales-race-create-${marker}`;
const initialUpdateKey = `sales-race-initial-${marker}`;
const writerAKey = `sales-race-a-${marker}`;
const writerBKey = `sales-race-b-${marker}`;
let saleId;

const authenticatedSql = (body) => `
  begin;
  set local lock_timeout = '20s';
  select set_config('request.jwt.claim.sub', '${context.owner_auth}', true);
  set local role authenticated;
  ${body}
  commit;
`;

const linesSql = `jsonb_build_array(jsonb_build_object(
  'product_id', '${productId}'::uuid,
  'quantity', 1,
  'unit_price', 100,
  'description', 'Concurrency service line'
))`;

const cleanup = () => {
  syncQuery(`
    begin;
    select set_config('app.canonical_sales_maintenance', 'authorized', true);
    delete from public.sale_events where sale_id = '${saleId ?? '00000000-0000-0000-0000-000000000000'}'::uuid;
    delete from public.sale_lines where sale_id = '${saleId ?? '00000000-0000-0000-0000-000000000000'}'::uuid;
    delete from public.sales where id = '${saleId ?? '00000000-0000-0000-0000-000000000000'}'::uuid;
    delete from public.sales_command_requests
      where tenant_id = '${context.tenant_id}'::uuid
        and idempotency_key in ('${createKey}', '${initialUpdateKey}', '${writerAKey}', '${writerBKey}');
    update public.product_templates set default_product_product_id = null where id = '${templateId}'::uuid;
    delete from public.product_products where id = '${productId}'::uuid;
    delete from public.product_templates where id = '${templateId}'::uuid;
    delete from public.partners where id = '${customerId}'::uuid;
    delete from public.stock_locations
      where branch_id = '${branchId}'::uuid and tenant_id = '${context.tenant_id}'::uuid;
    delete from public.branches where id = '${branchId}'::uuid;
    commit;
  `);
};

try {
  syncQuery(`
    begin;
    insert into public.branches (id, tenant_id, name, code, is_active)
    values ('${branchId}', '${context.tenant_id}', 'Sales concurrency ${marker}', 'SCR${marker.slice(0, 5)}', true);
    insert into public.partners (
      id, tenant_id, branch_id, name, contact_type, is_company,
      is_external_contact, customer_rank, supplier_rank, financer_rank, active
    ) values (
      '${customerId}', '${context.tenant_id}', '${branchId}', 'Sales concurrency customer',
      'person', false, true, 1, 0, 0, true
    );
    insert into public.product_templates (
      id, tenant_id, name, internal_reference, product_type, tracking,
      can_be_sold, is_active, sale_price
    ) values (
      '${templateId}', '${context.tenant_id}', 'Sales concurrency service ${marker}',
      'SCR${marker}', 'service', 'none', true, true, 100
    );
    insert into public.product_products (
      id, tenant_id, product_template_id, display_name, sku, tracking,
      is_active, sale_price
    ) values (
      '${productId}', '${context.tenant_id}', '${templateId}',
      'Sales concurrency service ${marker}', 'SCR${marker}', 'none', true, 100
    );
    update public.product_templates set default_product_product_id = '${productId}'::uuid
      where id = '${templateId}'::uuid;
    commit;
  `);

  syncQuery(authenticatedSql(`
    select public.create_sale(
      '${branchId}'::uuid, '${customerId}'::uuid, current_date,
      'EGP', 'Concurrency initial draft', '${createKey}'
    );
  `));
  const [created] = syncQuery(`
    select id from public.sales
    where tenant_id = '${context.tenant_id}'::uuid
      and create_idempotency_key = '${createKey}'
  `);
  if (!created) throw new Error('Sales concurrency draft was not created');
  saleId = created.id;

  syncQuery(authenticatedSql(`
    select public.update_sale_draft(
      '${saleId}'::uuid, 1, '${branchId}'::uuid, '${customerId}'::uuid,
      current_date, 'EGP', 'Concurrency base version', ${linesSql}, '${initialUpdateKey}'
    );
  `));

  const writerA = asyncQuery(authenticatedSql(`
    select public.update_sale_draft(
      '${saleId}'::uuid, 2, '${branchId}'::uuid, '${customerId}'::uuid,
      current_date, 'EGP', 'Writer A committed', ${linesSql}, '${writerAKey}'
    );
    select pg_sleep(7);
  `));
  await delay(1_500);
  const writerBStarted = Date.now();
  const writerB = asyncQuery(authenticatedSql(`
    select public.update_sale_draft(
      '${saleId}'::uuid, 2, '${branchId}'::uuid, '${customerId}'::uuid,
      current_date, 'EGP', 'Writer B must lose', ${linesSql}, '${writerBKey}'
    );
  `));

  const [writerAResult, writerBResult] = await Promise.all([writerA, writerB]);
  const writerBElapsedMs = Date.now() - writerBStarted;
  if (writerAResult.status !== 0) {
    throw new Error(`Writer A failed: ${writerAResult.stderr || writerAResult.stdout}`);
  }
  if (writerBResult.status === 0) {
    throw new Error('Writer B unexpectedly committed with the stale expected_version');
  }
  const writerBMessage = `${writerBResult.stderr}\n${writerBResult.stdout}`;
  if (!writerBMessage.includes('SALES_VERSION_CONFLICT')) {
    throw new Error(`Writer B failed for an unexpected reason: ${writerBMessage}`);
  }
  if (writerBElapsedMs < 4_000) {
    throw new Error(`Writer B did not wait on the sale row lock (${writerBElapsedMs}ms)`);
  }

  const [postState] = syncQuery(`
    select sale.version, sale.notes, sale.total_amount,
      (select count(*)::integer from public.sale_events event
        where event.sale_id = sale.id and event.event_type = 'sale_draft_updated') update_events,
      (select count(*)::integer from public.sale_events event
        where event.sale_id = sale.id and event.sale_version = 3) version_three_events,
      (select count(*)::integer from public.sales_command_requests request
        where request.tenant_id = sale.tenant_id and request.command_type = 'update_draft'
          and request.idempotency_key in ('${initialUpdateKey}', '${writerAKey}', '${writerBKey}')) update_commands,
      (select count(*)::integer from public.sales_command_requests request
        where request.tenant_id = sale.tenant_id and request.idempotency_key = '${writerBKey}') losing_commands
    from public.sales sale where sale.id = '${saleId}'::uuid
  `);
  if (!postState
      || Number(postState.version) !== 3
      || postState.notes !== 'Writer A committed'
      || Number(postState.total_amount) !== 100
      || postState.update_events !== 2
      || postState.version_three_events !== 1
      || postState.update_commands !== 2
      || postState.losing_commands !== 0) {
    throw new Error(`Unexpected Sales concurrency state: ${JSON.stringify(postState)}`);
  }

  console.log(JSON.stringify({
    independent_database_sessions: 2,
    shared_expected_version: 2,
    winning_writer: 'A',
    committed_version: Number(postState.version),
    losing_writer: 'B',
    losing_error: 'SALES_VERSION_CONFLICT',
    losing_writer_waited_ms: writerBElapsedMs,
    version_three_events: postState.version_three_events,
    losing_commands_persisted: postState.losing_commands,
    lost_update_prevented: true,
  }));
} finally {
  cleanup();
  const [leak] = syncQuery(`
    select (
      (select count(*) from public.sales where create_idempotency_key = '${createKey}')
      + (select count(*) from public.sales_command_requests
          where tenant_id = '${context.tenant_id}'::uuid
            and idempotency_key in ('${createKey}', '${initialUpdateKey}', '${writerAKey}', '${writerBKey}'))
      + (select count(*) from public.product_products where id = '${productId}'::uuid)
      + (select count(*) from public.product_templates where id = '${templateId}'::uuid)
      + (select count(*) from public.partners where id = '${customerId}'::uuid)
      + (select count(*) from public.stock_locations where branch_id = '${branchId}'::uuid)
      + (select count(*) from public.branches where id = '${branchId}'::uuid)
    )::integer as leaked
  `);
  if (leak.leaked !== 0) throw new Error(`Sales concurrency fixture cleanup leaked ${leak.leaked} rows`);
}
