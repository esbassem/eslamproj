import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';

const executable = process.platform === 'win32' ? process.execPath : 'npx';
const executableArguments = process.platform === 'win32'
  ? [join(process.cwd(), 'node_modules', 'supabase', 'dist', 'supabase.js')]
  : [];
const baseArguments = [...executableArguments,
  'db', 'query', '--linked', '--output', 'json',
];

const syncQuery = (sql) => {
  const result = spawnSync(executable, [...baseArguments, sql], {
    cwd: process.cwd(),
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      result.error?.message || result.stderr || result.stdout
      || `Supabase query failed with status ${result.status}`,
    );
  }
  const jsonStart = result.stdout.indexOf('[');
  return JSON.parse(result.stdout.slice(jsonStart));
};

const asyncQuery = (sql) => new Promise((resolve) => {
  const child = spawn(executable, [...baseArguments, sql], {
    cwd: process.cwd(),
    windowsHide: true,
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

const [{ tenant_id: tenantId }] = syncQuery(`
  select tenant_id
  from public.tenant_users
  where role = 'owner' and is_active
  order by tenant_id
  limit 1
`);
const marker = randomUUID();
const conflictSource = `phase2b-conflict-${marker}`;
const sameEngineSource = `phase2b-same-engine-${marker}`;

const acquireSql = (sourceId, engine, sleepSeconds, lockTimeout = null) => `
  begin;
  ${lockTimeout ? `set local lock_timeout = '${lockTimeout}';` : ''}
  select public.acquire_financial_engine_binding(
    '${tenantId}'::uuid, 'concurrency_test', 'sale', '${sourceId}',
    1, '${engine}', 'concurrency_test', null
  );
  ${sleepSeconds ? `select pg_sleep(${sleepSeconds});` : ''}
  rollback;
`;

const legacyWinner = asyncQuery(acquireSql(conflictSource, 'legacy', 12));
await delay(4_000);
const canonicalLoser = await asyncQuery(
  acquireSql(conflictSource, 'canonical', 0, '1500ms'),
);
const legacyResult = await legacyWinner;

if (legacyResult.status !== 0) {
  throw new Error(`Legacy lock holder failed: ${legacyResult.stderr || legacyResult.stdout}`);
}
if (canonicalLoser.status === 0
    || !/lock timeout|55P03|canceling statement due to lock timeout/iu.test(
      `${canonicalLoser.stdout}\n${canonicalLoser.stderr}`,
    )) {
  throw new Error(
    `Opposing engine was not blocked fail-closed: ${canonicalLoser.stderr || canonicalLoser.stdout}`,
  );
}

const sameEngineFirst = asyncQuery(acquireSql(sameEngineSource, 'canonical', 8));
await delay(4_000);
const sameEngineSecond = asyncQuery(`
  begin;
  set local lock_timeout = '15s';
  select public.acquire_financial_engine_binding(
    '${tenantId}'::uuid, 'concurrency_test', 'sale', '${sameEngineSource}',
    1, 'canonical', 'concurrency_test', null
  );
  do $$
  begin
    if (select count(*) from public.financial_engine_bindings
        where tenant_id = '${tenantId}'::uuid
          and source_app = 'concurrency_test'
          and source_model = 'sale'
          and source_id = '${sameEngineSource}'
          and financial_event_version = 1) <> 1 then
      raise exception 'CONCURRENT_SAME_ENGINE_CARDINALITY_INVALID';
    end if;
  end
  $$;
  rollback;
`);
const [sameFirstResult, sameSecondResult] = await Promise.all([
  sameEngineFirst,
  sameEngineSecond,
]);
if (sameFirstResult.status !== 0 || sameSecondResult.status !== 0) {
  throw new Error(
    `Same-engine serialization failed: ${sameFirstResult.stderr}${sameSecondResult.stderr}`,
  );
}

const [{ leaked_bindings: leakedBindings }] = syncQuery(`
  select count(*)::integer as leaked_bindings
  from public.financial_engine_bindings
  where tenant_id = '${tenantId}'::uuid
    and source_app = 'concurrency_test'
    and source_id in ('${conflictSource}', '${sameEngineSource}')
`);
if (leakedBindings !== 0) {
  throw new Error(`Rollback-safe concurrency fixtures leaked: ${leakedBindings}`);
}

console.log(JSON.stringify({
  independent_sessions: 2,
  opposing_engines_serialized: true,
  opposing_engine_failed_closed_on_lock_timeout: true,
  same_engine_serialized_to_one_logical_binding: true,
  rollback_fixtures_leaked: leakedBindings,
}));
