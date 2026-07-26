begin;

drop function if exists public.complete_showroom_sale(uuid, numeric, text, jsonb);

create function public.complete_showroom_sale(
  p_sale_id uuid,
  p_cash_amount numeric default 0,
  p_cash_note text default null,
  p_open_credit_allocations jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_user public.tenant_users%rowtype;
  v_sale public.showroom_sales%rowtype;
  v_branch_id uuid;
  v_total numeric := 0;
  v_cash numeric := round(greatest(coalesce(p_cash_amount, 0), 0), 2);
  v_open_credit_total numeric := 0;
  v_paid numeric := 0;
  v_remaining numeric := 0;
  v_receivable_account public.account_accounts%rowtype;
  v_income_account_id uuid;
  v_cash_account_id uuid;
  v_employee_partner_id uuid;
  v_sale_move_id uuid := gen_random_uuid();
  v_cash_move_id uuid;
  v_invoice_receivable_line_id uuid := gen_random_uuid();
  v_payment_receivable_line_id uuid;
  v_item jsonb;
  v_allocation_amount numeric;
  v_credit_ids uuid[] := array[]::uuid[];
  v_credit_line public.account_move_lines%rowtype;
  v_credit_move public.account_moves%rowtype;
  v_credit_reconciled numeric := 0;
  v_credit_available numeric := 0;
  v_invoice_currency varchar := 'EGP';
  v_credit_currency varchar;
  v_open_credit_results jsonb := '[]'::jsonb;
  v_inventory_active boolean := false;
  v_line record;
  v_quant record;
  v_unit record;
  v_account_count integer;
begin
  if v_auth_user_id is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;

  select sale.*
  into v_sale
  from public.showroom_sales sale
  where sale.id = p_sale_id
  for update;

  if v_sale.id is null then
    raise exception 'فاتورة الشو روم غير موجودة.';
  end if;

  select tenant_user.*
  into v_user
  from public.tenant_users tenant_user
  where tenant_user.auth_user_id = v_auth_user_id
    and tenant_user.tenant_id = v_sale.tenant_id
    and coalesce(tenant_user.is_active, true) = true
  order by tenant_user.created_at, tenant_user.id
  limit 1
  for update;

  if v_user.id is null then
    raise exception 'لا يمكن إتمام فاتورة تابعة لشركة أخرى.';
  end if;

  if v_sale.status = 'confirmed' and v_sale.account_move_id is not null then
    return jsonb_build_object(
      'success', true,
      'already_completed', true,
      'sale_id', v_sale.id,
      'sale_account_move_id', v_sale.account_move_id,
      'cash_move_id', null,
      'open_credit_allocations', '[]'::jsonb,
      'total_amount', v_sale.total_amount,
      'paid_amount', v_sale.paid_amount,
      'remaining_amount', v_sale.remaining_amount,
      'status', v_sale.status
    );
  end if;

  if v_sale.status <> 'pending_payment' then
    raise exception 'الفاتورة لم تعد معلقة على الدفع.';
  end if;
  if v_sale.customer_id is null then
    raise exception 'الفاتورة غير مرتبطة بعميل.';
  end if;
  if not exists (
    select 1
    from public.partners customer
    where customer.id = v_sale.customer_id
      and customer.tenant_id = v_sale.tenant_id
      and coalesce(customer.active, true) = true
  ) then
    raise exception 'عميل الفاتورة غير موجود أو غير نشط داخل الشركة.';
  end if;
  if v_sale.account_move_id is not null then
    raise exception 'الفاتورة مرتبطة بقيد محاسبي مسبقًا.';
  end if;

  select round(coalesce(sum(sale_line.total), 0), 2), count(*)
  into v_total, v_account_count
  from public.showroom_sale_lines sale_line
  where sale_line.tenant_id = v_sale.tenant_id
    and sale_line.sale_id = v_sale.id;

  if v_account_count = 0 or v_total <= 0 then
    raise exception 'الفاتورة لا تحتوي على سطور بيع صالحة.';
  end if;
  if coalesce(p_cash_amount, 0) < 0 then
    raise exception 'مبلغ الكاش لا يمكن أن يكون سالبًا.';
  end if;
  if p_open_credit_allocations is null
    or jsonb_typeof(p_open_credit_allocations) <> 'array'
  then
    raise exception 'بيانات تخصيص الاعتمادات غير صحيحة.';
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_open_credit_allocations)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or nullif(v_item ->> 'open_credit_line_id', '') is null
      or nullif(v_item ->> 'amount', '') is null
    then
      raise exception 'بيانات تخصيص الاعتماد غير مكتملة.';
    end if;

    v_allocation_amount := round((v_item ->> 'amount')::numeric, 2);
    if v_allocation_amount <= 0 then
      raise exception 'كل مبلغ مستخدم من الاعتماد يجب أن يكون أكبر من صفر.';
    end if;

    if array_position(v_credit_ids, (v_item ->> 'open_credit_line_id')::uuid) is not null then
      raise exception 'لا يمكن تكرار نفس الاعتماد في عملية البيع.';
    end if;

    v_credit_ids := array_append(v_credit_ids, (v_item ->> 'open_credit_line_id')::uuid);
    v_open_credit_total := round(v_open_credit_total + v_allocation_amount, 2);
  end loop;

  v_paid := round(v_cash + v_open_credit_total, 2);
  if v_paid > v_total then
    raise exception 'إجمالي الدفعات يتجاوز قيمة الفاتورة.';
  end if;

  select coalesce(v_sale.branch_id, showroom_config.branch_id)
  into v_branch_id
  from public.showroom_configs showroom_config
  where showroom_config.id = v_sale.showroom_config_id
    and showroom_config.tenant_id = v_sale.tenant_id;

  if v_branch_id is not null and not exists (
    select 1
    from public.branches branch
    where branch.id = v_branch_id
      and branch.tenant_id = v_sale.tenant_id
      and coalesce(branch.is_active, true) = true
  ) then
    raise exception 'فرع الفاتورة غير موجود أو غير نشط داخل الشركة.';
  end if;

  select account.*
  into v_receivable_account
  from public.account_accounts account
  where account.tenant_id = v_sale.tenant_id
    and account.code = '114001'
    and coalesce(account.active, true) = true;

  if v_receivable_account.id is null then
    raise exception 'حساب 114001 غير موجود أو غير نشط داخل الشركة.';
  end if;
  if not coalesce(v_receivable_account.reconcile, false) then
    raise exception 'حساب 114001 غير مهيأ للمصالحة.';
  end if;

  select count(*)
  into v_account_count
  from public.account_accounts account
  where account.tenant_id = v_sale.tenant_id
    and account.code = '411000'
    and coalesce(account.active, true) = true;

  if v_account_count <> 1 then
    raise exception 'حساب 411000 غير موجود مرة واحدة داخل الشركة.';
  end if;

  select account.id
  into v_income_account_id
  from public.account_accounts account
  where account.tenant_id = v_sale.tenant_id
    and account.code = '411000'
    and coalesce(account.active, true) = true;

  if cardinality(v_credit_ids) > 0 then
    perform pg_advisory_xact_lock(
      hashtextextended(v_sale.tenant_id::text || ':' || v_sale.customer_id::text, 0)
    );

    perform move_line.id
    from public.account_move_lines move_line
    where move_line.tenant_id = v_sale.tenant_id
      and move_line.id = any(v_credit_ids)
    order by move_line.id
    for update;

    perform account_move.id
    from public.account_moves account_move
    where account_move.tenant_id = v_sale.tenant_id
      and account_move.id in (
        select move_line.move_id
        from public.account_move_lines move_line
        where move_line.tenant_id = v_sale.tenant_id
          and move_line.id = any(v_credit_ids)
      )
    order by account_move.id
    for update;

    for v_item in
      select value
      from jsonb_array_elements(p_open_credit_allocations)
    loop
      v_allocation_amount := round((v_item ->> 'amount')::numeric, 2);

      select move_line.*
      into v_credit_line
      from public.account_move_lines move_line
      where move_line.id = (v_item ->> 'open_credit_line_id')::uuid
        and move_line.tenant_id = v_sale.tenant_id;

      if v_credit_line.id is null then
        raise exception 'الاعتماد المحدد غير موجود داخل الشركة.';
      end if;
      if v_credit_line.account_id <> v_receivable_account.id
        or v_credit_line.debit <> 0
        or v_credit_line.credit <= 0
        or v_credit_line.source_entity_id is null
      then
        raise exception 'السطر المحدد ليس Open Credit صالحًا على حساب 114001.';
      end if;
      if v_credit_line.partner_id is distinct from v_sale.customer_id then
        raise exception 'لا يمكن استخدام اعتماد يخص عميلًا آخر.';
      end if;

      select account_move.*
      into v_credit_move
      from public.account_moves account_move
      where account_move.id = v_credit_line.move_id
        and account_move.tenant_id = v_sale.tenant_id;

      if v_credit_move.id is null or v_credit_move.state <> 'posted' then
        raise exception 'قيد الاعتماد غير موجود أو غير مرحل.';
      end if;

      if not exists (
        select 1
        from public.partners payment_entity
        where payment_entity.id = v_credit_line.source_entity_id
          and payment_entity.tenant_id = v_sale.tenant_id
          and coalesce(payment_entity.active, true) = true
      ) then
        raise exception 'جهة الاعتماد غير موجودة أو غير نشطة داخل الشركة.';
      end if;

      v_credit_currency := coalesce(v_credit_line.currency_code, v_credit_move.currency_code, 'EGP');
      if v_credit_currency is distinct from v_invoice_currency then
        raise exception 'عملة الاعتماد لا تطابق عملة الفاتورة.';
      end if;

      select round(coalesce(sum(partial.amount), 0), 2)
      into v_credit_reconciled
      from public.account_partial_reconcile partial
      where partial.tenant_id = v_sale.tenant_id
        and partial.credit_move_id = v_credit_line.id;

      v_credit_available := round(greatest(v_credit_line.credit - v_credit_reconciled, 0), 2);
      if v_allocation_amount > v_credit_available then
        raise exception 'مبلغ الاستخدام أكبر من المتبقي الحقيقي للاعتماد %.', v_credit_available;
      end if;
    end loop;
  end if;

  if v_cash > 0 then
    v_employee_partner_id := v_user.partner_id;
    if v_employee_partner_id is null then
      insert into public.partners (
        tenant_id, name, phone1, mobile, email, contact_type, is_company,
        is_external_contact, customer_rank, supplier_rank, financer_rank, active
      )
      values (
        v_user.tenant_id,
        coalesce(nullif(btrim(v_user.full_name), ''), 'مستخدم داخلي'),
        nullif(btrim(v_user.phone), ''),
        nullif(btrim(v_user.phone), ''),
        nullif(btrim(v_user.email), ''),
        'person', false, false, 0, 0, 0, true
      )
      returning id into v_employee_partner_id;

      update public.tenant_users
      set partner_id = v_employee_partner_id,
          updated_at = now()
      where id = v_user.id;
    elsif not exists (
      select 1
      from public.partners partner
      where partner.id = v_employee_partner_id
        and partner.tenant_id = v_user.tenant_id
        and partner.active = true
    ) then
      raise exception 'الملف المالي للمستخدم الحالي غير موجود أو غير نشط.';
    end if;

    select count(*)
    into v_account_count
    from public.account_accounts account
    where account.tenant_id = v_sale.tenant_id
      and account.responsible_user_id = v_user.id
      and account.active = true
      and account.group_id in (
        select parent_account.group_id
        from public.account_accounts parent_account
        where parent_account.tenant_id = v_sale.tenant_id
          and (
            parent_account.code::text = '111003'
            or parent_account.name = 'نقدية لدى الموظفين'
          )
          and parent_account.group_id is not null
      );

    if v_account_count = 0 then
      raise exception 'لا يوجد حساب عهدة نشط للموظف الحالي.';
    end if;
    if v_account_count > 1 then
      raise exception 'يوجد أكثر من حساب عهدة نشط للموظف الحالي.';
    end if;

    select account.id
    into v_cash_account_id
    from public.account_accounts account
    where account.tenant_id = v_sale.tenant_id
      and account.responsible_user_id = v_user.id
      and account.active = true
      and account.group_id in (
        select parent_account.group_id
        from public.account_accounts parent_account
        where parent_account.tenant_id = v_sale.tenant_id
          and (
            parent_account.code::text = '111003'
            or parent_account.name = 'نقدية لدى الموظفين'
          )
          and parent_account.group_id is not null
      )
    limit 1;
  end if;

  insert into public.account_moves (
    id, tenant_id, branch_id, name, move_type, partner_id, invoice_date, date,
    amount_total, state, ref, notes, currency_code, created_by, journal_id, payment_id
  )
  values (
    v_sale_move_id, v_sale.tenant_id, v_branch_id,
    'SHOWROOM-SALE-' || upper(substr(replace(v_sale.id::text, '-', ''), 1, 12)),
    'sale', v_sale.customer_id, v_sale.sale_date, now(), v_total, 'posted',
    'showroom_sale:' || v_sale.id, v_sale.notes, v_invoice_currency, v_user.id, null, null
  );

  insert into public.account_move_lines (
    id, tenant_id, move_id, account_id, partner_id, source_entity_id, label,
    quantity, unit_price, debit, credit, line_type, is_reconciled,
    amount_residual, amount_residual_currency, parent_state, currency_code, created_by
  )
  values
    (
      v_invoice_receivable_line_id, v_sale.tenant_id, v_sale_move_id,
      v_receivable_account.id, v_sale.customer_id, null, 'ذمم فاتورة شو روم',
      1, v_total, v_total, 0, 'receivable', false,
      v_total, v_total, 'posted', v_invoice_currency, v_user.id
    ),
    (
      gen_random_uuid(), v_sale.tenant_id, v_sale_move_id,
      v_income_account_id, null, null, 'إيراد فاتورة شو روم',
      1, v_total, 0, v_total, 'income', true,
      0, 0, 'posted', v_invoice_currency, v_user.id
    );

  if v_cash > 0 then
    v_cash_move_id := gen_random_uuid();
    v_payment_receivable_line_id := gen_random_uuid();

    insert into public.account_moves (
      id, tenant_id, branch_id, name, move_type, partner_id, invoice_date, date,
      amount_total, state, ref, notes, pay_method, currency_code, created_by,
      journal_id, payment_id
    )
    values (
      v_cash_move_id, v_sale.tenant_id, v_branch_id,
      'SHOWROOM-CASH-' || upper(substr(replace(v_cash_move_id::text, '-', ''), 1, 12)),
      'payment', v_sale.customer_id, current_date, now(), v_cash, 'posted',
      'showroom_sale:' || v_sale.id, nullif(trim(coalesce(p_cash_note, '')), ''),
      'cash', v_invoice_currency, v_user.id, null, null
    );

    insert into public.account_move_lines (
      id, tenant_id, move_id, account_id, partner_id, source_entity_id, label,
      quantity, unit_price, debit, credit, line_type, is_reconciled,
      amount_residual, amount_residual_currency, parent_state, currency_code, created_by
    )
    values
      (
        gen_random_uuid(), v_sale.tenant_id, v_cash_move_id, v_cash_account_id,
        v_employee_partner_id, null, 'تحصيل نقدي لدى الموظف ' || v_user.full_name,
        1, v_cash, v_cash, 0, 'liquidity', true,
        0, 0, 'posted', v_invoice_currency, v_user.id
      ),
      (
        v_payment_receivable_line_id, v_sale.tenant_id, v_cash_move_id,
        v_receivable_account.id, v_sale.customer_id, null, 'تسوية نقدية لذمم العميل',
        1, v_cash, 0, v_cash, 'receivable', true,
        0, 0, 'posted', v_invoice_currency, v_user.id
      );

    insert into public.account_partial_reconcile (
      tenant_id, debit_move_id, credit_move_id, amount, max_date, created_by
    )
    values (
      v_sale.tenant_id, v_invoice_receivable_line_id,
      v_payment_receivable_line_id, v_cash, current_date, v_user.id
    );
  end if;

  for v_item in
    select value
    from jsonb_array_elements(p_open_credit_allocations)
  loop
    v_allocation_amount := round((v_item ->> 'amount')::numeric, 2);

    select move_line.*
    into v_credit_line
    from public.account_move_lines move_line
    where move_line.id = (v_item ->> 'open_credit_line_id')::uuid
      and move_line.tenant_id = v_sale.tenant_id;

    select account_move.*
    into v_credit_move
    from public.account_moves account_move
    where account_move.id = v_credit_line.move_id
      and account_move.tenant_id = v_sale.tenant_id;

    insert into public.account_partial_reconcile (
      tenant_id, debit_move_id, credit_move_id, amount, max_date, created_by
    )
    values (
      v_sale.tenant_id,
      v_invoice_receivable_line_id,
      v_credit_line.id,
      v_allocation_amount,
      greatest(v_sale.sale_date, v_credit_move.date::date),
      v_user.id
    );

    select round(coalesce(sum(partial.amount), 0), 2)
    into v_credit_reconciled
    from public.account_partial_reconcile partial
    where partial.tenant_id = v_sale.tenant_id
      and partial.credit_move_id = v_credit_line.id;

    v_credit_available := round(greatest(v_credit_line.credit - v_credit_reconciled, 0), 2);

    update public.account_move_lines
    set amount_residual = v_credit_available,
        amount_residual_currency = v_credit_available,
        is_reconciled = (v_credit_available = 0)
    where id = v_credit_line.id
      and tenant_id = v_sale.tenant_id;

    v_open_credit_results := v_open_credit_results || jsonb_build_array(
      jsonb_build_object(
        'open_credit_line_id', v_credit_line.id,
        'amount_applied', v_allocation_amount,
        'available_amount', v_credit_available
      )
    );
  end loop;

  select round(coalesce(sum(partial.amount), 0), 2)
  into v_paid
  from public.account_partial_reconcile partial
  where partial.tenant_id = v_sale.tenant_id
    and partial.debit_move_id = v_invoice_receivable_line_id;

  v_remaining := round(greatest(v_total - v_paid, 0), 2);

  update public.account_move_lines
  set amount_residual = v_remaining,
      amount_residual_currency = v_remaining,
      is_reconciled = (v_remaining = 0)
  where id = v_invoice_receivable_line_id
    and tenant_id = v_sale.tenant_id;

  select exists (
    select 1
    from public.tenant_modules tenant_module
    join public.ir_modules module
      on module.id = tenant_module.module_id
    where tenant_module.tenant_id = v_sale.tenant_id
      and tenant_module.state = 'installed'
      and module.technical_name = 'inventory'
  )
  into v_inventory_active;

  if exists (
    select 1
    from public.showroom_sale_lines sale_line
    left join public.product_products product
      on product.id = sale_line.product_product_id
     and product.tenant_id = sale_line.tenant_id
    where sale_line.tenant_id = v_sale.tenant_id
      and sale_line.sale_id = v_sale.id
      and product.id is null
  ) then
    raise exception 'أحد منتجات الفاتورة غير موجود داخل الشركة.';
  end if;

  for v_line in
    select sale_line.*, product.tracking, product.product_template_id, template.product_type
    from public.showroom_sale_lines sale_line
    join public.product_products product
      on product.id = sale_line.product_product_id
     and product.tenant_id = sale_line.tenant_id
    join public.product_templates template
      on template.id = product.product_template_id
     and template.tenant_id = sale_line.tenant_id
    where sale_line.tenant_id = v_sale.tenant_id
      and sale_line.sale_id = v_sale.id
  loop
    if v_line.tracking = 'serial' then
      if v_line.tracking_unit_id is null then
        raise exception 'سطر المنتج المسلسل غير مرتبط بوحدة تتبع.';
      end if;

      select tracking_unit.*
      into v_unit
      from public.stock_tracking_units tracking_unit
      where tracking_unit.id = v_line.tracking_unit_id
        and tracking_unit.tenant_id = v_sale.tenant_id
      for update;

      if v_unit.id is null
        or v_unit.status <> 'reserved'
        or v_unit.notes <> ('showroom_sale:' || v_sale.id)
      then
        raise exception 'وحدة التتبع غير محجوزة لهذه الفاتورة.';
      end if;

      update public.stock_tracking_units
      set status = 'sold',
          updated_at = now()
      where id = v_unit.id;
    end if;

    if v_inventory_active and v_line.product_type <> 'service' then
      insert into public.stock_moves (
        tenant_id, product_product_id, product_template_id, move_type,
        quantity, unit_price, reference_type, reference_id, notes, created_by
      )
      values (
        v_sale.tenant_id, v_line.product_product_id, v_line.product_template_id,
        'out', v_line.quantity, v_line.unit_price, 'showroom_sale', v_sale.id,
        'showroom_sale:' || v_sale.id, v_user.id
      );

      if v_line.tracking <> 'serial' then
        select quant.*
        into v_quant
        from public.stock_quants quant
        where quant.tenant_id = v_sale.tenant_id
          and quant.product_product_id = v_line.product_product_id
        order by quant.id
        limit 1
        for update;

        if v_quant.id is null then
          insert into public.stock_quants (
            tenant_id, product_product_id, product_template_id, quantity_on_hand
          )
          values (
            v_sale.tenant_id, v_line.product_product_id,
            v_line.product_template_id, -v_line.quantity
          );
        else
          update public.stock_quants
          set quantity_on_hand = quantity_on_hand - v_line.quantity,
              updated_at = now()
          where id = v_quant.id;
        end if;
      end if;
    end if;
  end loop;

  update public.showroom_sales
  set total_amount = v_total,
      paid_amount = v_paid,
      remaining_amount = v_remaining,
      account_move_id = v_sale_move_id,
      status = 'confirmed',
      updated_at = now()
  where id = v_sale.id;

  return jsonb_build_object(
    'success', true,
    'already_completed', false,
    'sale_id', v_sale.id,
    'sale_account_move_id', v_sale_move_id,
    'cash_move_id', v_cash_move_id,
    'open_credit_allocations', v_open_credit_results,
    'total_amount', v_total,
    'paid_amount', v_paid,
    'remaining_amount', v_remaining,
    'status', 'confirmed'
  );
end;
$$;

revoke all on function public.complete_showroom_sale(uuid, numeric, text, jsonb) from public, anon;
grant execute on function public.complete_showroom_sale(uuid, numeric, text, jsonb) to authenticated;

comment on function public.complete_showroom_sale(uuid, numeric, text, jsonb) is
  'Posts a showroom sale, optional employee-custody cash, and direct allocations from independent 114001 open-credit lines.';

notify pgrst, 'reload schema';

commit;
