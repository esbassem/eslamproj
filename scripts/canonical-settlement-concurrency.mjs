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
  let settled = false;
  const finish = (status) => {
    if (settled) return;
    settled = true;
    resolve({ status, stdout, stderr });
  };
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('exit', finish);
  child.on('error', (error) => {
    stderr = error.message;
    finish(-1);
  });
});

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const [context] = syncQuery(`
  select owner.tenant_id, owner.id owner_id, owner.auth_user_id owner_auth
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
if (!context) throw new Error('No financially ready owner exists for Settlement concurrency proof');

const marker = randomUUID().replaceAll('-', '').slice(0, 12);
const branchId = randomUUID();
const customerId = randomUUID();
const productTemplateId = randomUUID();
const productId = randomUUID();
const paymentMethodId = randomUUID();
let destinationId;
const sales = [];
const commandKeys = [];
const saleYear = new Date().getUTCFullYear();
const [sequenceBefore] = syncQuery(`
  select exists(select 1 from public.sale_number_sequences
    where tenant_id = '${context.tenant_id}'::uuid and sale_year = ${saleYear}) had_row,
    coalesce((select last_value from public.sale_number_sequences
      where tenant_id = '${context.tenant_id}'::uuid and sale_year = ${saleYear}), 0)::integer last_value
`);

const authenticatedTransaction = (body, holdSeconds = 0) => `
  begin;
  set local lock_timeout = '15s';
  select set_config('request.jwt.claim.sub', '${context.owner_auth}', true);
  set local role authenticated;
  ${body}
  ${holdSeconds ? `select pg_sleep(${holdSeconds});` : ''}
  commit;
`;

const createConfirmedSale = (name) => {
  const createKey = `settlement-race-${name}-create-${marker}`;
  const updateKey = `settlement-race-${name}-update-${marker}`;
  const confirmKey = `settlement-race-${name}-confirm-${marker}`;
  commandKeys.push(createKey, updateKey, confirmKey);
  syncQuery(authenticatedTransaction(`
    select public.create_sale(
      '${branchId}'::uuid, '${customerId}'::uuid, current_date,
      'EGP', '${name}', '${createKey}'
    );
  `));
  const [sale] = syncQuery(`select id from public.sales
    where tenant_id = '${context.tenant_id}'::uuid
      and create_idempotency_key = '${createKey}'`);
  if (!sale) throw new Error(`Failed to create Settlement race Sale ${name}`);
  syncQuery(authenticatedTransaction(`
    select public.update_sale_draft(
      '${sale.id}'::uuid, 1, '${branchId}'::uuid, '${customerId}'::uuid,
      current_date, 'EGP', '${name}',
      jsonb_build_array(jsonb_build_object(
        'product_id', '${productId}'::uuid, 'quantity', 1, 'unit_price', 10000
      )), '${updateKey}'
    );
    select public.confirm_sale('${sale.id}'::uuid, 2, '[]'::jsonb, '${confirmKey}');
  `));
  sales.push({ id: sale.id, name });
  return sale;
};

const settlementCall = (saleId, amount, key) => `
  select public.settle_obligation(
    'sale', '${saleId}', 'money_payment', ${amount},
    '${paymentMethodId}'::uuid, '${key}', '${destinationId}'::uuid,
    null, 'Settlement true-concurrency proof'
  );
`;

const assertCardinality = (saleId, residual, expectedSettlements = 1) => {
  const [actual] = syncQuery(`
    select
      line.amount_residual::numeric residual,
      (select count(*) from public.financial_payments payment
        where payment.source_app = 'settlement' and payment.source_model = 'sale'
          and payment.source_id = '${saleId}')::integer payments,
      (select count(*) from public.financial_payment_allocations allocation
        join public.financial_payments payment on payment.id = allocation.payment_id
        where payment.source_app = 'settlement' and payment.source_model = 'sale'
          and payment.source_id = '${saleId}')::integer allocations,
      (select count(*) from public.financial_payment_accounting_links link
        join public.financial_payments payment on payment.id = link.payment_id
        where payment.source_app = 'settlement' and payment.source_model = 'sale'
          and payment.source_id = '${saleId}')::integer posting_links,
      (select count(*) from public.obligation_settlements settlement
        where settlement.target_type = 'sale' and settlement.target_id = '${saleId}')::integer settlements,
      (select count(*) from public.obligation_settlement_components component
        join public.obligation_settlements settlement on settlement.id = component.settlement_id
        where settlement.target_type = 'sale' and settlement.target_id = '${saleId}')::integer components
    from public.sale_confirmation_links confirmation
    join public.financial_sale_postings posting
      on posting.id = confirmation.financial_sale_posting_id
    join public.account_move_lines line on line.id = posting.receivable_line_id
    where confirmation.sale_id = '${saleId}'::uuid
  `);
  if (!actual || Number(actual.residual) !== residual
      || Number(actual.payments) !== expectedSettlements
      || Number(actual.allocations) !== expectedSettlements
      || Number(actual.posting_links) !== expectedSettlements
      || Number(actual.settlements) !== expectedSettlements
      || Number(actual.components) !== expectedSettlements) {
    throw new Error(`Settlement race cardinality failed for ${saleId}: ${JSON.stringify(actual)}`);
  }
};

const runCompetingRace = async ({ name, saleId, firstAmount, secondAmount, expectedError, residual }) => {
  const firstKey = `settlement-race-${name}-a-${marker}`;
  const secondKey = `settlement-race-${name}-b-${marker}`;
  commandKeys.push(firstKey, secondKey);
  const first = asyncQuery(authenticatedTransaction(settlementCall(saleId, firstAmount, firstKey), 5));
  await delay(1_000);
  const secondStarted = Date.now();
  const second = asyncQuery(authenticatedTransaction(settlementCall(saleId, secondAmount, secondKey)));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const waitMs = Date.now() - secondStarted;
  if (firstResult.status !== 0) {
    throw new Error(`${name} writer A failed:\n${firstResult.stderr}\n${firstResult.stdout}`);
  }
  const secondMessage = `${secondResult.stderr}\n${secondResult.stdout}`;
  if (secondResult.status === 0 || !secondMessage.includes(expectedError)) {
    throw new Error(`${name} writer B did not fail after seeing committed residual: ${secondMessage}`);
  }
  if (waitMs < 3_500) {
    throw new Error(`${name} writer B did not wait on the target lock (${waitMs}ms)`);
  }
  assertCardinality(saleId, residual);
  return { winner: 'committed', competitor: expectedError, competitor_wait_ms: waitMs };
};

const runIdempotencyRace = async (saleId) => {
  const key = `settlement-race-idempotency-${marker}`;
  commandKeys.push(key);
  const first = asyncQuery(authenticatedTransaction(settlementCall(saleId, 4000, key), 5));
  await delay(1_000);
  const secondStarted = Date.now();
  const second = asyncQuery(authenticatedTransaction(settlementCall(saleId, 4000, key)));
  const [firstResult, secondResult] = await Promise.all([first, second]);
  const waitMs = Date.now() - secondStarted;
  if (firstResult.status !== 0 || secondResult.status !== 0) {
    throw new Error(`Idempotency race failed:\nA=${firstResult.stderr}\nB=${secondResult.stderr}`);
  }
  if (waitMs < 3_500) {
    throw new Error(`Idempotency retry did not wait on the command lock (${waitMs}ms)`);
  }
  assertCardinality(saleId, 6000);
  const [command] = syncQuery(`select count(*)::integer command_count,
    count(distinct result ->> 'settlement_id')::integer logical_results
    from public.obligation_settlement_commands
    where tenant_id = '${context.tenant_id}'::uuid and idempotency_key = '${key}'`);
  if (Number(command.command_count) !== 1 || Number(command.logical_results) !== 1) {
    throw new Error(`Idempotency command cardinality failed: ${JSON.stringify(command)}`);
  }
  return { callers: 2, logical_settlements: 1, retry_wait_ms: waitMs };
};

const cleanup = () => {
  const saleIds = sales.length
    ? sales.map((sale) => `'${sale.id}'::uuid`).join(',')
    : "'00000000-0000-0000-0000-000000000000'::uuid";
  const sourceIds = sales.length ? sales.map((sale) => `'${sale.id}'`).join(',') : "''";
  const keyValues = commandKeys.length ? commandKeys.map((key) => `'${key}'`).join(',') : "''";
  const expectedSequence = Number(sequenceBefore.last_value) + sales.length;
  syncQuery(`
    begin;
    create temporary table cleanup_settlement_payments as
      select payment.id from public.financial_payments payment
      where payment.source_app = 'settlement' and payment.source_model = 'sale'
        and payment.source_id in (${sourceIds});
    create temporary table cleanup_settlement_payment_moves as
      select link.account_move_id from public.financial_payment_accounting_links link
      where link.payment_id in (select id from cleanup_settlement_payments);
    create temporary table cleanup_settlement_partials as
      select allocation.partial_reconcile_id from public.financial_payment_allocations allocation
      where allocation.payment_id in (select id from cleanup_settlement_payments);
    create temporary table cleanup_sale_postings as
      select posting.id, posting.account_move_id
      from public.financial_sale_postings posting
      where posting.source_app = 'sales_core' and posting.source_model = 'sale'
        and posting.source_id in (${sourceIds});
    set local session_replication_role = replica;
    delete from public.obligation_settlement_events where settlement_id in (
      select id from public.obligation_settlements where target_type = 'sale' and target_id in (${sourceIds})
    );
    delete from public.obligation_settlement_components where settlement_id in (
      select id from public.obligation_settlements where target_type = 'sale' and target_id in (${sourceIds})
    );
    delete from public.obligation_settlements where target_type = 'sale' and target_id in (${sourceIds});
    delete from public.obligation_settlement_commands
      where tenant_id = '${context.tenant_id}'::uuid
        and idempotency_key in (${keyValues});
    delete from public.financial_payment_allocations
      where payment_id in (select id from cleanup_settlement_payments);
    delete from public.account_partial_reconcile
      where id in (select partial_reconcile_id from cleanup_settlement_partials);
    delete from public.financial_payment_accounting_links
      where payment_id in (select id from cleanup_settlement_payments);
    delete from public.financial_payment_events
      where payment_id in (select id from cleanup_settlement_payments);
    delete from public.account_move_lines
      where move_id in (select account_move_id from cleanup_settlement_payment_moves);
    delete from public.account_moves
      where id in (select account_move_id from cleanup_settlement_payment_moves);
    delete from public.financial_payments where id in (select id from cleanup_settlement_payments);
    delete from public.sale_confirmation_links where sale_id in (${saleIds});
    delete from public.financial_engine_bindings
      where source_app = 'sales_core' and source_model = 'sale' and source_id in (${sourceIds});
    delete from public.account_move_lines
      where move_id in (select account_move_id from cleanup_sale_postings);
    delete from public.account_moves
      where id in (select account_move_id from cleanup_sale_postings);
    delete from public.financial_sale_postings where id in (select id from cleanup_sale_postings);
    delete from public.sale_events where sale_id in (${saleIds});
    delete from public.sale_lines where sale_id in (${saleIds});
    delete from public.sales where id in (${saleIds});
    delete from public.sales_command_requests
      where tenant_id = '${context.tenant_id}'::uuid and idempotency_key in (${keyValues});
    delete from public.financial_payment_methods where id = '${paymentMethodId}'::uuid;
    update public.product_templates set default_product_product_id = null
      where id = '${productTemplateId}'::uuid;
    delete from public.product_products where id = '${productId}'::uuid;
    delete from public.product_templates where id = '${productTemplateId}'::uuid;
    delete from public.account_functional_accounts where branch_id = '${branchId}'::uuid;
    delete from public.money_destinations where id = '${destinationId}'::uuid;
    delete from public.account_journals where branch_id = '${branchId}'::uuid;
    delete from public.account_accounts
      where money_destination_id = '${destinationId}'::uuid;
    delete from public.partners where id = '${customerId}'::uuid;
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
    values ('${branchId}', '${context.tenant_id}', 'Settlement race ${marker}', 'STR${marker.slice(0, 5)}', true);
    insert into public.partners (
      id, tenant_id, branch_id, name, contact_type, is_company,
      is_external_contact, customer_rank, supplier_rank, financer_rank, active
    ) values (
      '${customerId}', '${context.tenant_id}', '${branchId}', 'Settlement race customer',
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
    ) values (
      '${productTemplateId}', '${context.tenant_id}', 'Settlement race service ${marker}',
      'STR${marker}', 'service', 'none', true, true, 10000
    );
    insert into public.product_products (
      id, tenant_id, product_template_id, display_name, sku, tracking, is_active, sale_price
    ) values (
      '${productId}', '${context.tenant_id}', '${productTemplateId}',
      'Settlement race service ${marker}', 'STR${marker}', 'none', true, 10000
    );
    update public.product_templates set default_product_product_id = '${productId}'::uuid
      where id = '${productTemplateId}'::uuid;
    insert into public.financial_payment_methods (
      id, tenant_id, name, semantic_key, method_type, settlement_mode,
      is_active, requires_reference, requires_confirmation, created_by
    ) values (
      '${paymentMethodId}', '${context.tenant_id}', 'Settlement race cash',
      'settlement_race_${marker}', 'cash', 'direct', true, false, false, '${context.owner_id}'
    );
    commit;
  `);
  const [provisioned] = syncQuery(authenticatedTransaction(`
    select public.create_and_provision_money_destination(
      '${context.tenant_id}'::uuid, 'settlement_race_${marker}',
      'Settlement race cashbox', 'cashbox', '${branchId}'::uuid,
      null, null, null, null, null, '{}'::jsonb, true
    ) result;
  `));
  destinationId = provisioned.result.destination_id;
  if (!destinationId) throw new Error('Settlement race destination provisioning failed');

  const fullSale = createConfirmedSale('full');
  const partialSale = createConfirmedSale('partial');
  const idempotentSale = createConfirmedSale('idempotent');

  const fullRace = await runCompetingRace({
    name: 'full-residual', saleId: fullSale.id,
    firstAmount: 10000, secondAmount: 10000,
    expectedError: 'OBLIGATION_ALREADY_SETTLED', residual: 0,
  });
  const partialRace = await runCompetingRace({
    name: 'partial-overlap', saleId: partialSale.id,
    firstAmount: 7000, secondAmount: 6000,
    expectedError: 'SETTLEMENT_EXCEEDS_OUTSTANDING', residual: 3000,
  });
  const idempotencyRace = await runIdempotencyRace(idempotentSale.id);

  process.stdout.write(`${JSON.stringify({
    same_obligation_full: fullRace,
    competing_partial: partialRace,
    same_idempotency_key: idempotencyRace,
  }, null, 2)}\n`);
} finally {
  if (destinationId) cleanup();
}
