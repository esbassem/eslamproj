begin;

create or replace function public.deliver_paperwork_to_customer(
  p_tenant_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_request public.paperwork_requests;
  v_document public.paperwork_documents;
  v_sale public.showroom_sales%rowtype;
  v_remaining numeric := 0;
  v_now timestamptz := now();
  v_notes text := 'تم تسليم الأوراق للعميل وإخراجها من الخزنة.';
begin
  if p_tenant_id is null or p_request_id is null then
    raise exception 'تعذر تحديد الشركة أو طلب الأوراق.';
  end if;

  select tu.id into v_user_id
  from public.tenant_users tu
  where tu.tenant_id = p_tenant_id
    and tu.auth_user_id = auth.uid()
    and tu.is_active = true
  limit 1;

  if v_user_id is null then
    raise exception 'Current user is not an active tenant user';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_request_id::text, 0));

  select pr.* into v_request
  from public.paperwork_requests pr
  where pr.tenant_id = p_tenant_id and pr.id = p_request_id
  for update;

  if v_request.id is null then
    raise exception 'طلب الأوراق غير موجود.';
  end if;
  if v_request.current_stage <> 'client_notified' then
    raise exception 'لا يمكن التسليم قبل إبلاغ العميل.';
  end if;
  if v_request.status <> 'open' then
    raise exception 'لا يمكن التسليم في طلب غير مفتوح.';
  end if;

  if v_request.sale_id is not null then
    select sale.* into v_sale
    from public.showroom_sales sale
    where sale.tenant_id = p_tenant_id
      and sale.id = v_request.sale_id
    for update;

    if v_sale.id is null then
      raise exception 'الفاتورة المرتبطة بطلب الأوراق غير موجودة.';
    end if;

    with sale_move as (
      select am.id
      from public.account_moves am
      where am.tenant_id = p_tenant_id
        and am.move_type = 'sale'
        and am.state = 'posted'
        and (
          am.id = v_sale.account_move_id
          or am.ref = 'showroom_sale:' || v_sale.id
        )
      order by case when am.id = v_sale.account_move_id then 0 else 1 end, am.created_at
      limit 1
    ),
    invoice_lines as (
      select aml.id, aml.debit
      from public.account_move_lines aml
      join sale_move sm on sm.id = aml.move_id
      join public.account_accounts aa
        on aa.id = aml.account_id
       and aa.tenant_id = aml.tenant_id
       and aa.code = '114001'
      where aml.tenant_id = p_tenant_id
        and aml.debit > 0
    ),
    line_balances as (
      select
        invoice_line.id,
        invoice_line.debit,
        coalesce(sum(reconcile.amount), 0) as paid
      from invoice_lines invoice_line
      left join public.account_partial_reconcile reconcile
        on reconcile.tenant_id = p_tenant_id
       and reconcile.debit_move_id = invoice_line.id
      group by invoice_line.id, invoice_line.debit
    )
    select round(greatest(
      coalesce(sum(line_balance.debit - line_balance.paid), v_sale.total_amount, 0),
      0
    ), 2)
    into v_remaining
    from line_balances line_balance;

    if v_remaining > 0 then
      raise exception 'لا يمكن تسليم الأوراق. المتبقي على الفاتورة: % جنيه.',
        trim(to_char(v_remaining, 'FM999G999G999G990D00'));
    end if;
  end if;

  select pd.* into v_document
  from public.paperwork_documents pd
  where pd.tenant_id = p_tenant_id
    and pd.paperwork_request_id = v_request.id
    and pd.status = 'in_custody'
  order by pd.created_at asc
  limit 1
  for update;

  if v_document.id is null then
    raise exception 'لا توجد ورقة في الخزنة مرتبطة بهذا الطلب.';
  end if;

  update public.paperwork_requests
  set current_stage = 'delivered', status = 'done', closed_at = v_now, updated_at = v_now
  where id = v_request.id;

  update public.paperwork_documents
  set status = 'delivered_to_customer', updated_at = v_now
  where id = v_document.id;

  insert into public.paperwork_document_moves (
    tenant_id, document_id, move_direction, source_type,
    from_user_id, from_location, to_partner_id, moved_at, notes, created_by
  ) values (
    p_tenant_id, v_document.id, 'out', 'to_customer',
    v_user_id, 'vault', v_request.customer_id, v_now, v_notes, v_user_id
  );

  insert into public.paperwork_request_events (
    tenant_id, request_id, event_type, old_stage, new_stage,
    new_status, notes, created_by
  ) values (
    p_tenant_id, v_request.id, 'done', v_request.current_stage, 'delivered',
    'done', v_notes, v_user_id
  );

  return jsonb_build_object(
    'request_id', v_request.id,
    'document_id', v_document.id,
    'old_stage', v_request.current_stage,
    'current_stage', 'delivered',
    'status', 'done',
    'updated_at', v_now
  );
end;
$$;

grant execute on function public.deliver_paperwork_to_customer(uuid, uuid) to authenticated;
notify pgrst, 'reload schema';

commit;
