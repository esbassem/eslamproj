begin;

-- Phase 10B.4 deterministic two-session reproduction:
-- allocation validated date D, a concurrent session closed through D and
-- committed, then the allocation committed.  Period-policy writers already
-- use this tenant lock, so make posting-date readers join the same ordering.
create or replace function public.assert_financial_posting_date(
  p_tenant uuid,
  p_date date
) returns date
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  locked date;
  future_allowed boolean := false;
begin
  if p_tenant is null or p_date is null then
    raise exception using
      errcode = '22023',
      message = 'FINANCIAL_POSTING_DATE_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('financial-period:' || p_tenant, 0)
  );

  select policy.allow_future_posting
  into future_allowed
  from public.financial_posting_policies policy
  where policy.tenant_id = p_tenant;

  if p_date > current_date and not coalesce(future_allowed, false) then
    raise exception using
      errcode = '23514',
      message = 'FUTURE_FINANCIAL_POSTING_DATE_NOT_ALLOWED';
  end if;

  select period.locked_through_date
  into locked
  from public.financial_period_locks period
  where period.tenant_id = p_tenant
    and period.active;

  if locked is not null and p_date <= locked then
    raise exception using
      errcode = '23514',
      message = 'FINANCIAL_PERIOD_CLOSED';
  end if;

  return p_date;
end
$$;

comment on function public.assert_financial_posting_date(uuid, date) is
  'Serializes posting-date validation with tenant period-policy changes and rejects future or closed-period dates.';

commit;
