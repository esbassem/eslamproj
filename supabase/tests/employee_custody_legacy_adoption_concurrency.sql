-- Consumed by scripts/employee-custody-adoption-concurrency.mjs. Each command
-- runs through a genuinely independent PostgreSQL session. Both business-data
-- transactions are rolled back, so the selected tenant retains no fixture.

-- @section context
select owner.tenant_id, owner.auth_user_id owner_auth, employee.id employee_id
from public.tenant_users owner
join lateral (
  select candidate.id
  from public.tenant_users candidate
  where candidate.tenant_id = owner.tenant_id and candidate.is_active
    and candidate.id <> owner.id
    and not exists (
      select 1 from public.account_accounts account
      where account.tenant_id = candidate.tenant_id
        and account.responsible_user_id = candidate.id and account.active
    )
    and not exists (
      select 1 from public.money_destinations destination
      where destination.tenant_id = candidate.tenant_id
        and destination.destination_type = 'employee_cash_custody'
        and destination.responsible_user_id = candidate.id
    )
  order by candidate.id limit 1
) employee on true
where owner.tenant_id = $1::uuid and owner.role = 'owner'
  and owner.is_active and owner.auth_user_id is not null
limit 1;

-- @section authenticate
select set_config('request.jwt.claim.sub', $1::text, true);
set local role authenticated;

-- @section create-a
select public.create_and_provision_money_destination(
  $1::uuid, 'custody_concurrency_a', 'Concurrent custody A',
  'employee_cash_custody', null, $2::uuid, null,
  null, null, null, '{}'::jsonb, true
);

-- @section create-b
select public.create_and_provision_money_destination(
  $1::uuid, 'custody_concurrency_b', 'Concurrent custody B',
  'employee_cash_custody', null, $2::uuid, null,
  null, null, null, '{}'::jsonb, true
);

-- @section assert-waiting
select exists (
  select 1 from pg_catalog.pg_locks blocked
  join pg_catalog.pg_stat_activity activity on activity.pid = blocked.pid
  where not blocked.granted and blocked.locktype = 'advisory'
    and activity.query like '%create_and_provision_money_destination%'
) waiting;

-- @section assert-single-in-session
select count(*)::integer destination_count
from public.money_destinations
where tenant_id = $1::uuid and destination_type = 'employee_cash_custody'
  and responsible_user_id = $2::uuid
  and destination_key like 'custody_concurrency_%';
