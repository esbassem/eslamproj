import { randomUUID } from 'node:crypto';
import pg from 'pg';

const tenantId = process.env.CANONICAL_SALE_POSTING_TEST_TENANT_ID;
const ownerAuthId = process.env.CANONICAL_SALE_POSTING_TEST_OWNER_AUTH_ID;
const customerId = process.env.CANONICAL_SALE_POSTING_TEST_CUSTOMER_ID;
const connectionString = process.env.CANONICAL_SALE_POSTING_DATABASE_URL;

if (!tenantId || !ownerAuthId || !customerId) {
  throw new Error(
    'CANONICAL_SALE_POSTING_TEST_TENANT_ID, _OWNER_AUTH_ID, and _CUSTOMER_ID are required',
  );
}

const connect = async () => {
  const client = new pg.Client({
    ...(connectionString ? { connectionString } : {}),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query('set role postgres');
  await client.query("set statement_timeout = '20s'");
  return client;
};

const authenticate = async (client) => {
  await client.query('begin');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerAuthId]);
  await client.query('set local role authenticated');
};

const callContract = (client, values) => client.query(
  `select public.post_financial_sale(
    $1::uuid, $2::text, $3::text, $4::text, $5::integer,
    $6::text, $7::text, $8::uuid, $9::numeric, $10::text,
    current_date, null::uuid, $11::text
  ) as result`,
  values,
);

const waitFor = async (probe, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for the second session to block on the contract lock');
};

const control = await connect();
const sessionA = await connect();
const sessionB = await connect();
const marker = randomUUID();
const sourceId = `phase2a-concurrency-${marker}`;
const idempotencyKey = `phase2a-concurrency-key-${marker}`;
const values = [
  tenantId,
  'concurrency_test',
  'commercial_sale',
  sourceId,
  1,
  idempotencyKey,
  'a'.repeat(64),
  customerId,
  '999.99',
  'EGP',
  `CONCURRENCY-${marker}`,
];

let baseline;
try {
  baseline = (await control.query(`select
    (select count(*)::bigint from public.account_moves where state = 'posted') as moves,
    (select count(*)::bigint from public.account_move_lines where parent_state = 'posted') as lines,
    (select count(*)::bigint from public.account_partial_reconcile) as partials,
    (select coalesce(sum(debit), 0)::text from public.account_move_lines where parent_state = 'posted') as debit,
    (select coalesce(sum(credit), 0)::text from public.account_move_lines where parent_state = 'posted') as credit
  `)).rows[0];

  await authenticate(sessionA);
  await authenticate(sessionB);
  const sessionBPid = (await sessionB.query('select pg_backend_pid() as pid')).rows[0].pid;

  const first = (await callContract(sessionA, values)).rows[0].result;
  const secondPending = callContract(sessionB, values);

  await waitFor(async () => {
    const result = await control.query(
      `select exists(
        select 1 from pg_catalog.pg_locks
        where pid = $1 and locktype = 'advisory' and not granted
      ) as waiting`,
      [sessionBPid],
    );
    return result.rows[0].waiting;
  });

  const invisibleBeforeCommit = (await control.query(
    `select count(*)::integer as count
     from public.financial_sale_postings
     where tenant_id = $1 and source_app = 'concurrency_test' and source_id = $2`,
    [tenantId, sourceId],
  )).rows[0].count;
  if (invisibleBeforeCommit !== 0) {
    throw new Error('Uncommitted posting became visible outside its transaction');
  }

  await sessionA.query('rollback');
  const second = (await secondPending).rows[0].result;
  const visibleInsideSecond = (await sessionB.query(
    `select
      (select count(*)::integer from public.financial_sale_postings
       where tenant_id = $1 and source_app = 'concurrency_test' and source_id = $2) as postings,
      (select count(*)::integer from public.account_moves
       where ref = 'financial_sale_posting:' || $3::text) as moves,
      (select count(*)::integer from public.account_move_lines
       where move_id = $4::uuid) as lines`,
    [tenantId, sourceId, second.posting_id, second.account_move_id],
  )).rows[0];
  if (visibleInsideSecond.postings !== 1 || visibleInsideSecond.moves !== 1 || visibleInsideSecond.lines !== 2) {
    throw new Error(`Concurrent logical cardinality failed: ${JSON.stringify(visibleInsideSecond)}`);
  }
  await sessionB.query('rollback');

  const alternateSourceId = `phase2a-source-lock-${marker}`;
  const alternateValuesA = [
    tenantId, 'concurrency_test', 'commercial_sale', alternateSourceId, 1,
    `phase2a-source-lock-a-${marker}`, 'b'.repeat(64), customerId,
    '1001.01', 'EGP', `SOURCE-LOCK-${marker}`,
  ];
  const alternateValuesB = [...alternateValuesA];
  alternateValuesB[5] = `phase2a-source-lock-b-${marker}`;
  await authenticate(sessionA);
  await authenticate(sessionB);
  const alternateSessionBPid = (await sessionB.query('select pg_backend_pid() as pid')).rows[0].pid;
  await callContract(sessionA, alternateValuesA);
  const alternatePending = callContract(sessionB, alternateValuesB);
  await waitFor(async () => {
    const lock = await control.query(
      `select exists(
        select 1 from pg_catalog.pg_locks
        where pid = $1 and locktype = 'advisory' and not granted
      ) as waiting`,
      [alternateSessionBPid],
    );
    return lock.rows[0].waiting;
  });
  await sessionA.query('rollback');
  await alternatePending;
  const alternateCount = (await sessionB.query(
    `select count(*)::integer as count from public.financial_sale_postings
     where tenant_id = $1 and source_app = 'concurrency_test' and source_id = $2`,
    [tenantId, alternateSourceId],
  )).rows[0].count;
  if (alternateCount !== 1) {
    throw new Error(`Different keys duplicated one source/event: ${alternateCount}`);
  }
  await sessionB.query('rollback');

  const conflictSourceId = `phase2a-conflict-${marker}`;
  const conflictValuesA = [
    tenantId, 'concurrency_test', 'commercial_sale', conflictSourceId, 1,
    `phase2a-conflict-key-${marker}`, 'c'.repeat(64), customerId,
    '1002.02', 'EGP', `CONFLICT-${marker}`,
  ];
  const conflictValuesB = [...conflictValuesA];
  conflictValuesB[8] = '1002.03';
  await authenticate(sessionA);
  await authenticate(sessionB);
  await sessionB.query("set local lock_timeout = '750ms'");
  await callContract(sessionA, conflictValuesA);
  let conflictingCallFailedClosed = false;
  try {
    await callContract(sessionB, conflictValuesB);
  } catch (error) {
    conflictingCallFailedClosed = error.code === '55P03';
  }
  if (!conflictingCallFailedClosed) {
    throw new Error('Concurrent conflicting payload did not fail closed on the contract lock');
  }
  await Promise.all([sessionA.query('rollback'), sessionB.query('rollback')]);

  const after = (await control.query(`select
    (select count(*)::bigint from public.account_moves where state = 'posted') as moves,
    (select count(*)::bigint from public.account_move_lines where parent_state = 'posted') as lines,
    (select count(*)::bigint from public.account_partial_reconcile) as partials,
    (select coalesce(sum(debit), 0)::text from public.account_move_lines where parent_state = 'posted') as debit,
    (select coalesce(sum(credit), 0)::text from public.account_move_lines where parent_state = 'posted') as credit,
    (select count(*)::integer from public.financial_sale_postings
     where tenant_id = $1 and source_app = 'concurrency_test'
       and source_id = any($2::text[])) as leaked_postings
  `, [tenantId, [sourceId, alternateSourceId, conflictSourceId]])).rows[0];
  for (const key of ['moves', 'lines', 'partials', 'debit', 'credit']) {
    if (after[key] !== baseline[key]) {
      throw new Error(`Ledger fingerprint changed for ${key}: ${baseline[key]} -> ${after[key]}`);
    }
  }
  if (after.leaked_postings !== 0) throw new Error('Rollback-safe concurrency fixture leaked');

  console.log(JSON.stringify({
    independent_sessions: 2,
    second_session_waited_on_advisory_lock: true,
    maximum_visible_logical_postings: visibleInsideSecond.postings,
    same_source_different_keys_serialized: alternateCount === 1,
    concurrent_conflicting_payload_failed_closed: conflictingCallFailedClosed,
    first_transaction_rolled_back: first.posting_id !== second.posting_id,
    ledger_fingerprint_unchanged: true,
  }));
} finally {
  await Promise.allSettled([
    sessionA.query('rollback'),
    sessionB.query('rollback'),
  ]);
  await Promise.allSettled([control.end(), sessionA.end(), sessionB.end()]);
}
