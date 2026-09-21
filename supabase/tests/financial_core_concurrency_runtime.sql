-- This file is consumed by scripts/financial-concurrency.mjs.  Each command is
-- executed through a real, independent PostgreSQL connection.  The fixture
-- changes only the period-policy row for an eligible tenant and restores it in
-- the harness finally block; no business document or accounting row is used.

-- @section context
select
  owner.tenant_id,
  owner.auth_user_id as owner_auth,
  coalesce(period.locked_through_date, current_date) as original_locked_through,
  coalesce(period.active, false) as original_active
from public.tenant_users owner
left join public.financial_period_locks period on period.tenant_id = owner.tenant_id
where owner.role = 'owner'
  and owner.is_active
  and owner.auth_user_id is not null
  and owner.tenant_id = $1::uuid
limit 1;

-- @section authenticate
select set_config('request.jwt.claim.sub', $1::text, true);
set local role authenticated;

-- @section open-period
begin;
select set_config('request.jwt.claim.sub', $2::text, true);
set local role authenticated;
select public.set_financial_period_lock(
  $1::uuid,
  current_date,
  false,
  'Phase 10B.4 deterministic concurrency fixture setup'
);
commit;

-- @section restore-period
begin;
select set_config('request.jwt.claim.sub', $2::text, true);
set local role authenticated;
select public.set_financial_period_lock(
  $1::uuid,
  $3::date,
  $4::boolean,
  'Phase 10B.4 restore isolated test tenant period state'
);
commit;

-- @section validate-open
select public.assert_financial_posting_date($1::uuid, current_date);

-- @section close-period
select public.set_financial_period_lock(
  $1::uuid,
  current_date,
  true,
  'Phase 10B.4 deterministic concurrent period close'
);

-- @section assert-close-waiting
select exists(
  select 1
  from pg_catalog.pg_locks blocked
  join pg_catalog.pg_stat_activity activity on activity.pid = blocked.pid
  where not blocked.granted
    and blocked.locktype = 'advisory'
    and activity.query like '%set_financial_period_lock%'
) as waiting;

-- @section validate-closed
select public.assert_financial_posting_date($1::uuid, current_date);
