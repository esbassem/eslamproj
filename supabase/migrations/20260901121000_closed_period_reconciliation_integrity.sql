begin;

alter table public.financial_payment_allocations
  add column effective_date date;

update public.financial_payment_allocations allocation
set effective_date=coalesce(
  (select partial.max_date from public.account_partial_reconcile partial
   where partial.id=allocation.partial_reconcile_id),
  allocation.created_at::date
);

alter table public.financial_payment_allocations
  alter column effective_date set not null;

create or replace function public.guard_financial_payment_allocation()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
declare contract_id text:=current_setting('app.financial_payment_allocation_contract',true);
begin
 if tg_op='DELETE'then raise exception using errcode='23514',message='FINANCIAL_PAYMENT_ALLOCATION_DELETE_FORBIDDEN';end if;
 if contract_id is distinct from new.id::text then raise exception using errcode='42501',message='FINANCIAL_PAYMENT_ALLOCATION_REQUIRES_CONTRACT';end if;
 if tg_op='INSERT'then new.idempotency_key:=btrim(new.idempotency_key);if new.status<>'active'then raise exception using errcode='23514',message='FINANCIAL_PAYMENT_ALLOCATION_MUST_START_ACTIVE';end if;return new;end if;
 if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
  or new.payment_id is distinct from old.payment_id or new.source_account_line_id is distinct from old.source_account_line_id
  or new.target_account_line_id is distinct from old.target_account_line_id or new.partial_reconcile_id is distinct from old.partial_reconcile_id
  or new.amount is distinct from old.amount or new.effective_date is distinct from old.effective_date
  or new.idempotency_key is distinct from old.idempotency_key or new.request_fingerprint is distinct from old.request_fingerprint
  or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
  or old.status<>'active'or new.status<>'unallocated'then raise exception using errcode='23514',message='FINANCIAL_PAYMENT_ALLOCATION_IMMUTABLE';end if;
 return new;
end$$;

create or replace function public.create_payment_allocation_partial_reconcile(
 p_allocation_id uuid,p_partial_id uuid,p_tenant_id uuid,p_debit_line_id uuid,p_credit_line_id uuid,
 p_amount numeric,p_actor_id uuid,p_effective_date date
)returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if current_setting('app.financial_payment_allocation_contract',true)is distinct from p_allocation_id::text then raise exception using errcode='42501',message='PARTIAL_RECONCILE_REQUIRES_ALLOCATION_CONTRACT';end if;
 insert into public.account_partial_reconcile(id,tenant_id,debit_move_id,credit_move_id,amount,max_date,created_by)
 values(p_partial_id,p_tenant_id,p_debit_line_id,p_credit_line_id,p_amount,p_effective_date,p_actor_id);
end$$;

create or replace function public.allocate_financial_payment(
 p_tenant_id uuid,p_payment_id uuid,p_target_account_line_id uuid,p_amount numeric,p_idempotency_key text,p_effective_date date
)returns jsonb language plpgsql security definer set search_path=pg_catalog,public,extensions as $$
declare payment public.financial_payments%rowtype;source jsonb;source_line public.account_move_lines%rowtype;target_line public.account_move_lines%rowtype;
 source_move public.account_moves%rowtype;target_move public.account_moves%rowtype;account public.account_accounts%rowtype;actor_id uuid:=public.current_tenant_user_id();
 requested numeric(18,2);fingerprint text;existing public.financial_payment_allocations%rowtype;allocation_id uuid:=gen_random_uuid();partial_id uuid:=gen_random_uuid();result jsonb;
begin
 if p_idempotency_key is null or btrim(p_idempotency_key)=''then raise exception using errcode='22023',message='ALLOCATION_IDEMPOTENCY_KEY_REQUIRED';end if;
 perform public.assert_financial_posting_date(p_tenant_id,p_effective_date);
 requested:=round(p_amount,2);if requested is null or requested<=0 or requested<>p_amount then raise exception using errcode='22023',message='ALLOCATION_AMOUNT_INVALID';end if;
 fingerprint:=encode(extensions.digest(concat_ws('|',p_payment_id::text,p_target_account_line_id::text,requested::text,p_effective_date::text),'sha256'),'hex');
 perform pg_advisory_xact_lock(hashtextextended('financial_payment_allocation:'||p_tenant_id||':'||btrim(p_idempotency_key),0));
 select*into existing from public.financial_payment_allocations item where item.tenant_id=p_tenant_id and item.idempotency_key=btrim(p_idempotency_key);
 if found then if existing.request_fingerprint<>fingerprint then raise exception using errcode='23505',message='ALLOCATION_IDEMPOTENCY_KEY_PAYLOAD_MISMATCH';end if;result:=public.get_financial_payment_allocation_summary(p_tenant_id,existing.payment_id);return result||jsonb_build_object('allocation_id',existing.id,'idempotent_replay',true);end if;
 select*into payment from public.financial_payments item where item.id=p_payment_id and item.tenant_id=p_tenant_id for update;if not found then raise exception using errcode='P0002',message='FINANCIAL_PAYMENT_NOT_FOUND';end if;
 source:=public.resolve_financial_payment_allocation_source(p_tenant_id,p_payment_id);perform public.assert_financial_authorized(p_tenant_id,'financial.payment.allocate',(source->>'account_id')::uuid,'reconcile',payment.branch_id,true);if actor_id is null then raise exception using errcode='42501',message='ACTIVE_TENANT_MEMBERSHIP_REQUIRED';end if;
 perform 1 from public.account_move_lines line where line.id in((source->>'source_line_id')::uuid,p_target_account_line_id)order by line.id for update;
 select*into source_line from public.account_move_lines where id=(source->>'source_line_id')::uuid;select*into target_line from public.account_move_lines where id=p_target_account_line_id;if target_line.id is null then raise exception using errcode='P0002',message='TARGET_OPEN_ITEM_NOT_FOUND';end if;
 select*into source_move from public.account_moves where id=source_line.move_id;select*into target_move from public.account_moves where id=target_line.move_id;select*into account from public.account_accounts where id=source_line.account_id;
 perform public.assert_financial_authorized(p_tenant_id,'financial.payment.allocate',target_line.account_id,'reconcile',target_move.branch_id,true);
 if source_line.tenant_id<>p_tenant_id or target_line.tenant_id<>p_tenant_id or source_move.tenant_id<>p_tenant_id or target_move.tenant_id<>p_tenant_id then raise exception using errcode='23514',message='CROSS_TENANT_ALLOCATION_FORBIDDEN';end if;
 if source_line.partner_id is null or source_line.partner_id<>target_line.partner_id then raise exception using errcode='23514',message='ALLOCATION_PARTNER_MISMATCH';end if;if source_line.account_id<>target_line.account_id then raise exception using errcode='23514',message='ALLOCATION_ACCOUNT_MISMATCH';end if;
 if not account.reconcile or not account.open_item_reconcile then raise exception using errcode='23514',message='ACCOUNT_NOT_OPEN_ITEM_RECONCILABLE';end if;if source_move.state<>'posted'or target_move.state<>'posted'or source_line.parent_state<>'posted'or target_line.parent_state<>'posted'then raise exception using errcode='23514',message='ALLOCATION_REQUIRES_POSTED_OPEN_ITEMS';end if;
 if source_line.currency_code<>target_line.currency_code then raise exception using errcode='23514',message='ALLOCATION_CURRENCY_MISMATCH';end if;
 if not((source_line.debit>0 and source_line.credit=0 and target_line.credit>0 and target_line.debit=0)or(source_line.credit>0 and source_line.debit=0 and target_line.debit>0 and target_line.credit=0))then raise exception using errcode='23514',message='ALLOCATION_POLARITY_MISMATCH';end if;
 if requested>source_line.amount_residual or requested>target_line.amount_residual then raise exception using errcode='23514',message='ALLOCATION_EXCEEDS_AVAILABLE_RESIDUAL';end if;
 perform set_config('app.financial_payment_allocation_contract',allocation_id::text,true);
 perform public.create_payment_allocation_partial_reconcile(allocation_id,partial_id,p_tenant_id,case when source_line.debit>0 then source_line.id else target_line.id end,case when source_line.credit>0 then source_line.id else target_line.id end,requested,actor_id,p_effective_date);
 insert into public.financial_payment_allocations(id,tenant_id,payment_id,source_account_line_id,target_account_line_id,partial_reconcile_id,amount,effective_date,status,idempotency_key,request_fingerprint,created_by)
 values(allocation_id,p_tenant_id,p_payment_id,source_line.id,target_line.id,partial_id,requested,p_effective_date,'active',btrim(p_idempotency_key),fingerprint,actor_id);
 if(select amount_residual from public.account_move_lines where id=source_line.id)<>round(source_line.amount_residual-requested,2)or(select amount_residual from public.account_move_lines where id=target_line.id)<>round(target_line.amount_residual-requested,2)then raise exception using errcode='23514',message='ALLOCATION_RESIDUAL_INTEGRITY_FAILURE';end if;
 perform set_config('app.financial_payment_allocation_contract','',true);result:=public.get_financial_payment_allocation_summary(p_tenant_id,p_payment_id);return result||jsonb_build_object('allocation_id',allocation_id,'partial_reconcile_id',partial_id,'effective_date',p_effective_date,'idempotent_replay',false);
end$$;

create or replace function public.allocate_financial_payment(p_tenant_id uuid,p_payment_id uuid,p_target_account_line_id uuid,p_amount numeric,p_idempotency_key text)
returns jsonb language sql security definer set search_path=pg_catalog,public as $$select public.allocate_financial_payment(p_tenant_id,p_payment_id,p_target_account_line_id,p_amount,p_idempotency_key,current_date)$$;

create or replace function public.unallocate_financial_payment_allocation(p_tenant_id uuid,p_allocation_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare allocation public.financial_payment_allocations%rowtype;payment public.financial_payments%rowtype;source_line public.account_move_lines%rowtype;target_line public.account_move_lines%rowtype;target_move public.account_moves%rowtype;actor_id uuid:=public.current_tenant_user_id();result jsonb;
begin
 if p_reason is null or btrim(p_reason)=''then raise exception using errcode='22023',message='UNALLOCATION_REASON_REQUIRED';end if;
 select*into allocation from public.financial_payment_allocations item where item.id=p_allocation_id and item.tenant_id=p_tenant_id for update;if not found then raise exception using errcode='P0002',message='FINANCIAL_PAYMENT_ALLOCATION_NOT_FOUND';end if;
 perform public.assert_financial_posting_date(p_tenant_id,allocation.effective_date);
 select*into payment from public.financial_payments item where item.id=allocation.payment_id and item.tenant_id=p_tenant_id for update;perform 1 from public.account_move_lines line where line.id in(allocation.source_account_line_id,allocation.target_account_line_id)order by line.id for update;
 select*into source_line from public.account_move_lines where id=allocation.source_account_line_id;select*into target_line from public.account_move_lines where id=allocation.target_account_line_id;select*into target_move from public.account_moves where id=target_line.move_id;
 perform public.assert_financial_authorized(p_tenant_id,'financial.reconciliation.manage',source_line.account_id,'reconcile',payment.branch_id,allocation.status='active');perform public.assert_financial_authorized(p_tenant_id,'financial.reconciliation.manage',target_line.account_id,'reconcile',target_move.branch_id,true);if actor_id is null then raise exception using errcode='42501',message='ACTIVE_TENANT_MEMBERSHIP_REQUIRED';end if;
 if not exists(select 1 from public.account_partial_reconcile item where item.id=allocation.partial_reconcile_id and item.tenant_id=p_tenant_id and item.amount=allocation.amount and item.max_date=allocation.effective_date and item.debit_move_id in(source_line.id,target_line.id)and item.credit_move_id in(source_line.id,target_line.id))then raise exception using errcode='23514',message='ALLOCATION_RECONCILIATION_LINK_INVALID';end if;
 perform set_config('app.financial_payment_allocation_contract',allocation.id::text,true);perform public.delete_payment_allocation_partial_reconcile(allocation.id,allocation.partial_reconcile_id,p_tenant_id);
 update public.financial_payment_allocations set status='unallocated',unallocated_by=actor_id,unallocated_at=now(),unallocation_reason=btrim(p_reason)where id=allocation.id;
 if(select amount_residual from public.account_move_lines where id=source_line.id)<>round(source_line.amount_residual+allocation.amount,2)or(select amount_residual from public.account_move_lines where id=target_line.id)<>round(target_line.amount_residual+allocation.amount,2)then raise exception using errcode='23514',message='UNALLOCATION_RESIDUAL_INTEGRITY_FAILURE';end if;
 perform set_config('app.financial_payment_allocation_contract','',true);result:=public.get_financial_payment_allocation_summary(p_tenant_id,allocation.payment_id);return result||jsonb_build_object('allocation_id',allocation.id,'unallocated',true);
end$$;

revoke all on function public.create_payment_allocation_partial_reconcile(uuid,uuid,uuid,uuid,uuid,numeric,uuid,date)from public,anon,authenticated;
revoke all on function public.allocate_financial_payment(uuid,uuid,uuid,numeric,text,date)from public,anon;
grant execute on function public.allocate_financial_payment(uuid,uuid,uuid,numeric,text,date)to authenticated;

comment on column public.financial_payment_allocations.effective_date is 'Accounting date on which the reconciliation changes open-item state; immutable and governed by tenant future/closed-period policy.';

commit;
