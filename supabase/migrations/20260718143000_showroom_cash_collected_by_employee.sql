begin;

create or replace function public.complete_showroom_sale(
  p_sale_id uuid,
  p_cash_amount numeric default 0,
  p_cash_note text default null,
  p_advance_payments jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auth_user_id uuid := auth.uid();
  v_user public.tenant_users%rowtype;
  v_sale public.showroom_sales%rowtype;
  v_branch_id uuid;
  v_total numeric := 0;
  v_cash numeric := round(greatest(coalesce(p_cash_amount, 0), 0), 2);
  v_advance_total numeric := 0;
  v_paid numeric := 0;
  v_remaining numeric := 0;
  v_receivable_account uuid;
  v_income_account uuid;
  v_cash_account uuid;
  v_employee_partner uuid;
  v_advance_account uuid;
  v_entity_account uuid;
  v_move_id uuid;
  v_sale_move_id uuid := gen_random_uuid();
  v_cash_move_id uuid;
  v_invoice_receivable_line_id uuid := gen_random_uuid();
  v_payment_receivable_line_id uuid;
  v_item jsonb;
  v_entity_id uuid;
  v_entity_name text;
  v_amount numeric;
  v_note text;
  v_available numeric;
  v_applied numeric := 0;
  v_advance_move_ids jsonb := '[]'::jsonb;
  v_inventory_active boolean := false;
  v_line record;
  v_quant record;
  v_unit record;
  v_account_count integer;
begin
  if v_auth_user_id is null then
    raise exception 'يجب تسجيل الدخول أولاً.';
  end if;

  select * into v_sale from public.showroom_sales where id = p_sale_id for update;
  if v_sale.id is null then raise exception 'فاتورة الشو روم غير موجودة.'; end if;
  select tu.* into v_user
  from public.tenant_users tu
  where tu.auth_user_id = v_auth_user_id and tu.tenant_id = v_sale.tenant_id and coalesce(tu.is_active, true) = true
  order by tu.created_at limit 1
  for update;
  if v_user.id is null then raise exception 'لا يمكن إتمام فاتورة تابعة لشركة أخرى.'; end if;

  if v_cash > 0 then
    v_employee_partner := v_user.partner_id;
    if v_employee_partner is null then
      insert into public.partners (
        tenant_id, name, phone1, mobile, email, contact_type, is_company,
        is_external_contact, customer_rank, supplier_rank, financer_rank, active
      ) values (
        v_user.tenant_id,
        coalesce(nullif(btrim(v_user.full_name), ''), 'مستخدم داخلي'),
        nullif(btrim(v_user.phone), ''), nullif(btrim(v_user.phone), ''),
        nullif(btrim(v_user.email), ''), 'person', false, false, 0, 0, 0, true
      ) returning id into v_employee_partner;

      update public.tenant_users
      set partner_id = v_employee_partner, updated_at = now()
      where id = v_user.id;
    elsif not exists (
      select 1 from public.partners partner
      where partner.id = v_employee_partner
        and partner.tenant_id = v_user.tenant_id
        and partner.active = true
    ) then
      raise exception 'الملف المالي للمستخدم الحالي غير موجود أو غير نشط.';
    end if;
  end if;
  if v_sale.status = 'confirmed' and v_sale.account_move_id is not null then
    return jsonb_build_object('success', true, 'already_completed', true, 'sale_id', v_sale.id,
      'sale_account_move_id', v_sale.account_move_id, 'cash_move_id', null, 'advance_move_ids', '[]'::jsonb,
      'total_amount', v_sale.total_amount, 'paid_amount', v_sale.paid_amount,
      'remaining_amount', v_sale.remaining_amount, 'status', v_sale.status);
  end if;
  if v_sale.status <> 'pending_payment' then raise exception 'الفاتورة لم تعد معلقة على الدفع.'; end if;
  if v_sale.customer_id is null then raise exception 'الفاتورة غير مرتبطة بعميل.'; end if;
  if v_sale.account_move_id is not null then raise exception 'الفاتورة مرتبطة بقيد محاسبي مسبقًا.'; end if;

  select round(coalesce(sum(sl.total), 0), 2), count(*) into v_total, v_account_count
  from public.showroom_sale_lines sl where sl.tenant_id = v_sale.tenant_id and sl.sale_id = v_sale.id;
  if v_account_count = 0 or v_total <= 0 then raise exception 'الفاتورة لا تحتوي على سطور بيع صالحة.'; end if;

  if coalesce(p_cash_amount, 0) < 0 then raise exception 'مبلغ الكاش لا يمكن أن يكون سالبًا.'; end if;
  if p_advance_payments is null or jsonb_typeof(p_advance_payments) <> 'array' then
    raise exception 'بيانات دفعات الجهات غير صحيحة.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_advance_payments) x
    group by x ->> 'financier_partner_id' having count(*) > 1) then
    raise exception 'لا يمكن تكرار نفس جهة الدفع.';
  end if;
  select round(coalesce(sum(nullif(x ->> 'amount', '')::numeric), 0), 2) into v_advance_total
  from jsonb_array_elements(p_advance_payments) x;
  if exists (select 1 from jsonb_array_elements(p_advance_payments) x
    where nullif(x ->> 'financier_partner_id', '') is null
       or coalesce(nullif(x ->> 'amount', '')::numeric, 0) <= 0) then
    raise exception 'كل دفعة جهة يجب أن تحتوي على جهة ومبلغ صحيح.';
  end if;
  v_paid := round(v_cash + v_advance_total, 2);
  if v_paid > v_total then raise exception 'إجمالي الدفعات يتجاوز قيمة الفاتورة.'; end if;
  v_remaining := round(v_total - v_paid, 2);

  select coalesce(v_sale.branch_id, sc.branch_id) into v_branch_id
  from public.showroom_configs sc where sc.id = v_sale.showroom_config_id and sc.tenant_id = v_sale.tenant_id;

  select count(*) into v_account_count from public.account_accounts where tenant_id=v_sale.tenant_id and code='114001' and active=true;
  if v_account_count <> 1 then raise exception 'حساب 114001 غير موجود مرة واحدة داخل الشركة.'; end if;
  select id into v_receivable_account from public.account_accounts where tenant_id=v_sale.tenant_id and code='114001' and active=true;
  select count(*) into v_account_count from public.account_accounts where tenant_id=v_sale.tenant_id and code='411000' and active=true;
  if v_account_count <> 1 then raise exception 'حساب 411000 غير موجود مرة واحدة داخل الشركة.'; end if;
  select id into v_income_account from public.account_accounts where tenant_id=v_sale.tenant_id and code='411000' and active=true;
  if v_cash > 0 then
    select count(*) into v_account_count
    from public.account_accounts aa
    where aa.tenant_id = v_sale.tenant_id
      and aa.responsible_user_id = v_user.id
      and aa.active = true
      and aa.group_id in (
        select parent_account.group_id
        from public.account_accounts parent_account
        where parent_account.tenant_id = v_sale.tenant_id
          and (parent_account.code::text = '111003' or parent_account.name = 'نقدية لدى الموظفين')
          and parent_account.group_id is not null
      );
    if v_account_count = 0 then raise exception 'لا يوجد حساب عهدة نشط للموظف الحالي.'; end if;
    if v_account_count > 1 then raise exception 'يوجد أكثر من حساب عهدة نشط للموظف الحالي.'; end if;
    select aa.id into v_cash_account
    from public.account_accounts aa
    where aa.tenant_id = v_sale.tenant_id
      and aa.responsible_user_id = v_user.id
      and aa.active = true
      and aa.group_id in (
        select parent_account.group_id
        from public.account_accounts parent_account
        where parent_account.tenant_id = v_sale.tenant_id
          and (parent_account.code::text = '111003' or parent_account.name = 'نقدية لدى الموظفين')
          and parent_account.group_id is not null
      )
    limit 1;
  end if;
  if v_advance_total > 0 then
    select count(*) into v_account_count from public.account_accounts where tenant_id=v_sale.tenant_id and code='212001' and active=true;
    if v_account_count <> 1 then raise exception 'حساب 212001 غير موجود مرة واحدة داخل الشركة.'; end if;
    select id into v_advance_account from public.account_accounts where tenant_id=v_sale.tenant_id and code='212001' and active=true;
    select count(*) into v_account_count from public.account_accounts where tenant_id=v_sale.tenant_id and code='114002' and active=true;
    if v_account_count <> 1 then raise exception 'حساب 114002 غير موجود مرة واحدة داخل الشركة.'; end if;
    select id into v_entity_account from public.account_accounts where tenant_id=v_sale.tenant_id and code='114002' and active=true;
    perform pg_advisory_xact_lock(hashtext(v_sale.tenant_id::text || ':' || v_sale.customer_id::text));
  end if;

  insert into public.account_moves (id,tenant_id,branch_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,notes,currency_code,created_by,journal_id,payment_id)
  values (v_sale_move_id,v_sale.tenant_id,v_branch_id,'SHOWROOM-SALE-'||upper(substr(replace(v_sale.id::text,'-',''),1,12)),'sale',v_sale.customer_id,v_sale.sale_date,now(),v_total,'posted','showroom_sale:'||v_sale.id,v_sale.notes,'EGP',v_user.id,null,null);
  insert into public.account_move_lines (id,tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
  values
    (v_invoice_receivable_line_id,v_sale.tenant_id,v_sale_move_id,v_receivable_account,v_sale.customer_id,'ذمم فاتورة شو روم',1,v_total,v_total,0,'receivable',false,v_total,v_total,'posted','EGP',v_user.id),
    (gen_random_uuid(),v_sale.tenant_id,v_sale_move_id,v_income_account,null,'إيراد فاتورة شو روم',1,v_total,0,v_total,'income',true,0,0,'posted','EGP',v_user.id);

  if v_cash > 0 then
    v_cash_move_id := gen_random_uuid(); v_payment_receivable_line_id := gen_random_uuid();
    insert into public.account_moves (id,tenant_id,branch_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,notes,pay_method,currency_code,created_by,journal_id,payment_id)
    values (v_cash_move_id,v_sale.tenant_id,v_branch_id,'SHOWROOM-CASH-'||upper(substr(replace(v_cash_move_id::text,'-',''),1,12)),'payment',v_sale.customer_id,current_date,now(),v_cash,'posted','showroom_sale:'||v_sale.id,nullif(trim(coalesce(p_cash_note,'')),''),'cash','EGP',v_user.id,null,null);
    insert into public.account_move_lines (id,tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
    values
      (gen_random_uuid(),v_sale.tenant_id,v_cash_move_id,v_cash_account,v_employee_partner,'تحصيل نقدي لدى الموظف '||v_user.full_name,1,v_cash,v_cash,0,'liquidity',true,0,0,'posted','EGP',v_user.id),
      (v_payment_receivable_line_id,v_sale.tenant_id,v_cash_move_id,v_receivable_account,v_sale.customer_id,'تسوية نقدية لذمم العميل',1,v_cash,0,v_cash,'receivable',true,0,0,'posted','EGP',v_user.id);
    insert into public.account_partial_reconcile (tenant_id,debit_move_id,credit_move_id,amount,max_date,created_by)
    values (v_sale.tenant_id,v_invoice_receivable_line_id,v_payment_receivable_line_id,v_cash,current_date,v_user.id);
    v_applied := v_cash;
  end if;

  for v_item in select value from jsonb_array_elements(p_advance_payments) loop
    v_entity_id := nullif(v_item->>'financier_partner_id','')::uuid;
    v_amount := round((v_item->>'amount')::numeric,2);
    v_note := nullif(trim(coalesce(v_item->>'note','')),'');
    select name into v_entity_name from public.partners where id=v_entity_id and tenant_id=v_sale.tenant_id and active=true;
    if v_entity_name is null then raise exception 'جهة الدفع المحددة غير موجودة أو غير نشطة.'; end if;

    select round(coalesce((select sum(aml.debit-aml.credit) from public.account_move_lines aml join public.account_moves am on am.id=aml.move_id
      where aml.tenant_id=v_sale.tenant_id and aml.account_id=v_entity_account and aml.partner_id=v_entity_id
        and am.partner_id=v_sale.customer_id and am.state='posted'),0)
      - coalesce((select sum(aml.debit) from public.account_move_lines aml join public.account_moves am on am.id=aml.move_id
      where aml.tenant_id=v_sale.tenant_id and aml.account_id=v_advance_account and aml.partner_id=v_sale.customer_id
        and am.partner_id=v_entity_id and am.pay_method='advance_credit' and am.state='posted'),0),2) into v_available;
    if v_amount > v_available then raise exception 'رصيد العميل لدى الجهة % غير كافٍ. المتاح % والمطلوب %.',v_entity_name,v_available,v_amount; end if;

    v_move_id := gen_random_uuid(); v_payment_receivable_line_id := gen_random_uuid();
    insert into public.account_moves (id,tenant_id,branch_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,notes,pay_method,currency_code,created_by,journal_id,payment_id)
    values (v_move_id,v_sale.tenant_id,v_branch_id,'SHOWROOM-ADV-'||upper(substr(replace(v_move_id::text,'-',''),1,12)),'payment',v_entity_id,current_date,now(),v_amount,'posted','showroom_sale:'||v_sale.id,v_note,'advance_credit','EGP',v_user.id,null,null);
    insert into public.account_move_lines (id,tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
    values
      (gen_random_uuid(),v_sale.tenant_id,v_move_id,v_advance_account,v_sale.customer_id,'استخدام دفعة مقدمة للعميل',1,v_amount,v_amount,0,'payable',true,0,0,'posted','EGP',v_user.id),
      (v_payment_receivable_line_id,v_sale.tenant_id,v_move_id,v_receivable_account,v_sale.customer_id,'تسوية رصيد مسبق مع فاتورة العميل',1,v_amount,0,v_amount,'receivable',true,0,0,'posted','EGP',v_user.id);
    insert into public.account_partial_reconcile (tenant_id,debit_move_id,credit_move_id,amount,max_date,created_by)
    values (v_sale.tenant_id,v_invoice_receivable_line_id,v_payment_receivable_line_id,v_amount,current_date,v_user.id);
    v_applied := v_applied + v_amount;
    v_advance_move_ids := v_advance_move_ids || jsonb_build_array(v_move_id);
  end loop;

  update public.account_move_lines set amount_residual=v_remaining,amount_residual_currency=v_remaining,is_reconciled=(v_remaining=0)
  where id=v_invoice_receivable_line_id;

  select exists(select 1 from public.tenant_modules tm join public.ir_modules im on im.id=tm.module_id
    where tm.tenant_id=v_sale.tenant_id and tm.state='installed' and im.technical_name='inventory') into v_inventory_active;
  if exists (
    select 1 from public.showroom_sale_lines sl
    left join public.product_products pp on pp.id=sl.product_product_id and pp.tenant_id=sl.tenant_id
    where sl.tenant_id=v_sale.tenant_id and sl.sale_id=v_sale.id and pp.id is null
  ) then raise exception 'أحد منتجات الفاتورة غير موجود داخل الشركة.'; end if;
  for v_line in
      select sl.*,pp.tracking,pp.product_template_id,pt.product_type
      from public.showroom_sale_lines sl join public.product_products pp on pp.id=sl.product_product_id and pp.tenant_id=sl.tenant_id
      join public.product_templates pt on pt.id=pp.product_template_id and pt.tenant_id=sl.tenant_id
      where sl.tenant_id=v_sale.tenant_id and sl.sale_id=v_sale.id
    loop
      if v_line.tracking='serial' then
        if v_line.tracking_unit_id is null then raise exception 'سطر المنتج المسلسل غير مرتبط بوحدة تتبع.'; end if;
        select * into v_unit from public.stock_tracking_units where id=v_line.tracking_unit_id and tenant_id=v_sale.tenant_id for update;
        if v_unit.id is null or v_unit.status<>'reserved' or v_unit.notes<>('showroom_sale:'||v_sale.id) then
          raise exception 'وحدة التتبع غير محجوزة لهذه الفاتورة.';
        end if;
        update public.stock_tracking_units set status='sold',updated_at=now() where id=v_unit.id;
      end if;
      if v_inventory_active and v_line.product_type<>'service' then
        insert into public.stock_moves (tenant_id,product_product_id,product_template_id,move_type,quantity,unit_price,reference_type,reference_id,notes,created_by)
        values (v_sale.tenant_id,v_line.product_product_id,v_line.product_template_id,'out',v_line.quantity,v_line.unit_price,'showroom_sale',v_sale.id,'showroom_sale:'||v_sale.id,v_user.id);
        if v_line.tracking<>'serial' then
          select * into v_quant from public.stock_quants where tenant_id=v_sale.tenant_id and product_product_id=v_line.product_product_id limit 1 for update;
          if v_quant.id is null then
            insert into public.stock_quants (tenant_id,product_product_id,product_template_id,quantity_on_hand)
            values (v_sale.tenant_id,v_line.product_product_id,v_line.product_template_id,-v_line.quantity);
          else
            update public.stock_quants set quantity_on_hand=quantity_on_hand-v_line.quantity,updated_at=now() where id=v_quant.id;
          end if;
        end if;
      end if;
  end loop;

  update public.showroom_sales set total_amount=v_total,paid_amount=v_paid,remaining_amount=v_remaining,
    account_move_id=v_sale_move_id,status='confirmed',updated_at=now() where id=v_sale.id;
  return jsonb_build_object('success',true,'already_completed',false,'sale_id',v_sale.id,
    'sale_account_move_id',v_sale_move_id,'cash_move_id',v_cash_move_id,'advance_move_ids',v_advance_move_ids,
    'total_amount',v_total,'paid_amount',v_paid,'remaining_amount',v_remaining,'status','confirmed');
end;
$$;

grant execute on function public.complete_showroom_sale(uuid,numeric,text,jsonb) to authenticated;

commit;
begin;

create or replace function public.pay_showroom_sale_accounting(
  p_sale_id uuid,
  p_amount numeric,
  p_notes text default null,
  p_payment_method text default 'cash'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user public.tenant_users%rowtype;
  v_sale public.showroom_sales%rowtype;
  v_sale_move_id uuid;
  v_receivable_account_id uuid;
  v_cash_account_id uuid;
  v_employee_partner_id uuid;
  v_invoice_line_id uuid;
  v_payment_move_id uuid := gen_random_uuid();
  v_payment_receivable_line_id uuid := gen_random_uuid();
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_paid numeric := 0;
  v_remaining numeric := 0;
  v_branch_id uuid;
  v_cash_account_count integer := 0;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولاً.'; end if;
  if v_amount <= 0 then raise exception 'مبلغ الدفعة يجب أن يكون أكبر من صفر.'; end if;

  select * into v_sale from public.showroom_sales where id = p_sale_id for update;
  if v_sale.id is null then raise exception 'فاتورة الشو روم غير موجودة.'; end if;
  if v_sale.status <> 'confirmed' then raise exception 'لا يمكن دفع فاتورة غير مؤكدة.'; end if;

  select tu.* into v_user
  from public.tenant_users tu
  where tu.auth_user_id = auth.uid()
    and tu.tenant_id = v_sale.tenant_id
    and coalesce(tu.is_active, true) = true
  order by tu.created_at
  limit 1
  for update;
  if v_user.id is null then raise exception 'لا تملك صلاحية تسجيل دفعة لهذه الفاتورة.'; end if;

  v_employee_partner_id := v_user.partner_id;
  if v_employee_partner_id is null then
    insert into public.partners (
      tenant_id, name, phone1, mobile, email, contact_type, is_company,
      is_external_contact, customer_rank, supplier_rank, financer_rank, active
    ) values (
      v_user.tenant_id,
      coalesce(nullif(btrim(v_user.full_name), ''), 'مستخدم داخلي'),
      nullif(btrim(v_user.phone), ''), nullif(btrim(v_user.phone), ''),
      nullif(btrim(v_user.email), ''), 'person', false, false, 0, 0, 0, true
    ) returning id into v_employee_partner_id;

    update public.tenant_users
    set partner_id = v_employee_partner_id, updated_at = now()
    where id = v_user.id;
  elsif not exists (
    select 1 from public.partners partner
    where partner.id = v_employee_partner_id
      and partner.tenant_id = v_user.tenant_id
      and partner.active = true
  ) then
    raise exception 'الملف المالي للمستخدم الحالي غير موجود أو غير نشط.';
  end if;

  select am.id into v_sale_move_id
  from public.account_moves am
  where am.tenant_id = v_sale.tenant_id
    and am.move_type = 'sale'
    and am.state = 'posted'
    and (am.id = v_sale.account_move_id or am.ref = 'showroom_sale:' || v_sale.id)
  order by case when am.id = v_sale.account_move_id then 0 else 1 end, am.created_at
  limit 1;
  if v_sale_move_id is null then raise exception 'لا يوجد قيد بيع مرحل مرتبط بالفاتورة.'; end if;

  select aa.id into v_receivable_account_id
  from public.account_accounts aa
  where aa.tenant_id = v_sale.tenant_id and aa.code = '114001' and aa.active = true;
  if v_receivable_account_id is null then raise exception 'حساب الذمم 114001 غير موجود.'; end if;

  select count(*) into v_cash_account_count
  from public.account_accounts aa
  where aa.tenant_id = v_sale.tenant_id
    and aa.responsible_user_id = v_user.id
    and aa.active = true
    and aa.group_id in (
      select parent_account.group_id
      from public.account_accounts parent_account
      where parent_account.tenant_id = v_sale.tenant_id
        and (parent_account.code::text = '111003' or parent_account.name = 'نقدية لدى الموظفين')
        and parent_account.group_id is not null
    );
  if v_cash_account_count = 0 then raise exception 'لا يوجد حساب عهدة نشط للموظف الحالي.'; end if;
  if v_cash_account_count > 1 then raise exception 'يوجد أكثر من حساب عهدة نشط للموظف الحالي.'; end if;

  select aa.id into v_cash_account_id
  from public.account_accounts aa
  where aa.tenant_id = v_sale.tenant_id
    and aa.responsible_user_id = v_user.id
    and aa.active = true
    and aa.group_id in (
      select parent_account.group_id
      from public.account_accounts parent_account
      where parent_account.tenant_id = v_sale.tenant_id
        and (parent_account.code::text = '111003' or parent_account.name = 'نقدية لدى الموظفين')
        and parent_account.group_id is not null
    )
  limit 1;

  select aml.id into v_invoice_line_id
  from public.account_move_lines aml
  where aml.tenant_id = v_sale.tenant_id
    and aml.move_id = v_sale_move_id
    and aml.account_id = v_receivable_account_id
    and aml.debit > 0
  order by aml.debit desc
  limit 1
  for update;
  if v_invoice_line_id is null then raise exception 'قيد الفاتورة لا يحتوي على سطر ذمم مدين.'; end if;

  select round(coalesce(sum(apr.amount), 0), 2) into v_paid
  from public.account_move_lines aml
  left join public.account_partial_reconcile apr
    on apr.tenant_id = aml.tenant_id and apr.debit_move_id = aml.id
  where aml.tenant_id = v_sale.tenant_id
    and aml.move_id = v_sale_move_id
    and aml.account_id = v_receivable_account_id
    and aml.debit > 0;

  v_remaining := round(greatest(coalesce(v_sale.total_amount, 0) - v_paid, 0), 2);
  if v_remaining <= 0 then raise exception 'الفاتورة مدفوعة بالكامل محاسبيًا.'; end if;
  if v_amount > v_remaining then raise exception 'مبلغ الدفعة أكبر من المتبقي المحاسبي %.', v_remaining; end if;

  select coalesce(v_sale.branch_id, sc.branch_id) into v_branch_id
  from public.showroom_configs sc
  where sc.id = v_sale.showroom_config_id and sc.tenant_id = v_sale.tenant_id;

  insert into public.account_moves (
    id, tenant_id, branch_id, name, move_type, partner_id, invoice_date, date,
    amount_total, state, ref, notes, pay_method, currency_code, created_by
  ) values (
    v_payment_move_id, v_sale.tenant_id, v_branch_id,
    'SHOWROOM-CASH-' || upper(substr(replace(v_payment_move_id::text, '-', ''), 1, 12)),
    'payment', v_sale.customer_id, current_date, now(), v_amount, 'posted',
    'showroom_sale:' || v_sale.id, nullif(trim(coalesce(p_notes, '')), ''),
    coalesce(nullif(trim(p_payment_method), ''), 'cash'), 'EGP', v_user.id
  );

  insert into public.account_move_lines (
    id, tenant_id, move_id, account_id, partner_id, label, quantity, unit_price,
    debit, credit, line_type, is_reconciled, amount_residual,
    amount_residual_currency, parent_state, currency_code, created_by
  ) values
    (gen_random_uuid(), v_sale.tenant_id, v_payment_move_id, v_cash_account_id, v_employee_partner_id,
     'تحصيل نقدي لدى الموظف ' || v_user.full_name, 1, v_amount, v_amount, 0, 'liquidity', true, 0, 0, 'posted', 'EGP', v_user.id),
    (v_payment_receivable_line_id, v_sale.tenant_id, v_payment_move_id, v_receivable_account_id, v_sale.customer_id,
     'تسوية نقدية لذمم العميل', 1, v_amount, 0, v_amount, 'receivable', true, 0, 0, 'posted', 'EGP', v_user.id);

  insert into public.account_partial_reconcile (
    tenant_id, debit_move_id, credit_move_id, amount, max_date, created_by
  ) values (
    v_sale.tenant_id, v_invoice_line_id, v_payment_receivable_line_id, v_amount, current_date, v_user.id
  );

  v_paid := round(v_paid + v_amount, 2);
  v_remaining := round(greatest(v_sale.total_amount - v_paid, 0), 2);

  update public.account_move_lines
  set amount_residual = v_remaining,
      amount_residual_currency = v_remaining,
      is_reconciled = (v_remaining = 0)
  where id = v_invoice_line_id;

  update public.showroom_sales
  set account_move_id = v_sale_move_id,
      paid_amount = v_paid,
      remaining_amount = v_remaining,
      updated_at = now()
  where id = v_sale.id;

  return jsonb_build_object(
    'success', true,
    'sale_id', v_sale.id,
    'payment_move_id', v_payment_move_id,
    'paid_amount', v_paid,
    'remaining_amount', v_remaining
  );
end;
$$;

grant execute on function public.pay_showroom_sale_accounting(uuid, numeric, text, text) to authenticated;

commit;
