begin;

create temporary table phase6_before as select
 (select count(*) from public.financial_payments) payments,
 (select count(*) from public.financial_payments where payment_purpose='customer_advance') customer_advances,
 (select count(*) from public.financial_payments where payment_purpose='supplier_advance') supplier_advances,
 (select count(*) from public.financial_advance_applications) applications,
 (select count(*) from public.financial_payment_accounting_links) payment_links,
 (select count(*) from public.account_moves where state='posted') moves,
 (select count(*) from public.account_move_lines l join public.account_moves m on m.id=l.move_id and m.tenant_id=l.tenant_id where m.state='posted') lines,
 (select count(*) from public.account_partial_reconcile) reconciliations,
 (select coalesce(sum(l.debit),0) from public.account_move_lines l join public.account_moves m on m.id=l.move_id and m.tenant_id=l.tenant_id where m.state='posted') debit,
 (select coalesce(sum(l.credit),0) from public.account_move_lines l join public.account_moves m on m.id=l.move_id and m.tenant_id=l.tenant_id where m.state='posted') credit;

create temporary table phase6_context as
select o.tenant_id,o.id owner_id,o.auth_user_id owner_auth,u.id other_id,u.auth_user_id other_auth,
 null::uuid customer_advance_account,null::uuid customer_receivable_account,
 null::uuid supplier_advance_account,null::uuid supplier_payable_account,
 public.resolve_financial_journal(o.tenant_id,'general',null,null) general_journal
from public.tenant_users o join lateral(select x.* from public.tenant_users x where x.tenant_id=o.tenant_id and x.is_active and x.role<>'owner' and x.auth_user_id is not null limit 1)u on true
where o.role='owner' and o.is_active and o.auth_user_id is not null limit 1;
do $$begin if not exists(select 1 from phase6_context)then raise exception'PHASE6_FUNCTIONAL_FIXTURE_UNAVAILABLE';end if;end$$;

create temporary table phase6_resources(customer_partner uuid,supplier_partner uuid,method_id uuid,cash_account uuid,
 customer_payment uuid,customer_source uuid,customer_target1 uuid,customer_target2 uuid,
 supplier_payment uuid,supplier_source uuid,supplier_target uuid,liquidity_before numeric);
grant select,update on phase6_resources to authenticated;grant select on phase6_context to authenticated;

do $$declare c phase6_context%rowtype;r phase6_resources%rowtype;g uuid;s text:=left(replace(gen_random_uuid()::text,'-',''),8);pgid uuid;
begin select*into c from phase6_context;
 select id into g from public.account_groups where tenant_id=c.tenant_id limit 1;
 update public.account_functional_accounts set is_active=false where tenant_id=c.tenant_id and functional_role in('customer_advance','customer_receivable','supplier_advance','supplier_payable') and is_active;
 insert into public.account_accounts(tenant_id,group_id,code,name,account_type,reconcile,active,canonical_account_type,statement_section,reporting_category,normal_balance,open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin)values
 (c.tenant_id,g,'P6CA'||s,'P6 Customer Advance','liability',true,true,'current_liability','balance_sheet','customer_advances','credit',true,false,true,'customer_advances','customer_advances','template')returning id into c.customer_advance_account;
 insert into public.account_accounts(tenant_id,group_id,code,name,account_type,reconcile,active,canonical_account_type,statement_section,reporting_category,normal_balance,open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin)values
 (c.tenant_id,g,'P6CR'||s,'P6 Customer Receivable','asset',true,true,'receivable','balance_sheet','trade_receivables','debit',true,false,true,'trade_receivable','trade_receivable','template')returning id into c.customer_receivable_account;
 insert into public.account_accounts(tenant_id,group_id,code,name,account_type,reconcile,active,canonical_account_type,statement_section,reporting_category,normal_balance,open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin)values
 (c.tenant_id,g,'P6SA'||s,'P6 Supplier Advance','asset',true,true,'current_asset','balance_sheet','other_receivables','debit',true,false,true,'supplier_advances','supplier_advances','template')returning id into c.supplier_advance_account;
 insert into public.account_accounts(tenant_id,group_id,code,name,account_type,reconcile,active,canonical_account_type,statement_section,reporting_category,normal_balance,open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin)values
 (c.tenant_id,g,'P6SP'||s,'P6 Supplier Payable','liability',true,true,'payable','balance_sheet','trade_payables','credit',true,false,true,'trade_payable','trade_payable','template')returning id into c.supplier_payable_account;
 insert into public.account_functional_accounts(tenant_id,functional_role,account_id)values
 (c.tenant_id,'customer_advance',c.customer_advance_account),(c.tenant_id,'customer_receivable',c.customer_receivable_account),(c.tenant_id,'supplier_advance',c.supplier_advance_account),(c.tenant_id,'supplier_payable',c.supplier_payable_account);
 update phase6_context set customer_advance_account=c.customer_advance_account,customer_receivable_account=c.customer_receivable_account,supplier_advance_account=c.supplier_advance_account,supplier_payable_account=c.supplier_payable_account;
 insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)
 values(c.tenant_id,'Phase6 Customer','person',false,true,1,0,0,true)returning id into r.customer_partner;
 insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)
 values(c.tenant_id,'Phase6 Supplier','company',true,true,0,1,0,true)returning id into r.supplier_partner;
 insert into public.financial_payment_methods(tenant_id,name,semantic_key,method_type,created_by)values(c.tenant_id,'Phase6 Method','phase6_'||s,'other',c.owner_id)returning id into r.method_id;
 insert into public.account_accounts(tenant_id,group_id,code,name,account_type,reconcile,active,canonical_account_type,statement_section,reporting_category,normal_balance,open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin)
 values(c.tenant_id,g,'P6C'||s,'Phase6 Test Cash','asset',false,true,'liquidity','balance_sheet','cash_and_cash_equivalents','debit',false,false,true,'phase6_cash_'||s,'phase6_cash_'||s,'template')returning id into r.cash_account;
 insert into public.res_groups(tenant_id,name,code,category,is_system,active)values(c.tenant_id,'Phase6 advance actor','phase6_'||s,'Tenant',false,true)returning id into pgid;
 insert into public.auth_group_permissions(group_id,permission_id)select pgid,id from public.auth_permissions where code in('financial.payment.allocate','financial.reconciliation.manage');
 insert into public.res_users_groups(tenant_id,user_id,group_id)values(c.tenant_id,c.owner_id,pgid);
 insert into phase6_resources values(r.*);
end$$;

-- Canonical customer advance source and two AR targets.
do $$declare c phase6_context%rowtype;r phase6_resources%rowtype;pm uuid:=gen_random_uuid();tm uuid;cashline uuid:=gen_random_uuid();linkid uuid;
begin select*into c from phase6_context;select*into r from phase6_resources;
 insert into public.financial_payments(tenant_id,payment_number,direction,amount,currency_code,payment_method_id,partner_id,status,idempotency_key,request_fingerprint,created_by,submitted_by,submitted_at,confirmed_by,confirmed_at)
 values(c.tenant_id,'PAY-2026-960001','inbound',20000,'EGP',r.method_id,r.customer_partner,'confirmed','p6-customer-payment',repeat('a',64),c.owner_id,c.owner_id,now(),c.owner_id,now())returning id into r.customer_payment;
 insert into public.account_moves(id,tenant_id,journal_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,currency_code,created_by)values(pm,c.tenant_id,c.general_journal,'P6 CUSTOMER ADVANCE','journal',r.customer_partner,current_date,now(),20000,'posted','phase6_customer_advance','EGP',c.owner_id);
 insert into public.account_move_lines(id,tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
 values(cashline,c.tenant_id,pm,r.cash_account,null,'Cash',1,20000,20000,0,'liquidity',true,0,0,'posted','EGP',c.owner_id);
 insert into public.account_move_lines(tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
 values(c.tenant_id,pm,c.customer_advance_account,r.customer_partner,'Customer advance',1,20000,0,20000,'open_item',false,20000,20000,'posted','EGP',c.owner_id)returning id into r.customer_source;
 perform set_config('app.financial_payment_posting_contract',r.customer_payment::text,true);
 insert into public.financial_payment_accounting_links(tenant_id,payment_id,account_move_id,entry_type,created_by)values(c.tenant_id,r.customer_payment,pm,'posting',c.owner_id);
 update public.financial_payments set accounting_state='posted',payment_purpose='customer_advance',posted_by=c.owner_id,posted_at=now()where id=r.customer_payment;
 foreach tm in array array[gen_random_uuid(),gen_random_uuid()]loop
  insert into public.account_moves(id,tenant_id,journal_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,currency_code,created_by)values(tm,c.tenant_id,c.general_journal,'P6 CUSTOMER INVOICE','journal',r.customer_partner,current_date,now(),case when r.customer_target1 is null then 15000 else 8000 end,'posted','phase6_invoice','EGP',c.owner_id);
  insert into public.account_move_lines(tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
  values(c.tenant_id,tm,c.customer_receivable_account,r.customer_partner,'Invoice AR',1,case when r.customer_target1 is null then 15000 else 8000 end,case when r.customer_target1 is null then 15000 else 8000 end,0,'open_item',false,case when r.customer_target1 is null then 15000 else 8000 end,case when r.customer_target1 is null then 15000 else 8000 end,'posted','EGP',c.owner_id)
  returning id into linkid;
  insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
  values(c.tenant_id,tm,r.cash_account,'Fixture counterpart',1,case when r.customer_target1 is null then 15000 else 8000 end,0,case when r.customer_target1 is null then 15000 else 8000 end,'other',true,0,0,'posted','EGP',c.owner_id);
  if r.customer_target1 is null then r.customer_target1:=linkid;else r.customer_target2:=linkid;end if;
 end loop;
 select coalesce(sum(debit-credit),0) into r.liquidity_before from public.account_move_lines where account_id=r.cash_account;
 update phase6_resources set customer_partner=r.customer_partner,method_id=r.method_id,cash_account=r.cash_account,customer_payment=r.customer_payment,customer_source=r.customer_source,customer_target1=r.customer_target1,customer_target2=r.customer_target2,liquidity_before=r.liquidity_before;
end$$;

-- Supplier advance and AP bill.
do $$declare c phase6_context%rowtype;r phase6_resources%rowtype;pm uuid:=gen_random_uuid();bm uuid:=gen_random_uuid();otherline uuid;
begin select*into c from phase6_context;select*into r from phase6_resources;
 insert into public.financial_payments(tenant_id,payment_number,direction,amount,currency_code,payment_method_id,partner_id,status,idempotency_key,request_fingerprint,created_by,submitted_by,submitted_at,confirmed_by,confirmed_at)
 values(c.tenant_id,'PAY-2026-960002','outbound',20000,'EGP',r.method_id,r.supplier_partner,'confirmed','p6-supplier-payment',repeat('b',64),c.owner_id,c.owner_id,now(),c.owner_id,now())returning id into r.supplier_payment;
 insert into public.account_moves(id,tenant_id,journal_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,currency_code,created_by)values(pm,c.tenant_id,c.general_journal,'P6 SUPPLIER ADVANCE','journal',r.supplier_partner,current_date,now(),20000,'posted','phase6_supplier_advance','EGP',c.owner_id);
 insert into public.account_move_lines(tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
 values(c.tenant_id,pm,c.supplier_advance_account,r.supplier_partner,'Supplier advance',1,20000,20000,0,'open_item',false,20000,20000,'posted','EGP',c.owner_id)returning id into r.supplier_source;
 insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,pm,r.cash_account,'Cash',1,20000,0,20000,'liquidity',true,0,0,'posted','EGP',c.owner_id);
 perform set_config('app.financial_payment_posting_contract',r.supplier_payment::text,true);insert into public.financial_payment_accounting_links(tenant_id,payment_id,account_move_id,entry_type,created_by)values(c.tenant_id,r.supplier_payment,pm,'posting',c.owner_id);
 update public.financial_payments set accounting_state='posted',payment_purpose='supplier_advance',posted_by=c.owner_id,posted_at=now()where id=r.supplier_payment;
 insert into public.account_moves(id,tenant_id,journal_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,currency_code,created_by)values(bm,c.tenant_id,c.general_journal,'P6 SUPPLIER BILL','journal',r.supplier_partner,current_date,now(),15000,'posted','phase6_bill','EGP',c.owner_id);
 insert into public.account_move_lines(tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,bm,c.supplier_payable_account,r.supplier_partner,'Bill AP',1,15000,0,15000,'open_item',false,15000,15000,'posted','EGP',c.owner_id)returning id into r.supplier_target;
 insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,bm,r.cash_account,'Fixture counterpart',1,15000,15000,0,'other',true,0,0,'posted','EGP',c.owner_id);
 select coalesce(sum(debit-credit),0) into r.liquidity_before from public.account_move_lines where account_id=r.cash_account;
 update phase6_resources set supplier_partner=r.supplier_partner,supplier_payment=r.supplier_payment,supplier_source=r.supplier_source,supplier_target=r.supplier_target,liquidity_before=r.liquidity_before;
end$$;

select set_config('request.jwt.claim.sub',owner_auth::text,true)from phase6_context;set local role authenticated;
do $$declare c phase6_context%rowtype;r phase6_resources%rowtype;x jsonb;y jsonb;aid uuid;second_aid uuid;mid uuid;original_app_move uuid;before_moves bigint;before_rec bigint;
begin select*into c from phase6_context;select*into r from phase6_resources;select count(*)into before_moves from public.account_moves;select count(*)into before_rec from public.account_partial_reconcile;
 x:=public.apply_financial_advance(c.tenant_id,r.customer_payment,r.customer_target1,12000,'p6-customer-apply','first invoice');aid:=(x->>'application_id')::uuid;mid:=(x->>'reclassification_move_id')::uuid;
 y:=public.apply_financial_advance(c.tenant_id,r.customer_payment,r.customer_target1,12000,'p6-customer-apply','first invoice');if(y->>'application_id')::uuid<>aid or(y->>'reclassification_move_id')::uuid<>mid or not(y->>'idempotent_replay')::boolean then raise exception'CUSTOMER_IDEMPOTENCY_FAILED';end if;
 if(select amount_residual from public.account_move_lines where id=r.customer_source)<>8000 or(select amount_residual from public.account_move_lines where id=r.customer_target1)<>3000 then raise exception'CUSTOMER_RESIDUALS_INVALID';end if;
 if(select count(*) from public.account_partial_reconcile where id in((x->>'advance_partial_reconcile_id')::uuid,(x->>'target_partial_reconcile_id')::uuid))<>2 then raise exception'TWO_SIDED_RECONCILIATION_MISSING';end if;
 if(select sum(debit-credit)from public.account_move_lines where move_id=mid)<>0 or(select debit from public.account_move_lines where move_id=mid and account_id=c.customer_advance_account)<>12000 or(select credit from public.account_move_lines where move_id=mid and account_id=c.customer_receivable_account)<>12000 then raise exception'CUSTOMER_RECLASSIFICATION_INVALID';end if;
 x:=public.apply_financial_advance(c.tenant_id,r.customer_payment,r.customer_target2,8000,'p6-customer-full');second_aid:=(x->>'application_id')::uuid;if(select amount_residual from public.account_move_lines where id=r.customer_source)<>0 then raise exception'FULL_APPLICATION_FAILED';end if;
 x:=public.apply_financial_advance(c.tenant_id,r.supplier_payment,r.supplier_target,12000,'p6-supplier-apply');mid:=(x->>'reclassification_move_id')::uuid;
 if(select amount_residual from public.account_move_lines where id=r.supplier_source)<>8000 or(select amount_residual from public.account_move_lines where id=r.supplier_target)<>3000 then raise exception'SUPPLIER_RESIDUALS_INVALID';end if;
 if(select debit from public.account_move_lines where move_id=mid and account_id=c.supplier_payable_account)<>12000 or(select credit from public.account_move_lines where move_id=mid and account_id=c.supplier_advance_account)<>12000 then raise exception'SUPPLIER_RECLASSIFICATION_INVALID';end if;
 if(select coalesce(sum(debit-credit),0)from public.account_move_lines where account_id=r.cash_account)<>r.liquidity_before then raise exception'ADVANCE_APPLICATION_CHANGED_LIQUIDITY';end if;
 begin perform public.apply_financial_advance(c.tenant_id,r.supplier_payment,r.supplier_target,4000,'p6-over-target');raise exception'OVER_TARGET_ACCEPTED';exception when check_violation then null;end;
 begin perform public.apply_financial_advance(c.tenant_id,r.supplier_payment,r.supplier_target,0,'p6-zero');raise exception'ZERO_ACCEPTED';exception when invalid_parameter_value then null;end;
 begin perform public.apply_financial_advance(c.tenant_id,r.customer_payment,r.supplier_target,1,'p6-cross-kind');raise exception'CROSS_KIND_ACCEPTED';exception when check_violation then null;end;
 begin perform public.apply_financial_advance(c.tenant_id,r.customer_payment,r.customer_target1,12001,'p6-customer-apply');raise exception'IDEMPOTENCY_MISMATCH_ACCEPTED';exception when unique_violation then null;end;
 select reclassification_move_id into original_app_move from public.financial_advance_applications where id=aid;
 x:=public.unapply_financial_advance(c.tenant_id,aid,'wrong invoice','p6-unapply-customer',current_date);
 if x->>'status'<>'unapplied'or(select status from public.financial_advance_applications where id=aid)<>'unapplied'then raise exception'UNAPPLICATION_STATE_INVALID';end if;
 if(select amount_residual from public.account_move_lines where id=r.customer_source)<>12000 or(select amount_residual from public.account_move_lines where id=r.customer_target1)<>15000 then raise exception'UNAPPLICATION_RESIDUAL_RESTORE_FAILED';end if;
 if(select state from public.account_moves where id=original_app_move)<>'posted'or not exists(select 1 from public.account_moves where id=(x->>'reversal_move_id')::uuid and state='posted'and reversed_entry_id=original_app_move)then raise exception'UNAPPLICATION_REVERSING_MOVE_INVALID';end if;
 y:=public.unapply_financial_advance(c.tenant_id,aid,'wrong invoice','p6-unapply-customer',current_date);if not(y->>'idempotent_replay')::boolean or y->>'reversal_id'<>x->>'reversal_id'then raise exception'UNAPPLICATION_REPLAY_FAILED';end if;
 begin perform public.unapply_financial_advance(c.tenant_id,aid,'changed reason','p6-unapply-customer',current_date);raise exception'UNAPPLICATION_IDEMPOTENCY_MISMATCH_ACCEPTED';exception when unique_violation then null;end;
 perform public.unapply_financial_advance(c.tenant_id,second_aid,'remove remaining application','p6-unapply-customer-second',current_date);
 if exists(select 1 from public.financial_advance_applications where tenant_id=c.tenant_id and advance_payment_id=r.customer_payment and status='active')or(select amount_residual from public.account_move_lines where id=r.customer_source)<>20000 then raise exception'ADVANCE_NOT_FULLY_RESTORED';end if;
 x:=public.reverse_financial_payment_accounting(c.tenant_id,r.customer_payment,'reverse restored advance payment','p6-reverse-restored-advance',current_date);
 if(select accounting_state from public.financial_payments where id=r.customer_payment)<>'reversed'or not exists(select 1 from public.account_moves where id=(x->>'reversal_move_id')::uuid and state='posted')then raise exception'RESTORED_ADVANCE_PAYMENT_REVERSAL_FAILED';end if;
 if(select count(*)from public.account_moves)<>before_moves+6 or(select count(*)from public.account_partial_reconcile)<>before_rec+7 then raise exception'LEDGER_CARDINALITY_INVALID';end if;
end$$;set local role postgres;

create temporary table phase6_security_application as
select id from public.financial_advance_applications where status='active'limit 1;
grant select on phase6_security_application to public;
select set_config('request.jwt.claim.sub',other_auth::text,true)from phase6_context;set local role authenticated;
do $$declare c phase6_context%rowtype;r phase6_resources%rowtype;blocked boolean:=false;begin select*into c from phase6_context;select*into r from phase6_resources;
 begin perform public.apply_financial_advance(c.tenant_id,r.supplier_payment,r.supplier_target,1,'p6-unauthorized');exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'UNAUTHORIZED_APPLICATION_ACCEPTED';end if;
 blocked:=false;begin perform public.unapply_financial_advance(c.tenant_id,(select id from phase6_security_application),'unauthorized','p6-unauthorized-unapply',current_date);exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'UNAUTHORIZED_UNAPPLICATION_ACCEPTED';end if;
end$$;set local role postgres;

do $$declare b phase6_before%rowtype;begin select*into b from phase6_before;
 if exists(select 1 from public.account_moves m join public.account_move_lines l on l.move_id=m.id and l.tenant_id=m.tenant_id where m.state='posted'group by m.id having round(sum(l.debit-l.credit),2)<>0)then raise exception'UNBALANCED_POSTED_MOVE';end if;
end$$;
rollback;
