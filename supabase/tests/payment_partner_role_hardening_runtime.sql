begin;

create temporary table p10_partner_context as
select owner.tenant_id, owner.id owner_id, owner.auth_user_id owner_auth,
       ordinary.id ordinary_id, ordinary.auth_user_id ordinary_auth
from public.tenant_users owner
join lateral (
  select candidate.* from public.tenant_users candidate
  where candidate.tenant_id = owner.tenant_id and candidate.is_active
    and candidate.role <> 'owner' and candidate.auth_user_id is not null limit 1
) ordinary on true
where owner.role = 'owner' and owner.is_active and owner.auth_user_id is not null
limit 1;

do $$ begin
  if not exists (select 1 from p10_partner_context) then
    raise exception 'PAYMENT_PARTNER_E2E_CONTEXT_UNAVAILABLE';
  end if;
end $$;

create temporary table p10_partner_fixture(
  branch_id uuid, method_id uuid, destination_id uuid, destination_account_id uuid,
  customer_id uuid, supplier_id uuid, dual_id uuid, inactive_customer_id uuid,
  inactive_supplier_id uuid, foreign_customer_id uuid, foreign_supplier_id uuid,
  customer_account_id uuid, supplier_account_id uuid, temp_group_id uuid,
  foreign_tenant_id uuid
);
grant select on p10_partner_context to public;
grant select, update on p10_partner_fixture to public;

do $$
declare
  context p10_partner_context%rowtype;
  fixture p10_partner_fixture%rowtype;
  foreign_tenant uuid;
  group_id uuid;
  suffix text := left(replace(gen_random_uuid()::text,'-',''),8);
begin
  select * into context from p10_partner_context;
  select tenant_id into foreign_tenant from public.tenant_users
  where tenant_id <> context.tenant_id and is_active limit 1;
  if foreign_tenant is null then raise exception 'SECOND_TENANT_UNAVAILABLE'; end if;
  fixture.foreign_tenant_id := foreign_tenant;
  select id into group_id from public.account_groups where tenant_id=context.tenant_id limit 1;
  select id into fixture.temp_group_id from public.account_groups
  where tenant_id=context.tenant_id and code='TEMP' limit 1;
  if fixture.temp_group_id is null then
    insert into public.account_groups(tenant_id,code,name,code_prefix_start)
    values(context.tenant_id,'TEMP','P10 Temporary Accounts','P10T')
    returning id into fixture.temp_group_id;
  end if;

  fixture.branch_id := gen_random_uuid();
  insert into public.branches(id,tenant_id,name,code,is_active)
  values(fixture.branch_id,context.tenant_id,'P10 Partner Branch','P10'||left(suffix,4),true);
  insert into public.financial_payment_methods(
    tenant_id,name,semantic_key,method_type,settlement_mode,
    requires_reference,requires_confirmation,created_by
  ) values(
    context.tenant_id,'P10 Direct Cash','p10_direct_'||suffix,'cash','direct',
    true,true,context.owner_id
  ) returning id into fixture.method_id;

  insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)
  values(context.tenant_id,'P10 Customer','person',false,true,1,0,0,true)
  returning id into fixture.customer_id;
  insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)
  values(context.tenant_id,'P10 Supplier','person',false,true,0,1,0,true)
  returning id into fixture.supplier_id;
  insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)
  values(context.tenant_id,'P10 Dual','person',false,true,1,1,0,true)
  returning id into fixture.dual_id;
  insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)
  values(context.tenant_id,'P10 Inactive Customer','person',false,true,1,0,0,false)
  returning id into fixture.inactive_customer_id;
  insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)
  values(context.tenant_id,'P10 Inactive Supplier','person',false,true,0,1,0,false)
  returning id into fixture.inactive_supplier_id;
  insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)
  values(foreign_tenant,'P10 Foreign Customer','person',false,true,1,0,0,true)
  returning id into fixture.foreign_customer_id;
  insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)
  values(foreign_tenant,'P10 Foreign Supplier','person',false,true,0,1,0,true)
  returning id into fixture.foreign_supplier_id;

  select id into fixture.customer_account_id from public.account_accounts
  where tenant_id=context.tenant_id and active and is_posting and open_item_reconcile
    and semantic_key='trade_receivable' and canonical_account_type='receivable'
    and reporting_category='trade_receivables' limit 1;
  if fixture.customer_account_id is null then insert into public.account_accounts(
    tenant_id,group_id,code,name,account_type,reconcile,active,
    canonical_account_type,statement_section,reporting_category,normal_balance,
    open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin
  ) values(
    context.tenant_id,group_id,'P10AR'||suffix,'P10 Customer Receivable','asset',true,true,
    'receivable','balance_sheet','trade_receivables','debit',true,false,true,
    'trade_receivable','p10_customer_receivable_'||suffix,'template'
  ) returning id into fixture.customer_account_id;
  end if;
  select id into fixture.supplier_account_id from public.account_accounts
  where tenant_id=context.tenant_id and active and is_posting and open_item_reconcile
    and semantic_key='trade_payable' and canonical_account_type='payable'
    and reporting_category='trade_payables' limit 1;
  if fixture.supplier_account_id is null then insert into public.account_accounts(
    tenant_id,group_id,code,name,account_type,reconcile,active,
    canonical_account_type,statement_section,reporting_category,normal_balance,
    open_item_reconcile,statement_reconcile,is_posting,semantic_key,template_account_key,account_origin
  ) values(
    context.tenant_id,group_id,'P10AP'||suffix,'P10 Supplier Payable','liability',true,true,
    'payable','balance_sheet','trade_payables','credit',true,false,true,
    'trade_payable','p10_supplier_payable_'||suffix,'template'
  ) returning id into fixture.supplier_account_id;
  end if;
  update public.account_functional_accounts set is_active=false
  where tenant_id=context.tenant_id and functional_role in('customer_receivable','supplier_payable') and is_active;
  insert into public.account_functional_accounts(tenant_id,functional_role,account_id)
  values(context.tenant_id,'customer_receivable',fixture.customer_account_id),
        (context.tenant_id,'supplier_payable',fixture.supplier_account_id);
  insert into p10_partner_fixture values(fixture.*);
end $$;

select set_config('request.jwt.claim.sub',owner_auth::text,true)
from p10_partner_context;
set local role authenticated;

do $$
declare
  context p10_partner_context%rowtype;
  fixture p10_partner_fixture%rowtype;
  result jsonb;
begin
  select * into context from p10_partner_context;
  select * into fixture from p10_partner_fixture;
  result := public.create_and_provision_money_destination(
    context.tenant_id,'p10_direct_cash','P10 Direct Cash','cashbox',fixture.branch_id,
    null,null,null,null,null,'{}',true
  );
  fixture.destination_id := (result->>'destination_id')::uuid;
  fixture.destination_account_id := (result->>'account_id')::uuid;
  update p10_partner_fixture set destination_id=fixture.destination_id,
    destination_account_id=fixture.destination_account_id;
end $$;

-- Controlled account-master mutation remains available only through the
-- permissioned TEMP contract.
do $$
declare
  context p10_partner_context%rowtype;
  fixture p10_partner_fixture%rowtype;
  result jsonb;
begin
  select * into context from p10_partner_context;
  select * into fixture from p10_partner_fixture;
  result := public.create_temporary_account(
    context.tenant_id,fixture.temp_group_id,'P10TMP'||left(replace(gen_random_uuid()::text,'-',''),6),
    'P10 Controlled Temporary Account','asset',true,true
  );
  if not exists(select 1 from public.account_accounts account
    where account.id=(result->>'id')::uuid and account.tenant_id=context.tenant_id
      and account.group_id=fixture.temp_group_id and account.account_origin='manual'
      and account.canonical_account_type is null and account.money_destination_id is null) then
    raise exception 'CONTROLLED_TEMPORARY_ACCOUNT_CREATION_INVALID';
  end if;
end $$;

select set_config('request.jwt.claim.sub',ordinary_auth::text,true)
from p10_partner_context;
do $$
declare context p10_partner_context%rowtype; fixture p10_partner_fixture%rowtype; blocked boolean:=false;
begin
  select * into context from p10_partner_context; select * into fixture from p10_partner_fixture;
  begin perform public.create_temporary_account(context.tenant_id,fixture.temp_group_id,
    'P10DENY'||left(replace(gen_random_uuid()::text,'-',''),6),'Denied Temporary','asset',false,true);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'UNAUTHORIZED_TEMPORARY_ACCOUNT_ACCEPTED'; end if;
end $$;

select set_config('request.jwt.claim.sub',owner_auth::text,true)
from p10_partner_context;
do $$
declare context p10_partner_context%rowtype; fixture p10_partner_fixture%rowtype; blocked boolean:=false;
begin
  select * into context from p10_partner_context; select * into fixture from p10_partner_fixture;
  begin perform public.create_temporary_account(fixture.foreign_tenant_id,fixture.temp_group_id,
    'P10CROSS'||left(replace(gen_random_uuid()::text,'-',''),4),'Cross Tenant Temporary','asset',false,true);
  exception when insufficient_privilege then blocked:=true; end;
  if not blocked then raise exception 'CROSS_TENANT_TEMPORARY_ACCOUNT_ACCEPTED'; end if;
end $$;

-- Positive E2E cases: customer, supplier, and dual-role in both directions.
do $$
declare
  context p10_partner_context%rowtype;
  fixture p10_partner_fixture%rowtype;
  partner uuid;
  direction text;
  purpose text;
  counterpart uuid;
  v_payment_id uuid;
  v_move_id uuid;
  result jsonb;
  sequence integer := 0;
begin
  select * into context from p10_partner_context;
  select * into fixture from p10_partner_fixture;
  for partner,direction,purpose,counterpart in
    select * from (values
      (fixture.customer_id,'inbound','inbound_customer_unallocated',fixture.customer_account_id),
      (fixture.dual_id,'inbound','inbound_customer_unallocated',fixture.customer_account_id),
      (fixture.supplier_id,'outbound','outbound_supplier_unallocated',fixture.supplier_account_id),
      (fixture.dual_id,'outbound','outbound_supplier_unallocated',fixture.supplier_account_id)
    ) cases(partner,direction,purpose,counterpart)
  loop
    sequence := sequence + 1;
    result := public.create_financial_payment(
      context.tenant_id,direction,1000,fixture.method_id,'p10-positive-'||sequence,
      fixture.destination_id,'EGP',partner,fixture.branch_id,'P10-'||sequence
    );
    v_payment_id := (result->>'payment_id')::uuid;
    perform public.submit_financial_payment(context.tenant_id,v_payment_id);
    perform public.confirm_financial_payment(context.tenant_id,v_payment_id);
    result := public.post_financial_payment(context.tenant_id,v_payment_id,purpose);
    v_move_id := (result->>'account_move_id')::uuid;
    if not exists(select 1 from public.financial_payment_accounting_links link
      where link.tenant_id=context.tenant_id and link.payment_id=v_payment_id
        and link.account_move_id=v_move_id and link.entry_type='posting')
      or (select move.partner_id from public.account_moves move where move.id=v_move_id) is distinct from partner
      or not exists(select 1 from public.account_move_lines line
        where line.move_id=v_move_id and line.account_id=counterpart and line.partner_id=partner)
      or not exists(select 1 from public.account_move_lines line
        where line.move_id=v_move_id and line.account_id=fixture.destination_account_id and line.partner_id is null)
      or (select round(sum(line.debit-line.credit),2) from public.account_move_lines line where line.move_id=v_move_id) <> 0 then
      raise exception 'VALID_PARTNER_PAYMENT_POSTING_INVALID: %', purpose;
    end if;
  end loop;
end $$;

-- Wrong-role, null and inactive partners reach the public posting contract and
-- leave the confirmed payment unposted with no move or accounting link.
do $$
declare
  context p10_partner_context%rowtype;
  fixture p10_partner_fixture%rowtype;
  partner uuid;
  direction text;
  purpose text;
  v_payment_id uuid;
  result jsonb;
  blocked boolean;
  sequence integer := 0;
begin
  select * into context from p10_partner_context;
  select * into fixture from p10_partner_fixture;
  for partner,direction,purpose in
    select * from (values
      (fixture.supplier_id,'inbound','inbound_customer_unallocated'),
      (null::uuid,'inbound','inbound_customer_unallocated'),
      (fixture.customer_id,'outbound','outbound_supplier_unallocated'),
      (null::uuid,'outbound','outbound_supplier_unallocated')
    ) cases(partner,direction,purpose)
  loop
    sequence := sequence + 1;
    result := public.create_financial_payment(
      context.tenant_id,direction,700,fixture.method_id,'p10-negative-'||sequence,
      fixture.destination_id,'EGP',partner,fixture.branch_id,'P10-N'||sequence
    );
    v_payment_id := (result->>'payment_id')::uuid;
    perform public.submit_financial_payment(context.tenant_id,v_payment_id);
    perform public.confirm_financial_payment(context.tenant_id,v_payment_id);
    blocked := false;
    begin perform public.post_financial_payment(context.tenant_id,v_payment_id,purpose);
    exception when check_violation then blocked := true; end;
    if not blocked
      or (select payment.accounting_state from public.financial_payments payment where payment.id=v_payment_id) <> 'unposted'
      or exists(select 1 from public.financial_payment_accounting_links link where link.payment_id=v_payment_id)
      or exists(select 1 from public.account_moves move where move.ref='financial_payment:'||v_payment_id)
      or exists(select 1 from public.account_partial_reconcile partial
        join public.account_move_lines line on line.id in(partial.debit_move_id,partial.credit_move_id)
        join public.account_moves move on move.id=line.move_id
        where move.ref='financial_payment:'||v_payment_id) then
      raise exception 'INVALID_PARTNER_PAYMENT_CREATED_ACCOUNTING_EFFECT: %', purpose;
    end if;
  end loop;
end $$;

-- Cross-tenant partners are rejected at canonical creation by the composite FK;
-- consequently they can never reach posting or produce accounting records.
do $$
declare
  context p10_partner_context%rowtype;
  fixture p10_partner_fixture%rowtype;
  blocked boolean;
  moves_before bigint;
  links_before bigint;
begin
  select * into context from p10_partner_context;
  select * into fixture from p10_partner_fixture;
  select count(*) into moves_before from public.account_moves;
  select count(*) into links_before from public.financial_payment_accounting_links;
  blocked := false;
  begin perform public.create_financial_payment(
    context.tenant_id,'inbound',500,fixture.method_id,'p10-cross-customer',
    fixture.destination_id,'EGP',fixture.foreign_customer_id,fixture.branch_id,'P10-XC'
  ); exception when foreign_key_violation or check_violation then blocked := true; end;
  if not blocked then raise exception 'CROSS_TENANT_CUSTOMER_ACCEPTED'; end if;
  blocked := false;
  begin perform public.create_financial_payment(
    context.tenant_id,'outbound',500,fixture.method_id,'p10-cross-supplier',
    fixture.destination_id,'EGP',fixture.foreign_supplier_id,fixture.branch_id,'P10-XS'
  ); exception when foreign_key_violation or check_violation then blocked := true; end;
  if not blocked or (select count(*) from public.account_moves)<>moves_before
    or (select count(*) from public.financial_payment_accounting_links)<>links_before then
    raise exception 'CROSS_TENANT_PAYMENT_CREATED_ACCOUNTING_EFFECT';
  end if;
  blocked := false;
  begin perform public.create_financial_payment(
    context.tenant_id,'inbound',500,fixture.method_id,'p10-inactive-customer',
    fixture.destination_id,'EGP',fixture.inactive_customer_id,fixture.branch_id,'P10-IC'
  ); exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'INACTIVE_CUSTOMER_ACCEPTED'; end if;
  blocked := false;
  begin perform public.create_financial_payment(
    context.tenant_id,'outbound',500,fixture.method_id,'p10-inactive-supplier',
    fixture.destination_id,'EGP',fixture.inactive_supplier_id,fixture.branch_id,'P10-IS'
  ); exception when check_violation then blocked := true; end;
  if not blocked or (select count(*) from public.account_moves)<>moves_before
    or (select count(*) from public.financial_payment_accounting_links)<>links_before then
    raise exception 'INACTIVE_PARTNER_CREATED_ACCOUNTING_EFFECT';
  end if;
end $$;

set local role postgres;
rollback;
