-- Post accounting entries for new showroom sales.
-- This keeps showroom_sale_payments as the operational payment rows,
-- and creates account_moves/account_move_lines from the sale and its payments.

alter table public.showroom_sale_payments
  add column if not exists account_move_id uuid references public.account_moves(id);

create or replace function public.post_showroom_sale_accounting(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale record;
  v_payment record;
  v_invoice_move_id uuid;
  v_payment_move_id uuid;
  v_receivable_account_id uuid;
  v_sales_account_id uuid;
  v_cashier_account_id uuid;
  v_product_id uuid;
  v_invoice_receivable_line_id uuid;
  v_payment_receivable_line_id uuid;
  v_current_residual numeric := 0;
  v_reconcile_amount numeric := 0;
  v_payment_count integer := 0;
begin
  select *
  into v_sale
  from public.showroom_sales
  where id = p_sale_id
  for update;

  if not found then
    raise exception 'Showroom sale % not found', p_sale_id;
  end if;

  if v_sale.status <> 'confirmed' then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'sale_not_confirmed',
      'sale_id', p_sale_id
    );
  end if;

  if coalesce(v_sale.total_amount, 0) <= 0 then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'zero_total_amount',
      'sale_id', p_sale_id
    );
  end if;

  select id into v_receivable_account_id
  from public.account_accounts
  where tenant_id = v_sale.tenant_id
    and code = '114001'
    and active = true
  limit 1;

  select id into v_sales_account_id
  from public.account_accounts
  where tenant_id = v_sale.tenant_id
    and code = '411000'
    and active = true
  limit 1;

  select id into v_cashier_account_id
  from public.account_accounts
  where tenant_id = v_sale.tenant_id
    and code = '111002'
    and active = true
  limit 1;

  select product_product_id into v_product_id
  from public.showroom_sale_lines
  where tenant_id = v_sale.tenant_id
    and sale_id = v_sale.id
  order by created_at asc
  limit 1;

  if v_receivable_account_id is null then
    raise exception 'Missing receivable account 114001 for tenant %', v_sale.tenant_id;
  end if;

  if v_sales_account_id is null then
    raise exception 'Missing sales revenue account 411000 for tenant %', v_sale.tenant_id;
  end if;

  if v_cashier_account_id is null then
    raise exception 'Missing cashier account 111002 for tenant %', v_sale.tenant_id;
  end if;

  if v_product_id is null then
    raise exception 'Missing sale line/product for sale %', v_sale.id;
  end if;

  -- 1) Invoice move: Dr Receivable / Cr Sales.
  if v_sale.account_move_id is null then
    insert into public.account_moves (
      tenant_id,
      branch_id,
      name,
      move_type,
      partner_id,
      invoice_date,
      date,
      amount_total,
      state,
      ref,
      notes,
      created_by
    ) values (
      v_sale.tenant_id,
      v_sale.branch_id,
      'SALE-' || left(v_sale.id::text, 8),
      'sale',
      v_sale.customer_id,
      v_sale.sale_date,
      coalesce(v_sale.created_at, now()),
      v_sale.total_amount,
      'posted',
      left(coalesce(v_sale.sale_number, 'SALE-' || left(v_sale.id::text, 8)), 30),
      concat(
        'قيد فاتورة بيع شو روم',
        E'\nرقم الفاتورة: ', coalesce(v_sale.sale_number, v_sale.id::text),
        E'\nتاريخ الفاتورة: ', v_sale.sale_date,
        E'\nتم إنشاؤه تلقائياً من post_showroom_sale_accounting.'
      ),
      v_sale.created_by
    ) returning id into v_invoice_move_id;

    insert into public.account_move_lines (
      tenant_id,
      move_id,
      account_id,
      partner_id,
      label,
      debit,
      credit,
      amount_residual,
      parent_state,
      product_product_id,
      created_by
    ) values
    (
      v_sale.tenant_id,
      v_invoice_move_id,
      v_receivable_account_id,
      v_sale.customer_id,
      'ذمم عميل - فاتورة بيع شو روم',
      v_sale.total_amount,
      0,
      v_sale.total_amount,
      'posted',
      v_product_id,
      v_sale.created_by
    ),
    (
      v_sale.tenant_id,
      v_invoice_move_id,
      v_sales_account_id,
      v_sale.customer_id,
      'إيراد بيع شو روم',
      0,
      v_sale.total_amount,
      0,
      'posted',
      v_product_id,
      v_sale.created_by
    );

    update public.showroom_sales
    set account_move_id = v_invoice_move_id,
        updated_at = now()
    where id = v_sale.id;
  else
    v_invoice_move_id := v_sale.account_move_id;
  end if;

  select id, amount_residual
  into v_invoice_receivable_line_id, v_current_residual
  from public.account_move_lines
  where move_id = v_invoice_move_id
    and account_id = v_receivable_account_id
    and debit > 0
  order by created_at asc
  limit 1;

  if v_invoice_receivable_line_id is null then
    raise exception 'Missing invoice receivable line for sale %', v_sale.id;
  end if;

  -- 2) Payment moves: each showroom_sale_payments row becomes its own accounting move.
  for v_payment in
    select *
    from public.showroom_sale_payments
    where tenant_id = v_sale.tenant_id
      and sale_id = v_sale.id
      and amount > 0
      and account_move_id is null
    order by payment_date asc, created_at asc
  loop
    insert into public.account_moves (
      tenant_id,
      branch_id,
      name,
      move_type,
      partner_id,
      invoice_date,
      date,
      amount_total,
      state,
      ref,
      notes,
      pay_method,
      created_by
    ) values (
      v_payment.tenant_id,
      v_sale.branch_id,
      'PAY-' || left(v_payment.id::text, 8),
      'payment',
      v_sale.customer_id,
      v_payment.payment_date,
      coalesce(v_payment.created_at, now()),
      v_payment.amount,
      'posted',
      left('PAY-' || coalesce(v_sale.sale_number, left(v_sale.id::text, 8)), 30),
      concat(
        'قيد دفعة شو روم',
        E'\nرقم دفعة الشو روم: ', v_payment.id,
        E'\nرقم الفاتورة: ', coalesce(v_sale.sale_number, v_sale.id::text),
        E'\nتاريخ الدفع: ', v_payment.payment_date,
        E'\nطريقة الدفع: ', coalesce(v_payment.payment_method, 'غير محدد'),
        E'\nملاحظات الدفعة: ', coalesce(v_payment.notes, ''),
        E'\nتاريخ تسجيل الدفعة: ', v_payment.created_at,
        E'\nملاحظة: هذه دفعة جديدة وتدخل على صندوق المعرض / الكاشير 111002.'
      ),
      left(coalesce(v_payment.payment_method, 'showroom'), 30),
      coalesce(v_payment.created_by, v_sale.created_by)
    ) returning id into v_payment_move_id;

    insert into public.account_move_lines (
      tenant_id,
      move_id,
      account_id,
      partner_id,
      label,
      debit,
      credit,
      amount_residual,
      parent_state,
      product_product_id,
      created_by
    ) values (
      v_payment.tenant_id,
      v_payment_move_id,
      v_cashier_account_id,
      v_sale.customer_id,
      'تحصيل من عميل - صندوق المعرض / الكاشير',
      v_payment.amount,
      0,
      0,
      'posted',
      v_product_id,
      coalesce(v_payment.created_by, v_sale.created_by)
    );

    insert into public.account_move_lines (
      tenant_id,
      move_id,
      account_id,
      partner_id,
      label,
      debit,
      credit,
      amount_residual,
      parent_state,
      product_product_id,
      created_by
    ) values (
      v_payment.tenant_id,
      v_payment_move_id,
      v_receivable_account_id,
      v_sale.customer_id,
      'تسوية دفعة على فاتورة شو روم',
      0,
      v_payment.amount,
      0,
      'posted',
      v_product_id,
      coalesce(v_payment.created_by, v_sale.created_by)
    ) returning id into v_payment_receivable_line_id;

    select amount_residual
    into v_current_residual
    from public.account_move_lines
    where id = v_invoice_receivable_line_id
    for update;

    v_reconcile_amount := least(v_payment.amount, greatest(coalesce(v_current_residual, 0), 0));

    if v_reconcile_amount > 0 then
      insert into public.account_partial_reconcile (
        tenant_id,
        debit_move_id,
        credit_move_id,
        amount,
        max_date,
        created_by
      ) values (
        v_payment.tenant_id,
        v_invoice_receivable_line_id,
        v_payment_receivable_line_id,
        v_reconcile_amount,
        v_payment.payment_date,
        coalesce(v_payment.created_by, v_sale.created_by)
      );

      update public.account_move_lines
      set amount_residual = greatest(amount_residual - v_reconcile_amount, 0),
          is_reconciled = (greatest(amount_residual - v_reconcile_amount, 0) = 0)
      where id = v_invoice_receivable_line_id;
    end if;

    update public.account_move_lines
    set amount_residual = 0,
        is_reconciled = true
    where id = v_payment_receivable_line_id;

    update public.showroom_sale_payments
    set account_move_id = v_payment_move_id
    where id = v_payment.id;

    v_payment_count := v_payment_count + 1;
  end loop;

  return jsonb_build_object(
    'status', 'done',
    'sale_id', v_sale.id,
    'invoice_move_id', v_invoice_move_id,
    'posted_payment_count', v_payment_count
  );
end;
$$;
