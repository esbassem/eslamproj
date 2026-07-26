begin;

create or replace function public.list_customer_open_credits(
  p_tenant_id uuid,
  p_customer_id uuid,
  p_include_fully_used boolean default false
)
returns table (
  open_credit_line_id uuid,
  move_id uuid,
  customer_id uuid,
  payment_entity_id uuid,
  payment_entity_name text,
  original_amount numeric,
  reconciled_amount numeric,
  available_amount numeric,
  move_date timestamptz,
  move_name text,
  currency_code varchar,
  status text,
  attachment jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;

  if p_tenant_id is null or not exists (
    select 1
    from public.tenant_users tenant_user
    where tenant_user.tenant_id = p_tenant_id
      and tenant_user.auth_user_id = auth.uid()
      and coalesce(tenant_user.is_active, true) = true
  ) then
    raise exception 'لا تملك صلاحية عرض أرصدة هذه الشركة.';
  end if;

  if p_customer_id is null or not exists (
    select 1
    from public.partners customer
    where customer.id = p_customer_id
      and customer.tenant_id = p_tenant_id
      and coalesce(customer.active, true) = true
  ) then
    raise exception 'العميل غير موجود أو غير نشط داخل الشركة.';
  end if;

  return query
  with open_credit_rows as (
    select
      move_line.id as open_credit_line_id,
      move_line.move_id,
      move_line.partner_id as customer_id,
      move_line.source_entity_id as payment_entity_id,
      payment_entity.name as payment_entity_name,
      round(move_line.credit, 2) as original_amount,
      round(coalesce(reconciled.total, 0), 2) as reconciled_amount,
      round(greatest(move_line.credit - coalesce(reconciled.total, 0), 0), 2) as available_amount,
      account_move.date as move_date,
      account_move.name as move_name,
      coalesce(move_line.currency_code, account_move.currency_code) as currency_code,
      latest_attachment.attachment
    from public.account_move_lines move_line
    join public.account_moves account_move
      on account_move.id = move_line.move_id
     and account_move.tenant_id = move_line.tenant_id
     and account_move.state = 'posted'
    join public.account_accounts account
      on account.id = move_line.account_id
     and account.tenant_id = move_line.tenant_id
     and account.code = '114001'
     and coalesce(account.active, true) = true
     and coalesce(account.reconcile, false) = true
    join public.partners payment_entity
      on payment_entity.id = move_line.source_entity_id
     and payment_entity.tenant_id = move_line.tenant_id
    left join lateral (
      select sum(partial.amount) as total
      from public.account_partial_reconcile partial
      where partial.tenant_id = move_line.tenant_id
        and partial.credit_move_id = move_line.id
    ) reconciled on true
    left join lateral (
      select jsonb_build_object(
        'id', file.id,
        'bucket_name', file.bucket_name,
        'file_path', file.file_path,
        'original_file_name', file.original_file_name,
        'mime_type', file.mime_type,
        'file_size', file.file_size,
        'created_at', file.created_at
      ) as attachment
      from public.ir_attachments file
      where file.tenant_id = move_line.tenant_id
        and file.related_model = 'account_moves'
        and file.related_id = move_line.move_id
        and coalesce(file.is_active, true) = true
      order by file.created_at desc, file.id desc
      limit 1
    ) latest_attachment on true
    where move_line.tenant_id = p_tenant_id
      and move_line.partner_id = p_customer_id
      and move_line.source_entity_id is not null
      and move_line.debit = 0
      and move_line.credit > 0
  )
  select
    row.open_credit_line_id,
    row.move_id,
    row.customer_id,
    row.payment_entity_id,
    row.payment_entity_name,
    row.original_amount,
    row.reconciled_amount,
    row.available_amount,
    row.move_date,
    row.move_name,
    row.currency_code,
    case
      when row.available_amount = 0 then 'fully_used'
      when row.reconciled_amount > 0 then 'partially_used'
      else 'open'
    end as status,
    row.attachment
  from open_credit_rows row
  where p_include_fully_used or row.available_amount > 0
  order by row.move_date, row.open_credit_line_id;
end;
$$;

revoke all on function public.list_customer_open_credits(uuid, uuid, boolean) from public, anon;
grant execute on function public.list_customer_open_credits(uuid, uuid, boolean) to authenticated;

comment on function public.list_customer_open_credits(uuid, uuid, boolean) is
  'Lists independent posted 114001 customer open credits and derives their residual solely from account_partial_reconcile.';

create or replace function public.settle_showroom_sale_with_open_credits(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_allocations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user public.tenant_users%rowtype;
  v_sale public.showroom_sales%rowtype;
  v_invoice_move public.account_moves%rowtype;
  v_receivable_account public.account_accounts%rowtype;
  v_invoice_line public.account_move_lines%rowtype;
  v_invoice_line_ids uuid[];
  v_invoice_original numeric := 0;
  v_invoice_reconciled numeric := 0;
  v_invoice_residual numeric := 0;
  v_total_allocated numeric := 0;
  v_allocation_amount numeric;
  v_credit_ids uuid[] := array[]::uuid[];
  v_credit_line public.account_move_lines%rowtype;
  v_credit_move public.account_moves%rowtype;
  v_payment_entity public.partners%rowtype;
  v_credit_reconciled numeric := 0;
  v_credit_available numeric := 0;
  v_invoice_currency varchar;
  v_credit_currency varchar;
  v_item jsonb;
  v_credit_result jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;

  if p_tenant_id is null then
    raise exception 'لا توجد شركة نشطة.';
  end if;

  select tenant_user.*
  into v_user
  from public.tenant_users tenant_user
  where tenant_user.tenant_id = p_tenant_id
    and tenant_user.auth_user_id = auth.uid()
    and coalesce(tenant_user.is_active, true) = true
  order by tenant_user.created_at, tenant_user.id
  limit 1;

  if v_user.id is null then
    raise exception 'لا تملك صلاحية تسوية فواتير هذه الشركة.';
  end if;

  if p_allocations is null
    or jsonb_typeof(p_allocations) <> 'array'
    or jsonb_array_length(p_allocations) = 0
  then
    raise exception 'اختر اعتمادًا واحدًا على الأقل وحدد مبلغ الاستخدام.';
  end if;

  for v_item in select value from jsonb_array_elements(p_allocations)
  loop
    if jsonb_typeof(v_item) <> 'object'
      or nullif(v_item ->> 'open_credit_line_id', '') is null
      or nullif(v_item ->> 'amount', '') is null
    then
      raise exception 'بيانات توزيع الاعتمادات غير مكتملة.';
    end if;

    v_allocation_amount := round((v_item ->> 'amount')::numeric, 2);
    if v_allocation_amount <= 0 then
      raise exception 'كل مبلغ مستخدم من الاعتماد يجب أن يكون أكبر من صفر.';
    end if;

    if array_position(v_credit_ids, (v_item ->> 'open_credit_line_id')::uuid) is not null then
      raise exception 'لا يمكن تكرار نفس الاعتماد في عملية التسوية.';
    end if;

    v_credit_ids := array_append(v_credit_ids, (v_item ->> 'open_credit_line_id')::uuid);
    v_total_allocated := round(v_total_allocated + v_allocation_amount, 2);
  end loop;

  select sale.*
  into v_sale
  from public.showroom_sales sale
  where sale.id = p_sale_id
    and sale.tenant_id = p_tenant_id
  for update;

  if v_sale.id is null then
    raise exception 'فاتورة الشو روم غير موجودة داخل الشركة.';
  end if;
  if v_sale.status <> 'confirmed' then
    raise exception 'لا يمكن تسوية فاتورة غير مؤكدة.';
  end if;
  if v_sale.customer_id is null then
    raise exception 'الفاتورة غير مرتبطة بعميل.';
  end if;
  if not exists (
    select 1
    from public.partners customer
    where customer.id = v_sale.customer_id
      and customer.tenant_id = p_tenant_id
      and coalesce(customer.active, true) = true
  ) then
    raise exception 'عميل الفاتورة غير موجود أو غير نشط داخل الشركة.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || v_sale.customer_id::text, 0)
  );

  select account.*
  into v_receivable_account
  from public.account_accounts account
  where account.tenant_id = p_tenant_id
    and account.code = '114001'
    and coalesce(account.active, true) = true;

  if v_receivable_account.id is null then
    raise exception 'حساب ذمم العملاء 114001 غير موجود أو غير نشط داخل الشركة.';
  end if;
  if not coalesce(v_receivable_account.reconcile, false) then
    raise exception 'حساب ذمم العملاء 114001 غير مهيأ للمصالحة.';
  end if;

  select account_move.*
  into v_invoice_move
  from public.account_moves account_move
  where account_move.tenant_id = p_tenant_id
    and account_move.state = 'posted'
    and (
      account_move.id = v_sale.account_move_id
      or account_move.ref = 'showroom_sale:' || v_sale.id
    )
  order by
    case when account_move.id = v_sale.account_move_id then 0 else 1 end,
    account_move.created_at,
    account_move.id
  limit 1
  for update;

  if v_invoice_move.id is null then
    raise exception 'لا يوجد قيد بيع مرحل مرتبط بالفاتورة.';
  end if;

  select array_agg(move_line.id order by move_line.id)
  into v_invoice_line_ids
  from public.account_move_lines move_line
  where move_line.tenant_id = p_tenant_id
    and move_line.move_id = v_invoice_move.id
    and move_line.account_id = v_receivable_account.id
    and move_line.partner_id = v_sale.customer_id
    and move_line.debit > 0
    and move_line.credit = 0;

  if coalesce(cardinality(v_invoice_line_ids), 0) <> 1 then
    raise exception 'تعذر تحديد سطر ذمم العميل المدين الخاص بالفاتورة بشكل وحيد.';
  end if;

  select move_line.*
  into v_invoice_line
  from public.account_move_lines move_line
  where move_line.id = v_invoice_line_ids[1]
  for update;

  v_invoice_original := round(v_invoice_line.debit, 2);
  v_invoice_currency := coalesce(v_invoice_line.currency_code, v_invoice_move.currency_code);

  -- Lock every selected open item in a deterministic order before calculating
  -- either the invoice residual or any open-credit residual.
  perform move_line.id
  from public.account_move_lines move_line
  where move_line.id = any(v_credit_ids)
  order by move_line.id
  for update;

  perform account_move.id
  from public.account_moves account_move
  where account_move.id in (
    select move_line.move_id
    from public.account_move_lines move_line
    where move_line.id = any(v_credit_ids)
  )
  order by account_move.id
  for update;

  select round(coalesce(sum(partial.amount), 0), 2)
  into v_invoice_reconciled
  from public.account_partial_reconcile partial
  where partial.tenant_id = p_tenant_id
    and partial.debit_move_id = v_invoice_line.id;

  v_invoice_residual := round(greatest(v_invoice_original - v_invoice_reconciled, 0), 2);
  if v_invoice_residual <= 0 then
    raise exception 'الفاتورة مسددة بالكامل محاسبيًا.';
  end if;
  if v_total_allocated > v_invoice_residual then
    raise exception 'إجمالي الاعتمادات المختارة أكبر من المتبقي الحقيقي على الفاتورة %.', v_invoice_residual;
  end if;

  -- Validate every allocation after all relevant rows have been locked.
  for v_item in select value from jsonb_array_elements(p_allocations)
  loop
    v_allocation_amount := round((v_item ->> 'amount')::numeric, 2);

    select move_line.*
    into v_credit_line
    from public.account_move_lines move_line
    where move_line.id = (v_item ->> 'open_credit_line_id')::uuid
      and move_line.tenant_id = p_tenant_id;

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
      and account_move.tenant_id = p_tenant_id;

    if v_credit_move.id is null or v_credit_move.state <> 'posted' then
      raise exception 'قيد الاعتماد غير موجود أو غير مرحل.';
    end if;

    select payment_entity.*
    into v_payment_entity
    from public.partners payment_entity
    where payment_entity.id = v_credit_line.source_entity_id
      and payment_entity.tenant_id = p_tenant_id;

    if v_payment_entity.id is null then
      raise exception 'جهة مصدر الاعتماد غير موجودة داخل الشركة.';
    end if;

    v_credit_currency := coalesce(v_credit_line.currency_code, v_credit_move.currency_code);
    if v_credit_currency is distinct from v_invoice_currency then
      raise exception 'عملة الاعتماد لا تطابق عملة الفاتورة.';
    end if;

    select round(coalesce(sum(partial.amount), 0), 2)
    into v_credit_reconciled
    from public.account_partial_reconcile partial
    where partial.tenant_id = p_tenant_id
      and partial.credit_move_id = v_credit_line.id;

    v_credit_available := round(greatest(v_credit_line.credit - v_credit_reconciled, 0), 2);
    if v_allocation_amount > v_credit_available then
      raise exception 'رصيد اعتماد % غير كافٍ. المتاح % والمطلوب %.',
        v_payment_entity.name, v_credit_available, v_allocation_amount;
    end if;
  end loop;

  -- No account_move or account_move_lines are created here. The allocation is
  -- represented only by account_partial_reconcile.
  for v_item in select value from jsonb_array_elements(p_allocations)
  loop
    v_allocation_amount := round((v_item ->> 'amount')::numeric, 2);

    select move_line.*
    into v_credit_line
    from public.account_move_lines move_line
    where move_line.id = (v_item ->> 'open_credit_line_id')::uuid
      and move_line.tenant_id = p_tenant_id;

    select account_move.*
    into v_credit_move
    from public.account_moves account_move
    where account_move.id = v_credit_line.move_id
      and account_move.tenant_id = p_tenant_id;

    insert into public.account_partial_reconcile (
      tenant_id,
      debit_move_id,
      credit_move_id,
      amount,
      max_date,
      created_by
    )
    values (
      p_tenant_id,
      v_invoice_line.id,
      v_credit_line.id,
      v_allocation_amount,
      greatest(v_invoice_move.date::date, v_credit_move.date::date),
      v_user.id
    );
  end loop;

  select round(coalesce(sum(partial.amount), 0), 2)
  into v_invoice_reconciled
  from public.account_partial_reconcile partial
  where partial.tenant_id = p_tenant_id
    and partial.debit_move_id = v_invoice_line.id;

  v_invoice_residual := round(greatest(v_invoice_original - v_invoice_reconciled, 0), 2);

  -- Compatibility caches only. They are never read above for validation or
  -- residual calculations.
  update public.account_move_lines
  set amount_residual = v_invoice_residual,
      amount_residual_currency = v_invoice_residual,
      is_reconciled = (v_invoice_residual = 0)
  where id = v_invoice_line.id
    and tenant_id = p_tenant_id;

  update public.showroom_sales
  set account_move_id = v_invoice_move.id,
      paid_amount = v_invoice_reconciled,
      remaining_amount = v_invoice_residual,
      updated_at = now()
  where id = v_sale.id
    and tenant_id = p_tenant_id;

  for v_item in select value from jsonb_array_elements(p_allocations)
  loop
    v_allocation_amount := round((v_item ->> 'amount')::numeric, 2);

    select move_line.*
    into v_credit_line
    from public.account_move_lines move_line
    where move_line.id = (v_item ->> 'open_credit_line_id')::uuid
      and move_line.tenant_id = p_tenant_id;

    select account_move.*
    into v_credit_move
    from public.account_moves account_move
    where account_move.id = v_credit_line.move_id
      and account_move.tenant_id = p_tenant_id;

    select payment_entity.*
    into v_payment_entity
    from public.partners payment_entity
    where payment_entity.id = v_credit_line.source_entity_id
      and payment_entity.tenant_id = p_tenant_id;

    select round(coalesce(sum(partial.amount), 0), 2)
    into v_credit_reconciled
    from public.account_partial_reconcile partial
    where partial.tenant_id = p_tenant_id
      and partial.credit_move_id = v_credit_line.id;

    v_credit_available := round(greatest(v_credit_line.credit - v_credit_reconciled, 0), 2);

    update public.account_move_lines
    set amount_residual = v_credit_available,
        amount_residual_currency = v_credit_available,
        is_reconciled = (v_credit_available = 0)
    where id = v_credit_line.id
      and tenant_id = p_tenant_id;

    v_credit_result := v_credit_result || jsonb_build_array(jsonb_build_object(
      'open_credit_line_id', v_credit_line.id,
      'original_amount', round(v_credit_line.credit, 2),
      'amount_applied_now', v_allocation_amount,
      'reconciled_amount', v_credit_reconciled,
      'available_amount', v_credit_available,
      'status', case
        when v_credit_available = 0 then 'fully_used'
        when v_credit_reconciled > 0 then 'partially_used'
        else 'open'
      end,
      'payment_entity_id', v_payment_entity.id,
      'payment_entity_name', v_payment_entity.name
    ));
  end loop;

  return jsonb_build_object(
    'success', true,
    'sale_id', v_sale.id,
    'invoice_receivable_line_id', v_invoice_line.id,
    'invoice_original_amount', v_invoice_original,
    'invoice_reconciled_amount', v_invoice_reconciled,
    'invoice_residual', v_invoice_residual,
    'amount_applied_now', v_total_allocated,
    'open_credits', v_credit_result
  );
end;
$$;

revoke all on function public.settle_showroom_sale_with_open_credits(uuid, uuid, jsonb) from public, anon;
grant execute on function public.settle_showroom_sale_with_open_credits(uuid, uuid, jsonb) to authenticated;

comment on function public.settle_showroom_sale_with_open_credits(uuid, uuid, jsonb) is
  'Allocates explicitly selected posted 114001 open-credit items to an existing showroom invoice using account_partial_reconcile only.';

-- Existing-invoice callers must use explicit open-item allocations. Keep the
-- legacy function for migration history, but prevent authenticated clients from
-- creating the obsolete 212001 settlement move.
revoke all on function public.settle_showroom_sale_with_advance_credit(uuid, uuid, numeric, text)
  from public, anon, authenticated;

notify pgrst, 'reload schema';

commit;
