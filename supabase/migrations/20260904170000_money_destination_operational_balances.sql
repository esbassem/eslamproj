begin;

create or replace function public.list_money_destination_operational_balances(
  p_tenant_id uuid,
  p_permission_code text,
  p_access_type text default 'view',
  p_branch_id uuid default null,
  p_destination_types text[] default null
)
returns table (
  destination_id uuid,
  balance numeric,
  currency_code text,
  calculated_at timestamptz
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with allowed as materialized (
    select item.destination_id, item.ledger_account_id
    from public.list_allowed_money_destinations(
      p_tenant_id,
      p_permission_code,
      p_access_type,
      p_branch_id,
      p_destination_types
    ) item
  )
  select
    allowed.destination_id,
    round(coalesce(sum(line.debit - line.credit), 0), 2) as balance,
    case when count(distinct line.currency_code) <= 1 then max(line.currency_code)::text else null end,
    statement_timestamp() as calculated_at
  from allowed
  left join public.account_move_lines line
    on line.tenant_id = p_tenant_id
   and line.account_id = allowed.ledger_account_id
   and line.parent_state = 'posted'
  group by allowed.destination_id
  order by allowed.destination_id
$$;

revoke all on function public.list_money_destination_operational_balances(uuid,text,text,uuid,text[])
from public, anon;
grant execute on function public.list_money_destination_operational_balances(uuid,text,text,uuid,text[])
to authenticated;

comment on function public.list_money_destination_operational_balances(uuid,text,text,uuid,text[]) is
  'Permission- and resource-scope-aware aggregate balance for active canonical Money Destinations. Returns no ledger, account, or journal identifiers.';

commit;
