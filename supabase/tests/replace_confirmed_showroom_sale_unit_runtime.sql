begin;

do $$
declare
  v_owner_auth uuid; v_tenant uuid; v_sale uuid; v_line uuid; v_old uuid; v_new uuid;
  v_non_owner_auth uuid; v_result jsonb; v_replay jsonb; v_key uuid:=gen_random_uuid(); v_rejected boolean; v_before jsonb; v_lines_before jsonb; v_move_before jsonb;
begin
  select owner.auth_user_id,sale.tenant_id,sale.id,line.id,line.tracking_unit_id,candidate.id
  into v_owner_auth,v_tenant,v_sale,v_line,v_old,v_new
  from public.showroom_sales sale
  join public.tenant_users owner on owner.tenant_id=sale.tenant_id and owner.role='owner' and owner.is_active
  join public.showroom_sale_lines line on line.tenant_id=sale.tenant_id and line.sale_id=sale.id and line.tracking_unit_id is not null
  join public.stock_tracking_units old_unit on old_unit.tenant_id=line.tenant_id and old_unit.id=line.tracking_unit_id and old_unit.status='sold'
  join public.stock_tracking_units candidate on candidate.tenant_id=line.tenant_id
    and candidate.status='in_stock' and coalesce(candidate.data_status,'complete')='complete' and candidate.id<>old_unit.id
  join public.product_products candidate_product on candidate_product.id=candidate.product_product_id and candidate_product.tenant_id=candidate.tenant_id and candidate_product.is_active and candidate_product.sale_price>0
  where sale.status='confirmed' and sale.account_move_id is not null
    and not exists(select 1 from public.paperwork_documents d where d.tenant_id=line.tenant_id and d.tracking_unit_id=old_unit.id)
  order by sale.created_at,line.id,candidate.id limit 1;
  if v_owner_auth is null then raise exception 'TEST_SETUP: no eligible confirmed sale and replacement unit'; end if;

  perform set_config('request.jwt.claim.sub',v_owner_auth::text,true);
  select jsonb_build_object('line_unit',tracking_unit_id,'old_status',(select status from public.stock_tracking_units where id=v_old),
    'new_status',(select status from public.stock_tracking_units where id=v_new),'total',total)
  into v_before from public.showroom_sale_lines where id=v_line;
  select jsonb_agg(to_jsonb(l) order by l.id) into v_lines_before from public.showroom_sale_lines l where l.tenant_id=v_tenant and l.sale_id=v_sale;
  select to_jsonb(m) into v_move_before from public.account_moves m where m.id=(select account_move_id from public.showroom_sales where id=v_sale);

  begin
    v_result:=public.create_confirmed_showroom_sale_return(v_tenant,v_sale,jsonb_build_array(jsonb_build_object('sale_line_id',v_line,'quantity',1,'action','exchange','new_tracking_unit_id',v_new)),'customer_request','اختبار ذري',v_key);
    if v_result->>'return_operation_id' is null then raise exception 'TEST_FAILED: return operation id missing'; end if;
    if (select tracking_unit_id from public.showroom_sale_lines where id=v_line)<>v_old then raise exception 'TEST_FAILED: original line history changed'; end if;
    if (select status from public.stock_tracking_units where id=v_old)<>'in_stock' then raise exception 'TEST_FAILED: old unit not returned'; end if;
    if (select status from public.stock_tracking_units where id=v_new)<>'sold' then raise exception 'TEST_FAILED: new unit not sold'; end if;
    if (select total from public.showroom_sale_lines where id=v_line)<>(v_before->>'total')::numeric then raise exception 'TEST_FAILED: financial value changed'; end if;
    if v_lines_before is distinct from (select jsonb_agg(to_jsonb(l) order by l.id) from public.showroom_sale_lines l where l.tenant_id=v_tenant and l.sale_id=v_sale) then raise exception 'TEST_FAILED: original sale lines changed'; end if;
    if v_move_before is distinct from (select to_jsonb(m) from public.account_moves m where m.id=(select account_move_id from public.showroom_sales where id=v_sale)) then raise exception 'TEST_FAILED: original posted move changed'; end if;
    if not exists(select 1 from public.showroom_sales where id=(v_result->>'replacement_sale_id')::uuid and source_type='sale_return_exchange' and source_sale_id=v_sale) then raise exception 'TEST_FAILED: replacement sale missing'; end if;
    if not exists(select 1 from public.account_moves where id=(v_result->>'credit_note_move_id')::uuid and move_type='refund' and state='posted') then raise exception 'TEST_FAILED: partial credit note missing'; end if;
    if not exists(select 1 from public.account_moves where id=(v_result->>'replacement_invoice_move_id')::uuid and move_type='sale' and state='posted') then raise exception 'TEST_FAILED: replacement invoice missing'; end if;
    v_replay:=public.create_confirmed_showroom_sale_return(v_tenant,v_sale,jsonb_build_array(jsonb_build_object('sale_line_id',v_line,'quantity',1,'action','exchange','new_tracking_unit_id',v_new)),'customer_request','اختبار ذري',v_key);
    if v_replay->>'return_operation_id' is distinct from v_result->>'return_operation_id' or coalesce((v_replay->>'idempotent_replay')::boolean,false)=false then raise exception 'TEST_FAILED: idempotent retry created another operation'; end if;
    raise exception using errcode='ZX001',message='ROLLBACK_CASE';
  exception when sqlstate 'ZX001' then null;
  end;

  if v_before is distinct from (select jsonb_build_object('line_unit',tracking_unit_id,'old_status',(select status from public.stock_tracking_units where id=v_old),
    'new_status',(select status from public.stock_tracking_units where id=v_new),'total',total) from public.showroom_sale_lines where id=v_line) then
    raise exception 'TEST_FAILED: rollback did not restore state';
  end if;

  v_rejected:=false;
  begin perform public.create_confirmed_showroom_sale_return(v_tenant,v_sale,jsonb_build_array(jsonb_build_object('sale_line_id',v_line,'quantity',1,'action','exchange','new_tracking_unit_id',v_old)),'customer_request','نفس القطعة',gen_random_uuid());
  exception when others then v_rejected:=position('بنفسها' in sqlerrm)>0; end;
  if not v_rejected then raise exception 'TEST_FAILED: same unit accepted'; end if;

  select auth_user_id into v_non_owner_auth from public.tenant_users where tenant_id=v_tenant and role<>'owner' and is_active limit 1;
  if v_non_owner_auth is not null then
    perform set_config('request.jwt.claim.sub',v_non_owner_auth::text,true); v_rejected:=false;
    begin perform public.create_confirmed_showroom_sale_return(v_tenant,v_sale,jsonb_build_array(jsonb_build_object('sale_line_id',v_line,'quantity',1,'action','exchange','new_tracking_unit_id',v_new)),'customer_request','غير مالك',gen_random_uuid());
    exception when others then v_rejected:=position('لمالك الشركة فقط' in sqlerrm)>0; end;
    if not v_rejected then raise exception 'TEST_FAILED: non-owner accepted'; end if;
  end if;
  raise notice 'create_confirmed_showroom_sale_return runtime tests passed';
end $$;

rollback;
