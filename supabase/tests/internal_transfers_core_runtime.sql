begin;

create temporary table phase5_before as select
 (select count(*) from public.account_moves where state='posted') moves,
 (select count(*) from public.account_move_lines l join public.account_moves m on m.id=l.move_id and m.tenant_id=l.tenant_id where m.state='posted') lines,
 (select count(*) from public.account_partial_reconcile) reconciliations,
 (select coalesce(sum(l.debit),0) from public.account_move_lines l join public.account_moves m on m.id=l.move_id and m.tenant_id=l.tenant_id where m.state='posted') debit,
 (select coalesce(sum(l.credit),0) from public.account_move_lines l join public.account_moves m on m.id=l.move_id and m.tenant_id=l.tenant_id where m.state='posted') credit;

create temporary table phase5_context as
select owner.tenant_id,owner.id owner_id,owner.auth_user_id owner_auth,
 other.id other_id,other.auth_user_id other_auth
from public.tenant_users owner join lateral(select u.* from public.tenant_users u where u.tenant_id=owner.tenant_id and u.is_active and u.role<>'owner' and u.auth_user_id is not null limit 1) other on true
where owner.role='owner' and owner.is_active and owner.auth_user_id is not null limit 1;
do $$ begin if not exists(select 1 from phase5_context) then raise exception 'PHASE5_AUTH_FIXTURE_UNAVAILABLE'; end if; end $$;

create temporary table phase5_resources(branch_id uuid,source_id uuid,source_account uuid,destination_id uuid,destination_account uuid,custody_id uuid,custody_account uuid,transit_account uuid);
do $$ declare c phase5_context%rowtype; r phase5_resources%rowtype; x jsonb; suffix text:=left(replace(gen_random_uuid()::text,'-',''),8); g uuid; permission_group uuid;
begin select * into c from phase5_context; r.branch_id:=gen_random_uuid();
 insert into public.branches(id,tenant_id,name,code,is_active) values(r.branch_id,c.tenant_id,'Phase 5 Branch','P5'||left(suffix,5),true);
 insert into public.res_groups(tenant_id,name,code,category,is_system,active) values(c.tenant_id,'Phase 5 transfer actors','phase5_transfer_'||suffix,'Tenant',false,true) returning id into permission_group;
 insert into public.auth_group_permissions(group_id,permission_id) select permission_group,id from public.auth_permissions where code in('financial.transfer.create','financial.transfer.send','financial.transfer.receive','financial.transfer.confirm','financial.transfer.reverse');
 insert into public.res_users_groups(tenant_id,user_id,group_id) values(c.tenant_id,c.owner_id,permission_group);
 select id into g from public.account_groups where tenant_id=c.tenant_id and template_group_key='liquidity_resources' limit 1;
 if g is null then select id into g from public.account_groups where tenant_id=c.tenant_id limit 1; end if;
 insert into public.account_accounts(tenant_id,group_id,code,name,account_type,reconcile,active,canonical_account_type,statement_section,reporting_category,normal_balance,open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin)
 values(c.tenant_id,g,'P5T'||suffix,'Phase 5 Cash In Transit','asset',false,true,'liquidity','balance_sheet','cash_and_cash_equivalents','debit',false,false,true,'cash_in_transit','cash_in_transit','template') returning id into r.transit_account;
 insert into public.account_functional_accounts(tenant_id,functional_role,account_id) values(c.tenant_id,'cash_in_transit',r.transit_account);
 insert into phase5_resources values(r.*);
end $$;
grant select,update on phase5_resources to authenticated; grant select on phase5_context to authenticated;
select set_config('request.jwt.claim.sub',owner_auth::text,true) from phase5_context; set local role authenticated;
do $$ declare c phase5_context%rowtype; r phase5_resources%rowtype; x jsonb;
begin select * into c from phase5_context;select * into r from phase5_resources;
 x:=public.create_and_provision_money_destination(c.tenant_id,'p5_source','Phase 5 Source','cashbox',r.branch_id,null,null,null,null,null,'{}',true); r.source_id:=(x->>'destination_id')::uuid;r.source_account:=(x->>'account_id')::uuid;
 x:=public.create_and_provision_money_destination(c.tenant_id,'p5_destination','Phase 5 Destination','cashbox',r.branch_id,null,null,null,null,null,'{}',true); r.destination_id:=(x->>'destination_id')::uuid;r.destination_account:=(x->>'account_id')::uuid;
 x:=public.create_and_provision_money_destination(c.tenant_id,'p5_custody','Phase 5 Ahmed Custody','employee_cash_custody',r.branch_id,c.other_id,null,null,null,null,'{}',true); r.custody_id:=(x->>'destination_id')::uuid;r.custody_account:=(x->>'account_id')::uuid;
 update phase5_resources set source_id=r.source_id,source_account=r.source_account,destination_id=r.destination_id,destination_account=r.destination_account,custody_id=r.custody_id,custody_account=r.custody_account;
end $$;

do $$ declare c phase5_context%rowtype;r phase5_resources%rowtype;x jsonb;y jsonb;tid uuid;mid uuid;before_rec bigint;
begin select * into c from phase5_context;select * into r from phase5_resources;select count(*) into before_rec from public.account_partial_reconcile;
 x:=public.create_internal_transfer(c.tenant_id,r.source_id,r.destination_id,1000,'immediate','p5-policy-deny-immediate','EGP',r.branch_id,r.branch_id);tid:=(x->>'transfer_id')::uuid;
 begin perform public.confirm_internal_transfer(c.tenant_id,tid,'p5-policy-deny-immediate-confirm');raise exception'INSUFFICIENT_IMMEDIATE_TRANSFER_ACCEPTED';exception when check_violation then null;end;
 if(select status from public.financial_internal_transfers where id=tid)<>'draft'or exists(select 1 from public.financial_internal_transfer_accounting_links where transfer_id=tid)then raise exception'FAILED_IMMEDIATE_TRANSFER_NOT_ATOMIC';end if;
 x:=public.create_internal_transfer(c.tenant_id,r.source_id,r.destination_id,1000,'in_transit','p5-policy-deny-send','EGP',r.branch_id,r.branch_id);tid:=(x->>'transfer_id')::uuid;
 begin perform public.send_internal_transfer(c.tenant_id,tid,'p5-policy-deny-send-command');raise exception'INSUFFICIENT_IN_TRANSIT_SEND_ACCEPTED';exception when check_violation then null;end;
 if(select status from public.financial_internal_transfers where id=tid)<>'draft'or exists(select 1 from public.financial_internal_transfer_accounting_links where transfer_id=tid)then raise exception'FAILED_IN_TRANSIT_SEND_NOT_ATOMIC';end if;
 x:=public.create_internal_transfer(c.tenant_id,r.custody_id,r.destination_id,1000,'immediate','p5-policy-deny-custody','EGP',r.branch_id,r.branch_id);tid:=(x->>'transfer_id')::uuid;
 begin perform public.confirm_internal_transfer(c.tenant_id,tid,'p5-policy-deny-custody-confirm');raise exception'INSUFFICIENT_CUSTODY_TRANSFER_ACCEPTED';exception when check_violation then null;end;
 perform public.configure_money_destination_negative_balance(c.tenant_id,r.source_id,true,'Legacy transfer runtime fixture starts without an opening balance');
 perform public.configure_money_destination_negative_balance(c.tenant_id,r.custody_id,true,'Legacy custody runtime fixture starts without an opening balance');
 x:=public.create_internal_transfer(c.tenant_id,r.source_id,r.destination_id,10000,'immediate','p5-create-immediate','EGP',r.branch_id,r.branch_id);
 y:=public.create_internal_transfer(c.tenant_id,r.source_id,r.destination_id,10000,'immediate','p5-create-immediate','EGP',r.branch_id,r.branch_id);
 if x->>'transfer_id'<>y->>'transfer_id' or not (y->>'idempotent_replay')::boolean then raise exception 'CREATE_IDEMPOTENCY_FAILED'; end if; tid:=(x->>'transfer_id')::uuid;
 if(public.get_financial_reversal_eligibility(c.tenant_id,'internal_transfer',tid)->>'eligible')::boolean or not(public.get_financial_reversal_eligibility(c.tenant_id,'internal_transfer',tid)->'blockers'?'TRANSFER_HAS_NO_ACCOUNTING_EFFECT')then raise exception'DRAFT_TRANSFER_ELIGIBILITY_INVALID';end if;
 x:=public.confirm_internal_transfer(c.tenant_id,tid,'p5-confirm-immediate'); mid:=(x->>'account_move_id')::uuid;
 if (select sum(debit-credit) from public.account_move_lines where move_id=mid)<>0
 or (select debit from public.account_move_lines where move_id=mid and account_id=r.destination_account)<>10000
 or (select credit from public.account_move_lines where move_id=mid and account_id=r.source_account)<>10000 then raise exception 'IMMEDIATE_POSTING_INVALID'; end if;
 y:=public.confirm_internal_transfer(c.tenant_id,tid,'p5-confirm-immediate'); if (y->>'account_move_id')::uuid<>mid or not (y->>'idempotent_replay')::boolean then raise exception 'CONFIRM_IDEMPOTENCY_FAILED'; end if;
 begin perform public.confirm_internal_transfer(c.tenant_id,tid,'p5-confirm-mismatch'); raise exception 'DUPLICATE_CONFIRM_ACCEPTED'; exception when check_violation then null; end;
 if (select count(*) from public.account_partial_reconcile)<>before_rec then raise exception 'TRANSFER_CREATED_RECONCILIATION'; end if;
 if not (public.get_financial_reversal_eligibility(c.tenant_id,'internal_transfer',tid)->>'eligible')::boolean then raise exception 'IMMEDIATE_REVERSAL_NOT_ELIGIBLE';end if;
 x:=public.reverse_internal_transfer_accounting(c.tenant_id,tid,'fixture correction','p5-reverse-immediate',current_date);
 if(select debit from public.account_move_lines where move_id=((x->'moves'->0->>'move_id')::uuid) and account_id=r.source_account)<>10000
 or(select credit from public.account_move_lines where move_id=((x->'moves'->0->>'move_id')::uuid) and account_id=r.destination_account)<>10000 then raise exception'IMMEDIATE_REVERSAL_INVALID';end if;
 y:=public.reverse_internal_transfer_accounting(c.tenant_id,tid,'fixture correction','p5-reverse-immediate',current_date);
 if not(y->>'idempotent_replay')::boolean or y->>'reversal_id'<>x->>'reversal_id'then raise exception'IMMEDIATE_REVERSAL_REPLAY_FAILED';end if;
 begin perform public.reverse_internal_transfer_accounting(c.tenant_id,tid,'changed','p5-reverse-immediate',current_date);raise exception'REVERSE_IDEMPOTENCY_MISMATCH_ACCEPTED';exception when unique_violation then null;end;
 begin perform public.reverse_internal_transfer_accounting(c.tenant_id,tid,'second reversal','p5-reverse-immediate-second',current_date);raise exception'DOUBLE_REVERSAL_ACCEPTED';exception when check_violation then null;end;

 x:=public.create_internal_transfer(c.tenant_id,r.custody_id,r.destination_id,2500,'immediate','p5-custody-create','EGP',r.branch_id,r.branch_id); tid:=(x->>'transfer_id')::uuid;
 x:=public.confirm_internal_transfer(c.tenant_id,tid,'p5-custody-confirm'); mid:=(x->>'account_move_id')::uuid;
 if exists(select 1 from public.account_move_lines where move_id=mid and partner_id is not null) or
   (select credit from public.account_move_lines where move_id=mid and account_id=r.custody_account)<>2500 then raise exception 'CUSTODY_TRANSFER_SEMANTICS_INVALID'; end if;

 x:=public.create_internal_transfer(c.tenant_id,r.source_id,r.destination_id,4000,'in_transit','p5-transit-create','EGP',r.branch_id,r.branch_id);tid:=(x->>'transfer_id')::uuid;
 begin perform public.receive_internal_transfer(c.tenant_id,tid,'p5-receive-early');raise exception 'RECEIVE_BEFORE_SEND_ACCEPTED';exception when check_violation then null;end;
 x:=public.send_internal_transfer(c.tenant_id,tid,'p5-send');mid:=(x->>'account_move_id')::uuid;
 if (select debit from public.account_move_lines where move_id=mid and account_id=r.transit_account)<>4000 or (select credit from public.account_move_lines where move_id=mid and account_id=r.source_account)<>4000 then raise exception 'SEND_POSTING_INVALID';end if;
 x:=public.receive_internal_transfer(c.tenant_id,tid,'p5-receive');mid:=(x->>'account_move_id')::uuid;
 if (select debit from public.account_move_lines where move_id=mid and account_id=r.destination_account)<>4000 or (select credit from public.account_move_lines where move_id=mid and account_id=r.transit_account)<>4000 then raise exception 'RECEIVE_POSTING_INVALID';end if;
 x:=public.confirm_internal_transfer(c.tenant_id,tid,'p5-final-confirm');if x->'account_move_id'<>'null'::jsonb then raise exception 'IN_TRANSIT_CONFIRM_CREATED_MOVE';end if;
 if (select sum(debit-credit) from public.account_move_lines where account_id=r.transit_account and move_id in(select account_move_id from public.financial_internal_transfer_accounting_links where transfer_id=tid))<>0 then raise exception 'COMPLETED_TRANSFER_REMAINS_IN_TRANSIT';end if;
 x:=public.reverse_internal_transfer_accounting(c.tenant_id,tid,'completed fixture correction','p5-reverse-completed',current_date);
 if(select count(*)from public.financial_accounting_reversal_move_links where reversal_id=(x->>'reversal_id')::uuid and stage in('transfer_receive','transfer_send'))<>2 then raise exception'COMPLETED_REVERSAL_STAGES_MISSING';end if;
 if(select coalesce(sum(l.debit-l.credit),0)from public.account_move_lines l where l.account_id=r.transit_account and l.move_id in(select account_move_id from public.financial_internal_transfer_accounting_links where transfer_id=tid))<>0 then raise exception'COMPLETED_REVERSAL_TRANSIT_NOT_ZERO';end if;
 begin update public.financial_internal_transfers set amount=5 where id=tid;raise exception 'ACCOUNTED_TRANSFER_MUTATED';exception when check_violation or insufficient_privilege then null;end;
 begin perform public.create_internal_transfer(c.tenant_id,r.source_id,r.source_id,1,'immediate','p5-same','EGP',r.branch_id,r.branch_id);raise exception 'SAME_DESTINATION_ACCEPTED';exception when check_violation then null;end;
 begin perform public.create_internal_transfer(c.tenant_id,r.source_id,r.destination_id,10001,'immediate','p5-create-immediate','EGP',r.branch_id,r.branch_id);raise exception 'IDEMPOTENCY_MISMATCH_ACCEPTED';exception when unique_violation then null;end;
end $$;

-- Sent-only in-transit reversal restores source and clears transit without touching destination.
do $$declare c phase5_context%rowtype;r phase5_resources%rowtype;x jsonb;tid uuid;send_move uuid;rev_move uuid;dst_before numeric;
begin select*into c from phase5_context;select*into r from phase5_resources;
 select coalesce(sum(debit-credit),0)into dst_before from public.account_move_lines where account_id=r.destination_account;
 x:=public.create_internal_transfer(c.tenant_id,r.source_id,r.destination_id,10000,'in_transit','p5-sent-only-create','EGP',r.branch_id,r.branch_id);tid:=(x->>'transfer_id')::uuid;
 x:=public.send_internal_transfer(c.tenant_id,tid,'p5-sent-only-send');send_move:=(x->>'account_move_id')::uuid;
 if not(public.get_financial_reversal_eligibility(c.tenant_id,'internal_transfer',tid)->>'eligible')::boolean then raise exception'SENT_ONLY_NOT_ELIGIBLE';end if;
 x:=public.reverse_internal_transfer_accounting(c.tenant_id,tid,'sent-only correction','p5-reverse-sent-only',current_date);
 select reversal_move_id into rev_move from public.financial_accounting_reversal_move_links where reversal_id=(x->>'reversal_id')::uuid and stage='transfer_send';
 if(select debit from public.account_move_lines where move_id=rev_move and account_id=r.source_account)<>10000 or(select credit from public.account_move_lines where move_id=rev_move and account_id=r.transit_account)<>10000 then raise exception'SENT_ONLY_REVERSAL_INVALID';end if;
 if(select sum(debit-credit)from public.account_move_lines where account_id=r.transit_account and move_id in(send_move,rev_move))<>0 then raise exception'SENT_ONLY_TRANSIT_NOT_ZERO';end if;
 if(select coalesce(sum(debit-credit),0)from public.account_move_lines where account_id=r.destination_account)<>dst_before then raise exception'SENT_ONLY_CHANGED_DESTINATION';end if;
end$$;
set local role postgres;

select set_config('request.jwt.claim.sub',other_auth::text,true) from phase5_context;set local role authenticated;
do $$ declare c phase5_context%rowtype;r phase5_resources%rowtype;blocked boolean:=false;begin select * into c from phase5_context;select * into r from phase5_resources;
 begin perform public.create_internal_transfer(c.tenant_id,r.source_id,r.destination_id,1,'immediate','p5-unauthorized','EGP',r.branch_id,r.branch_id);exception when insufficient_privilege then blocked:=true;end;
 if not blocked then raise exception 'UNAUTHORIZED_CREATE_ACCEPTED';end if;
 if exists(select 1 from public.financial_internal_transfers where tenant_id=c.tenant_id and accounting_state='active'and status<>'draft')then
  blocked:=false;begin perform public.reverse_internal_transfer_accounting(c.tenant_id,(select id from public.financial_internal_transfers where tenant_id=c.tenant_id and accounting_state='active'and status<>'draft'limit 1),'unauthorized','p5-unauthorized-reverse',current_date);exception when insufficient_privilege then blocked:=true;end;
  if not blocked then raise exception'UNAUTHORIZED_TRANSFER_REVERSAL_ACCEPTED';end if;
 end if;
end $$;
set local role postgres;

do $$ declare b phase5_before%rowtype;begin select * into b from phase5_before;
 if exists(select 1 from public.account_moves m join public.account_move_lines l on l.move_id=m.id and l.tenant_id=m.tenant_id where m.state='posted' group by m.id having round(sum(l.debit-l.credit),2)<>0) then raise exception 'UNBALANCED_POSTED_MOVE';end if;
 if (select count(*) from public.account_partial_reconcile)<>b.reconciliations then raise exception 'RECONCILIATION_COUNT_CHANGED';end if;
 raise notice 'PHASE5_ROLLBACK_SAFE_BASELINE moves=% lines=% reconciliations=% debit=% credit=%',b.moves,b.lines,b.reconciliations,b.debit,b.credit;
end $$;

rollback;
