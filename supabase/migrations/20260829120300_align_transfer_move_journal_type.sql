begin;

create or replace function public.create_internal_transfer_move(
 p_tenant_id uuid,p_transfer_id uuid,p_transfer_number text,p_entry_type text,p_amount numeric,p_currency text,
 p_debit_account uuid,p_credit_account uuid,p_journal uuid,p_branch uuid,p_actor uuid
) returns uuid language plpgsql security definer set search_path=pg_catalog,public as $$
declare mid uuid:=gen_random_uuid();
begin
  if current_setting('app.internal_transfer_contract',true) is distinct from p_transfer_id::text then
    raise exception using errcode='42501',message='TRANSFER_MOVE_REQUIRES_CONTRACT';
  end if;
  if p_debit_account=p_credit_account then
    raise exception using errcode='23514',message='TRANSFER_ACCOUNTS_MUST_DIFFER';
  end if;
  insert into public.account_moves(
    id,tenant_id,branch_id,journal_id,name,move_type,invoice_date,date,
    amount_total,state,ref,notes,pay_method,currency_code,created_by
  ) values(
    mid,p_tenant_id,p_branch,p_journal,
    'TRANSFER-'||p_transfer_number||'-'||upper(p_entry_type),
    case when p_entry_type='receive' then 'cash_in' else 'cash_out' end,
    current_date,now(),round(p_amount,2),'posted',
    'financial_internal_transfer:'||p_transfer_id,
    'entry_type='||p_entry_type,'canonical_internal_transfer',p_currency,p_actor
  );
  insert into public.account_move_lines(
    tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,
    line_type,is_reconciled,amount_residual,amount_residual_currency,
    parent_state,currency_code,created_by
  ) values
    (p_tenant_id,mid,p_debit_account,p_transfer_number||' — debit',1,p_amount,p_amount,0,
      'liquidity',true,0,0,'posted',p_currency,p_actor),
    (p_tenant_id,mid,p_credit_account,p_transfer_number||' — credit',1,p_amount,0,p_amount,
      'liquidity',true,0,0,'posted',p_currency,p_actor);
  perform public.accounting_assert_move_balanced(mid);
  return mid;
end $$;

revoke all on function public.create_internal_transfer_move(uuid,uuid,text,text,numeric,text,uuid,uuid,uuid,uuid,uuid)
  from public,anon,authenticated;

comment on function public.create_internal_transfer_move(uuid,uuid,text,text,numeric,text,uuid,uuid,uuid,uuid,uuid) is
  'Protected balanced transfer move constructor. Uses cash_out for source-originated immediate/send and cash_in for destination receive so resource cash/bank journals pass the canonical journal guard.';

commit;
