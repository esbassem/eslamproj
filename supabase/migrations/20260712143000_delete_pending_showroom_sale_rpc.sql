begin;

create or replace function public.delete_pending_showroom_sale(p_sale_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale public.showroom_sales%rowtype;
  v_user_id uuid;
  v_line_ids uuid[];
  v_tracking_ids uuid[];
  v_created_tracking_ids uuid[];
  v_existing_tracking_ids uuid[];
begin
  select * into v_sale from public.showroom_sales where id = p_sale_id for update;
  if v_sale.id is null then raise exception 'الفاتورة المعلقة غير موجودة.'; end if;

  select tu.id into v_user_id from public.tenant_users tu
  where tu.auth_user_id = auth.uid() and tu.tenant_id = v_sale.tenant_id and coalesce(tu.is_active,true)=true
  order by tu.created_at limit 1;
  if v_user_id is null then raise exception 'لا يمكن حذف فاتورة تابعة لشركة أخرى.'; end if;
  if v_sale.status <> 'pending_payment' then raise exception 'لا يمكن حذف فاتورة تم اعتمادها.'; end if;
  if v_sale.account_move_id is not null or exists(select 1 from public.account_moves where tenant_id=v_sale.tenant_id and ref='showroom_sale:'||v_sale.id) then
    raise exception 'لا يمكن حذف الفاتورة لوجود قيود محاسبية مرتبطة بها.';
  end if;

  select coalesce(array_agg(id),array[]::uuid[]),coalesce(array_agg(tracking_unit_id) filter(where tracking_unit_id is not null),array[]::uuid[])
  into v_line_ids,v_tracking_ids from public.showroom_sale_lines where tenant_id=v_sale.tenant_id and sale_id=v_sale.id;

  select coalesce(array_agg(id) filter(where created_at >= v_sale.created_at - interval '5 seconds'),array[]::uuid[]),
         coalesce(array_agg(id) filter(where created_at < v_sale.created_at - interval '5 seconds'),array[]::uuid[])
  into v_created_tracking_ids,v_existing_tracking_ids
  from public.stock_tracking_units
  where tenant_id=v_sale.tenant_id and id=any(v_tracking_ids) and status='reserved' and notes='showroom_sale:'||v_sale.id;

  if cardinality(v_line_ids)>0 then
    delete from public.transaction_line_attributes where tenant_id=v_sale.tenant_id and transaction_line_id=any(v_line_ids);
  end if;
  delete from public.showroom_sale_lines where tenant_id=v_sale.tenant_id and sale_id=v_sale.id;

  if cardinality(v_created_tracking_ids)>0 then
    delete from public.stock_tracking_unit_licenses where tenant_id=v_sale.tenant_id and tracking_unit_id=any(v_created_tracking_ids);
    delete from public.stock_tracking_unit_identifiers where tenant_id=v_sale.tenant_id and tracking_unit_id=any(v_created_tracking_ids);
    delete from public.stock_tracking_units where tenant_id=v_sale.tenant_id and id=any(v_created_tracking_ids);
  end if;
  if cardinality(v_existing_tracking_ids)>0 then
    delete from public.stock_tracking_unit_licenses where tenant_id=v_sale.tenant_id
      and tracking_unit_id=any(v_existing_tracking_ids) and created_at>=v_sale.created_at-interval '5 seconds';
    update public.stock_tracking_unit_licenses l set is_current=true,updated_at=now()
    where l.id in (
      select distinct on (tracking_unit_id) id from public.stock_tracking_unit_licenses
      where tenant_id=v_sale.tenant_id and tracking_unit_id=any(v_existing_tracking_ids)
      order by tracking_unit_id,created_at desc
    );
    delete from public.stock_tracking_unit_identifiers where tenant_id=v_sale.tenant_id
      and tracking_unit_id=any(v_existing_tracking_ids) and created_at>=v_sale.created_at-interval '5 seconds';
    update public.stock_tracking_units set status='in_stock',notes=null,updated_at=now()
    where tenant_id=v_sale.tenant_id and id=any(v_existing_tracking_ids) and status='reserved' and notes='showroom_sale:'||v_sale.id;
  end if;

  delete from public.showroom_sales where id=v_sale.id;
  return jsonb_build_object('success',true,'sale_id',v_sale.id);
end;
$$;

grant execute on function public.delete_pending_showroom_sale(uuid) to authenticated;

commit;
