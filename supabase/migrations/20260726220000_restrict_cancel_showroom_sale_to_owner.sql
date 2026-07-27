begin;

create or replace function public.cancel_showroom_sale(
  p_tenant_id uuid,
  p_sale_id uuid,
  p_reason text,
  p_preview_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_user public.tenant_users%rowtype;
  v_sale public.showroom_sales%rowtype;
  v_original_move public.account_moves%rowtype;
  v_existing public.showroom_sale_cancellations%rowtype;
  v_preview jsonb;
  v_cancellation_id uuid := gen_random_uuid();
  v_reversal_move_id uuid := gen_random_uuid();
  v_invoice_line public.account_move_lines%rowtype;
  v_reversal_line public.account_move_lines%rowtype;
  v_receivable_count integer := 0;
  v_snapshot_count integer := 0;
  v_deleted_apr_count integer := 0;
  v_inventory_active boolean := false;
  v_affected_credit_ids uuid[] := '{}'::uuid[];
  v_released_open_credits jsonb := '[]'::jsonb;
  v_customer_credits jsonb := '[]'::jsonb;
  v_inventory_returns jsonb := '[]'::jsonb;
  v_paperwork_cancelled jsonb := '[]'::jsonb;
  v_item jsonb;
  v_line record;
  v_request record;
  v_return_move_id uuid;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;
  if p_tenant_id is null or p_sale_id is null then
    raise exception 'تعذر تحديد الشركة أو الفاتورة.';
  end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then
    raise exception 'سبب الإلغاء إلزامي.';
  end if;
  if nullif(btrim(coalesce(p_preview_version, '')), '') is null then
    raise exception 'يجب فتح معاينة الإلغاء أولاً.';
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
    raise exception 'لا تملك صلاحية الوصول إلى هذه الشركة.';
  end if;

  if not public.is_tenant_owner(p_tenant_id) then
    raise exception 'إلغاء الفواتير المرحلة متاح لمالك الشركة فقط.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      p_tenant_id::text || ':showroom_sale_cancellation:' || p_sale_id::text,
      0
    )
  );

  select cancellation.*
  into v_existing
  from public.showroom_sale_cancellations cancellation
  where cancellation.tenant_id = p_tenant_id
    and cancellation.sale_id = p_sale_id
    and cancellation.status in ('pending', 'completed')
  order by cancellation.created_at, cancellation.id
  limit 1
  for update;

  if v_existing.status = 'completed' then
    return jsonb_build_object(
      'sale_id', p_sale_id,
      'status', 'cancelled',
      'idempotent', true,
      'cancellation_id', v_existing.id,
      'original_move_id', v_existing.original_move_id,
      'reversal_move_id', v_existing.reversal_move_id,
      'released_open_credits', '[]'::jsonb,
      'customer_credits', '[]'::jsonb,
      'inventory_returns', '[]'::jsonb,
      'paperwork_cancelled', '[]'::jsonb,
      'invoice_reconciliation', coalesce(
        v_existing.preview_snapshot -> 'execution' -> 'invoice_reconciliation',
        '{}'::jsonb
      ),
      'cancelled_at', v_existing.completed_at
    );
  elsif v_existing.status = 'pending' then
    raise exception 'يوجد طلب إلغاء قيد التنفيذ لهذه الفاتورة.';
  end if;

  select sale.*
  into v_sale
  from public.showroom_sales sale
  where sale.tenant_id = p_tenant_id
    and sale.id = p_sale_id
  for update;

  if v_sale.id is null then
    raise exception 'فاتورة الشو روم غير موجودة داخل الشركة.';
  end if;
  if v_sale.status <> 'confirmed' then
    raise exception 'يمكن إلغاء فاتورة Showroom مؤكدة فقط.';
  end if;
  if v_sale.account_move_id is null then
    raise exception 'الفاتورة المؤكدة لا تحتوي على قيد بيع أصلي.';
  end if;

  select account_move.*
  into v_original_move
  from public.account_moves account_move
  where account_move.tenant_id = p_tenant_id
    and account_move.id = v_sale.account_move_id
  for update;

  if v_original_move.id is null then
    raise exception 'قيد البيع الأصلي غير موجود داخل الشركة.';
  end if;

  perform 1
  from public.account_move_lines move_line
  where move_line.tenant_id = p_tenant_id
    and move_line.move_id = v_original_move.id
  order by move_line.id
  for update;

  select count(*)
  into v_receivable_count
  from public.account_move_lines move_line
  join public.account_accounts account
    on account.id = move_line.account_id
   and account.tenant_id = move_line.tenant_id
  where move_line.tenant_id = p_tenant_id
    and move_line.move_id = v_original_move.id
    and account.code = '114001'
    and move_line.debit > 0
    and move_line.credit = 0;

  if v_receivable_count <> 1 then
    raise exception 'قيد البيع لا يحتوي على سطر ذمم 114001 مدين واحد.';
  end if;

  select move_line.*
  into v_invoice_line
  from public.account_move_lines move_line
  join public.account_accounts account
    on account.id = move_line.account_id
   and account.tenant_id = move_line.tenant_id
  where move_line.tenant_id = p_tenant_id
    and move_line.move_id = v_original_move.id
    and account.code = '114001'
    and move_line.debit > 0
    and move_line.credit = 0
  for update;

  perform 1
  from public.account_partial_reconcile reconcile
  where reconcile.tenant_id = p_tenant_id
    and reconcile.debit_move_id = v_invoice_line.id
  order by reconcile.id
  for update;

  perform 1
  from public.account_move_lines credit_line
  join public.account_partial_reconcile reconcile
    on reconcile.tenant_id = credit_line.tenant_id
   and reconcile.credit_move_id = credit_line.id
  where reconcile.tenant_id = p_tenant_id
    and reconcile.debit_move_id = v_invoice_line.id
  order by credit_line.id
  for update of credit_line;

  perform 1
  from public.account_moves source_move
  join public.account_move_lines credit_line
    on credit_line.tenant_id = source_move.tenant_id
   and credit_line.move_id = source_move.id
  join public.account_partial_reconcile reconcile
    on reconcile.tenant_id = credit_line.tenant_id
   and reconcile.credit_move_id = credit_line.id
  where reconcile.tenant_id = p_tenant_id
    and reconcile.debit_move_id = v_invoice_line.id
  order by source_move.id
  for update of source_move;

  perform 1
  from public.account_moves reversal
  where reversal.tenant_id = p_tenant_id
    and reversal.reversed_entry_id = v_original_move.id
  order by reversal.id
  for update;

  if found then
    raise exception 'يوجد Reversal سابق لقيد البيع الأصلي.';
  end if;

  perform 1
  from public.showroom_sale_lines sale_line
  where sale_line.tenant_id = p_tenant_id
    and sale_line.sale_id = p_sale_id
  order by sale_line.id
  for update;

  perform 1
  from public.stock_tracking_units tracking_unit
  join public.showroom_sale_lines sale_line
    on sale_line.tenant_id = tracking_unit.tenant_id
   and sale_line.tracking_unit_id = tracking_unit.id
  where sale_line.tenant_id = p_tenant_id
    and sale_line.sale_id = p_sale_id
  order by tracking_unit.id
  for update of tracking_unit;

  perform 1
  from public.stock_moves stock_move
  where stock_move.tenant_id = p_tenant_id
    and stock_move.reference_type = 'showroom_sale'
    and stock_move.reference_id = p_sale_id
  order by stock_move.id
  for update;

  perform 1
  from public.stock_quants quant
  where quant.tenant_id = p_tenant_id
    and quant.product_product_id in (
      select sale_line.product_product_id
      from public.showroom_sale_lines sale_line
      where sale_line.tenant_id = p_tenant_id
        and sale_line.sale_id = p_sale_id
    )
  order by quant.id
  for update;

  perform 1
  from public.paperwork_requests request
  where request.tenant_id = p_tenant_id
    and request.sale_id = p_sale_id
  order by request.id
  for update;

  v_preview := public.preview_showroom_sale_cancellation(p_tenant_id, p_sale_id);

  if v_preview ->> 'preview_version' is distinct from btrim(p_preview_version) then
    raise exception 'بيانات الفاتورة تغيرت. أعد فتح معاينة الإلغاء.';
  end if;
  if coalesce((v_preview ->> 'can_cancel_now')::boolean, false) is not true then
    raise exception 'الفاتورة تحتوي على موانع تمنع الإلغاء الآلي.';
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(v_preview -> 'allocations', '[]'::jsonb))
  loop
    if v_item ->> 'classification' not in (
      'payment_entity_open_credit', 'cash', 'employee_custody_cash'
    ) or coalesce((v_item ->> 'blocker')::boolean, true)
    then
      raise exception 'توجد تسوية غير مدعومة تمنع الإلغاء الآلي.';
    end if;
  end loop;

  insert into public.showroom_sale_cancellations (
    id, tenant_id, sale_id, status, reason, requested_by, requested_at,
    original_move_id, preview_snapshot
  )
  values (
    v_cancellation_id, p_tenant_id, p_sale_id, 'pending', btrim(p_reason),
    v_user.id, v_now, v_original_move.id, v_preview
  );

  for v_item in
    select value from jsonb_array_elements(coalesce(v_preview -> 'allocations', '[]'::jsonb))
  loop
    insert into public.showroom_sale_cancellation_reconciliations (
      tenant_id, cancellation_id, original_apr_id, debit_move_line_id,
      credit_move_line_id, amount, classification, source_move_id, source_entity_id
    )
    values (
      p_tenant_id,
      v_cancellation_id,
      (v_item ->> 'apr_id')::uuid,
      v_invoice_line.id,
      (v_item ->> 'source_credit_line_id')::uuid,
      (v_item ->> 'amount')::numeric,
      v_item ->> 'classification',
      (v_item ->> 'source_move_id')::uuid,
      nullif(v_item ->> 'source_entity_id', '')::uuid
    );
    v_snapshot_count := v_snapshot_count + 1;

    v_affected_credit_ids := array_append(
      v_affected_credit_ids,
      (v_item ->> 'source_credit_line_id')::uuid
    );

    if v_item ->> 'classification' = 'payment_entity_open_credit' then
      v_released_open_credits := v_released_open_credits || jsonb_build_array(
        jsonb_build_object(
          'source_move_id', v_item ->> 'source_move_id',
          'credit_line_id', v_item ->> 'source_credit_line_id',
          'source_entity_id', v_item ->> 'source_entity_id',
          'amount', (v_item ->> 'amount')::numeric
        )
      );
    else
      v_customer_credits := v_customer_credits || jsonb_build_array(
        jsonb_build_object(
          'source_move_id', v_item ->> 'source_move_id',
          'credit_line_id', v_item ->> 'source_credit_line_id',
          'amount', (v_item ->> 'amount')::numeric,
          'classification', v_item ->> 'classification'
        )
      );
    end if;
  end loop;

  delete from public.account_partial_reconcile reconcile
  where reconcile.tenant_id = p_tenant_id
    and reconcile.debit_move_id = v_invoice_line.id;
  get diagnostics v_deleted_apr_count = row_count;

  if v_deleted_apr_count <> v_snapshot_count then
    raise exception 'عدد APRs المحذوفة لا يطابق عدد Snapshots المحفوظة.';
  end if;

  if coalesce(array_length(v_affected_credit_ids, 1), 0) > 0 then
    update public.account_move_lines credit_line
    set amount_residual = greatest(
          credit_line.credit - coalesce((
            select sum(reconcile.amount)
            from public.account_partial_reconcile reconcile
            where reconcile.tenant_id = p_tenant_id
              and reconcile.credit_move_id = credit_line.id
          ), 0), 0),
        amount_residual_currency = greatest(
          credit_line.credit - coalesce((
            select sum(reconcile.amount)
            from public.account_partial_reconcile reconcile
            where reconcile.tenant_id = p_tenant_id
              and reconcile.credit_move_id = credit_line.id
          ), 0), 0),
        is_reconciled = greatest(
          credit_line.credit - coalesce((
            select sum(reconcile.amount)
            from public.account_partial_reconcile reconcile
            where reconcile.tenant_id = p_tenant_id
              and reconcile.credit_move_id = credit_line.id
          ), 0), 0) = 0
    where credit_line.tenant_id = p_tenant_id
      and credit_line.id = any(v_affected_credit_ids);
  end if;

  insert into public.account_moves (
    id, tenant_id, branch_id, name, move_type, partner_id, invoice_date, date,
    amount_total, state, ref, notes, currency_code, created_by, journal_id,
    reversed_entry_id
  )
  values (
    v_reversal_move_id, p_tenant_id, v_original_move.branch_id,
    'SHOWROOM-CANCEL-' || upper(substr(replace(v_reversal_move_id::text, '-', ''), 1, 12)),
    'refund', v_sale.customer_id, current_date, v_now,
    v_original_move.amount_total, 'posted',
    'showroom_sale_cancel:' || p_sale_id,
    'إلغاء القيد ' || v_original_move.name || '. السبب: ' || btrim(p_reason),
    v_original_move.currency_code, v_user.id, v_original_move.journal_id,
    v_original_move.id
  );

  insert into public.account_move_lines (
    id, tenant_id, move_id, account_id, partner_id, source_entity_id, label,
    quantity, unit_price, debit, credit, line_type, due_date, is_reconciled,
    created_by, currency_code, amount_residual,
    amount_residual_currency, parent_state, product_product_id
  )
  select
    gen_random_uuid(), p_tenant_id, v_reversal_move_id, original_line.account_id,
    original_line.partner_id, original_line.source_entity_id,
    'عكس: ' || coalesce(original_line.label, v_original_move.name),
    original_line.quantity, original_line.unit_price,
    original_line.credit, original_line.debit, original_line.line_type,
    original_line.due_date, false, v_user.id,
    original_line.currency_code,
    case when original_line.id = v_invoice_line.id then original_line.debit else 0 end,
    case when original_line.id = v_invoice_line.id then original_line.debit else 0 end,
    'posted', original_line.product_product_id
  from public.account_move_lines original_line
  where original_line.tenant_id = p_tenant_id
    and original_line.move_id = v_original_move.id
  order by original_line.id;

  select reversal_line.*
  into v_reversal_line
  from public.account_move_lines reversal_line
  where reversal_line.tenant_id = p_tenant_id
    and reversal_line.move_id = v_reversal_move_id
    and reversal_line.account_id = v_invoice_line.account_id
    and reversal_line.debit = 0
    and reversal_line.credit = v_invoice_line.debit;

  if v_reversal_line.id is null then
    raise exception 'تعذر تحديد سطر ذمم Reversal.';
  end if;

  insert into public.account_partial_reconcile (
    tenant_id, debit_move_id, credit_move_id, amount, max_date, created_by
  )
  values (
    p_tenant_id, v_invoice_line.id, v_reversal_line.id,
    v_invoice_line.debit, current_date, v_user.id
  );

  update public.account_move_lines move_line
  set amount_residual = 0,
      amount_residual_currency = 0,
      is_reconciled = true
  where move_line.tenant_id = p_tenant_id
    and move_line.id in (v_invoice_line.id, v_reversal_line.id);

  select exists (
    select 1
    from public.tenant_modules tenant_module
    join public.ir_modules module on module.id = tenant_module.module_id
    where tenant_module.tenant_id = p_tenant_id
      and tenant_module.state = 'installed'
      and module.technical_name = 'inventory'
  ) into v_inventory_active;

  for v_line in
    select sale_line.id sale_line_id, sale_line.product_product_id,
      sale_line.tracking_unit_id, sale_line.quantity, sale_line.unit_price,
      product.product_template_id, product.tracking, template.product_type
    from public.showroom_sale_lines sale_line
    join public.product_products product
      on product.id = sale_line.product_product_id
     and product.tenant_id = sale_line.tenant_id
    join public.product_templates template
      on template.id = product.product_template_id
     and template.tenant_id = product.tenant_id
    where sale_line.tenant_id = p_tenant_id
      and sale_line.sale_id = p_sale_id
    order by sale_line.id
  loop
    if v_line.product_type <> 'service' and v_line.tracking = 'serial' then
      if not exists (
        select 1 from public.stock_tracking_units tracking_unit
        where tracking_unit.tenant_id = p_tenant_id
          and tracking_unit.id = v_line.tracking_unit_id
          and tracking_unit.product_product_id = v_line.product_product_id
          and tracking_unit.status = 'sold'
      ) then
        raise exception 'وحدة التتبع لا تطابق وحدة مباعة قابلة للإرجاع.';
      end if;
      update public.stock_tracking_units
      set status = 'in_stock', notes = null, updated_at = v_now
      where tenant_id = p_tenant_id and id = v_line.tracking_unit_id;
    end if;

    if v_line.product_type <> 'service' and v_inventory_active then
      v_return_move_id := gen_random_uuid();
      insert into public.stock_moves (
        id, tenant_id, product_product_id, product_template_id, move_type,
        quantity, unit_price, reference_type, reference_id, notes, created_by
      )
      values (
        v_return_move_id, p_tenant_id, v_line.product_product_id,
        v_line.product_template_id, 'return', v_line.quantity, v_line.unit_price,
        'showroom_sale_cancellation', v_cancellation_id,
        'showroom_sale_cancel:' || p_sale_id, v_user.id
      );

      if v_line.tracking <> 'serial' then
        update public.stock_quants
        set quantity_on_hand = quantity_on_hand + v_line.quantity,
            updated_at = v_now
        where tenant_id = p_tenant_id
          and product_product_id = v_line.product_product_id;
        if not found then
          raise exception 'تعذر العثور على Stock Quant لإرجاع الكمية.';
        end if;
      end if;

      v_inventory_returns := v_inventory_returns || jsonb_build_array(
        jsonb_build_object(
          'sale_line_id', v_line.sale_line_id,
          'product_id', v_line.product_product_id,
          'tracking_unit_id', v_line.tracking_unit_id,
          'quantity', v_line.quantity,
          'return_move_id', v_return_move_id,
          'tracking_status', case when v_line.tracking = 'serial' then 'in_stock' else null end
        )
      );
    elsif v_line.product_type <> 'service' and v_line.tracking = 'serial' then
      v_inventory_returns := v_inventory_returns || jsonb_build_array(
        jsonb_build_object(
          'sale_line_id', v_line.sale_line_id,
          'product_id', v_line.product_product_id,
          'tracking_unit_id', v_line.tracking_unit_id,
          'quantity', v_line.quantity,
          'return_move_id', null,
          'tracking_status', 'in_stock'
        )
      );
    end if;
  end loop;

  for v_request in
    select request.id, request.status, request.current_stage
    from public.paperwork_requests request
    where request.tenant_id = p_tenant_id
      and request.sale_id = p_sale_id
    order by request.id
  loop
    if v_request.current_stage <> 'preparation' then
      raise exception 'طلب الأوراق تجاوز مرحلة preparation.';
    end if;

    update public.paperwork_requests
    set status = 'cancelled', current_stage = 'cancelled',
        cancel_reason = 'إلغاء تلقائي بسبب إلغاء فاتورة Showroom: ' || btrim(p_reason),
        closed_at = v_now, stage_entered_at = v_now, updated_at = v_now
    where tenant_id = p_tenant_id and id = v_request.id;

    insert into public.paperwork_request_events (
      tenant_id, request_id, event_type, old_stage, new_stage,
      old_status, new_status, notes, created_by
    )
    values (
      p_tenant_id, v_request.id, 'cancelled', 'preparation', 'cancelled',
      v_request.status, 'cancelled',
      'إلغاء تلقائي بسبب إلغاء فاتورة Showroom ' || p_sale_id
        || '. السبب: ' || btrim(p_reason),
      v_user.id
    );
    v_paperwork_cancelled := v_paperwork_cancelled || jsonb_build_array(
      jsonb_build_object('request_id', v_request.id, 'old_status', v_request.status)
    );
  end loop;

  update public.showroom_sales
  set status = 'cancelled', paid_amount = 0, remaining_amount = 0, updated_at = v_now
  where tenant_id = p_tenant_id and id = p_sale_id;

  update public.showroom_sale_cancellations
  set status = 'completed', completed_by = v_user.id, completed_at = v_now,
      reversal_move_id = v_reversal_move_id, failure_reason = null,
      preview_snapshot = v_preview || jsonb_build_object(
        'execution', jsonb_build_object(
          'invoice_reconciliation', jsonb_build_object(
            'original_receivable_line_id', v_invoice_line.id,
            'reversal_receivable_line_id', v_reversal_line.id,
            'amount', v_invoice_line.debit
          )
        )
      )
  where tenant_id = p_tenant_id and id = v_cancellation_id;

  return jsonb_build_object(
    'sale_id', p_sale_id,
    'status', 'cancelled',
    'idempotent', false,
    'cancellation_id', v_cancellation_id,
    'original_move_id', v_original_move.id,
    'reversal_move_id', v_reversal_move_id,
    'released_open_credits', v_released_open_credits,
    'customer_credits', v_customer_credits,
    'inventory_returns', v_inventory_returns,
    'paperwork_cancelled', v_paperwork_cancelled,
    'invoice_reconciliation', jsonb_build_object(
      'original_receivable_line_id', v_invoice_line.id,
      'reversal_receivable_line_id', v_reversal_line.id,
      'amount', v_invoice_line.debit
    ),
    'cancelled_at', v_now
  );
end;
$$;

revoke all on function public.cancel_showroom_sale(uuid, uuid, text, text)
  from public, anon;
grant execute on function public.cancel_showroom_sale(uuid, uuid, text, text)
  to authenticated;

comment on function public.cancel_showroom_sale(uuid, uuid, text, text) is
  'Owner-only atomic cancellation of a confirmed showroom sale after locked preview revalidation.';

notify pgrst, 'reload schema';

commit;
