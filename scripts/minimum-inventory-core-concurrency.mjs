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
if (!context) throw new Error('No eligible owner exists for concurrency proof');

const branchId = randomUUID();
const locationId = randomUUID();
const serialTemplateId = randomUUID();
const serialProductId = randomUUID();
const serialUnitId = randomUUID();
const quantityTemplateId = randomUUID();
const quantityProductId = randomUUID();
const marker = randomUUID().replaceAll('-', '').slice(0, 12);

const cleanupSql = `
  begin;
  delete from public.stock_tracking_units where id = '${serialUnitId}'::uuid;
  delete from public.stock_quants
    where tenant_id = '${context.tenant_id}'::uuid
      and product_product_id = '${quantityProductId}'::uuid
      and location_id = '${locationId}'::uuid;
  update public.product_templates set default_product_product_id = null
    where id in ('${serialTemplateId}'::uuid, '${quantityTemplateId}'::uuid);
  delete from public.product_products
    where id in ('${serialProductId}'::uuid, '${quantityProductId}'::uuid);
  delete from public.product_templates
    where id in ('${serialTemplateId}'::uuid, '${quantityTemplateId}'::uuid);
  delete from public.stock_locations
    where branch_id = '${branchId}'::uuid and tenant_id = '${context.tenant_id}'::uuid;
  delete from public.branches where id = '${branchId}'::uuid;
  commit;
`;

const reservationAttempt = ({ kind, sourceId, idempotencyKey, holdSeconds }) => {
  const lines = kind === 'serial'
    ? `jsonb_build_array(jsonb_build_object(
        'product_id', '${serialProductId}'::uuid,
        'quantity', 1,
        'tracking_unit_id', '${serialUnitId}'::uuid
      ))`
    : `jsonb_build_array(jsonb_build_object(
        'product_id', '${quantityProductId}'::uuid,
        'quantity', 1
      ))`;
  return `
    begin;
    set local lock_timeout = '${holdSeconds ? 20 : 2}s';
    select set_config('request.jwt.claim.sub', '${context.owner_auth}', true);
    set local role authenticated;
    select public.reserve_inventory(
      '${branchId}'::uuid,
      '${locationId}'::uuid,
      'inventory_concurrency',
      '${sourceId}',
      ${lines},
      '${idempotencyKey}'
    );
    ${holdSeconds ? `select pg_sleep(${holdSeconds});` : ''}
    rollback;
  `;
};

const runRace = async (kind) => {
  const first = asyncQuery(reservationAttempt({
    kind,
    sourceId: `${kind}-session-a-${marker}`,
    idempotencyKey: `${kind}-session-a-${marker}`,
    holdSeconds: 7,
  }));
  await delay(1_500);
  const secondStarted = Date.now();
  const second = asyncQuery(reservationAttempt({
    kind,
    sourceId: `${kind}-session-b-${marker}`,
    idempotencyKey: `${kind}-session-b-${marker}`,
    holdSeconds: 0,
  }));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const secondElapsedMs = Date.now() - secondStarted;
  if (firstResult.status !== 0) {
    throw new Error(`${kind} session A did not complete its reservation: ${firstResult.stderr || firstResult.stdout}`);
  }
  if (secondResult.status === 0) {
    throw new Error(`${kind} session B unexpectedly acquired the same stock resource`);
  }
  const secondMessage = `${secondResult.stderr}\n${secondResult.stdout}`;
  if (!secondMessage.includes('lock timeout')) {
    throw new Error(`${kind} session B failed for an unexpected reason: ${secondMessage}`);
  }
  if (secondElapsedMs < 1_500) {
    throw new Error(`${kind} session B did not contend on the database row lock (${secondElapsedMs}ms)`);
  }
  return { first_status: 'reserved', second_status: 'lock_rejected', second_elapsed_ms: secondElapsedMs };
};

try {
  syncQuery(`
    begin;
    insert into public.branches (id, tenant_id, name, code, is_active)
    values ('${branchId}', '${context.tenant_id}', 'Inventory concurrency ${marker}', 'ICC${marker.slice(0, 5)}', true);
    insert into public.stock_locations (
      id, tenant_id, branch_id, code, name, location_type, is_active
    ) values (
      '${locationId}', '${context.tenant_id}', '${branchId}',
      'ICL${marker.slice(0, 5)}', 'Inventory concurrency location', 'internal', true
    );
    insert into public.product_templates (
      id, tenant_id, name, internal_reference, product_type, tracking,
      can_be_sold, is_active, sale_price
    ) values
      ('${serialTemplateId}', '${context.tenant_id}', 'Concurrency serial ${marker}', 'ICS${marker}', 'goods', 'serial', true, true, 1),
      ('${quantityTemplateId}', '${context.tenant_id}', 'Concurrency quantity ${marker}', 'ICQ${marker}', 'goods', 'none', true, true, 1);
    insert into public.product_products (
      id, tenant_id, product_template_id, display_name, sku, tracking,
      is_active, sale_price
    ) values
      ('${serialProductId}', '${context.tenant_id}', '${serialTemplateId}', 'Concurrency serial ${marker}', 'ICS${marker}', 'serial', true, 1),
      ('${quantityProductId}', '${context.tenant_id}', '${quantityTemplateId}', 'Concurrency quantity ${marker}', 'ICQ${marker}', 'none', true, 1);
    update public.product_templates template set default_product_product_id = product.id
    from public.product_products product
    where template.id in ('${serialTemplateId}'::uuid, '${quantityTemplateId}'::uuid)
      and product.product_template_id = template.id;
    insert into public.stock_tracking_units (
      id, tenant_id, product_product_id, product_template_id,
      tracking_type, tracking_number, status, data_status,
      incomplete_reason, current_location_id
    ) values (
      '${serialUnitId}', '${context.tenant_id}', '${serialProductId}',
      '${serialTemplateId}', 'serial', 'ICU${marker}', 'in_stock',
      'complete', null, '${locationId}'
    );
    insert into public.stock_quants (
      tenant_id, product_product_id, product_template_id, location_id,
      quantity_on_hand, reserved_quantity
    ) values (
      '${context.tenant_id}', '${quantityProductId}', '${quantityTemplateId}',
      '${locationId}', 1, 0
    );
    commit;
  `);

  const serialRace = await runRace('serial');
  const quantityRace = await runRace('quantity');

  const [postState] = syncQuery(`
    select
      (select status from public.stock_tracking_units where id = '${serialUnitId}'::uuid) unit_status,
      (select quantity_on_hand from public.stock_quants
        where tenant_id = '${context.tenant_id}'::uuid
          and product_product_id = '${quantityProductId}'::uuid
          and location_id = '${locationId}'::uuid) quantity_on_hand,
      (select count(*)::integer from public.inventory_reservations
        where tenant_id = '${context.tenant_id}'::uuid
          and source_type = 'inventory_concurrency'
          and source_id like '%${marker}') reservations,
      (select count(*)::integer from public.inventory_events
        where tenant_id = '${context.tenant_id}'::uuid
          and source_type = 'inventory_concurrency'
          and source_id like '%${marker}') events,
      (select count(*)::integer from public.inventory_tracking_unit_states
        where tenant_id = '${context.tenant_id}'::uuid
          and tracking_unit_id = '${serialUnitId}'::uuid) canonical_states
  `);
  if (postState.unit_status !== 'in_stock'
      || Number(postState.quantity_on_hand) !== 1
      || postState.reservations !== 0
      || postState.events !== 0
      || postState.canonical_states !== 0) {
    throw new Error(`Concurrency transaction leaked state: ${JSON.stringify(postState)}`);
  }

  console.log(JSON.stringify({
    independent_sessions_per_race: 2,
    serial_same_unit_race: serialRace,
    quantity_on_hand_one_race: quantityRace,
    one_reservation_completed_per_race: true,
    competing_reservation_failed_on_resource_lock: true,
    duplicate_reservations: postState.reservations,
    invalid_tracking_states: postState.canonical_states,
    quantity_after_rollback: Number(postState.quantity_on_hand),
    rollback_safe: true,
  }));
} finally {
  syncQuery(cleanupSql);
  const [leak] = syncQuery(`
    select (
      (select count(*) from public.stock_tracking_units where id = '${serialUnitId}'::uuid)
      + (select count(*) from public.stock_quants where product_product_id = '${quantityProductId}'::uuid)
      + (select count(*) from public.product_products where id in ('${serialProductId}'::uuid, '${quantityProductId}'::uuid))
      + (select count(*) from public.product_templates where id in ('${serialTemplateId}'::uuid, '${quantityTemplateId}'::uuid))
      + (select count(*) from public.stock_locations where branch_id = '${branchId}'::uuid)
      + (select count(*) from public.branches where id = '${branchId}'::uuid)
    )::integer as leaked
  `);
  if (leak.leaked !== 0) throw new Error(`Concurrency fixture cleanup leaked ${leak.leaked} rows`);
}
