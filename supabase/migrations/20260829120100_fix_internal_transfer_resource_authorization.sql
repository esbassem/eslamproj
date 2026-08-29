begin;

create or replace function public.resolve_internal_transfer_destination(
  p_tenant_id uuid,p_destination_id uuid,p_permission text,p_access text,p_branch_id uuid
) returns table(destination_id uuid,destination_name text,destination_type text,branch_id uuid,ledger_account_id uuid,journal_id uuid)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare resolved_account_id uuid;
begin
  select d.ledger_account_id into resolved_account_id
  from public.money_destinations d
  where d.id=p_destination_id and d.tenant_id=p_tenant_id;
  perform public.assert_financial_authorized(
    p_tenant_id,p_permission,resolved_account_id,p_access,p_branch_id,true
  );
  return query select d.id,d.name,d.destination_type,d.branch_id,d.ledger_account_id,d.journal_id
  from public.money_destinations d
  join public.account_accounts a on a.id=d.ledger_account_id and a.tenant_id=d.tenant_id
  join public.account_journals j on j.id=d.journal_id and j.tenant_id=d.tenant_id
  where d.id=p_destination_id and d.tenant_id=p_tenant_id and d.status='active'
    and (p_branch_id is null or d.branch_id is null or d.branch_id=p_branch_id)
    and a.active and a.is_posting and a.account_origin='resource' and a.normal_balance='debit'
    and not a.open_item_reconcile and j.is_active and j.default_account_id=a.id
    and public.has_financial_resource_access(p_tenant_id,a.id,p_access,coalesce(p_branch_id,d.branch_id));
  if not found then
    raise exception using errcode='42501',message='INTERNAL_TRANSFER_DESTINATION_NOT_ALLOWED';
  end if;
end $$;

revoke all on function public.resolve_internal_transfer_destination(uuid,uuid,text,text,uuid)
  from public,anon,authenticated;

comment on function public.resolve_internal_transfer_destination(uuid,uuid,text,text,uuid) is
  'Resolves caller-supplied Money Destination to its protected account/journal, then applies action permission, branch scope and account-backed transfer_from/transfer_to scope.';

commit;
