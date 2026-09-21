begin;

do $$
begin
  if has_table_privilege('anon', 'public.financial_settlement_sequences', 'SELECT')
     or has_table_privilege('anon', 'public.financial_settlement_sequences', 'INSERT')
     or has_table_privilege('anon', 'public.financial_settlement_sequences', 'UPDATE')
     or has_table_privilege('anon', 'public.financial_settlement_sequences', 'DELETE')
     or has_table_privilege('anon', 'public.financial_settlement_sequences', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.financial_settlement_sequences', 'SELECT')
     or has_table_privilege('authenticated', 'public.financial_settlement_sequences', 'INSERT')
     or has_table_privilege('authenticated', 'public.financial_settlement_sequences', 'UPDATE')
     or has_table_privilege('authenticated', 'public.financial_settlement_sequences', 'DELETE')
     or has_table_privilege('authenticated', 'public.financial_settlement_sequences', 'TRUNCATE') then
    raise exception 'SETTLEMENT_SEQUENCE_DIRECT_PRIVILEGE_REMAINS';
  end if;
  if has_function_privilege('anon', 'public.next_financial_settlement_number(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.next_financial_settlement_number(uuid)', 'EXECUTE')
     or has_function_privilege('public', 'public.next_financial_settlement_number(uuid)', 'EXECUTE') then
    raise exception 'SETTLEMENT_NUMBER_HELPER_EXPOSED';
  end if;
  if has_table_privilege('anon', 'public.account_accounts', 'INSERT')
     or has_table_privilege('anon', 'public.account_accounts', 'UPDATE')
     or has_table_privilege('anon', 'public.account_accounts', 'DELETE')
     or has_table_privilege('anon', 'public.account_accounts', 'TRUNCATE')
     or has_table_privilege('authenticated', 'public.account_accounts', 'INSERT')
     or has_table_privilege('authenticated', 'public.account_accounts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.account_accounts', 'DELETE')
     or has_table_privilege('authenticated', 'public.account_accounts', 'TRUNCATE') then
    raise exception 'ACCOUNT_MASTER_DIRECT_MUTATION_PRIVILEGE_REMAINS';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'account_accounts' and policyname = 'account_accounts_tenant_read'
      and cmd = 'SELECT'
  ) or exists (
    select 1 from pg_policies where schemaname = 'public'
      and tablename = 'account_accounts' and cmd <> 'SELECT'
  ) then
    raise exception 'ACCOUNT_MASTER_RLS_NOT_READ_ONLY';
  end if;
end
$$;

set local role anon;
do $$
declare blocked boolean;
begin
  blocked := false;
  begin perform public.next_financial_settlement_number(gen_random_uuid());
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'ANON_NUMBER_HELPER_ACCEPTED'; end if;
  blocked := false;
  begin truncate public.financial_settlement_sequences;
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'ANON_SEQUENCE_TRUNCATE_ACCEPTED'; end if;
  blocked := false;
  begin truncate public.account_accounts;
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'ANON_ACCOUNT_TRUNCATE_ACCEPTED'; end if;
end
$$;

set local role authenticated;
do $$
declare blocked boolean;
begin
  blocked := false;
  begin perform public.next_financial_settlement_number(gen_random_uuid());
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'AUTHENTICATED_NUMBER_HELPER_ACCEPTED'; end if;
  blocked := false;
  begin update public.account_accounts set name = name;
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'AUTHENTICATED_ACCOUNT_UPDATE_ACCEPTED'; end if;
  blocked := false;
  begin truncate public.account_accounts;
  exception when insufficient_privilege then blocked := true; end;
  if not blocked then raise exception 'AUTHENTICATED_ACCOUNT_TRUNCATE_ACCEPTED'; end if;
end
$$;

set local role postgres;

-- The partner validator is the single semantic source used by both direct and
-- clearing posting. Exercise customer, supplier, dual-role, null and cross-tenant.
do $$
declare
  tenant_one uuid;
  tenant_two uuid;
  customer uuid;
  supplier uuid;
  dual_role uuid;
  foreign_customer uuid;
  purpose_customer text;
  purpose_supplier text;
  blocked boolean;
begin
  select code into purpose_customer from public.financial_payment_purposes
  where is_active and requires_partner and partner_role = 'customer' limit 1;
  select code into purpose_supplier from public.financial_payment_purposes
  where is_active and requires_partner and partner_role = 'supplier' limit 1;
  select tenant_id into tenant_one from public.tenant_users where is_active limit 1;
  select tenant_id into tenant_two from public.tenant_users
  where is_active and tenant_id <> tenant_one limit 1;
  if purpose_customer is null or purpose_supplier is null or tenant_two is null then
    raise exception 'PARTNER_VALIDATION_FIXTURE_UNAVAILABLE';
  end if;
  insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)
  values
    (tenant_one,'P10B Customer','person',false,true,1,0,0,true),
    (tenant_one,'P10B Supplier','person',false,true,0,1,0,true),
    (tenant_one,'P10B Dual','person',false,true,1,1,0,true);
  select id into customer from public.partners where tenant_id=tenant_one and name='P10B Customer';
  select id into supplier from public.partners where tenant_id=tenant_one and name='P10B Supplier';
  select id into dual_role from public.partners where tenant_id=tenant_one and name='P10B Dual';
  insert into public.partners(tenant_id,name,contact_type,is_company,is_external_contact,customer_rank,supplier_rank,financer_rank,active)
  values(tenant_two,'P10B Foreign Customer','person',false,true,1,0,0,true) returning id into foreign_customer;
  perform public.assert_financial_payment_partner_role(tenant_one,customer,purpose_customer);
  perform public.assert_financial_payment_partner_role(tenant_one,supplier,purpose_supplier);
  perform public.assert_financial_payment_partner_role(tenant_one,dual_role,purpose_customer);
  perform public.assert_financial_payment_partner_role(tenant_one,dual_role,purpose_supplier);
  blocked := false;
  begin perform public.assert_financial_payment_partner_role(tenant_one,supplier,purpose_customer);
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'SUPPLIER_ACCEPTED_AS_CUSTOMER'; end if;
  blocked := false;
  begin perform public.assert_financial_payment_partner_role(tenant_one,customer,purpose_supplier);
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'CUSTOMER_ACCEPTED_AS_SUPPLIER'; end if;
  blocked := false;
  begin perform public.assert_financial_payment_partner_role(tenant_one,null,purpose_customer);
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'NULL_REQUIRED_PARTNER_ACCEPTED'; end if;
  blocked := false;
  begin perform public.assert_financial_payment_partner_role(tenant_one,foreign_customer,purpose_customer);
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'CROSS_TENANT_PARTNER_ACCEPTED'; end if;
  update public.partners set active = false where id = customer;
  blocked := false;
  begin perform public.assert_financial_payment_partner_role(tenant_one,customer,purpose_customer);
  exception when check_violation then blocked := true; end;
  if not blocked then raise exception 'INACTIVE_PARTNER_ACCEPTED'; end if;
end
$$;

rollback;
