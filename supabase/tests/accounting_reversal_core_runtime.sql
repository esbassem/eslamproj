begin;

create temporary table phase7_before as select
 (select count(*)from public.financial_payments)payments,
 (select count(*)from public.financial_payments where accounting_state='posted')posted_payments,
 (select count(*)from public.financial_payments where accounting_state='reversed')reversed_payments,
 (select count(*)from public.financial_payment_allocations where status='active')active_allocations,
 (select count(*)from public.financial_advance_applications)applications,
 (select count(*)from public.financial_advance_applications where status='active')active_applications,
 (select count(*)from public.financial_advance_applications where status='unapplied')unapplied_applications,
 (select count(*)from public.financial_internal_transfers)transfers,
 (select count(*)from public.financial_internal_transfers where accounting_state='reversed')reversed_transfers,
 (select count(*)from public.financial_accounting_reversals)reversals,
 (select count(*)from public.account_moves where state='posted')moves,
 (select count(*)from public.account_move_lines where parent_state='posted')lines,
 (select count(*)from public.account_partial_reconcile)partials,
 (select coalesce(sum(debit),0)from public.account_move_lines where parent_state='posted')debit,
 (select coalesce(sum(credit),0)from public.account_move_lines where parent_state='posted')credit;

create temporary table phase7_context as
select o.tenant_id,o.id owner_id,o.auth_user_id owner_auth,u.id other_id,u.auth_user_id other_auth,
 public.resolve_financial_journal(o.tenant_id,'general',null,null)journal_id
from public.tenant_users o join lateral(
 select x.*from public.tenant_users x where x.tenant_id=o.tenant_id and x.is_active and x.role<>'owner'and x.auth_user_id is not null limit 1
)u on true where o.role='owner'and o.is_active and o.auth_user_id is not null limit 1;
do $$begin if not exists(select 1 from phase7_context)then raise exception'PHASE7_AUTH_FIXTURE_UNAVAILABLE';end if;end$$;

create temporary table phase7_resources(
 customer uuid,supplier uuid,method_id uuid,cash_account uuid,ar_account uuid,ap_account uuid,
 customer_payment uuid,customer_move uuid,customer_source uuid,customer_target uuid,
 supplier_payment uuid,supplier_move uuid,supplier_source uuid
);
grant select,update on phase7_resources to public;
grant select on phase7_context to public;

do $$declare c phase7_context%rowtype;r phase7_resources%rowtype;g uuid;s text:=left(replace(gen_random_uuid()::text,'-',''),8);gid uuid;
begin select*into c from phase7_context;select id into g from public.account_groups where tenant_id=c.tenant_id limit 1;
 insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)values(c.tenant_id,'Phase7 Customer','person',false,true,1,0,0,true)returning id into r.customer;
 insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)values(c.tenant_id,'Phase7 Supplier','company',true,true,0,1,0,true)returning id into r.supplier;
 insert into public.financial_payment_methods(tenant_id,name,semantic_key,method_type,created_by)values(c.tenant_id,'Phase7 Method','phase7_'||s,'other',c.owner_id)returning id into r.method_id;
 insert into public.account_accounts(tenant_id,group_id,code,name,account_type,reconcile,active,canonical_account_type,statement_section,reporting_category,normal_balance,open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin)values
 (c.tenant_id,g,'P7C'||s,'Phase7 Cash','asset',false,true,'liquidity','balance_sheet','cash_and_cash_equivalents','debit',false,false,true,'p7_cash_'||s,'p7_cash_'||s,'template')returning id into r.cash_account;
 insert into public.account_accounts(tenant_id,group_id,code,name,account_type,reconcile,active,canonical_account_type,statement_section,reporting_category,normal_balance,open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin)values
 (c.tenant_id,g,'P7AR'||s,'Phase7 AR','asset',true,true,'receivable','balance_sheet','trade_receivables','debit',true,false,true,'trade_receivable','trade_receivable','template')returning id into r.ar_account;
 insert into public.account_accounts(tenant_id,group_id,code,name,account_type,reconcile,active,canonical_account_type,statement_section,reporting_category,normal_balance,open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin)values
 (c.tenant_id,g,'P7AP'||s,'Phase7 AP','liability',true,true,'payable','balance_sheet','trade_payables','credit',true,false,true,'trade_payable','trade_payable','template')returning id into r.ap_account;
 update public.account_functional_accounts set is_active=false where tenant_id=c.tenant_id and functional_role in('customer_receivable','supplier_payable')and is_active;
 insert into public.account_functional_accounts(tenant_id,functional_role,account_id)values(c.tenant_id,'customer_receivable',r.ar_account),(c.tenant_id,'supplier_payable',r.ap_account);
 insert into public.res_groups(tenant_id,name,code,category,is_system,active)values(c.tenant_id,'Phase7 reversal actor','phase7_'||s,'Tenant',false,true)returning id into gid;
 insert into public.auth_group_permissions(group_id,permission_id)select gid,id from public.auth_permissions where code in('financial.payment.reverse','financial.payment.allocate','financial.reconciliation.manage');
 insert into public.res_users_groups(tenant_id,user_id,group_id)values(c.tenant_id,c.owner_id,gid);
 insert into phase7_resources values(r.*);
end$$;

-- Customer receipt: cash Dr / AR Cr, plus an open customer invoice used by allocation blocking.
do $$declare c phase7_context%rowtype;r phase7_resources%rowtype;invoice_move uuid:=gen_random_uuid();counterpart uuid;
begin select*into c from phase7_context;select*into r from phase7_resources;r.customer_move:=gen_random_uuid();
 insert into public.financial_payments(tenant_id,payment_number,direction,amount,currency_code,payment_method_id,partner_id,status,idempotency_key,request_fingerprint,created_by,submitted_by,submitted_at,confirmed_by,confirmed_at)
 values(c.tenant_id,'PAY-2026-970001','inbound',20000,'EGP',r.method_id,r.customer,'confirmed','p7-customer',repeat('c',64),c.owner_id,c.owner_id,now(),c.owner_id,now())returning id into r.customer_payment;
 insert into public.account_moves(id,tenant_id,journal_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,currency_code,created_by)values(r.customer_move,c.tenant_id,c.journal_id,'P7 CUSTOMER RECEIPT','journal',r.customer,current_date,current_date,20000,'posted','phase7_customer_payment','EGP',c.owner_id);
 insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,r.customer_move,r.cash_account,'Cash',1,20000,20000,0,'liquidity',true,0,0,'posted','EGP',c.owner_id);
 insert into public.account_move_lines(tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,r.customer_move,r.ar_account,r.customer,'Customer receipt',1,20000,0,20000,'open_item',false,20000,20000,'posted','EGP',c.owner_id)returning id into r.customer_source;
 perform set_config('app.financial_payment_posting_contract',r.customer_payment::text,true);insert into public.financial_payment_accounting_links(tenant_id,payment_id,account_move_id,entry_type,created_by)values(c.tenant_id,r.customer_payment,r.customer_move,'posting',c.owner_id);update public.financial_payments set accounting_state='posted',payment_purpose='inbound_customer_unallocated',posted_by=c.owner_id,posted_at=now()where id=r.customer_payment;
 insert into public.account_moves(id,tenant_id,journal_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,currency_code,created_by)values(invoice_move,c.tenant_id,c.journal_id,'P7 INVOICE','journal',r.customer,current_date,current_date,15000,'posted','phase7_invoice','EGP',c.owner_id);
 insert into public.account_move_lines(tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,invoice_move,r.ar_account,r.customer,'Invoice AR',1,15000,15000,0,'open_item',false,15000,15000,'posted','EGP',c.owner_id)returning id into r.customer_target;
 insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,invoice_move,r.cash_account,'Fixture counterpart',1,15000,0,15000,'other',true,0,0,'posted','EGP',c.owner_id)returning id into counterpart;
 update phase7_resources set customer=r.customer,method_id=r.method_id,cash_account=r.cash_account,ar_account=r.ar_account,ap_account=r.ap_account,customer_payment=r.customer_payment,customer_move=r.customer_move,customer_source=r.customer_source,customer_target=r.customer_target;
end$$;

select set_config('request.jwt.claim.sub',owner_auth::text,true)from phase7_context;set local role authenticated;

do $$declare c phase7_context%rowtype;r phase7_resources%rowtype;x jsonb;y jsonb;allocation uuid;rev uuid;reverse_move uuid;move_snapshot jsonb;line_snapshot jsonb;cash_before numeric;
begin select*into c from phase7_context;select*into r from phase7_resources;
 if not(public.get_financial_reversal_eligibility(c.tenant_id,'payment',r.customer_payment)->>'eligible')::boolean then raise exception'CLEAN_PAYMENT_NOT_ELIGIBLE';end if;
 x:=public.allocate_financial_payment(c.tenant_id,r.customer_payment,r.customer_target,5000,'p7-allocation');allocation:=(x->>'allocation_id')::uuid;
 if(public.get_financial_reversal_eligibility(c.tenant_id,'payment',r.customer_payment)->>'eligible')::boolean then raise exception'ALLOCATED_PAYMENT_ELIGIBLE';end if;
 begin perform public.reverse_financial_payment_accounting(c.tenant_id,r.customer_payment,'allocated rejection','p7-reverse-blocked',current_date);raise exception'ALLOCATED_PAYMENT_REVERSED';exception when check_violation then null;end;
 perform public.unallocate_financial_payment_allocation(c.tenant_id,allocation,'fixture cleanup');
 select to_jsonb(m)-'write_date'-'updated_at'into move_snapshot from public.account_moves m where id=r.customer_move;
 select jsonb_agg(to_jsonb(l)-'amount_residual'-'amount_residual_currency'-'is_reconciled'-'write_date'-'updated_at'order by l.id)into line_snapshot from public.account_move_lines l where move_id=r.customer_move;
 select coalesce(sum(debit-credit),0)into cash_before from public.account_move_lines where account_id=r.cash_account;
 begin perform public.reverse_financial_payment_accounting(c.tenant_id,r.customer_payment,'bad date','p7-reverse-bad-date',current_date-1);raise exception'EARLY_REVERSAL_DATE_ACCEPTED';exception when check_violation then null;end;
 x:=public.reverse_financial_payment_accounting(c.tenant_id,r.customer_payment,'fixture correction','p7-reverse-customer',current_date);rev:=(x->>'reversal_id')::uuid;reverse_move:=(x->>'reversal_move_id')::uuid;
 if(select accounting_state from public.financial_payments where id=r.customer_payment)<>'reversed'then raise exception'PAYMENT_NOT_REVERSED';end if;
 if(select state from public.account_moves where id=reverse_move)<>'posted'or(select sum(debit-credit)from public.account_move_lines where move_id=reverse_move)<>0 then raise exception'REVERSAL_MOVE_INVALID';end if;
 if(select debit from public.account_move_lines where move_id=reverse_move and account_id=r.ar_account)<>20000 or(select credit from public.account_move_lines where move_id=reverse_move and account_id=r.cash_account)<>20000 then raise exception'CUSTOMER_REVERSAL_POLARITY_INVALID';end if;
 if(select amount_residual from public.account_move_lines where id=r.customer_source)<>0 or(select amount_residual from public.account_move_lines where move_id=reverse_move and account_id=r.ar_account)<>0 then raise exception'CUSTOMER_OPEN_ITEM_CLEANUP_FAILED';end if;
 if(select coalesce(sum(debit-credit),0)from public.account_move_lines where account_id=r.cash_account)<>cash_before-20000 then raise exception'CASH_REVERSAL_NET_INVALID';end if;
 if(select to_jsonb(m)-'write_date'-'updated_at'from public.account_moves m where id=r.customer_move)is distinct from move_snapshot or(select jsonb_agg(to_jsonb(l)-'amount_residual'-'amount_residual_currency'-'is_reconciled'-'write_date'-'updated_at'order by l.id)from public.account_move_lines l where move_id=r.customer_move)is distinct from line_snapshot then raise exception'ORIGINAL_LEDGER_MUTATED';end if;
 if not exists(select 1 from public.financial_accounting_reversal_move_links ml join public.financial_accounting_reversal_line_links ll on ll.move_link_id=ml.id join public.financial_accounting_reversal_reconcile_links rl on rl.reversal_id=ml.reversal_id where ml.reversal_id=rev and ml.original_move_id=r.customer_move and ml.reversal_move_id=reverse_move and rl.role='payment_open_item')then raise exception'REversal_TRACE_INCOMPLETE';end if;
 y:=public.reverse_financial_payment_accounting(c.tenant_id,r.customer_payment,'fixture correction','p7-reverse-customer',current_date);if not(y->>'idempotent_replay')::boolean or y->>'reversal_id'<>x->>'reversal_id'then raise exception'PAYMENT_REPLAY_FAILED';end if;
 begin perform public.reverse_financial_payment_accounting(c.tenant_id,r.customer_payment,'changed','p7-reverse-customer',current_date);raise exception'PAYMENT_IDEMPOTENCY_MISMATCH_ACCEPTED';exception when unique_violation then null;end;
 begin perform public.reverse_financial_payment_accounting(c.tenant_id,r.customer_payment,'again','p7-reverse-customer-2',current_date);raise exception'DOUBLE_PAYMENT_REVERSAL_ACCEPTED';exception when check_violation then null;end;
 if(public.get_financial_reversal_eligibility(c.tenant_id,'payment',r.customer_payment)->>'eligible')::boolean then raise exception'REVERSED_PAYMENT_ELIGIBLE';end if;
end$$;

-- Supplier payment: AP Dr / cash Cr and exact open-item cleanup after reversal.
set local role postgres;
do $$declare c phase7_context%rowtype;r phase7_resources%rowtype;
begin select*into c from phase7_context;select*into r from phase7_resources;r.supplier_move:=gen_random_uuid();
 insert into public.financial_payments(tenant_id,payment_number,direction,amount,currency_code,payment_method_id,partner_id,status,idempotency_key,request_fingerprint,created_by,submitted_by,submitted_at,confirmed_by,confirmed_at)values(c.tenant_id,'PAY-2026-970002','outbound',7000,'EGP',r.method_id,r.supplier,'confirmed','p7-supplier',repeat('d',64),c.owner_id,c.owner_id,now(),c.owner_id,now())returning id into r.supplier_payment;
 insert into public.account_moves(id,tenant_id,journal_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,currency_code,created_by)values(r.supplier_move,c.tenant_id,c.journal_id,'P7 SUPPLIER PAYMENT','journal',r.supplier,current_date,current_date,7000,'posted','phase7_supplier_payment','EGP',c.owner_id);
 insert into public.account_move_lines(tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,r.supplier_move,r.ap_account,r.supplier,'Supplier payment',1,7000,7000,0,'open_item',false,7000,7000,'posted','EGP',c.owner_id)returning id into r.supplier_source;
 insert into public.account_move_lines(tenant_id,move_id,account_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)values(c.tenant_id,r.supplier_move,r.cash_account,'Cash',1,7000,0,7000,'liquidity',true,0,0,'posted','EGP',c.owner_id);
 perform set_config('app.financial_payment_posting_contract',r.supplier_payment::text,true);insert into public.financial_payment_accounting_links(tenant_id,payment_id,account_move_id,entry_type,created_by)values(c.tenant_id,r.supplier_payment,r.supplier_move,'posting',c.owner_id);update public.financial_payments set accounting_state='posted',payment_purpose='outbound_supplier_unallocated',posted_by=c.owner_id,posted_at=now()where id=r.supplier_payment;
 update phase7_resources set supplier_payment=r.supplier_payment,supplier_move=r.supplier_move,supplier_source=r.supplier_source;
end$$;
select set_config('request.jwt.claim.sub',owner_auth::text,true)from phase7_context;set local role authenticated;
do $$declare c phase7_context%rowtype;r phase7_resources%rowtype;x jsonb;reverse_move uuid;
begin select*into c from phase7_context;select*into r from phase7_resources;
 x:=public.reverse_financial_payment_accounting(c.tenant_id,r.supplier_payment,'supplier fixture correction','p7-reverse-supplier',current_date);reverse_move:=(x->>'reversal_move_id')::uuid;
 if(select credit from public.account_move_lines where move_id=reverse_move and account_id=r.ap_account)<>7000 or(select amount_residual from public.account_move_lines where id=r.supplier_source)<>0 or(select amount_residual from public.account_move_lines where move_id=reverse_move and account_id=r.ap_account)<>0 then raise exception'SUPPLIER_REVERSAL_INVALID';end if;
end$$;
set local role postgres;

-- Direct and unauthorized paths fail closed.
select set_config('request.jwt.claim.sub',other_auth::text,true)from phase7_context;set local role authenticated;
do $$declare c phase7_context%rowtype;r phase7_resources%rowtype;blocked boolean;fake uuid:=gen_random_uuid();begin select*into c from phase7_context;select*into r from phase7_resources;
 blocked:=false;begin perform public.reverse_financial_payment_accounting(c.tenant_id,r.supplier_payment,'unauthorized','p7-unauthorized',current_date);exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'UNAUTHORIZED_PAYMENT_REVERSAL_ACCEPTED';end if;
 blocked:=false;begin perform public.create_reversing_account_move(fake,c.tenant_id,r.supplier_move,'payment_posting',current_date,c.other_id);exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'ARBITRARY_MOVE_REVERSAL_ACCEPTED';end if;
 blocked:=false;begin insert into public.financial_accounting_reversals(id,tenant_id,reversal_number,domain_type,domain_id,reason,reversal_date,idempotency_key,request_fingerprint,requested_by,completed_by)values(fake,c.tenant_id,'REV-2026-999999','payment',r.supplier_payment,'forged',current_date,'forged',repeat('f',64),c.other_id,c.other_id);exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'DIRECT_REVERSAL_INSERT_ACCEPTED';end if;
 blocked:=false;begin insert into public.financial_accounting_reversal_move_links(tenant_id,reversal_id,stage,original_move_id,reversal_move_id)values(c.tenant_id,fake,'payment_posting',r.customer_move,r.supplier_move);exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'DIRECT_REVERSAL_LINK_INSERT_ACCEPTED';end if;
 blocked:=false;begin perform public.reverse_financial_payment_accounting(gen_random_uuid(),r.supplier_payment,'forged tenant','p7-forged-tenant',current_date);exception when no_data_found or insufficient_privilege then blocked:=true;end;if not blocked then raise exception'FORGED_TENANT_REVERSAL_ACCEPTED';end if;
 blocked:=false;begin update public.financial_payments set accounting_state='posted'where id=r.customer_payment;exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'DIRECT_ACCOUNTING_STATE_UPDATE_ACCEPTED';end if;
 blocked:=false;begin delete from public.account_partial_reconcile where tenant_id=c.tenant_id;exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'DIRECT_PARTIAL_DELETE_ACCEPTED';end if;
 blocked:=false;begin update public.account_moves set ref='forged'where id=r.customer_move;exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'POSTED_MOVE_UPDATE_ACCEPTED';end if;
 blocked:=false;begin delete from public.account_move_lines where move_id=r.customer_move;exception when insufficient_privilege then blocked:=true;end;if not blocked then raise exception'POSTED_LINE_DELETE_ACCEPTED';end if;
end$$;
set local role postgres;

do $$declare b phase7_before%rowtype;begin select*into b from phase7_before;
 if exists(select 1 from public.account_moves m join public.account_move_lines l on l.move_id=m.id and l.tenant_id=m.tenant_id where m.state='posted'group by m.id having round(sum(l.debit-l.credit),2)<>0)then raise exception'UNBALANCED_POSTED_MOVE';end if;
 raise notice'PHASE7_ROLLBACK_SAFE_BASELINE payments=% posted=% reversed=% allocations=% applications=% active_apps=% unapplied_apps=% transfers=% reversed_transfers=% reversals=% moves=% lines=% partials=% debit=% credit=%',b.payments,b.posted_payments,b.reversed_payments,b.active_allocations,b.applications,b.active_applications,b.unapplied_applications,b.transfers,b.reversed_transfers,b.reversals,b.moves,b.lines,b.partials,b.debit,b.credit;
end$$;

rollback;
