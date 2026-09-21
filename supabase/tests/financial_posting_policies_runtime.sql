begin;

create temporary table p10b3_before as select
 (select count(*)from public.account_moves where state='posted')moves,
 (select count(*)from public.account_move_lines where parent_state='posted')lines,
 (select count(*)from public.account_partial_reconcile)partials,
 (select coalesce(sum(debit),0)from public.account_move_lines where parent_state='posted')debit,
 (select coalesce(sum(credit),0)from public.account_move_lines where parent_state='posted')credit;
create temporary table p10b3_context as select o.tenant_id,o.id owner_id,o.auth_user_id owner_auth,u.id other_id,u.auth_user_id other_auth
 from public.tenant_users o join lateral(select x.*from public.tenant_users x where x.tenant_id=o.tenant_id and x.is_active and x.role<>'owner'and x.auth_user_id is not null limit 1)u on true
 where o.role='owner'and o.is_active and o.auth_user_id is not null limit 1;
do $$begin if not exists(select 1 from p10b3_context)then raise exception'PHASE10B3_FIXTURE_UNAVAILABLE';end if;end$$;
create temporary table p10b3_r(branch uuid,destination uuid,liquidity uuid,journal uuid,counterpart uuid);
grant select on p10b3_context to public;grant select,update on p10b3_r to public;

do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;g uuid;s text:=left(replace(gen_random_uuid()::text,'-',''),8);begin
 select*into c from p10b3_context;select id into g from public.account_groups where tenant_id=c.tenant_id limit 1;
 r.branch:=gen_random_uuid();insert into public.branches(id,tenant_id,name,code,is_active)values(r.branch,c.tenant_id,'Phase10B3 Branch','PB3'||left(s,5),true);
 insert into public.account_accounts(tenant_id,group_id,code,name,account_type,reconcile,active,canonical_account_type,statement_section,reporting_category,normal_balance,open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin)
 values(c.tenant_id,g,'PB3'||s,'Phase10B3 Counterpart','asset',false,true,'current_asset','balance_sheet','other_current_assets','debit',false,false,true,'p10b3_counter_'||s,'p10b3_counter_'||s,'template')returning id into r.counterpart;
 insert into p10b3_r values(r.*);end$$;

select set_config('request.jwt.claim.sub',owner_auth::text,true)from p10b3_context;set local role authenticated;
do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;x jsonb;begin select*into c from p10b3_context;select*into r from p10b3_r;
 x:=public.create_and_provision_money_destination(c.tenant_id,'p10b3_cash','Phase10B3 Cash','cashbox',r.branch,null,null,null,null,null,'{}',true);
 update p10b3_r set destination=(x->>'destination_id')::uuid,liquidity=(x->>'account_id')::uuid,journal=(x->>'journal_id')::uuid;end$$;
set local role postgres;

-- Seed 10,000 inbound. Today and an open historical date are valid.
do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;m uuid:=gen_random_uuid();begin select*into c from p10b3_context;select*into r from p10b3_r;
 insert into public.account_moves(id,tenant_id,branch_id,journal_id,name,move_type,invoice_date,date,amount_total,state,ref,currency_code,created_by)
 values(m,c.tenant_id,r.branch,r.journal,'P10B3-SEED','cash_in',current_date,current_date,10000,'posted','financial_policy_test:seed','EGP',c.owner_id);
 insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values
 (c.tenant_id,m,r.liquidity,'seed',1,10000,10000,0,'liquidity',true,0,0,'posted','EGP',c.owner_id),(c.tenant_id,m,r.counterpart,'seed counter',1,10000,0,10000,'other',true,0,0,'posted','EGP',c.owner_id);
end$$;

-- 12,000 outbound is atomic and rejected; balance and move count remain unchanged.
do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;m uuid:=gen_random_uuid();before_moves bigint;begin select*into c from p10b3_context;select*into r from p10b3_r;select count(*)into before_moves from public.account_moves;
 begin insert into public.account_moves(id,tenant_id,branch_id,journal_id,name,move_type,invoice_date,date,amount_total,state,ref,currency_code,created_by)values(m,c.tenant_id,r.branch,r.journal,'P10B3-DENY','cash_out',current_date,current_date,12000,'posted','financial_policy_test:deny','EGP',c.owner_id);
 insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,m,r.counterpart,'deny counter',1,12000,12000,0,'other',true,0,0,'posted','EGP',c.owner_id),(c.tenant_id,m,r.liquidity,'deny',1,12000,0,12000,'liquidity',true,0,0,'posted','EGP',c.owner_id);raise exception'NEGATIVE_LIQUIDITY_ACCEPTED';exception when check_violation then null;end;
 if(select coalesce(sum(debit-credit),0)from public.account_move_lines where account_id=r.liquidity)<>10000 or(select count(*)from public.account_moves)<>before_moves then raise exception'NEGATIVE_LIQUIDITY_FAILURE_NOT_ATOMIC';end if;end$$;

-- Exact balance reaches zero.
do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;m uuid:=gen_random_uuid();begin select*into c from p10b3_context;select*into r from p10b3_r;insert into public.account_moves(id,tenant_id,branch_id,journal_id,name,move_type,invoice_date,date,amount_total,state,ref,currency_code,created_by)values(m,c.tenant_id,r.branch,r.journal,'P10B3-EXACT','cash_out',current_date,current_date,10000,'posted','financial_policy_test:exact','EGP',c.owner_id);insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,m,r.counterpart,'exact counter',1,10000,10000,0,'other',true,0,0,'posted','EGP',c.owner_id),(c.tenant_id,m,r.liquidity,'exact',1,10000,0,10000,'liquidity',true,0,0,'posted','EGP',c.owner_id);if(select coalesce(sum(debit-credit),0)from public.account_move_lines where account_id=r.liquidity)<>0 then raise exception'EXACT_LIQUIDITY_NOT_ZERO';end if;end$$;

-- Explicit override permits 10,000 -> 12,000 = -2,000.
select set_config('request.jwt.claim.sub',owner_auth::text,true)from p10b3_context;set local role authenticated;
select public.configure_money_destination_negative_balance(c.tenant_id,r.destination,true,'Test explicit overdraft')from p10b3_context c cross join p10b3_r r;
set local role postgres;
do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;m1 uuid:=gen_random_uuid();m2 uuid:=gen_random_uuid();begin select*into c from p10b3_context;select*into r from p10b3_r;
 insert into public.account_moves(id,tenant_id,branch_id,journal_id,name,move_type,invoice_date,date,amount_total,state,ref,currency_code,created_by)values(m1,c.tenant_id,r.branch,r.journal,'P10B3-INBOUND','cash_in',current_date,current_date,10000,'posted','financial_policy_test:inbound','EGP',c.owner_id),(m2,c.tenant_id,r.branch,r.journal,'P10B3-ALLOW','cash_out',current_date,current_date,12000,'posted','financial_policy_test:allow','EGP',c.owner_id);
 insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values
 (c.tenant_id,m1,r.liquidity,'inbound',1,10000,10000,0,'liquidity',true,0,0,'posted','EGP',c.owner_id),(c.tenant_id,m1,r.counterpart,'inbound counter',1,10000,0,10000,'other',true,0,0,'posted','EGP',c.owner_id),
 (c.tenant_id,m2,r.counterpart,'allow counter',1,12000,12000,0,'other',true,0,0,'posted','EGP',c.owner_id),(c.tenant_id,m2,r.liquidity,'allow',1,12000,0,12000,'liquidity',true,0,0,'posted','EGP',c.owner_id);
 if(select coalesce(sum(debit-credit),0)from public.account_move_lines where account_id=r.liquidity)<>-2000 then raise exception'ALLOW_NEGATIVE_BALANCE_FAILED';end if;end$$;

-- Future date fails closed; yesterday is open. Reversal entries bypass only liquidity, never date/period.
do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;begin select*into c from p10b3_context;select*into r from p10b3_r;
 begin insert into public.account_moves(tenant_id,branch_id,journal_id,name,move_type,date,amount_total,state,ref,currency_code,created_by)values(c.tenant_id,r.branch,r.journal,'P10B3-FUTURE','cash_in',current_date+1,0,'posted','financial_policy_test:future','EGP',c.owner_id);raise exception'FUTURE_POSTING_ACCEPTED';exception when check_violation then null;end;
 insert into public.account_moves(tenant_id,branch_id,journal_id,name,move_type,date,amount_total,state,ref,currency_code,created_by)values(c.tenant_id,r.branch,r.journal,'P10B3-HISTORICAL','cash_in',current_date-1,0,'posted','financial_policy_test:historical','EGP',c.owner_id);end$$;

select set_config('request.jwt.claim.sub',owner_auth::text,true)from p10b3_context;set local role authenticated;
select public.configure_financial_posting_policy(tenant_id,true,'Test explicit future-date override')from p10b3_context;
set local role postgres;
do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;begin select*into c from p10b3_context;select*into r from p10b3_r;
 insert into public.account_moves(tenant_id,branch_id,journal_id,name,move_type,date,amount_total,state,ref,currency_code,created_by)values(c.tenant_id,r.branch,r.journal,'P10B3-FUTURE-ALLOWED','cash_in',current_date+1,0,'posted','financial_policy_test:future-allowed','EGP',c.owner_id);end$$;
select set_config('request.jwt.claim.sub',owner_auth::text,true)from p10b3_context;set local role authenticated;
select public.configure_financial_posting_policy(tenant_id,false,'Restore fail-closed future-date policy')from p10b3_context;
select public.configure_money_destination_negative_balance(c.tenant_id,r.destination,false,'Prove corrective reversals bypass liquidity denial')from p10b3_context c cross join p10b3_r r;
set local role postgres;
do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;m uuid:=gen_random_uuid();begin select*into c from p10b3_context;select*into r from p10b3_r;
 insert into public.account_moves(id,tenant_id,branch_id,journal_id,name,move_type,date,amount_total,state,ref,currency_code,created_by)values(m,c.tenant_id,r.branch,r.journal,'P10B3-CORRECTIVE-REVERSAL','cash_out',current_date,1,'posted','financial_accounting_reversal:00000000-0000-0000-0000-000000000001','EGP',c.owner_id);
 insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,m,r.counterpart,'reversal counter',1,1,1,0,'other',true,0,0,'posted','EGP',c.owner_id),(c.tenant_id,m,r.liquidity,'corrective reversal',1,1,0,1,'liquidity',true,0,0,'posted','EGP',c.owner_id);
end$$;

select set_config('request.jwt.claim.sub',owner_auth::text,true)from p10b3_context;set local role authenticated;
do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;blocked boolean:=false;begin select*into c from p10b3_context;select*into r from p10b3_r;begin perform public.configure_money_destination_negative_balance(c.tenant_id,r.destination,true,'   ');exception when invalid_parameter_value then blocked:=true;end;if not blocked then raise exception'NEGATIVE_POLICY_BLANK_REASON_ACCEPTED';end if;end$$;
select public.set_financial_period_lock(tenant_id,current_date,true,'Close through today for runtime test')from p10b3_context;
set local role postgres;
do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;begin select*into c from p10b3_context;select*into r from p10b3_r;
 begin insert into public.account_moves(tenant_id,branch_id,journal_id,name,move_type,date,amount_total,state,ref,currency_code,created_by)values(c.tenant_id,r.branch,r.journal,'P10B3-CLOSED','cash_in',current_date,0,'posted','financial_payment:policy-test','EGP',c.owner_id);raise exception'CLOSED_PERIOD_POSTING_ACCEPTED';exception when check_violation then null;end;
 begin insert into public.account_moves(tenant_id,branch_id,journal_id,name,move_type,date,amount_total,state,ref,currency_code,created_by)values(c.tenant_id,r.branch,r.journal,'P10B3-CLOSED-REVERSAL','cash_in',current_date,0,'posted','financial_accounting_reversal:00000000-0000-0000-0000-000000000001','EGP',c.owner_id);raise exception'CLOSED_PERIOD_REVERSAL_ACCEPTED';exception when check_violation then null;end;end$$;

-- Ordinary and cross-tenant users cannot manage policy or write tables directly.
select set_config('request.jwt.claim.sub',other_auth::text,true)from p10b3_context;set local role authenticated;
do $$declare c p10b3_context%rowtype;r p10b3_r%rowtype;blocked boolean:=false;foreign_tenant uuid;begin select*into c from p10b3_context;select*into r from p10b3_r;
 begin perform public.set_financial_period_lock(c.tenant_id,current_date,false,'Unauthorized');exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'UNAUTHORIZED_PERIOD_MANAGEMENT_ACCEPTED';end if;
 blocked:=false;begin perform public.configure_money_destination_negative_balance(c.tenant_id,r.destination,true,'Unauthorized');exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'UNAUTHORIZED_NEGATIVE_POLICY_ACCEPTED';end if;
 select id into foreign_tenant from public.tenants where id<>c.tenant_id limit 1;blocked:=false;begin perform public.set_financial_period_lock(foreign_tenant,current_date,true,'Cross tenant');exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'CROSS_TENANT_PERIOD_MANAGEMENT_ACCEPTED';end if;
 blocked:=false;begin perform public.configure_money_destination_negative_balance(foreign_tenant,r.destination,true,'Cross tenant');exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'CROSS_TENANT_NEGATIVE_POLICY_ACCEPTED';end if;
 blocked:=false;begin update public.money_destinations set allow_negative_balance=true where id=r.destination;exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'DIRECT_NEGATIVE_POLICY_WRITE_ACCEPTED';end if;
 blocked:=false;begin insert into public.financial_period_locks(tenant_id,locked_through_date,reason,created_by,updated_by)values(c.tenant_id,current_date,'Forged',c.other_id,c.other_id);exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'DIRECT_PERIOD_WRITE_ACCEPTED';end if;end$$;
set local role postgres;

do $$declare b p10b3_before%rowtype;begin select*into b from p10b3_before;if exists(select 1 from public.account_moves m join public.account_move_lines l on l.move_id=m.id and l.tenant_id=m.tenant_id where m.state='posted'group by m.id having round(sum(l.debit-l.credit),2)<>0)then raise exception'UNBALANCED_POSTED_MOVE';end if;raise notice'PHASE10B3_BASELINE moves=% lines=% partials=% debit=% credit=%',b.moves,b.lines,b.partials,b.debit,b.credit;end$$;
rollback;
