begin;

create or replace function public.preview_showroom_sale_cancellation(
  p_tenant_id uuid,
  p_sale_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_previewed_at timestamptz := clock_timestamp();
  v_user public.tenant_users%rowtype;
  v_sale public.showroom_sales%rowtype;
  v_move public.account_moves%rowtype;
  v_receivable_account_id uuid;
  v_receivable_account_count integer := 0;
  v_invoice_line public.account_move_lines%rowtype;
  v_receivable_line_count integer := 0;
  v_move_debit numeric := 0;
  v_move_credit numeric := 0;
  v_reconciled numeric := 0;
  v_residual numeric := 0;
  v_apr_count integer := 0;
  v_source_reconciled numeric := 0;
  v_source_debit numeric := 0;
  v_source_credit numeric := 0;
  v_source_is_balanced boolean := false;
  v_counterpart_count integer := 0;
  v_counterpart record;
  v_has_legacy_account boolean := false;
  v_is_employee_custody boolean := false;
  v_structural_evidence_valid boolean := false;
  v_classification text;
  v_action text;
  v_allocation_blocker boolean;
  v_allocation_warning text;
  v_cash_total numeric := 0;
  v_employee_cash_total numeric := 0;
  v_account_settlement_total numeric := 0;
  v_legacy_total numeric := 0;
  v_unknown_total numeric := 0;
  v_open_credit_released_total numeric := 0;
  v_allocations jsonb := '[]'::jsonb;
  v_open_credit_items jsonb := '[]'::jsonb;
  v_inventory_items jsonb := '[]'::jsonb;
  v_paperwork_requests jsonb := '[]'::jsonb;
  v_failures jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_existing_cancellation jsonb := null;
  v_existing_reversal jsonb := null;
  v_inventory_has_blocker boolean := false;
  v_paperwork_has_blocker boolean := false;
  v_manual_review boolean := false;
  v_can_cancel boolean := false;
  v_inventory_active boolean := false;
  v_stock_moves jsonb;
  v_stock_out_quantity numeric;
  v_quant_quantity numeric;
  v_tracking_status text;
  v_inventory_action text;
  v_inventory_blocker text;
  v_signature_payload jsonb;
  v_preview_version text;
  v_row record;
begin
  if auth.uid() is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;
  if p_tenant_id is null or p_sale_id is null then
    raise exception 'تعذر تحديد الشركة أو الفاتورة.';
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
    raise exception 'لا تملك صلاحية معاينة إلغاء فواتير هذه الشركة.';
  end if;

  select sale.*
  into v_sale
  from public.showroom_sales sale
  where sale.tenant_id = p_tenant_id
    and sale.id = p_sale_id;

  if v_sale.id is null then
    raise exception 'فاتورة الشو روم غير موجودة داخل الشركة.';
  end if;

  if v_sale.status <> 'confirmed' then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'code', 'sale_not_confirmed',
      'message', case
        when v_sale.status = 'pending_payment'
          then 'الفاتورة معلقة على الدفع وتخضع لمسار الحذف، وليست لمسار إلغاء الفواتير المرحلة.'
        when v_sale.status = 'cancelled'
          then 'الفاتورة ملغاة بالفعل.'
        else 'حالة الفاتورة لا تسمح بمعاينة الإلغاء.'
      end
    ));
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'sale_status',
      'message', 'حالة الفاتورة الحالية: ' || coalesce(v_sale.status, 'غير محددة') || '.'
    ));
  end if;

  select jsonb_build_object(
    'id', cancellation.id,
    'status', cancellation.status,
    'reason', cancellation.reason,
    'requested_at', cancellation.requested_at,
    'completed_at', cancellation.completed_at,
    'original_move_id', cancellation.original_move_id,
    'reversal_move_id', cancellation.reversal_move_id,
    'failure_reason', cancellation.failure_reason,
    'updated_at', cancellation.updated_at
  )
  into v_existing_cancellation
  from public.showroom_sale_cancellations cancellation
  where cancellation.tenant_id = p_tenant_id
    and cancellation.sale_id = v_sale.id
  order by
    case cancellation.status
      when 'pending' then 0
      when 'completed' then 1
      else 2
    end,
    cancellation.created_at desc,
    cancellation.id desc
  limit 1;

  if v_existing_cancellation ->> 'status' = 'pending' then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'code', 'active_cancellation_exists',
      'message', 'يوجد طلب إلغاء معلق لهذه الفاتورة.'
    ));
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'cancellation_already_pending',
      'message', 'لا يمكن بدء إلغاء جديد أثناء وجود طلب إلغاء معلق.'
    ));
  elsif v_existing_cancellation ->> 'status' = 'completed' then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'code', 'completed_cancellation_exists',
      'message', case
        when v_sale.status = 'cancelled'
          then 'الفاتورة لها عملية إلغاء مكتملة وهي ملغاة بالفعل.'
        else 'توجد عملية إلغاء مكتملة لكن حالة الفاتورة ليست cancelled؛ يلزم فحص يدوي.'
      end
    ));
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'cancellation_already_completed',
      'message', 'لا يمكن تنفيذ إلغاء مكرر.'
    ));
  elsif v_existing_cancellation ->> 'status' = 'failed' then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'previous_cancellation_failed',
      'message', coalesce(
        nullif(v_existing_cancellation ->> 'failure_reason', ''),
        'توجد محاولة إلغاء سابقة فاشلة.'
      )
    ));
  end if;

  if v_sale.account_move_id is null then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'code', 'original_move_missing',
      'message', 'الفاتورة المؤكدة لا تحتوي على account_move_id.'
    ));
  else
    select account_move.*
    into v_move
    from public.account_moves account_move
    where account_move.id = v_sale.account_move_id
      and account_move.tenant_id = p_tenant_id;

    if v_move.id is null then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'code', 'original_move_invalid',
        'message', 'account_move_id لا يشير إلى قيد داخل نفس الشركة.'
      ));
    else
      if v_move.state <> 'posted' then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'original_move_not_posted',
          'message', 'قيد البيع الأصلي غير مرحل.'
        ));
      end if;
      if v_move.move_type <> 'sale' then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'original_move_not_sale',
          'message', 'القيد المرتبط بالفاتورة ليس من نوع sale.'
        ));
      end if;
      if v_move.ref is distinct from ('showroom_sale:' || v_sale.id) then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'original_move_reference_mismatch',
          'message', 'مرجع قيد البيع الأصلي لا يطابق الفاتورة.'
        ));
      end if;

      select round(coalesce(sum(move_line.debit), 0), 2),
             round(coalesce(sum(move_line.credit), 0), 2)
      into v_move_debit, v_move_credit
      from public.account_move_lines move_line
      where move_line.tenant_id = p_tenant_id
        and move_line.move_id = v_move.id;

      if v_move_debit <= 0 or v_move_debit <> v_move_credit then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'original_move_unbalanced',
          'message', 'قيد البيع الأصلي غير متوازن.',
          'debit', v_move_debit,
          'credit', v_move_credit
        ));
      end if;

      select jsonb_build_object(
        'id', reversal.id,
        'name', reversal.name,
        'state', reversal.state,
        'move_type', reversal.move_type,
        'date', reversal.date,
        'updated_at', reversal.updated_at
      )
      into v_existing_reversal
      from public.account_moves reversal
      where reversal.tenant_id = p_tenant_id
        and reversal.reversed_entry_id = v_move.id
      order by reversal.created_at, reversal.id
      limit 1;

      if v_existing_reversal is not null then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'existing_reversal',
          'message', 'يوجد قيد عكسي مرتبط بقيد البيع الأصلي.'
        ));
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'original_move_already_reversed',
          'message', 'يلزم فحص يدوي قبل أي إجراء آخر.'
        ));
      end if;
    end if;
  end if;

  select count(*), (array_agg(account.id order by account.id))[1]
  into v_receivable_account_count, v_receivable_account_id
  from public.account_accounts account
  where account.tenant_id = p_tenant_id
    and account.code = '114001'
    and coalesce(account.active, true) = true;

  if v_receivable_account_count <> 1 then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'code', 'receivable_account_not_unique',
      'message', 'حساب 114001 غير موجود بشكل وحيد ونشط داخل الشركة.'
    ));
    v_receivable_account_id := null;
  end if;

  if v_move.id is not null and v_receivable_account_id is not null then
    select count(*)
    into v_receivable_line_count
    from public.account_move_lines move_line
    where move_line.tenant_id = p_tenant_id
      and move_line.move_id = v_move.id
      and move_line.account_id = v_receivable_account_id;

    if v_receivable_line_count <> 1 then
      v_failures := v_failures || jsonb_build_array(jsonb_build_object(
        'code', 'invoice_receivable_line_not_unique',
        'message', 'يجب أن يحتوي قيد البيع على سطر 114001 واحد فقط.',
        'line_count', v_receivable_line_count
      ));
    else
      select move_line.*
      into v_invoice_line
      from public.account_move_lines move_line
      where move_line.tenant_id = p_tenant_id
        and move_line.move_id = v_move.id
        and move_line.account_id = v_receivable_account_id;

      if v_invoice_line.debit <= 0 or v_invoice_line.credit <> 0 then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'invoice_receivable_line_invalid_amount_side',
          'message', 'سطر 114001 الخاص بالفاتورة ليس سطرًا مدينًا صالحًا.'
        ));
      end if;
      if v_invoice_line.partner_id is distinct from v_sale.customer_id then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'invoice_receivable_partner_mismatch',
          'message', 'Partner سطر ذمم الفاتورة لا يطابق عميل الفاتورة.'
        ));
      end if;
      if round(v_invoice_line.debit, 2) <> round(v_sale.total_amount, 2) then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'invoice_total_mismatch',
          'message', 'قيمة سطر ذمم الفاتورة لا تطابق إجمالي Sale.',
          'invoice_line_amount', round(v_invoice_line.debit, 2),
          'sale_total_amount', round(v_sale.total_amount, 2)
        ));
      end if;

      select round(coalesce(sum(reconcile.amount), 0), 2), count(*)
      into v_reconciled, v_apr_count
      from public.account_partial_reconcile reconcile
      where reconcile.tenant_id = p_tenant_id
        and reconcile.debit_move_id = v_invoice_line.id;

      v_residual := round(v_invoice_line.debit - v_reconciled, 2);

      if v_reconciled < 0 or v_reconciled > round(v_invoice_line.debit, 2)
         or v_residual < 0
      then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'invoice_over_reconciled',
          'message', 'مجموع APR يتجاوز قيمة سطر الفاتورة.',
          'original_amount', round(v_invoice_line.debit, 2),
          'reconciled_amount', v_reconciled
        ));
      end if;

      if round(coalesce(v_sale.paid_amount, 0), 2) <> v_reconciled
         or round(coalesce(v_sale.remaining_amount, 0), 2) <> v_residual
      then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'sale_payment_cache_drift',
          'message', 'القيم المخزنة على Sale لا تطابق القيم المشتقة من APR.',
          'apr_paid', v_reconciled,
          'cached_paid', round(coalesce(v_sale.paid_amount, 0), 2),
          'apr_residual', v_residual,
          'cached_residual', round(coalesce(v_sale.remaining_amount, 0), 2)
        ));
      end if;

      for v_row in
        select
          reconcile.id as apr_id,
          reconcile.amount,
          reconcile.credit_move_id as source_credit_line_id,
          credit_line.move_id as source_move_id,
          credit_line.account_id as credit_account_id,
          credit_account.code as credit_account_code,
          credit_line.partner_id as credit_partner_id,
          credit_line.source_entity_id,
          source_entity.name as source_entity_name,
          credit_line.debit as credit_line_debit,
          credit_line.credit as credit_line_credit,
          credit_line.currency_code as credit_line_currency,
          source_move.name as source_move_name,
          source_move.state as source_move_state,
          source_move.move_type as source_move_type,
          source_move.pay_method,
          source_move.payment_id,
          source_move.partner_id as source_move_partner_id,
          source_move.currency_code as source_move_currency,
          source_move.updated_at as source_move_updated_at
        from public.account_partial_reconcile reconcile
        left join public.account_move_lines credit_line
          on credit_line.id = reconcile.credit_move_id
         and credit_line.tenant_id = reconcile.tenant_id
        left join public.account_accounts credit_account
          on credit_account.id = credit_line.account_id
         and credit_account.tenant_id = credit_line.tenant_id
        left join public.account_moves source_move
          on source_move.id = credit_line.move_id
         and source_move.tenant_id = credit_line.tenant_id
        left join public.partners source_entity
          on source_entity.id = credit_line.source_entity_id
         and source_entity.tenant_id = credit_line.tenant_id
        where reconcile.tenant_id = p_tenant_id
          and reconcile.debit_move_id = v_invoice_line.id
        order by reconcile.id
      loop
        v_classification := 'unknown';
        v_action := 'manual_review';
        v_allocation_blocker := true;
        v_allocation_warning := null;
        v_counterpart_count := 0;
        v_counterpart := null;
        v_has_legacy_account := false;
        v_is_employee_custody := false;
        v_source_debit := 0;
        v_source_credit := 0;
        v_source_is_balanced := false;
        v_structural_evidence_valid := false;

        select
          round(coalesce(sum(source_line.debit), 0), 2),
          round(coalesce(sum(source_line.credit), 0), 2)
        into v_source_debit, v_source_credit
        from public.account_move_lines source_line
        where source_line.tenant_id = p_tenant_id
          and source_line.move_id = v_row.source_move_id;

        v_source_is_balanced :=
          v_source_debit > 0
          and v_source_debit = v_source_credit;

        select count(*)
        into v_counterpart_count
        from public.account_move_lines source_line
        where source_line.tenant_id = p_tenant_id
          and source_line.move_id = v_row.source_move_id
          and source_line.debit > 0
          and source_line.credit = 0;

        if v_counterpart_count = 1 then
          select
            source_line.id as line_id,
            source_line.account_id,
            account.code,
            account.name,
            account.account_type,
            account.group_id,
            account_group.code as group_code,
            account_group.name as group_name,
            account.responsible_user_id,
            source_line.debit,
            source_line.partner_id
          into v_counterpart
          from public.account_move_lines source_line
          join public.account_accounts account
            on account.id = source_line.account_id
           and account.tenant_id = source_line.tenant_id
          left join public.account_groups account_group
            on account_group.id = account.group_id
           and account_group.tenant_id = account.tenant_id
          where source_line.tenant_id = p_tenant_id
            and source_line.move_id = v_row.source_move_id
            and source_line.debit > 0
            and source_line.credit = 0;
        end if;

        select exists (
          select 1
          from public.account_move_lines source_line
          join public.account_accounts account
            on account.id = source_line.account_id
           and account.tenant_id = source_line.tenant_id
          where source_line.tenant_id = p_tenant_id
            and source_line.move_id = v_row.source_move_id
            and account.code = '212001'
        )
        into v_has_legacy_account;

        if v_counterpart_count = 1 and v_counterpart.responsible_user_id is not null then
          select exists (
            select 1
            from public.account_accounts custody_root
            where custody_root.tenant_id = p_tenant_id
              and coalesce(custody_root.active, true) = true
              and (
                custody_root.code = '111003'
                or custody_root.name = 'نقدية لدى الموظفين'
              )
              and custody_root.group_id is not null
              and custody_root.group_id = v_counterpart.group_id
          )
          into v_is_employee_custody;
        end if;

        v_structural_evidence_valid :=
          v_row.source_move_id is not null
          and v_row.source_move_state = 'posted'
          and v_row.credit_account_code = '114001'
          and v_row.credit_line_debit = 0
          and v_row.credit_line_credit > 0
          and v_row.credit_partner_id = v_sale.customer_id
          and v_row.source_move_partner_id = v_sale.customer_id
          and v_counterpart_count = 1
          and (
            v_counterpart.partner_id is null
            or v_counterpart.partner_id = v_sale.customer_id
          )
          and v_source_is_balanced
          and coalesce(v_row.credit_line_currency, v_row.source_move_currency)
              is not distinct from coalesce(v_invoice_line.currency_code, v_move.currency_code);

        if v_row.credit_account_code = '114001'
           and v_row.source_entity_id is not null
           and v_row.credit_line_debit = 0
           and v_row.credit_line_credit > 0
        then
          v_classification := 'payment_entity_open_credit';
          v_action := 'release_open_credit';
          v_allocation_blocker := false;
        elsif lower(coalesce(v_row.pay_method, '')) = 'advance_credit'
              or v_has_legacy_account
        then
          v_classification := 'legacy';
          v_action := 'manual_review';
          v_allocation_blocker := true;
        elsif v_structural_evidence_valid
              and v_counterpart.group_code = 'TEMP'
        then
          v_classification := 'account_settlement';
          v_action := 'manual_review';
          v_allocation_blocker := true;
        elsif v_structural_evidence_valid
              and v_is_employee_custody
        then
          v_classification := 'employee_custody_cash';
          v_action := 'keep_as_customer_credit';
          v_allocation_blocker := false;
        elsif v_structural_evidence_valid
              and v_counterpart.code = '111001'
        then
          v_classification := 'cash';
          v_action := 'keep_as_customer_credit';
          v_allocation_blocker := false;
        elsif v_structural_evidence_valid
              and v_counterpart.code = '111002'
              and v_counterpart.group_code = 'CASH'
        then
          v_classification := 'cash';
          v_action := 'keep_as_customer_credit';
          v_allocation_blocker := false;
          v_allocation_warning := 'legacy_showroom_cash_111002';
        elsif v_structural_evidence_valid
              and v_counterpart.code = '119001'
        then
          v_classification := 'legacy';
          v_action := 'manual_review';
          v_allocation_blocker := true;
          v_allocation_warning := 'legacy_collection_119001';
        else
          v_allocation_warning := 'تعذر إثبات نوع التسوية من الحقول الهيكلية الحالية.';
        end if;

        if v_row.source_move_id is null
           or v_row.source_move_state is distinct from 'posted'
           or v_row.credit_account_code is distinct from '114001'
           or v_row.credit_line_debit <> 0
           or v_row.credit_line_credit <= 0
           or v_row.credit_partner_id is distinct from v_sale.customer_id
           or coalesce(v_row.credit_line_currency, v_row.source_move_currency)
              is distinct from coalesce(v_invoice_line.currency_code, v_move.currency_code)
        then
          v_classification := 'unknown';
          v_action := 'manual_review';
          v_allocation_blocker := true;
          v_allocation_warning := 'سطر التسوية أو قيده لا يطابق Invariants ذمم العميل.';
        end if;

        select round(coalesce(sum(reconcile.amount), 0), 2)
        into v_source_reconciled
        from public.account_partial_reconcile reconcile
        where reconcile.tenant_id = p_tenant_id
          and reconcile.credit_move_id = v_row.source_credit_line_id;

        if v_row.amount <= 0
           or v_row.amount > v_row.credit_line_credit
           or v_source_reconciled > v_row.credit_line_credit
        then
          v_failures := v_failures || jsonb_build_array(jsonb_build_object(
            'code', 'invalid_apr_total',
            'message', 'APR أو إجمالي مصالحات السطر الدائن يتجاوز قيمة السطر.',
            'apr_id', v_row.apr_id
          ));
          v_allocation_blocker := true;
        end if;

        if v_classification = 'cash' then
          v_cash_total := round(v_cash_total + v_row.amount, 2);
        elsif v_classification = 'employee_custody_cash' then
          v_employee_cash_total := round(v_employee_cash_total + v_row.amount, 2);
        elsif v_classification = 'account_settlement' then
          v_account_settlement_total := round(v_account_settlement_total + v_row.amount, 2);
        elsif v_classification = 'legacy' then
          v_legacy_total := round(v_legacy_total + v_row.amount, 2);
        elsif v_classification = 'unknown' then
          v_unknown_total := round(v_unknown_total + v_row.amount, 2);
        end if;

        if v_allocation_blocker then
          v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
            'code', 'allocation_requires_manual_review',
            'apr_id', v_row.apr_id,
            'classification', v_classification,
            'message', coalesce(v_allocation_warning, 'نوع التسوية يتطلب مراجعة يدوية.')
          ));
        end if;

        v_allocations := v_allocations || jsonb_build_array(jsonb_build_object(
          'apr_id', v_row.apr_id,
          'amount', round(v_row.amount, 2),
          'classification', v_classification,
          'source_move_id', v_row.source_move_id,
          'source_move_name', v_row.source_move_name,
          'source_credit_line_id', v_row.source_credit_line_id,
          'source_entity_id', v_row.source_entity_id,
          'source_entity_name', v_row.source_entity_name,
          'pay_method', v_row.pay_method,
          'move_type', v_row.source_move_type,
          'payment_id', v_row.payment_id,
          'currency_code', coalesce(v_row.credit_line_currency, v_row.source_move_currency),
          'counterpart_account', case
            when v_counterpart_count = 1 then jsonb_build_object(
              'line_id', v_counterpart.line_id,
              'account_id', v_counterpart.account_id,
              'code', v_counterpart.code,
              'name', v_counterpart.name,
              'account_type', v_counterpart.account_type,
              'responsible_user_id', v_counterpart.responsible_user_id,
              'debit', round(v_counterpart.debit, 2)
            )
            else null
          end,
          'counterpart_debit_line_count', v_counterpart_count,
          'action_if_cancelled', v_action,
          'blocker', v_allocation_blocker,
          'warning', v_allocation_warning
        ));
      end loop;

      if v_unknown_total > 0 then
        v_failures := v_failures || jsonb_build_array(jsonb_build_object(
          'code', 'allocations_not_fully_classified',
          'message', 'توجد APR allocations لم يمكن تصنيفها بشكل موثوق.',
          'unknown_total', v_unknown_total
        ));
      end if;

      if v_account_settlement_total > 0 then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'account_settlement_present',
          'message', 'توجد تسوية على حساب وتتطلب مراجعة يدوية.',
          'amount', v_account_settlement_total
        ));
      end if;
      if v_legacy_total > 0 then
        v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
          'code', 'legacy_settlement_present',
          'message', 'توجد تسوية Legacy وتتطلب مراجعة يدوية.',
          'amount', v_legacy_total
        ));
      end if;

      select
        coalesce(jsonb_agg(
          jsonb_build_object(
            'open_credit_line_id', open_credit.credit_line_id,
            'source_move_id', open_credit.source_move_id,
            'source_entity_id', open_credit.source_entity_id,
            'source_entity_name', open_credit.source_entity_name,
            'original_amount', open_credit.original_amount,
            'reconciled_total', open_credit.reconciled_total,
            'available_before', open_credit.available_before,
            'released_from_this_invoice', open_credit.released_from_invoice,
            'available_after_cancellation',
              round(open_credit.available_before + open_credit.released_from_invoice, 2),
            'currency_code', open_credit.currency_code
          )
          order by open_credit.credit_line_id
        ), '[]'::jsonb),
        round(coalesce(sum(open_credit.released_from_invoice), 0), 2)
      into v_open_credit_items, v_open_credit_released_total
      from (
        select
          credit_line.id as credit_line_id,
          credit_line.move_id as source_move_id,
          credit_line.source_entity_id,
          source_entity.name as source_entity_name,
          round(credit_line.credit, 2) as original_amount,
          round(coalesce(all_reconciled.total, 0), 2) as reconciled_total,
          round(greatest(credit_line.credit - coalesce(all_reconciled.total, 0), 0), 2)
            as available_before,
          round(sum(invoice_reconcile.amount), 2) as released_from_invoice,
          coalesce(credit_line.currency_code, source_move.currency_code) as currency_code
        from public.account_partial_reconcile invoice_reconcile
        join public.account_move_lines credit_line
          on credit_line.id = invoice_reconcile.credit_move_id
         and credit_line.tenant_id = invoice_reconcile.tenant_id
        join public.account_accounts credit_account
          on credit_account.id = credit_line.account_id
         and credit_account.tenant_id = credit_line.tenant_id
         and credit_account.code = '114001'
        join public.account_moves source_move
          on source_move.id = credit_line.move_id
         and source_move.tenant_id = credit_line.tenant_id
        join public.partners source_entity
          on source_entity.id = credit_line.source_entity_id
         and source_entity.tenant_id = credit_line.tenant_id
        left join lateral (
          select sum(reconcile.amount) as total
          from public.account_partial_reconcile reconcile
          where reconcile.tenant_id = credit_line.tenant_id
            and reconcile.credit_move_id = credit_line.id
        ) all_reconciled on true
        where invoice_reconcile.tenant_id = p_tenant_id
          and invoice_reconcile.debit_move_id = v_invoice_line.id
          and credit_line.source_entity_id is not null
          and credit_line.debit = 0
          and credit_line.credit > 0
        group by
          credit_line.id,
          credit_line.move_id,
          credit_line.source_entity_id,
          source_entity.name,
          credit_line.credit,
          all_reconciled.total,
          credit_line.currency_code,
          source_move.currency_code
      ) open_credit;
    end if;
  end if;

  select exists (
    select 1
    from public.tenant_modules tenant_module
    join public.ir_modules module
      on module.id = tenant_module.module_id
    where tenant_module.tenant_id = p_tenant_id
      and tenant_module.state = 'installed'
      and module.technical_name = 'inventory'
  )
  into v_inventory_active;

  for v_row in
    select
      sale_line.id as sale_line_id,
      sale_line.product_product_id,
      sale_line.tracking_unit_id,
      sale_line.quantity,
      product.display_name as product_name,
      product.tracking,
      template.product_type,
      tracking_unit.status as tracking_status,
      tracking_unit.product_product_id as tracking_product_id
    from public.showroom_sale_lines sale_line
    left join public.product_products product
      on product.id = sale_line.product_product_id
     and product.tenant_id = sale_line.tenant_id
    left join public.product_templates template
      on template.id = product.product_template_id
     and template.tenant_id = product.tenant_id
    left join public.stock_tracking_units tracking_unit
      on tracking_unit.id = sale_line.tracking_unit_id
     and tracking_unit.tenant_id = sale_line.tenant_id
    where sale_line.tenant_id = p_tenant_id
      and sale_line.sale_id = v_sale.id
    order by sale_line.id
  loop
    select
      coalesce(jsonb_agg(jsonb_build_object(
        'id', stock_move.id,
        'move_type', stock_move.move_type,
        'quantity', stock_move.quantity,
        'created_at', stock_move.created_at
      ) order by stock_move.created_at, stock_move.id), '[]'::jsonb),
      round(coalesce(sum(stock_move.quantity)
        filter (where stock_move.move_type = 'out'), 0), 2)
    into v_stock_moves, v_stock_out_quantity
    from public.stock_moves stock_move
    where stock_move.tenant_id = p_tenant_id
      and stock_move.reference_type = 'showroom_sale'
      and stock_move.reference_id = v_sale.id
      and stock_move.product_product_id = v_row.product_product_id;

    select round(coalesce(sum(quant.quantity_on_hand), 0), 2)
    into v_quant_quantity
    from public.stock_quants quant
    where quant.tenant_id = p_tenant_id
      and quant.product_product_id = v_row.product_product_id;

    v_inventory_blocker := null;
    if v_row.product_name is null or v_row.product_type is null then
      v_inventory_action := 'manual_review';
      v_inventory_blocker := 'المنتج أو قالب المنتج غير موجود داخل الشركة.';
    elsif v_row.product_type = 'service' or not v_inventory_active then
      v_inventory_action := 'no_inventory_action';
    elsif v_row.tracking = 'serial' then
      v_inventory_action := 'return_tracking_unit_to_stock';
      if v_row.tracking_unit_id is null then
        v_inventory_blocker := 'سطر Serial لا يحتوي على tracking_unit_id.';
      elsif v_row.tracking_status is null then
        v_inventory_blocker := 'وحدة التتبع غير موجودة داخل الشركة.';
      elsif v_row.tracking_status <> 'sold' then
        v_inventory_blocker := 'حالة وحدة التتبع لا تطابق Sale مؤكدة: '
          || v_row.tracking_status || '.';
      elsif v_row.tracking_product_id is distinct from v_row.product_product_id then
        v_inventory_blocker := 'وحدة التتبع مرتبطة بمنتج آخر.';
      elsif v_stock_out_quantity <> round(v_row.quantity, 2) then
        v_inventory_blocker := 'كمية حركة الخروج لا تطابق كمية سطر البيع.';
      end if;
    else
      v_inventory_action := 'restore_stock_quantity';
      if v_stock_out_quantity <> round(v_row.quantity, 2) then
        v_inventory_blocker := 'كمية حركة الخروج لا تطابق كمية سطر البيع.';
      elsif not exists (
        select 1
        from public.stock_quants quant
        where quant.tenant_id = p_tenant_id
          and quant.product_product_id = v_row.product_product_id
      ) then
        v_inventory_blocker := 'لا يوجد Stock Quant للمنتج رغم تفعيل المخزون.';
      end if;
    end if;

    if v_inventory_blocker is not null then
      v_inventory_has_blocker := true;
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'inventory_not_interpretable',
        'sale_line_id', v_row.sale_line_id,
        'message', v_inventory_blocker
      ));
    end if;

    v_inventory_items := v_inventory_items || jsonb_build_array(jsonb_build_object(
      'sale_line_id', v_row.sale_line_id,
      'product_id', v_row.product_product_id,
      'product_name', v_row.product_name,
      'product_type', v_row.product_type,
      'tracking', v_row.tracking,
      'quantity', round(v_row.quantity, 2),
      'tracking_unit_id', v_row.tracking_unit_id,
      'tracking_status', v_row.tracking_status,
      'stock_moves', v_stock_moves,
      'stock_out_quantity', v_stock_out_quantity,
      'current_quantity_on_hand', v_quant_quantity,
      'action_if_cancelled', v_inventory_action,
      'blocker', v_inventory_blocker is not null,
      'blocker_reason', v_inventory_blocker
    ));
  end loop;

  if v_inventory_has_blocker then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'code', 'inventory_links_not_interpretable',
      'message', 'يوجد أثر مخزني لا يمكن تفسيره آليًا.'
    ));
  end if;

  for v_row in
    select request.id, request.status, request.current_stage,
           request.updated_at, request.cancel_reason
    from public.paperwork_requests request
    where request.tenant_id = p_tenant_id
      and request.sale_id = v_sale.id
    order by request.created_at, request.id
  loop
    if v_row.current_stage = 'preparation' then
      v_paperwork_requests := v_paperwork_requests || jsonb_build_array(jsonb_build_object(
        'request_id', v_row.id,
        'status', v_row.status,
        'current_stage', v_row.current_stage,
        'action_if_cancelled', 'cancel_paperwork_request',
        'blocker', false,
        'blocker_reason', null
      ));
    else
      v_paperwork_has_blocker := true;
      v_paperwork_requests := v_paperwork_requests || jsonb_build_array(jsonb_build_object(
        'request_id', v_row.id,
        'status', v_row.status,
        'current_stage', v_row.current_stage,
        'action_if_cancelled', 'manual_review',
        'blocker', true,
        'blocker_reason', 'الـMVP يسمح فقط بطلب أوراق في مرحلة preparation.'
      ));
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'paperwork_beyond_preparation',
        'request_id', v_row.id,
        'current_stage', v_row.current_stage,
        'message', case
          when v_row.current_stage = 'cancelled'
            then 'طلب الأوراق ملغي مسبقًا ويحتاج مراجعة اتساق يدوية.'
          else 'طلب الأوراق تجاوز مرحلة preparation.'
        end
      ));
    end if;
  end loop;

  if v_paperwork_has_blocker then
    v_failures := v_failures || jsonb_build_array(jsonb_build_object(
      'code', 'paperwork_rule_not_satisfied',
      'message', 'يوجد طلب أوراق خارج مرحلة preparation.'
    ));
  end if;

  if v_cash_total + v_employee_cash_total > 0 then
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'cash_becomes_customer_credit',
      'message', 'هذه المبالغ لن يتم Refund لها داخل Cancellation. بعد فك APR ستصبح Customer Outstanding Credit.',
      'amount', round(v_cash_total + v_employee_cash_total, 2)
    ));
  end if;

  v_manual_review := jsonb_array_length(v_failures) > 0
    or jsonb_array_length(v_blockers) > 0;
  v_can_cancel := v_sale.status = 'confirmed'
    and not v_manual_review
    and v_account_settlement_total = 0
    and v_legacy_total = 0
    and v_unknown_total = 0
    and not v_inventory_has_blocker
    and not v_paperwork_has_blocker
    and v_existing_reversal is null;

  v_signature_payload := jsonb_build_object(
    'sale', jsonb_build_object(
      'id', v_sale.id,
      'status', v_sale.status,
      'updated_at', v_sale.updated_at,
      'account_move_id', v_sale.account_move_id,
      'total_amount', v_sale.total_amount,
      'paid_amount', v_sale.paid_amount,
      'remaining_amount', v_sale.remaining_amount
    ),
    'move', case when v_move.id is null then null else jsonb_build_object(
      'id', v_move.id,
      'state', v_move.state,
      'move_type', v_move.move_type,
      'ref', v_move.ref,
      'updated_at', v_move.updated_at,
      'debit', v_move_debit,
      'credit', v_move_credit
    ) end,
    'invoice_line', case when v_invoice_line.id is null then null else jsonb_build_object(
      'id', v_invoice_line.id,
      'debit', v_invoice_line.debit,
      'credit', v_invoice_line.credit,
      'partner_id', v_invoice_line.partner_id,
      'currency_code', v_invoice_line.currency_code
    ) end,
    'allocations', v_allocations,
    'inventory', v_inventory_items,
    'paperwork', v_paperwork_requests,
    'existing_cancellation', v_existing_cancellation,
    'existing_reversal', v_existing_reversal
  );

  v_preview_version := encode(
    extensions.digest(v_signature_payload::text, 'sha256'),
    'hex'
  );

  return jsonb_build_object(
    'sale', jsonb_build_object(
      'id', v_sale.id,
      'tenant_id', v_sale.tenant_id,
      'status', v_sale.status,
      'customer_id', v_sale.customer_id,
      'sale_number', v_sale.sale_number,
      'total_amount', round(v_sale.total_amount, 2),
      'paid_amount_cached', round(coalesce(v_sale.paid_amount, 0), 2),
      'remaining_amount_cached', round(coalesce(v_sale.remaining_amount, 0), 2),
      'account_move_id', v_sale.account_move_id,
      'updated_at', v_sale.updated_at
    ),
    'invoice', case when v_move.id is null then null else jsonb_build_object(
      'move_id', v_move.id,
      'move_name', v_move.name,
      'move_type', v_move.move_type,
      'state', v_move.state,
      'ref', v_move.ref,
      'date', v_move.date,
      'currency_code', v_move.currency_code,
      'is_balanced', v_move_debit > 0 and v_move_debit = v_move_credit,
      'total_debit', v_move_debit,
      'total_credit', v_move_credit,
      'receivable_line_id', v_invoice_line.id,
      'original_amount', case
        when v_invoice_line.id is null then null
        else round(v_invoice_line.debit, 2)
      end,
      'reconciled_amount', case
        when v_invoice_line.id is null then null
        else v_reconciled
      end,
      'residual', case
        when v_invoice_line.id is null then null
        else v_residual
      end,
      'apr_count', v_apr_count,
      'existing_reversal', v_existing_reversal
    ) end,
    'payments', jsonb_build_object(
      'cash_total', v_cash_total,
      'employee_custody_cash_total', v_employee_cash_total,
      'account_settlement_total', v_account_settlement_total,
      'legacy_total', v_legacy_total,
      'unknown_total', v_unknown_total,
      'cash_cancellation_result',
        'هذه المبالغ لن يتم Refund لها داخل Cancellation. بعد فك APR ستصبح Customer Outstanding Credit.'
    ),
    'allocations', v_allocations,
    'open_credits', jsonb_build_object(
      'released_total', v_open_credit_released_total,
      'items', v_open_credit_items
    ),
    'inventory', jsonb_build_object(
      'module_installed', v_inventory_active,
      'items', v_inventory_items,
      'has_blocker', v_inventory_has_blocker
    ),
    'paperwork', jsonb_build_object(
      'requests', v_paperwork_requests,
      'has_blocker', v_paperwork_has_blocker
    ),
    'existing_cancellation', v_existing_cancellation,
    'invariants', jsonb_build_object(
      'valid', jsonb_array_length(v_failures) = 0,
      'failures', v_failures
    ),
    'warnings', v_warnings,
    'blockers', v_blockers,
    'manual_review_required', v_manual_review,
    'can_cancel_now', v_can_cancel,
    'preview_version', v_preview_version,
    'previewed_at', v_previewed_at
  );
end;
$$;

revoke all on function public.preview_showroom_sale_cancellation(uuid, uuid)
  from public, anon;
grant execute on function public.preview_showroom_sale_cancellation(uuid, uuid)
  to authenticated;

comment on function public.preview_showroom_sale_cancellation(uuid, uuid) is
  'Read-only deterministic preview of confirmed showroom sale cancellation effects and blockers.';

notify pgrst, 'reload schema';

commit;
