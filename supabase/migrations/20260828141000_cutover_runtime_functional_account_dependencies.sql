begin;

-- Override current runtime functions in place. Historical migration helpers
-- and explicit cash/custody diagnostics remain legacy by design.
do $$
declare
  signatures regprocedure[] := array[
    'public.cancel_showroom_sale(uuid,uuid,text,text)'::regprocedure,
    'public.complete_showroom_sale(uuid,numeric,text,jsonb)'::regprocedure,
    'public.create_accountant_payment_entity_credit(jsonb)'::regprocedure,
    'public.create_confirmed_showroom_sale_return(uuid,uuid,jsonb,text,text,uuid)'::regprocedure,
    'public.deliver_paperwork_to_customer(uuid,uuid)'::regprocedure,
    'public.list_customer_open_credits(uuid,uuid,boolean)'::regprocedure,
    'public.pay_showroom_sale_accounting(uuid,numeric,text,text)'::regprocedure,
    'public.preview_showroom_sale_cancellation(uuid,uuid)'::regprocedure,
    'public.settle_showroom_sale_balance(uuid,numeric,text,uuid,text)'::regprocedure,
    'public.settle_showroom_sale_with_advance_credit(uuid,uuid,numeric,text)'::regprocedure,
    'public.settle_showroom_sale_with_open_credits(uuid,uuid,jsonb)'::regprocedure
  ];
  signature regprocedure;
  definition text;
begin
  foreach signature in array signatures loop
    definition := pg_get_functiondef(signature);

    definition := replace(definition,
      'account.code = ''114001''',
      'public.account_matches_functional_role(account.tenant_id, account.id, ''customer_receivable'', null)');
    definition := replace(definition,
      'receivable_account.code = ''114001''',
      'public.account_matches_functional_role(receivable_account.tenant_id, receivable_account.id, ''customer_receivable'', null)');
    definition := replace(definition,
      'aa.code = ''114001''',
      'public.account_matches_functional_role(aa.tenant_id, aa.id, ''customer_receivable'', null)');
    definition := replace(definition,
      'credit_account.code = ''114001''',
      'public.account_matches_functional_role(credit_account.tenant_id, credit_account.id, ''customer_receivable'', null)');
    definition := replace(definition,
      'account.code = ''114002''',
      'public.account_matches_functional_role(account.tenant_id, account.id, ''payment_entity_receivable'', null)');
    definition := replace(definition,
      'account.code = ''212001''',
      'public.account_matches_functional_role(account.tenant_id, account.id, ''customer_advance'', null)');
    definition := replace(definition,
      'account.code = ''411000''',
      'public.account_matches_functional_role(account.tenant_id, account.id, ''sales_revenue'', null)');

    definition := regexp_replace(
      definition,
      '([[:space:]])code[[:space:]]*=[[:space:]]*''114001''',
      E'\\1id = public.resolve_functional_account(tenant_id, ''customer_receivable'', null)',
      'g');
    definition := regexp_replace(
      definition,
      '([[:space:]])code[[:space:]]*=[[:space:]]*''114002''',
      E'\\1id = public.resolve_functional_account(tenant_id, ''payment_entity_receivable'', null)',
      'g');
    definition := regexp_replace(
      definition,
      '([[:space:]])code[[:space:]]*=[[:space:]]*''212001''',
      E'\\1id = public.resolve_functional_account(tenant_id, ''customer_advance'', null)',
      'g');
    definition := regexp_replace(
      definition,
      '([[:space:]])code[[:space:]]*=[[:space:]]*''411000''',
      E'\\1id = public.resolve_functional_account(tenant_id, ''sales_revenue'', null)',
      'g');

    definition := replace(definition,
      'v_row.credit_account_code = ''114001''',
      'v_row.credit_account_id = v_receivable_account_id');
    definition := replace(definition,
      'v_row.credit_account_code is distinct from ''114001''',
      'v_row.credit_account_id is distinct from v_receivable_account_id');

    execute definition;
  end loop;
end
$$;

-- The two migration helpers intentionally preserve their historical code
-- vocabulary and are not part of runtime functional resolution.
comment on function public.migrate_old_showroom_sale_payments() is
  'LEGACY MIGRATION ONLY: historical code-based data conversion; not a runtime accounting contract.';
comment on function public.migrate_old_showroom_sales_invoice_moves() is
  'LEGACY MIGRATION ONLY: historical code-based data conversion; not a runtime accounting contract.';

commit;
