begin;

create or replace function public.preview_confirmed_showroom_sale_return(p_tenant_id uuid,p_sale_id uuid,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_sale public.showroom_sales%rowtype; v_item jsonb; v_line public.showroom_sale_lines%rowtype; v_new public.stock_tracking_units%rowtype;
  v_available numeric; v_quantity numeric; v_return_total numeric:=0; v_replacement_total numeric:=0; v_line_amount numeric; v_rows jsonb:='[]'::jsonb;
  v_request_count integer; v_request public.paperwork_requests%rowtype; v_operation_type text;
begin
  if auth.uid() is null or not public.is_tenant_owner(p_tenant_id) then raise exception 'المعاينة متاحة لمالك الشركة فقط.'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'يجب اختيار سطر واحد على الأقل.'; end if;
  select * into v_sale from public.showroom_sales where tenant_id=p_tenant_id and id=p_sale_id;
  if v_sale.id is null or v_sale.status<>'confirmed' or v_sale.account_move_id is null then raise exception 'العملية متاحة لفاتورة مؤكدة ومرحلة محاسبيًا فقط.'; end if;
  if (select count(*) from jsonb_array_elements(p_lines))<>(select count(distinct value->>'sale_line_id') from jsonb_array_elements(p_lines)) then raise exception 'لا يمكن اختيار السطر أكثر من مرة.'; end if;
  if (select count(*) from jsonb_array_elements(p_lines) where value->>'action'='exchange')=0 then v_operation_type:='return';
  elsif (select count(*) from jsonb_array_elements(p_lines) where value->>'action'='return')=0 then v_operation_type:='exchange'; else v_operation_type:='mixed'; end if;
  for v_item in select value from jsonb_array_elements(p_lines) loop
    v_quantity:=nullif(v_item->>'quantity','')::numeric;
    if v_item->>'action' not in('return','exchange') or v_quantity is null or v_quantity<=0 then raise exception 'بيانات أحد السطور غير صالحة.'; end if;
    select * into v_line from public.showroom_sale_lines where tenant_id=p_tenant_id and sale_id=p_sale_id and id=(v_item->>'sale_line_id')::uuid;
    if v_line.id is null then raise exception 'أحد السطور لا يخص الفاتورة.'; end if;
    select v_line.quantity-coalesce(sum(rl.quantity),0) into v_available from public.showroom_sale_return_lines rl
      join public.showroom_sale_return_operations ro on ro.id=rl.return_operation_id and ro.status in('confirmed','completed')
      where rl.tenant_id=p_tenant_id and rl.original_sale_line_id=v_line.id;
    v_available:=coalesce(v_available,v_line.quantity);
    if v_quantity>v_available then raise exception 'الكمية المطلوبة أكبر من المتاح.'; end if;
    select count(*) into v_request_count from public.paperwork_requests where tenant_id=p_tenant_id and status<>'cancelled'
      and sale_id=p_sale_id and sale_line_id=v_line.id and tracking_unit_id is not distinct from v_line.tracking_unit_id;
    if v_request_count>1 then raise exception 'يوجد تعارض في طلبات أوراق أحد السطور.'; end if;
    select * into v_request from public.paperwork_requests where tenant_id=p_tenant_id and status<>'cancelled'
      and sale_id=p_sale_id and sale_line_id=v_line.id and tracking_unit_id is not distinct from v_line.tracking_unit_id;
    if v_request.status='done' or v_request.current_stage in('received_from_processor','client_notified','delivered') or exists(
      select 1 from public.paperwork_documents d where d.tenant_id=p_tenant_id and d.cancelled_at is null
        and d.status in('in_custody','available','delivered','delivered_to_customer','out') and (d.paperwork_request_id=v_request.id or d.tracking_unit_id=v_line.tracking_unit_id)
    ) then raise exception 'لا يمكن إرجاع هذه القطعة لأن جواب الأوراق تم استخراجه أو استلامه بالفعل.'; end if;
    v_line_amount:=round((v_line.total/nullif(v_line.quantity,0))*v_quantity,2); v_return_total:=v_return_total+v_line_amount;
    if v_item->>'action'='exchange' then
      if v_quantity<>1 or nullif(v_item->>'new_tracking_unit_id','') is null then raise exception 'البديل يتطلب وحدة واحدة صالحة.'; end if;
      select * into v_new from public.stock_tracking_units where tenant_id=p_tenant_id and id=(v_item->>'new_tracking_unit_id')::uuid;
      if v_new.id is null or v_new.status<>'in_stock' or coalesce(v_new.data_status,'complete')<>'complete' then raise exception 'القطعة البديلة غير متاحة.'; end if;
      v_replacement_total:=v_replacement_total+coalesce((select round(sale_price,2) from public.product_products where tenant_id=p_tenant_id and id=v_new.product_product_id and is_active),0);
    end if;
    v_rows:=v_rows||jsonb_build_array(jsonb_build_object('sale_line_id',v_line.id,'available_quantity',v_available,'return_amount',v_line_amount,
      'paperwork_effect',case when v_request.id is null then 'none' when v_request.current_stage='pending_processor_cancellation' then 'pending_processor_cancellation' when v_request.current_stage in('sent_to_processor','processor_ready') then 'requires_processor_cancellation' else 'cancel_directly' end));
  end loop;
  return jsonb_build_object('operation_type',v_operation_type,'total_return_amount',v_return_total,'total_replacement_amount',v_replacement_total,
    'price_difference',v_replacement_total-v_return_total,'lines',v_rows);
end $$;
revoke all on function public.preview_confirmed_showroom_sale_return(uuid,uuid,jsonb) from public,anon;
grant execute on function public.preview_confirmed_showroom_sale_return(uuid,uuid,jsonb) to authenticated;

create or replace function public.create_confirmed_showroom_sale_return(
  p_tenant_id uuid,p_sale_id uuid,p_lines jsonb,p_reason_code text,p_reason text,p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_user public.tenant_users%rowtype; v_sale public.showroom_sales%rowtype; v_item jsonb; v_line public.showroom_sale_lines%rowtype;
  v_old public.stock_tracking_units%rowtype; v_new public.stock_tracking_units%rowtype; v_request public.paperwork_requests%rowtype;
  v_operation_id uuid:=gen_random_uuid(); v_credit_id uuid:=gen_random_uuid(); v_replacement_sale_id uuid; v_replacement_invoice_id uuid;
  v_receivable_id uuid; v_income_id uuid; v_credit_receivable_id uuid:=gen_random_uuid(); v_original_receivable public.account_move_lines%rowtype;
  v_operation_type text; v_action text; v_quantity numeric; v_available numeric; v_return_unit_price numeric; v_replacement_unit_price numeric;
  v_return_total numeric:=0; v_replacement_total numeric:=0;
  v_original_residual numeric; v_credit_remaining numeric; v_apply numeric; v_new_receivable_id uuid; v_now timestamptz:=clock_timestamp();
  v_result_lines jsonb:='[]'::jsonb; v_return_line_id uuid; v_return_move_id uuid; v_out_move_id uuid; v_replacement_line_id uuid; v_new_request_id uuid;
  v_product_template_id uuid;
  v_product_type text; v_tracking text; v_quant public.stock_quants%rowtype; v_currency text; v_account_count integer; v_request_count integer;
  v_existing public.showroom_sale_return_operations%rowtype;
  v_request_result jsonb;
begin
  if auth.uid() is null then raise exception 'يجب تسجيل الدخول أولًا.'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'يجب اختيار سطر واحد على الأقل.'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'سبب المرتجع أو الاستبدال إلزامي.'; end if;
  if p_idempotency_key is null then raise exception 'مفتاح منع التكرار إلزامي.'; end if;
  if p_reason_code not in('customer_request','product_defect','selection_error','invoice_or_delivery_error','specification_mismatch','other') then raise exception 'سبب العملية غير صالح.'; end if;
  select * into v_user from public.tenant_users where tenant_id=p_tenant_id and auth_user_id=auth.uid() and is_active limit 1;
  if v_user.id is null or not public.is_tenant_owner(p_tenant_id) then raise exception 'المرتجع أو الاستبدال متاح لمالك الشركة فقط.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant_id::text||':sale-return:'||p_sale_id::text,0));
  select * into v_existing from public.showroom_sale_return_operations where tenant_id=p_tenant_id and idempotency_key=p_idempotency_key;
  if v_existing.id is not null then
    if v_existing.original_sale_id<>p_sale_id or v_existing.request_payload<>jsonb_build_object('lines',p_lines,'reason_code',p_reason_code,'reason',btrim(p_reason)) then
      raise exception 'مفتاح منع التكرار مستخدم مسبقًا لطلب مختلف.';
    end if;
    return jsonb_build_object('return_operation_id',v_existing.id,'operation_type',v_existing.operation_type,'credit_note_move_id',v_existing.credit_note_move_id,
      'replacement_sale_id',v_existing.replacement_sale_id,'replacement_invoice_move_id',v_existing.replacement_invoice_move_id,
      'total_return_amount',v_existing.total_return_amount,'total_replacement_amount',v_existing.total_replacement_amount,
      'price_difference',v_existing.price_difference,'status',v_existing.status,'idempotent_replay',true);
  end if;
  perform public.preview_confirmed_showroom_sale_return(p_tenant_id,p_sale_id,p_lines);
  select * into v_sale from public.showroom_sales where tenant_id=p_tenant_id and id=p_sale_id for update;
  if v_sale.id is null or v_sale.status<>'confirmed' or v_sale.account_move_id is null then raise exception 'العملية متاحة لفاتورة مؤكدة ومرحلة محاسبيًا فقط.'; end if;
  if not exists(select 1 from public.account_moves where tenant_id=p_tenant_id and id=v_sale.account_move_id and state='posted' and move_type='sale') then raise exception 'القيد الأصلي غير موجود أو غير مرحل.'; end if;
  if (select count(*) from jsonb_array_elements(p_lines))<>(select count(distinct value->>'sale_line_id') from jsonb_array_elements(p_lines)) then raise exception 'لا يمكن اختيار سطر الفاتورة أكثر من مرة.'; end if;
  if (select count(*) from jsonb_array_elements(p_lines) where value->>'action'='exchange')=0 then v_operation_type:='return';
  elsif (select count(*) from jsonb_array_elements(p_lines) where value->>'action'='return')=0 then v_operation_type:='exchange'; else v_operation_type:='mixed'; end if;
  select count(*) into v_account_count from public.account_accounts where tenant_id=p_tenant_id and code='114001' and active and reconcile;
  if v_account_count<>1 then raise exception 'يجب وجود حساب ذمم 114001 نشط وقابل للتسوية مرة واحدة فقط.'; end if;
  select id into v_receivable_id from public.account_accounts where tenant_id=p_tenant_id and code='114001' and active and reconcile;
  select count(*) into v_account_count from public.account_accounts where tenant_id=p_tenant_id and code='411000' and active;
  if v_account_count<>1 then raise exception 'يجب وجود حساب إيراد 411000 نشط مرة واحدة فقط.'; end if;
  select id into v_income_id from public.account_accounts where tenant_id=p_tenant_id and code='411000' and active;
  select currency_code into v_currency from public.account_moves where tenant_id=p_tenant_id and id=v_sale.account_move_id;
  if nullif(v_currency,'') is null then raise exception 'عملة الفاتورة الأصلية غير محددة.'; end if;

  insert into public.showroom_sale_return_operations(id,tenant_id,branch_id,customer_id,original_sale_id,idempotency_key,request_payload,operation_type,status,reason_code,reason,created_by)
  values(v_operation_id,p_tenant_id,v_sale.branch_id,v_sale.customer_id,v_sale.id,p_idempotency_key,jsonb_build_object('lines',p_lines,'reason_code',p_reason_code,'reason',btrim(p_reason)),v_operation_type,'draft',p_reason_code,btrim(p_reason),v_user.id);

  for v_item in select value from jsonb_array_elements(p_lines) loop
    v_action:=v_item->>'action'; v_quantity:=(v_item->>'quantity')::numeric;
    if v_action not in('return','exchange') or v_quantity is null or v_quantity<=0 then raise exception 'بيانات أحد سطور العملية غير صالحة.'; end if;
    select * into v_line from public.showroom_sale_lines where tenant_id=p_tenant_id and sale_id=p_sale_id and id=(v_item->>'sale_line_id')::uuid for update;
    if v_line.id is null then raise exception 'أحد السطور لا يخص الفاتورة الأصلية.'; end if;
    select p.product_template_id,p.tracking,t.product_type into v_product_template_id,v_tracking,v_product_type
      from public.product_products p join public.product_templates t on t.id=p.product_template_id and t.tenant_id=p.tenant_id
      where p.tenant_id=p_tenant_id and p.id=v_line.product_product_id;
    if v_product_template_id is null then raise exception 'منتج أحد السطور غير موجود داخل الشركة.'; end if;
    select v_line.quantity-coalesce(sum(rl.quantity) filter(where ro.status<>'cancelled'),0) into v_available
      from public.showroom_sale_return_lines rl join public.showroom_sale_return_operations ro on ro.id=rl.return_operation_id and ro.tenant_id=rl.tenant_id
      where rl.tenant_id=p_tenant_id and rl.original_sale_line_id=v_line.id and ro.status in('confirmed','completed');
    v_available:=coalesce(v_available,v_line.quantity);
    if v_quantity>v_available then raise exception 'الكمية المرتجعة أكبر من الكمية المتاحة.'; end if;
    if v_tracking='serial' and (v_line.tracking_unit_id is null or v_quantity<>1) then raise exception 'سطر المنتج المسلسل يجب أن يرتبط بوحدة واحدة وكمية مرتجعة تساوي واحدًا.'; end if;
    if v_tracking='serial' then
      select * into v_old from public.stock_tracking_units where tenant_id=p_tenant_id and id=v_line.tracking_unit_id for update;
      if v_old.id is null or v_old.status<>'sold' or v_old.product_product_id<>v_line.product_product_id then raise exception 'وحدة التتبع لا تخص سطر البيع الأصلي أو ليست في حيازة العميل.'; end if;
    else v_old:=null; end if;
    select count(*) into v_request_count from public.paperwork_requests where tenant_id=p_tenant_id and status<>'cancelled'
      and sale_id=v_sale.id and sale_line_id=v_line.id and tracking_unit_id is not distinct from v_line.tracking_unit_id;
    if v_request_count>1 then raise exception 'يوجد أكثر من طلب أوراق نشط مرتبط بالسطر أو وحدة التتبع ويجب مراجعته قبل المرتجع.'; end if;
    select * into v_request from public.paperwork_requests where tenant_id=p_tenant_id and status<>'cancelled'
      and sale_id=v_sale.id and sale_line_id=v_line.id and tracking_unit_id is not distinct from v_line.tracking_unit_id for update;
    if v_request.id is not null and (v_request.status='done' or v_request.current_stage in('received_from_processor','client_notified','delivered'))
      or exists(select 1 from public.paperwork_documents d where d.tenant_id=p_tenant_id and d.cancelled_at is null
        and d.status in('in_custody','available','delivered','delivered_to_customer','out')
        and (d.paperwork_request_id=v_request.id or d.tracking_unit_id=v_line.tracking_unit_id)) then
      raise exception 'لا يمكن إرجاع هذه القطعة لأن جواب الأوراق تم استخراجه أو استلامه بالفعل. يلزم إجراء استثنائي مستقل.';
    end if;
    v_return_unit_price:=round(v_line.total/nullif(v_line.quantity,0),2);
    v_replacement_unit_price:=null;
    v_return_total:=v_return_total+round(v_return_unit_price*v_quantity,2);
    v_return_line_id:=gen_random_uuid(); v_return_move_id:=gen_random_uuid(); v_replacement_line_id:=null; v_out_move_id:=null; v_new_request_id:=null; v_new:=null;
    if v_action='exchange' then
      if v_quantity<>1 then raise exception 'استبدال وحدة تتبع بديلة واحدة يتطلب كمية مرتجعة تساوي واحدًا.'; end if;
      if nullif(v_item->>'new_tracking_unit_id','') is null then raise exception 'يجب اختيار قطعة بديلة لكل سطر مستبدل.'; end if;
      if (v_item->>'new_tracking_unit_id')::uuid=v_old.id then raise exception 'لا يمكن استبدال القطعة بنفسها.'; end if;
      select * into v_new from public.stock_tracking_units where tenant_id=p_tenant_id and id=(v_item->>'new_tracking_unit_id')::uuid for update;
      if v_new.id is null or v_new.status<>'in_stock' or coalesce(v_new.data_status,'complete')<>'complete' then raise exception 'إحدى القطع البديلة غير متاحة فعليًا في المخزون.'; end if;
      if exists(select 1 from jsonb_array_elements(p_lines) x where x->>'new_tracking_unit_id'=v_new.id::text group by x->>'new_tracking_unit_id' having count(*)>1) then raise exception 'لا يمكن استخدام القطعة البديلة نفسها مرتين.'; end if;
      select round(sale_price,2) into strict v_replacement_unit_price from public.product_products where tenant_id=p_tenant_id and id=v_new.product_product_id and is_active;
      v_replacement_total:=v_replacement_total+v_replacement_unit_price;
    end if;
    if v_product_type<>'service' then
      insert into public.stock_moves(id,tenant_id,product_product_id,product_template_id,move_type,quantity,unit_price,reference_type,reference_id,notes,created_by,tracking_unit_id,original_sale_id,original_sale_line_id,sale_return_operation_id)
        values(v_return_move_id,p_tenant_id,v_line.product_product_id,coalesce(v_old.product_template_id,v_product_template_id),'return',v_quantity,v_line.unit_price,'showroom_sale_return',v_operation_id,'مرتجع بيع للسطر '||v_line.id,v_user.id,v_old.id,v_sale.id,v_line.id,v_operation_id);
      if v_tracking<>'serial' then
        select * into v_quant from public.stock_quants where tenant_id=p_tenant_id and product_product_id=v_line.product_product_id for update;
        if v_quant.id is null then raise exception 'تعذر العثور على Stock Quant للمنتج غير المسلسل.'; end if;
        update public.stock_quants set quantity_on_hand=quantity_on_hand+v_quantity,updated_at=v_now where id=v_quant.id;
      end if;
    else v_return_move_id:=null; end if;
    if v_old.id is not null then update public.stock_tracking_units set status='in_stock',updated_at=v_now where id=v_old.id; end if;
    insert into public.showroom_sale_return_lines(id,tenant_id,return_operation_id,original_sale_line_id,old_tracking_unit_id,quantity,unit_price,return_amount,line_action,line_note,new_tracking_unit_id,replacement_amount,price_difference,inventory_return_move_id)
      values(v_return_line_id,p_tenant_id,v_operation_id,v_line.id,v_old.id,v_quantity,v_return_unit_price,round(v_return_unit_price*v_quantity,2),v_action,nullif(btrim(coalesce(v_item->>'note','')),''),v_new.id,case when v_action='exchange' then v_replacement_unit_price else 0 end,case when v_action='exchange' then v_replacement_unit_price-round(v_return_unit_price*v_quantity,2) else -round(v_return_unit_price*v_quantity,2) end,v_return_move_id);
    if v_request.id is not null then
      if v_request.current_stage='pending_processor_cancellation' then
        update public.paperwork_requests set sale_return_operation_id=coalesce(sale_return_operation_id,v_operation_id),updated_at=v_now where id=v_request.id;
      elsif v_request.current_stage in('sent_to_processor','processor_ready') then
        update public.paperwork_requests set status='open',current_stage='pending_processor_cancellation',cancel_reason='unit_returned',sale_return_operation_id=v_operation_id,processor_cancellation_requested_at=v_now,stage_entered_at=v_now,updated_at=v_now where id=v_request.id;
        insert into public.paperwork_request_events(tenant_id,request_id,event_type,old_stage,new_stage,old_status,new_status,notes,created_by) values(p_tenant_id,v_request.id,'processor_cancellation_required_by_sale_return',v_request.current_stage,'pending_processor_cancellation',v_request.status,'open',jsonb_build_object('message','تم إرجاع أو استبدال القطعة بعد إرسال طلب الأوراق. يجب إيقاف الطلب السابق لدى جهة الإصدار.','return_operation_id',v_operation_id,'return_line_id',v_return_line_id,'line_action',v_action)::text,v_user.id);
      else
        update public.paperwork_requests set status='cancelled',current_stage='cancelled',cancel_reason='unit_returned',sale_return_operation_id=v_operation_id,closed_at=v_now,stage_entered_at=v_now,updated_at=v_now where id=v_request.id;
        insert into public.paperwork_request_events(tenant_id,request_id,event_type,old_stage,new_stage,old_status,new_status,notes,created_by) values(p_tenant_id,v_request.id,case when v_action='exchange' then 'paperwork_request_cancelled_by_sale_replacement' else 'paperwork_request_cancelled_by_sale_return' end,v_request.current_stage,'cancelled',v_request.status,'cancelled',jsonb_build_object('return_operation_id',v_operation_id,'return_line_id',v_return_line_id)::text,v_user.id);
      end if;
    end if;
    update public.showroom_sale_return_lines set old_paperwork_request_id=v_request.id where id=v_return_line_id;
    v_result_lines:=v_result_lines||jsonb_build_array(jsonb_build_object('return_line_id',v_return_line_id,'sale_line_id',v_line.id,'action',v_action,'quantity',v_quantity,'return_amount',round(v_return_unit_price*v_quantity,2),'old_paperwork_request_id',v_request.id));
  end loop;

  insert into public.account_moves(id,tenant_id,branch_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,notes,currency_code,created_by,reversed_move_id)
    values(v_credit_id,p_tenant_id,v_sale.branch_id,'SHOWROOM-RETURN-'||upper(substr(replace(v_credit_id::text,'-',''),1,12)),'refund',v_sale.customer_id,current_date,v_now,v_return_total,'posted','showroom_sale_return:'||v_operation_id,'إشعار دائن للفاتورة '||v_sale.account_move_id,v_currency,v_user.id,v_sale.account_move_id);
  insert into public.account_move_lines(id,tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
    values(v_credit_receivable_id,p_tenant_id,v_credit_id,v_receivable_id,v_sale.customer_id,'ذمم مرتجع مبيعات',1,v_return_total,0,v_return_total,'receivable',false,v_return_total,v_return_total,'posted',v_currency,v_user.id);
  insert into public.account_move_lines(tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by,product_product_id)
    select p_tenant_id,v_credit_id,v_income_id,null,'عكس إيراد: '||coalesce(sl.description,'سطر بيع'),rl.quantity,rl.unit_price,rl.return_amount,0,'income',true,0,0,'posted',v_currency,v_user.id,sl.product_product_id
    from public.showroom_sale_return_lines rl join public.showroom_sale_lines sl on sl.id=rl.original_sale_line_id where rl.return_operation_id=v_operation_id;
  select * into v_original_receivable from public.account_move_lines where tenant_id=p_tenant_id and move_id=v_sale.account_move_id and account_id=v_receivable_id and debit>0 order by id limit 1 for update;
  if v_original_receivable.id is null then raise exception 'قيد الفاتورة الأصلية لا يحتوي على سطر ذمم 114001 مدين صالح.'; end if;
  v_original_residual:=greatest(v_original_receivable.debit
    -coalesce((select sum(amount) from public.account_partial_reconcile where tenant_id=p_tenant_id and debit_move_id=v_original_receivable.id),0)
    +coalesce((select sum(amount) from public.account_partial_reconcile where tenant_id=p_tenant_id and credit_move_id=v_original_receivable.id),0),0);
  v_apply:=least(v_return_total,v_original_residual);
  if v_apply>0 then insert into public.account_partial_reconcile(tenant_id,debit_move_id,credit_move_id,amount,max_date,created_by) values(p_tenant_id,v_original_receivable.id,v_credit_receivable_id,v_apply,current_date,v_user.id); end if;
  update public.account_move_lines set amount_residual=v_original_residual-v_apply,amount_residual_currency=v_original_residual-v_apply,is_reconciled=(v_original_residual=v_apply) where id=v_original_receivable.id;
  v_credit_remaining:=v_return_total-v_apply;

  if v_operation_type<>'return' then
    v_replacement_sale_id:=gen_random_uuid(); v_replacement_invoice_id:=gen_random_uuid(); v_new_receivable_id:=gen_random_uuid();
    insert into public.showroom_sales(id,tenant_id,branch_id,customer_id,showroom_config_id,sale_date,status,total_amount,notes,created_by,source_type,source_sale_id)
      values(v_replacement_sale_id,p_tenant_id,v_sale.branch_id,v_sale.customer_id,v_sale.showroom_config_id,current_date,'confirmed',v_replacement_total,'بيع بديل للعملية '||v_operation_id,v_user.id,'sale_return_exchange',v_sale.id);
    for v_item in select value from jsonb_array_elements(p_lines) where value->>'action'='exchange' loop
      select * into v_new from public.stock_tracking_units where id=(v_item->>'new_tracking_unit_id')::uuid and tenant_id=p_tenant_id for update;
      select * into v_line from public.showroom_sale_lines where id=(v_item->>'sale_line_id')::uuid and tenant_id=p_tenant_id;
      v_replacement_line_id:=gen_random_uuid(); v_out_move_id:=gen_random_uuid(); v_new_request_id:=gen_random_uuid();
      select round(sale_price,2) into v_replacement_unit_price from public.product_products where id=v_new.product_product_id and tenant_id=p_tenant_id;
      insert into public.showroom_sale_lines(id,tenant_id,sale_id,product_product_id,tracking_unit_id,description,quantity,unit_price,total,ownership_name)
        select v_replacement_line_id,p_tenant_id,v_replacement_sale_id,p.id,v_new.id,p.display_name,1,v_replacement_unit_price,v_replacement_unit_price,v_line.ownership_name from public.product_products p where p.id=v_new.product_product_id;
      insert into public.stock_moves(id,tenant_id,product_product_id,product_template_id,move_type,quantity,unit_price,reference_type,reference_id,notes,created_by,tracking_unit_id,original_sale_id,original_sale_line_id,sale_return_operation_id)
        values(v_out_move_id,p_tenant_id,v_new.product_product_id,v_new.product_template_id,'out',1,v_replacement_unit_price,'showroom_sale_return_exchange',v_operation_id,'خروج قطعة بديلة',v_user.id,v_new.id,v_sale.id,v_line.id,v_operation_id);
      update public.stock_tracking_units set status='sold',notes='showroom_sale:'||v_replacement_sale_id,updated_at=v_now where id=v_new.id;
      select pr.* into v_request from public.showroom_sale_return_lines rl join public.paperwork_requests pr on pr.id=rl.old_paperwork_request_id
        where rl.return_operation_id=v_operation_id and rl.original_sale_line_id=v_line.id;
      if v_request.id is not null then
        v_request_result:=public.confirm_sale_paperwork_request(p_tenant_id,v_sale.branch_id,v_replacement_sale_id,v_replacement_line_id,v_new.id,v_sale.customer_id,
          coalesce(v_request.document_owner_status,'later'),v_request.document_owner_name,v_request.document_owner_national_id,v_request.document_owner_note,null,true,'تم إنشاء القطعة من عملية استبدال مع الاحتفاظ بصور وحدة التتبع.');
        v_new_request_id:=(v_request_result->>'id')::uuid;
        update public.paperwork_requests set sale_return_operation_id=v_operation_id,replaced_paperwork_request_id=v_request.id,
          processor_partner_id=v_request.processor_partner_id,processor_cancellation_blocking_request_id=case when v_request.current_stage='pending_processor_cancellation' then v_request.id end
          where id=v_new_request_id and tenant_id=p_tenant_id;
        insert into public.paperwork_request_events(tenant_id,request_id,event_type,new_stage,new_status,notes,created_by) values(p_tenant_id,v_new_request_id,'created_from_sale_return_exchange','preparation','open',jsonb_build_object('return_operation_id',v_operation_id,'old_request_id',v_request.id)::text,v_user.id);
      else v_new_request_id:=null; end if;
      update public.showroom_sale_return_lines set replacement_sale_line_id=v_replacement_line_id,inventory_out_move_id=v_out_move_id,new_paperwork_request_id=v_new_request_id where tenant_id=p_tenant_id and return_operation_id=v_operation_id and original_sale_line_id=v_line.id;
    end loop;
    insert into public.account_moves(id,tenant_id,branch_id,name,move_type,partner_id,invoice_date,date,amount_total,state,ref,notes,currency_code,created_by)
      values(v_replacement_invoice_id,p_tenant_id,v_sale.branch_id,'SHOWROOM-EXCHANGE-'||upper(substr(replace(v_replacement_invoice_id::text,'-',''),1,12)),'sale',v_sale.customer_id,current_date,v_now,v_replacement_total,'posted','showroom_sale:'||v_replacement_sale_id,'فاتورة بديلة للعملية '||v_operation_id,v_currency,v_user.id);
    insert into public.account_move_lines(id,tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by)
      values(v_new_receivable_id,p_tenant_id,v_replacement_invoice_id,v_receivable_id,v_sale.customer_id,'ذمم فاتورة بديلة',1,v_replacement_total,v_replacement_total,0,'receivable',false,v_replacement_total,v_replacement_total,'posted',v_currency,v_user.id);
    insert into public.account_move_lines(tenant_id,move_id,account_id,partner_id,label,quantity,unit_price,debit,credit,line_type,is_reconciled,amount_residual,amount_residual_currency,parent_state,currency_code,created_by,product_product_id)
      select p_tenant_id,v_replacement_invoice_id,v_income_id,null,'إيراد: '||coalesce(sl.description,'قطعة بديلة'),sl.quantity,sl.unit_price,0,sl.total,'income',true,0,0,'posted',v_currency,v_user.id,sl.product_product_id
      from public.showroom_sale_lines sl where sl.tenant_id=p_tenant_id and sl.sale_id=v_replacement_sale_id;
    v_apply:=least(v_credit_remaining,v_replacement_total);
    if v_apply>0 then insert into public.account_partial_reconcile(tenant_id,debit_move_id,credit_move_id,amount,max_date,created_by) values(p_tenant_id,v_new_receivable_id,v_credit_receivable_id,v_apply,current_date,v_user.id); end if;
    update public.account_move_lines set amount_residual=v_replacement_total-v_apply,amount_residual_currency=v_replacement_total-v_apply,is_reconciled=(v_replacement_total=v_apply) where id=v_new_receivable_id;
    v_credit_remaining:=v_credit_remaining-v_apply;
    update public.showroom_sales set account_move_id=v_replacement_invoice_id,updated_at=v_now where id=v_replacement_sale_id;
  end if;
  update public.account_move_lines set amount_residual=v_credit_remaining,amount_residual_currency=v_credit_remaining,is_reconciled=(v_credit_remaining=0) where id=v_credit_receivable_id;
  update public.showroom_sale_return_operations set status='completed',credit_note_move_id=v_credit_id,replacement_sale_id=v_replacement_sale_id,replacement_invoice_move_id=v_replacement_invoice_id,total_return_amount=v_return_total,total_replacement_amount=v_replacement_total,price_difference=v_replacement_total-v_return_total,completed_at=v_now where id=v_operation_id;
  return jsonb_build_object('return_operation_id',v_operation_id,'operation_type',v_operation_type,'credit_note_move_id',v_credit_id,'replacement_sale_id',v_replacement_sale_id,'replacement_invoice_move_id',v_replacement_invoice_id,'total_return_amount',v_return_total,'total_replacement_amount',v_replacement_total,'price_difference',v_replacement_total-v_return_total,'open_credit',v_credit_remaining,'lines',v_result_lines,'status','completed');
end $$;
revoke all on function public.create_confirmed_showroom_sale_return(uuid,uuid,jsonb,text,text,uuid) from public,anon;
grant execute on function public.create_confirmed_showroom_sale_return(uuid,uuid,jsonb,text,text,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
