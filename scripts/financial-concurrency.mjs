import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.FINANCIAL_CONCURRENCY_DATABASE_URL;
const testTenantId = process.env.FINANCIAL_CONCURRENCY_TEST_TENANT_ID;
if (!connectionString) {
  throw new Error('FINANCIAL_CONCURRENCY_DATABASE_URL is required');
}
if (!testTenantId) {
  throw new Error('FINANCIAL_CONCURRENCY_TEST_TENANT_ID must identify an isolated test tenant');
}

const fixturePath = new URL('../supabase/tests/financial_core_concurrency_runtime.sql', import.meta.url);
const fixtureSql = await readFile(fixturePath, 'utf8');
const sections = new Map();
let current;
for (const line of fixtureSql.split(/\r?\n/u)) {
  const marker = line.match(/^-- @section ([a-z0-9_-]+)$/u);
  if (marker) {
    current = marker[1];
    sections.set(current, []);
  } else if (current) {
    sections.get(current).push(line);
  }
}

const sql = (name) => {
  const lines = sections.get(name);
  if (!lines) throw new Error(`Missing SQL section: ${name}`);
  return lines.join('\n');
};

const connect = async () => {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("set statement_timeout = '15s'");
  await client.query("set lock_timeout = '10s'");
  return client;
};

const waitFor = async (probe, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for deterministic database synchronization point');
};

const control = await connect();
const sessionA = await connect();
const sessionB = await connect();
let context;

try {
  context = (await control.query(sql('context'), [testTenantId])).rows[0];
  if (!context) throw new Error('The isolated test tenant has no eligible owner');

  await control.query(sql('open-period'), [context.tenant_id, context.owner_auth]);

  await sessionA.query('begin');
  await sessionA.query(sql('authenticate'), [context.owner_auth]);
  await sessionA.query(sql('validate-open'), [context.tenant_id]);

  const closeStarted = sessionB.query('begin').then(() =>
    sessionB.query(sql('authenticate'), [context.owner_auth])
  ).then(() => sessionB.query(sql('close-period'), [context.tenant_id]));

  await waitFor(async () => (await control.query(sql('assert-close-waiting'))).rows[0].waiting);
  await sessionA.query('commit');
  await closeStarted;
  await sessionB.query('commit');

  await sessionA.query('begin');
  await sessionA.query(sql('authenticate'), [context.owner_auth]);
  let rejected = false;
  try {
    await sessionA.query(sql('validate-closed'), [context.tenant_id]);
  } catch (error) {
    rejected = error.code === '23514' && error.message === 'FINANCIAL_PERIOD_CLOSED';
  }
  await sessionA.query('rollback');
  if (!rejected) throw new Error('Closed-period validation did not reject after serialized close');

  console.log(JSON.stringify({ period_lock_race: 'passed', independent_sessions: 2 }));
} finally {
  await Promise.allSettled([
    sessionA.query('rollback'),
    sessionB.query('rollback'),
  ]);
  if (context) {
    await control.query(sql('restore-period'), [
      context.tenant_id,
      context.owner_auth,
      context.original_locked_through,
      context.original_active,
    ]).catch(() => {});
  }
  await Promise.allSettled([control.end(), sessionA.end(), sessionB.end()]);
}
