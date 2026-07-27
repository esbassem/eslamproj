begin;

-- Rewrite every currently published function that still reads or writes the
-- showroom payment cache. Each replacement is asserted so this migration
-- fails closed if an earlier function definition differs from the audited one.
create function pg_temp.rewrite_function(
  p_signature text,
  p_old text[],
  p_new text[]
)
returns void
language plpgsql
as $$
declare
  v_definition text;
  v_index integer;
begin
  if coalesce(array_length(p_old, 1), 0) <> coalesce(array_length(p_new, 1), 0) then
    raise exception 'Invalid rewrite arrays for %', p_signature;
  end if;

  select pg_get_functiondef(to_regprocedure(p_signature))
  into v_definition;

  if v_definition is null then
    raise exception 'Function % was not found', p_signature;
  end if;

  v_definition := replace(v_definition, E'\r\n', E'\n');

  for v_index in 1..array_length(p_old, 1)
  loop
    if strpos(v_definition, p_old[v_index]) = 0 then
      raise exception 'Expected source fragment % was not found in %', v_index, p_signature;
    end if;
    v_definition := replace(v_definition, p_old[v_index], p_new[v_index]);
  end loop;

  execute v_definition;
end;
$$;

select pg_temp.rewrite_function(
  'public.complete_showroom_sale(uuid,numeric,text,jsonb)',
  array[
    $old$  if v_sale.status = 'confirmed' and v_sale.account_move_id is not null then
    return jsonb_build_object($old$,
    $old$      'paid_amount', v_sale.paid_amount,
      'remaining_amount', v_sale.remaining_amount,$old$,
    $old$  set total_amount = v_total,
      paid_amount = v_paid,
      remaining_amount = v_remaining,
      account_move_id = v_sale_move_id,$old$,
    $old$    'paid_amount', v_paid,
    'remaining_amount', v_remaining,$old$
  ],
  array[
    $new$  if v_sale.status = 'confirmed' and v_sale.account_move_id is not null then
    select
      round(coalesce(sum(reconcile.amount), 0), 2),
      round(greatest(coalesce(max(invoice_line.debit), v_sale.total_amount, 0)
        - coalesce(sum(reconcile.amount), 0), 0), 2)
    into v_paid, v_remaining
    from public.account_move_lines invoice_line
    join public.account_accounts receivable_account
      on receivable_account.id = invoice_line.account_id
     and receivable_account.tenant_id = invoice_line.tenant_id
     and receivable_account.code = '114001'
    left join public.account_partial_reconcile reconcile
      on reconcile.tenant_id = invoice_line.tenant_id
     and reconcile.debit_move_id = invoice_line.id
    where invoice_line.tenant_id = v_sale.tenant_id
      and invoice_line.move_id = v_sale.account_move_id
      and invoice_line.debit > 0;

    return jsonb_build_object($new$,
    $new$      'accounting_paid_amount', v_paid,
      'accounting_remaining_amount', v_remaining,$new$,
    $new$  set total_amount = v_total,
      account_move_id = v_sale_move_id,$new$,
    $new$    'accounting_paid_amount', v_paid,
    'accounting_remaining_amount', v_remaining,$new$
  ]
);

select pg_temp.rewrite_function(
  'public.pay_showroom_sale_accounting(uuid,numeric,text,text)',
  array[
    $old$  v_remaining := round(greatest(coalesce(v_sale.total_amount, 0) - v_paid, 0), 2);$old$,
    $old$  v_remaining := round(greatest(v_sale.total_amount - v_paid, 0), 2);$old$,
    $old$  set account_move_id = v_sale_move_id,
      paid_amount = v_paid,
      remaining_amount = v_remaining,
      updated_at = now()$old$,
    $old$    'paid_amount', v_paid,
    'remaining_amount', v_remaining$old$
  ],
  array[
    $new$  v_remaining := round(greatest(
    (select invoice_line.debit from public.account_move_lines invoice_line where invoice_line.id = v_invoice_line_id)
    - v_paid, 0), 2);$new$,
    $new$  v_remaining := round(greatest(
    (select invoice_line.debit from public.account_move_lines invoice_line where invoice_line.id = v_invoice_line_id)
    - v_paid, 0), 2);$new$,
    $new$  set account_move_id = v_sale_move_id,
      updated_at = now()$new$,
    $new$    'accounting_paid_amount', v_paid,
    'accounting_remaining_amount', v_remaining$new$
  ]
);

select pg_temp.rewrite_function(
  'public.settle_showroom_sale_balance(uuid,numeric,text,uuid,text)',
  array[
    $old$  v_remaining := round(greatest(coalesce(v_sale.total_amount, 0) - v_paid, 0), 2);$old$,
    $old$  v_remaining := round(greatest(v_sale.total_amount - v_paid, 0), 2);$old$,
    $old$  set account_move_id = v_sale_move_id,
      paid_amount = v_paid,
      remaining_amount = v_remaining,
      updated_at = now()$old$,
    $old$    'paid_amount', v_paid,
    'remaining_amount', v_remaining$old$
  ],
  array[
    $new$  v_remaining := round(greatest(
    (select invoice_line.debit from public.account_move_lines invoice_line where invoice_line.id = v_invoice_line_id)
    - v_paid, 0), 2);$new$,
    $new$  v_remaining := round(greatest(
    (select invoice_line.debit from public.account_move_lines invoice_line where invoice_line.id = v_invoice_line_id)
    - v_paid, 0), 2);$new$,
    $new$  set account_move_id = v_sale_move_id,
      updated_at = now()$new$,
    $new$    'accounting_paid_amount', v_paid,
    'accounting_remaining_amount', v_remaining$new$
  ]
);

select pg_temp.rewrite_function(
  'public.settle_showroom_sale_with_advance_credit(uuid,uuid,numeric,text)',
  array[
    $old$  set account_move_id = v_sale_move_id,
      paid_amount = v_paid,
      remaining_amount = v_remaining,
      updated_at = now()$old$,
    $old$    'paid_amount', v_paid,
    'remaining_amount', v_remaining$old$
  ],
  array[
    $new$  set account_move_id = v_sale_move_id,
      updated_at = now()$new$,
    $new$    'accounting_paid_amount', v_paid,
    'accounting_remaining_amount', v_remaining$new$
  ]
);

select pg_temp.rewrite_function(
  'public.settle_showroom_sale_with_open_credits(uuid,uuid,jsonb)',
  array[
    $old$  -- Compatibility caches only. They are never read above for validation or
  -- residual calculations.
$old$,
    $old$  set account_move_id = v_invoice_move.id,
      paid_amount = v_invoice_reconciled,
      remaining_amount = v_invoice_residual,
      updated_at = now()$old$
  ],
  array[
    $new$$new$,
    $new$  set account_move_id = v_invoice_move.id,
      updated_at = now()$new$
  ]
);

select pg_temp.rewrite_function(
  'public.cancel_showroom_sale(uuid,uuid,text,text)',
  array[
    $old$  set status = 'cancelled', paid_amount = 0, remaining_amount = 0, updated_at = v_now$old$
  ],
  array[
    $new$  set status = 'cancelled', updated_at = v_now$new$
  ]
);

select pg_temp.rewrite_function(
  'public.delete_account_move_atomic(uuid,uuid)',
  array[
    $old$  for v_sale in
    select sale.id, sale.total_amount, sale.account_move_id
    from public.showroom_sales sale
    where sale.tenant_id = p_tenant_id
      and sale.id = any(v_affected_sale_ids)
    for update
  loop
    select round(coalesce(sum(reconcile.amount), 0), 2)
    into v_paid
    from public.account_moves sale_move
    join public.account_move_lines invoice_line
      on invoice_line.tenant_id = sale_move.tenant_id
     and invoice_line.move_id = sale_move.id
     and invoice_line.debit > 0
    join public.account_accounts receivable_account
      on receivable_account.tenant_id = invoice_line.tenant_id
     and receivable_account.id = invoice_line.account_id
     and receivable_account.code = '114001'
    left join public.account_partial_reconcile reconcile
      on reconcile.tenant_id = invoice_line.tenant_id
     and reconcile.debit_move_id = invoice_line.id
    where sale_move.tenant_id = p_tenant_id
      and sale_move.move_type = 'sale'
      and sale_move.state = 'posted'
      and (
        sale_move.id = v_sale.account_move_id
        or sale_move.ref = 'showroom_sale:' || v_sale.id
      );

    v_remaining := round(greatest(coalesce(v_sale.total_amount, 0) - coalesce(v_paid, 0), 0), 2);

    update public.showroom_sales
    set
      paid_amount = coalesce(v_paid, 0),
      remaining_amount = v_remaining,
      updated_at = now()
    where tenant_id = p_tenant_id
      and id = v_sale.id;
  end loop;

$old$
  ],
  array[$new$$new$]
);

select pg_temp.rewrite_function(
  'public.preview_showroom_sale_cancellation(uuid,uuid)',
  array[
    $old$      if round(coalesce(v_sale.paid_amount, 0), 2) <> v_reconciled
         or round(coalesce(v_sale.remaining_amount, 0), 2) <> v_residual
      then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'sale_payment_cache_drift',
          'message', 'القيم المخزنة على Sale لا تطابق القيم المشتقة من APR.',
          'apr_paid', v_reconciled,
          'cached_paid', round(coalesce(v_sale.paid_amount, 0), 2),
          'apr_residual', v_residual,
          'cached_residual', round(coalesce(v_sale.remaining_amount, 0), 2),
          'details', jsonb_build_object(
            'invoice_total', round(v_invoice_line.debit, 2),
            'cached_paid_amount', round(coalesce(v_sale.paid_amount, 0), 2),
            'cached_remaining_amount', round(coalesce(v_sale.remaining_amount, 0), 2),
            'accounting_paid_amount', v_reconciled,
            'accounting_remaining_amount', v_residual,
            'paid_difference',
              round(coalesce(v_sale.paid_amount, 0), 2) - v_reconciled,
            'remaining_difference',
              round(coalesce(v_sale.remaining_amount, 0), 2) - v_residual,
            'accounting_source', 'partial_reconciliations'
          )
        ));
      end if;
$old$,
    $old$      'total_amount', v_sale.total_amount,
      'paid_amount', v_sale.paid_amount,
      'remaining_amount', v_sale.remaining_amount$old$,
    $old$      'total_amount', round(v_sale.total_amount, 2),
      'paid_amount_cached', round(coalesce(v_sale.paid_amount, 0), 2),
      'remaining_amount_cached', round(coalesce(v_sale.remaining_amount, 0), 2),
      'account_move_id', v_sale.account_move_id,$old$
  ],
  array[
    $new$$new$,
    $new$      'total_amount', v_sale.total_amount,
      'accounting_paid_amount', v_reconciled,
      'accounting_remaining_amount', v_residual$new$,
    $new$      'total_amount', round(v_sale.total_amount, 2),
      'accounting_paid_amount', v_reconciled,
      'accounting_remaining_amount', v_residual,
      'account_move_id', v_sale.account_move_id,$new$
  ]
);

-- Only the column-local defaults and CHECK constraints remained as catalog
-- dependencies in the pre-drop audit. No CASCADE is used.
alter table public.showroom_sales
  drop column paid_amount,
  drop column remaining_amount;

notify pgrst, 'reload schema';

commit;
