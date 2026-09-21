begin;

create temporary table retirement_runtime_context as
select owner.auth_user_id,
       historical.sale_id,
       historical.financial_account_move_id,
       credit.move_id as unapplied_credit_move_id
from public.tenant_users owner
join lateral (
  select source.sale_id, source.financial_account_move_id
  from public.sale_historical_sources source
  where source.tenant_id = owner.tenant_id and source.financial_account_move_id is not null
  order by source.imported_at, source.sale_id limit 1
) historical on true
join public.account_move_lines credit
  on credit.id = '51bcc530-1f84-4054-996b-57e3e51077bf'::uuid
 and credit.tenant_id = owner.tenant_id
where owner.role = 'owner' and owner.is_active
limit 1;

grant select on retirement_runtime_context to authenticated;

select set_config('request.jwt.claim.sub', auth_user_id::text, true)
from retirement_runtime_context;
set local role authenticated;

do $$
declare context record; receipt jsonb; source jsonb; credit jsonb;
begin
  select * into strict context from retirement_runtime_context;
  receipt := public.get_sale_receipt_context(context.sale_id);
  source := public.get_financial_source_context(context.financial_account_move_id);
  credit := public.get_financial_source_context(context.unapplied_credit_move_id);
  if receipt->>'sale_id' <> context.sale_id::text or (receipt->>'historical')::boolean is not true then
    raise exception 'HISTORICAL_RECEIPT_CONTEXT_FAILED';
  end if;
  if source->>'canonical_sale_id' <> context.sale_id::text or (source->>'can_open_sale')::boolean is not true then
    raise exception 'HISTORICAL_FINANCIAL_SOURCE_CONTEXT_FAILED';
  end if;
  if credit->>'canonical_sale_id' is not null
     or credit->>'relation_to_sale' <> 'unapplied_customer_credit'
     or credit->>'resolution_state' <> 'unallocated' then
    raise exception 'UNAPPLIED_CREDIT_FALSELY_ATTACHED';
  end if;
end
$$;

reset role;
rollback;

select jsonb_build_object(
  'status','passed',
  'historical_receipt','resolved_without_legacy_table',
  'historical_financial_source','resolved_without_legacy_table',
  'unapplied_credit','unallocated'
) as final_legacy_showroom_retirement_runtime;
