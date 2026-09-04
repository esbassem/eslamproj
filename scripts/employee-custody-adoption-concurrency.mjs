import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.FINANCIAL_CONCURRENCY_DATABASE_URL;
const testTenantId = process.env.FINANCIAL_CONCURRENCY_TEST_TENANT_ID;
if (!connectionString) throw new Error('FINANCIAL_CONCURRENCY_DATABASE_URL is required');
if (!testTenantId) throw new Error('FINANCIAL_CONCURRENCY_TEST_TENANT_ID is required');

const fixturePath = new URL('../supabase/tests/employee_custody_legacy_adoption_concurrency.sql', import.meta.url);
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
const sql = (name) => sections.get(name)?.join('\n') ?? (() => { throw new Error(`Missing SQL section: ${name}`); })();
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
  throw new Error('Timed out waiting for employee-custody advisory lock');
};

const control = await connect();
const sessionA = await connect();
const sessionB = await connect();
try {
  const context = (await control.query(sql('context'), [testTenantId])).rows[0];
  if (!context) throw new Error('No isolated employee-custody concurrency fixture is available');

  await sessionA.query('begin');
  await sessionA.query(sql('authenticate'), [context.owner_auth]);
  await sessionA.query(sql('create-a'), [context.tenant_id, context.employee_id]);

  const second = sessionB.query('begin')
    .then(() => sessionB.query(sql('authenticate'), [context.owner_auth]))
    .then(() => sessionB.query(sql('create-b'), [context.tenant_id, context.employee_id]));

  await waitFor(async () => (await control.query(sql('assert-waiting'))).rows[0].waiting);
  await sessionA.query('rollback');
  await second;

  const count = (await sessionB.query(sql('assert-single-in-session'), [context.tenant_id, context.employee_id])).rows[0].destination_count;
  if (count !== 1) throw new Error(`Expected one logical custody, received ${count}`);
  await sessionB.query('rollback');
  console.log(JSON.stringify({ employee_custody_lock: 'passed', independent_sessions: 2, logical_custodies: 1 }));
} finally {
  await Promise.allSettled([sessionA.query('rollback'), sessionB.query('rollback')]);
  await Promise.allSettled([control.end(), sessionA.end(), sessionB.end()]);
}
