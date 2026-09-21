begin;

create or replace function public.guard_sale_historical_marker()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' and new.is_historical is distinct from old.is_historical
     and coalesce(current_setting('app.historical_sales_import', true), '') <> 'on' then
    raise exception using errcode = '23514', message = 'SALE_HISTORICAL_MARKER_IMMUTABLE';
  end if;
  return new;
end $$;

create or replace function public.guard_historical_sale_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.is_historical and coalesce(current_setting('app.historical_sales_import', true), '') <> 'on' then
    raise exception using errcode = '23514', message = 'HISTORICAL_SALE_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

do $$
declare
  r record;
  v_existing integer;
  v_before_moves bigint := (select count(*) from public.account_moves);
  v_before_move_lines bigint := (select count(*) from public.account_move_lines);
  v_before_payments bigint := (select count(*) from public.financial_payments);
  v_before_reconciles bigint := (select count(*) from public.account_partial_reconcile);
  v_before_residual numeric := (select coalesce(sum(amount_residual),0) from public.account_move_lines);
  v_before_stock_moves bigint := (select count(*) from public.stock_moves);
  v_before_reservations bigint := (select count(*) from public.inventory_reservations);
  v_before_deliveries bigint := (select count(*) from public.sale_deliveries);
  v_before_tracking text := (select md5(string_agg(id::text||':'||status,',' order by id)) from public.stock_tracking_units);
begin
  create temporary table supplemental_manifest on commit drop as
  select s.*, sc.branch_id effective_branch_id, l.id source_line_id, l.product_product_id,
    l.tracking_unit_id, l.description line_description, l.quantity, l.unit_price, l.total line_total,
    u.status tracking_status, c.completed_by, c.completed_at, c.reversal_move_id,
    case s.id
      when '46efd2df-5097-4449-b5f9-3e23c7554fa9'::uuid then 'CANCELLED_SERIAL_RESERVED_WITHOUT_HISTORICAL_RELEASE'
      else 'CANCELLED_SERIAL_REUSED_WITHOUT_HISTORICAL_RETURN_MOVE'
    end inventory_evidence,
    case when s.id='a09d1ff0-7491-4ae8-af74-b805cd667d02'::uuid
      then '2e8127b7-884d-4f65-bf37-3b9d79ce046b'::uuid end subsequent_sale_id
  from public.showroom_sales s
  join public.showroom_configs sc on sc.id=s.showroom_config_id and sc.tenant_id=s.tenant_id
  join public.showroom_sale_lines l on l.sale_id=s.id and l.tenant_id=s.tenant_id
  join public.stock_tracking_units u on u.id=l.tracking_unit_id and u.tenant_id=l.tenant_id
  join public.showroom_sale_cancellations c on c.sale_id=s.id and c.tenant_id=s.tenant_id and c.status='completed'
  join public.account_moves original on original.id=s.account_move_id and original.tenant_id=s.tenant_id
    and original.state='posted' and original.move_type='sale' and original.amount_total=s.total_amount
  join public.account_moves reversal on reversal.id=c.reversal_move_id and reversal.tenant_id=s.tenant_id
    and reversal.state='posted' and reversal.move_type='refund' and reversal.reversed_entry_id=original.id
    and reversal.amount_total=original.amount_total
  where s.id in ('46efd2df-5097-4449-b5f9-3e23c7554fa9','a09d1ff0-7491-4ae8-af74-b805cd667d02')
    and s.status='cancelled';

  if (select count(*) from supplemental_manifest) <> 2
     or exists(select 1 from supplemental_manifest group by id having count(*)<>1)
     or exists(select 1 from supplemental_manifest where effective_branch_id is null or customer_id is null or created_by is null
       or product_product_id is null or tracking_unit_id is null or quantity<>1 or line_total<>total_amount)
     or exists(select 1 from supplemental_manifest m where not exists(
       select 1 from public.account_move_lines debit_line
       join public.account_accounts debit_account on debit_account.id=debit_line.account_id and debit_account.tenant_id=debit_line.tenant_id and debit_account.code='114001'
       join public.account_partial_reconcile rec on rec.debit_move_id=debit_line.id and rec.tenant_id=debit_line.tenant_id and rec.amount=m.total_amount
       join public.account_move_lines credit_line on credit_line.id=rec.credit_move_id and credit_line.tenant_id=rec.tenant_id and credit_line.move_id=m.reversal_move_id
       where debit_line.move_id=m.account_move_id and debit_line.tenant_id=m.tenant_id
         and debit_line.amount_residual=0 and credit_line.amount_residual=0))
  then raise exception 'SUPPLEMENTAL_HISTORICAL_EVIDENCE_MISMATCH'; end if;

  if exists(select 1 from supplemental_manifest where
      (id='46efd2df-5097-4449-b5f9-3e23c7554fa9' and tracking_status<>'reserved') or
      (id='a09d1ff0-7491-4ae8-af74-b805cd667d02' and (tracking_status<>'sold' or not exists(
        select 1 from public.showroom_sale_lines later_line join public.showroom_sales later_sale
          on later_sale.id=later_line.sale_id and later_sale.tenant_id=later_line.tenant_id
        where later_sale.id='2e8127b7-884d-4f65-bf37-3b9d79ce046b' and later_sale.status='confirmed'
          and later_line.tracking_unit_id=supplemental_manifest.tracking_unit_id))))
  then raise exception 'SUPPLEMENTAL_HISTORICAL_INVENTORY_EVIDENCE_MISMATCH'; end if;

  select count(*) into v_existing from public.sale_historical_sources
  where source_system='showroom' and source_sale_id in (select id from supplemental_manifest);
  if v_existing not in (0,2) then raise exception 'SUPPLEMENTAL_HISTORICAL_PARTIAL_STATE'; end if;

  if v_existing=0 then
    if exists(select 1 from supplemental_manifest m join public.sales s
      on s.id=m.id or (s.tenant_id=m.tenant_id and (s.sale_number='SAL-'||substring(m.sale_number,1,5)||'900'||substring(m.sale_number,6)
        or s.create_idempotency_key='legacy-showroom:'||m.id::text)))
    then raise exception 'SUPPLEMENTAL_HISTORICAL_IDENTITY_COLLISION'; end if;

    insert into public.sales(id,tenant_id,branch_id,customer_id,effective_sale_date,currency_code,status,total_amount,notes,version,
      create_idempotency_key,create_request_fingerprint,created_by,created_at,updated_at,is_historical)
    select id,tenant_id,effective_branch_id,customer_id,sale_date,'EGP','draft',total_amount,notes,1,
      'legacy-showroom:'||id::text,encode(digest(jsonb_build_object('source','showroom','id',id,'total',total_amount)::text,'sha256'),'hex'),
      created_by,created_at,updated_at,false from supplemental_manifest;

    insert into public.sale_lines(id,tenant_id,sale_id,line_position,product_id,description,quantity,unit_price,line_total,tracking_requirement,created_at,updated_at)
    select m.source_line_id,m.tenant_id,m.id,1,m.product_product_id,coalesce(nullif(btrim(m.line_description),''),p.display_name,t.name),
      m.quantity,m.unit_price,m.line_total,coalesce(p.tracking,t.tracking,'serial'),m.created_at,m.created_at
    from supplemental_manifest m join public.product_products p on p.id=m.product_product_id and p.tenant_id=m.tenant_id
    join public.product_templates t on t.id=p.product_template_id and t.tenant_id=p.tenant_id;

    insert into public.sale_historical_sources(tenant_id,sale_id,source_system,source_sale_id,source_sale_number,classification,
      financial_account_move_id,inventory_evidence_type,provenance,imported_at)
    select tenant_id,id,'showroom',id,sale_number,'B',account_move_id,inventory_evidence,
      jsonb_strip_nulls(jsonb_build_object('legacy_status','cancelled','legacy_showroom_config_id',showroom_config_id,
        'canonical_internal_number','SAL-'||substring(sale_number,1,5)||'900'||substring(sale_number,6),
        'audit_classification','B','financial_reversal_move_id',reversal_move_id,
        'financial_evidence','ORIGINAL_AND_REVERSAL_POSTED_FULLY_RECONCILED',
        'serial_state_preserved',tracking_status,'subsequent_legacy_sale_id',subsequent_sale_id,
        'subsequent_legacy_sale_number',case when subsequent_sale_id is not null then '2026-000187' end)),now()
    from supplemental_manifest;

    insert into public.sale_line_historical_sources(tenant_id,sale_line_id,source_system,source_line_id,tracking_unit_id,
      inventory_evidence_type,provenance)
    select tenant_id,source_line_id,'showroom',source_line_id,tracking_unit_id,inventory_evidence,
      jsonb_strip_nulls(jsonb_build_object('legacy_sale_id',id,'legacy_line_total',line_total,
        'serial_state_preserved',tracking_status,'subsequent_legacy_sale_id',subsequent_sale_id))
    from supplemental_manifest;

    perform set_config('app.historical_sales_import','on',true);
    update public.sales set is_historical=true where id in (select id from supplemental_manifest);
    for r in select * from supplemental_manifest loop
      perform set_config('app.canonical_sales_transition',r.id::text,true);
      update public.sales set status='confirmed',sale_number='SAL-'||substring(r.sale_number,1,5)||'900'||substring(r.sale_number,6),
        confirmed_by=r.created_by,confirmed_at=(select created_at from public.account_moves where id=r.account_move_id),version=2,
        updated_at=greatest(r.updated_at,(select created_at from public.account_moves where id=r.account_move_id)) where id=r.id;
      perform set_config('app.canonical_sales_transition',r.id::text,true);
      update public.sales set status='cancelled',cancelled_by=r.completed_by,cancelled_at=r.completed_at,version=3,
        updated_at=greatest(updated_at,r.completed_at) where id=r.id;
    end loop;
    perform set_config('app.historical_sales_import','off',true);
    perform set_config('app.canonical_sales_transition','',true);
  end if;

  if exists(select 1 from supplemental_manifest m left join public.sales s on s.id=m.id and s.tenant_id=m.tenant_id
    left join public.sale_historical_sources h on h.sale_id=s.id and h.tenant_id=s.tenant_id
    left join public.sale_lines l on l.sale_id=s.id and l.tenant_id=s.tenant_id
    left join public.sale_line_historical_sources lh on lh.sale_line_id=l.id and lh.tenant_id=l.tenant_id
    where s.id is null or not s.is_historical or s.status<>'cancelled' or s.total_amount<>m.total_amount
      or s.customer_id<>m.customer_id or s.branch_id<>m.effective_branch_id or h.source_sale_number<>m.sale_number
      or h.inventory_evidence_type<>m.inventory_evidence or h.financial_account_move_id<>m.account_move_id
      or l.id<>m.source_line_id or l.product_id<>m.product_product_id or l.line_total<>m.line_total
      or lh.tracking_unit_id<>m.tracking_unit_id or lh.inventory_evidence_type<>m.inventory_evidence)
  then raise exception 'SUPPLEMENTAL_HISTORICAL_REPLAY_FACT_MISMATCH'; end if;

  if (select count(*) from public.sale_historical_sources where source_system='showroom')<>217
     or (select count(*) from public.sale_line_historical_sources where source_system='showroom')<>217
  then raise exception 'SUPPLEMENTAL_HISTORICAL_FINAL_COUNT_MISMATCH'; end if;

  if v_before_moves<>(select count(*) from public.account_moves) or v_before_move_lines<>(select count(*) from public.account_move_lines)
     or v_before_payments<>(select count(*) from public.financial_payments) or v_before_reconciles<>(select count(*) from public.account_partial_reconcile)
     or v_before_residual<>(select coalesce(sum(amount_residual),0) from public.account_move_lines)
     or v_before_stock_moves<>(select count(*) from public.stock_moves) or v_before_reservations<>(select count(*) from public.inventory_reservations)
     or v_before_deliveries<>(select count(*) from public.sale_deliveries)
     or v_before_tracking is distinct from (select md5(string_agg(id::text||':'||status,',' order by id)) from public.stock_tracking_units)
  then raise exception 'SUPPLEMENTAL_HISTORICAL_SIDE_EFFECT_DETECTED'; end if;
end $$;

revoke all on function public.guard_sale_historical_marker(), public.guard_historical_sale_immutable() from public,anon,authenticated;

commit;
