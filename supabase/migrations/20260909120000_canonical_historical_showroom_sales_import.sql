begin;

alter table public.sales
  add column if not exists is_historical boolean not null default false;

create or replace function public.guard_sale_historical_marker()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' and new.is_historical is distinct from old.is_historical then
    raise exception using errcode = '23514', message = 'SALE_HISTORICAL_MARKER_IMMUTABLE';
  end if;
  return new;
end $$;

drop trigger if exists sale_historical_marker_guard on public.sales;
create trigger sale_historical_marker_guard
before update on public.sales for each row execute function public.guard_sale_historical_marker();

create table if not exists public.sale_historical_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  source_system text not null,
  source_sale_id uuid not null,
  source_sale_number text,
  classification text not null,
  financial_account_move_id uuid,
  inventory_evidence_type text,
  provenance jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  constraint sale_historical_sources_sale_fk foreign key (sale_id, tenant_id)
    references public.sales(id, tenant_id) on delete restrict,
  constraint sale_historical_sources_move_fk foreign key (financial_account_move_id, tenant_id)
    references public.account_moves(id, tenant_id) on delete restrict,
  constraint sale_historical_sources_source_check check (source_system ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint sale_historical_sources_class_check check (classification in ('A','B')),
  constraint sale_historical_sources_provenance_check check (jsonb_typeof(provenance) = 'object'),
  constraint sale_historical_sources_source_unique unique (tenant_id, source_system, source_sale_id),
  constraint sale_historical_sources_sale_unique unique (tenant_id, sale_id)
);

create table if not exists public.sale_line_historical_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_line_id uuid not null,
  source_system text not null,
  source_line_id uuid not null,
  tracking_unit_id uuid,
  inventory_evidence_type text,
  provenance jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  constraint sale_line_historical_sources_line_fk foreign key (sale_line_id, tenant_id)
    references public.sale_lines(id, tenant_id) on delete restrict,
  constraint sale_line_historical_sources_tracking_fk foreign key (tracking_unit_id, tenant_id)
    references public.stock_tracking_units(id, tenant_id) on delete restrict,
  constraint sale_line_historical_sources_source_check check (source_system ~ '^[a-z][a-z0-9_]{1,39}$'),
  constraint sale_line_historical_sources_provenance_check check (jsonb_typeof(provenance) = 'object'),
  constraint sale_line_historical_sources_source_unique unique (tenant_id, source_system, source_line_id),
  constraint sale_line_historical_sources_line_unique unique (tenant_id, sale_line_id)
);

create or replace function public.guard_historical_source_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  raise exception using errcode = '23514', message = 'HISTORICAL_SOURCE_IMMUTABLE';
end $$;

drop trigger if exists sale_historical_sources_immutable on public.sale_historical_sources;
create trigger sale_historical_sources_immutable before update or delete on public.sale_historical_sources
for each row execute function public.guard_historical_source_immutable();
drop trigger if exists sale_line_historical_sources_immutable on public.sale_line_historical_sources;
create trigger sale_line_historical_sources_immutable before update or delete on public.sale_line_historical_sources
for each row execute function public.guard_historical_source_immutable();

alter table public.sale_historical_sources enable row level security;
alter table public.sale_line_historical_sources enable row level security;
revoke all on public.sale_historical_sources, public.sale_line_historical_sources from public, anon, authenticated;
grant select on public.sale_historical_sources, public.sale_line_historical_sources to authenticated;
drop policy if exists sale_historical_sources_read on public.sale_historical_sources;
create policy sale_historical_sources_read on public.sale_historical_sources for select to authenticated
using (tenant_id = public.current_tenant_id() and public.has_permission('sales.view', tenant_id));
drop policy if exists sale_line_historical_sources_read on public.sale_line_historical_sources;
create policy sale_line_historical_sources_read on public.sale_line_historical_sources for select to authenticated
using (tenant_id = public.current_tenant_id() and public.has_permission('sales.view', tenant_id));

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
  select count(*) into v_existing from public.sale_historical_sources where source_system = 'showroom';
  if v_existing not in (0, 215) then
    raise exception 'HISTORICAL_IMPORT_PARTIAL_STATE: %', v_existing;
  end if;

  if v_existing = 0 then
    create temporary table historical_import_manifest on commit drop as
    with held(id) as (values
      ('36efa3b4-12a1-4eff-b346-7467b08aa14d'::uuid), ('67f4258b-b486-499a-83ed-fe43012bfcca'::uuid),
      ('43c00089-d7dd-4119-b0e7-cd89c1d97343'::uuid), ('46efd2df-5097-4449-b5f9-3e23c7554fa9'::uuid),
      ('a09d1ff0-7491-4ae8-af74-b805cd667d02'::uuid), ('05cdc68e-6e92-4371-84eb-fcb42758ac19'::uuid),
      ('18fdf2ff-dc1d-40fd-ac01-029173790bf8'::uuid), ('6558b8b5-5b39-4801-8067-8bfee9aaefbb'::uuid),
      ('8e607147-cea9-4dcf-b21f-1d300c51ba73'::uuid), ('0f92b2b8-a5cd-4de4-a1f3-fb03102f28a5'::uuid)
    ), inv as (
      select s.id, count(sm.id) filter(where sm.move_type='out') outs,
        count(sm.id) filter(where sm.move_type='in') ins,
        count(l.id) lines, count(l.id) filter(where u.status='in_stock') in_stock_lines
      from public.showroom_sales s
      left join public.showroom_sale_lines l on l.sale_id=s.id and l.tenant_id=s.tenant_id
      left join public.stock_tracking_units u on u.id=l.tracking_unit_id and u.tenant_id=l.tenant_id
      left join public.stock_moves sm on sm.tenant_id=s.tenant_id and
        ((sm.reference_type='showroom_sale' and sm.reference_id=s.id) or sm.original_sale_id=s.id)
      group by s.id
    )
    select s.*, sc.branch_id effective_branch_id, m.id financial_move_id, m.created_at financial_created_at,
      case when (s.status='confirmed' and inv.lines>0 and inv.outs=0)
             or (s.status='cancelled' and inv.outs>0 and inv.ins=0 and inv.in_stock_lines>0) then 'B' else 'A' end classification,
      case when s.status='confirmed' and inv.lines>0 and inv.outs=0 then 'CURRENT_SERIAL_STATE_SOLD_WITHOUT_HISTORICAL_STOCK_OUT'
           when s.status='cancelled' and inv.outs>0 and inv.ins=0 and inv.in_stock_lines>0 then 'CURRENT_SERIAL_STATE_IN_STOCK_WITHOUT_HISTORICAL_RETURN_MOVE' end inventory_evidence
    from public.showroom_sales s join inv on inv.id=s.id
    left join held h on h.id=s.id
    join public.showroom_configs sc on sc.id=s.showroom_config_id and sc.tenant_id=s.tenant_id
    join public.account_moves m on m.tenant_id=s.tenant_id and m.move_type='sale'
      and (m.id=s.account_move_id or m.ref='showroom_sale:'||s.id::text)
    where h.id is null;

    if (select count(*) from historical_import_manifest) <> 215
       or (select count(*) from historical_import_manifest where classification='A') <> 59
       or (select count(*) from historical_import_manifest where classification='B') <> 156
       or (select count(*) from public.showroom_sale_lines l join historical_import_manifest m on m.id=l.sale_id and m.tenant_id=l.tenant_id) <> 215
       or (select sum(total_amount) from historical_import_manifest) <> 11369400 then
      raise exception 'HISTORICAL_IMPORT_SCOPE_MISMATCH';
    end if;
    if exists(select 1 from historical_import_manifest m left join public.branches b on b.id=m.effective_branch_id and b.tenant_id=m.tenant_id
      left join public.partners p on p.id=m.customer_id and p.tenant_id=m.tenant_id left join public.tenant_users u on u.id=m.created_by and u.tenant_id=m.tenant_id
      where b.id is null or p.id is null or u.id is null) then raise exception 'HISTORICAL_IMPORT_HEADER_MAPPING_FAILED'; end if;
    if exists(select 1 from public.showroom_sale_lines l join historical_import_manifest m on m.id=l.sale_id and m.tenant_id=l.tenant_id
      left join public.product_products p on p.id=l.product_product_id and p.tenant_id=l.tenant_id
      where p.id is null or l.quantity<=0 or l.unit_price<0 or l.total<>round(l.quantity*l.unit_price,2)) then raise exception 'HISTORICAL_IMPORT_LINE_MAPPING_FAILED'; end if;
    if exists(select 1 from historical_import_manifest m join public.sales s on s.id=m.id or (s.tenant_id=m.tenant_id and s.create_idempotency_key='legacy-showroom:'||m.id::text)) then raise exception 'HISTORICAL_IMPORT_IDENTITY_COLLISION'; end if;

    insert into public.sales(id,tenant_id,branch_id,customer_id,effective_sale_date,currency_code,status,total_amount,notes,version,
      create_idempotency_key,create_request_fingerprint,created_by,created_at,updated_at,is_historical)
    select id,tenant_id,effective_branch_id,customer_id,sale_date,'EGP','draft',total_amount,notes,1,
      'legacy-showroom:'||id::text,encode(digest(jsonb_build_object('source','showroom','id',id,'total',total_amount)::text,'sha256'),'hex'),
      created_by,created_at,updated_at,true from historical_import_manifest;

    insert into public.sale_lines(id,tenant_id,sale_id,line_position,product_id,description,quantity,unit_price,line_total,tracking_requirement,created_at,updated_at)
    select l.id,l.tenant_id,l.sale_id,row_number() over(partition by l.sale_id order by l.created_at,l.id),l.product_product_id,
      coalesce(nullif(btrim(l.description),''),p.display_name,t.name),l.quantity,l.unit_price,l.total,coalesce(p.tracking,t.tracking,'none'),l.created_at,l.created_at
    from public.showroom_sale_lines l join historical_import_manifest m on m.id=l.sale_id and m.tenant_id=l.tenant_id
    join public.product_products p on p.id=l.product_product_id and p.tenant_id=l.tenant_id
    join public.product_templates t on t.id=p.product_template_id and t.tenant_id=p.tenant_id;

    insert into public.sale_historical_sources(tenant_id,sale_id,source_system,source_sale_id,source_sale_number,classification,financial_account_move_id,inventory_evidence_type,provenance,imported_at)
    select tenant_id,id,'showroom',id,sale_number,classification,financial_move_id,inventory_evidence,
      jsonb_build_object('legacy_status',status,'legacy_showroom_config_id',showroom_config_id,'canonical_internal_number','SAL-'||substring(sale_number,1,5)||'900'||substring(sale_number,6),'audit_classification',classification),now()
    from historical_import_manifest;

    insert into public.sale_line_historical_sources(tenant_id,sale_line_id,source_system,source_line_id,tracking_unit_id,inventory_evidence_type,provenance)
    select l.tenant_id,l.id,'showroom',l.id,l.tracking_unit_id,m.inventory_evidence,
      jsonb_build_object('legacy_sale_id',l.sale_id,'legacy_line_total',l.total)
    from public.showroom_sale_lines l join historical_import_manifest m on m.id=l.sale_id and m.tenant_id=l.tenant_id;

    for r in select m.*,c.completed_by,c.completed_at from historical_import_manifest m
      left join public.showroom_sale_cancellations c on c.sale_id=m.id and c.tenant_id=m.tenant_id and c.status='completed'
    loop
      perform set_config('app.canonical_sales_transition',r.id::text,true);
      update public.sales set status='confirmed',sale_number='SAL-'||substring(r.sale_number,1,5)||'900'||substring(r.sale_number,6),
        confirmed_by=r.created_by,confirmed_at=r.financial_created_at,version=2,updated_at=greatest(r.updated_at,r.financial_created_at)
      where id=r.id;
      if r.status='cancelled' then
        if r.completed_by is null or r.completed_at is null then raise exception 'HISTORICAL_CANCELLATION_MAPPING_FAILED: %',r.id; end if;
        perform set_config('app.canonical_sales_transition',r.id::text,true);
        update public.sales set status='cancelled',cancelled_by=r.completed_by,cancelled_at=r.completed_at,version=3,updated_at=greatest(updated_at,r.completed_at)
        where id=r.id;
      end if;
    end loop;
    perform set_config('app.canonical_sales_transition','',true);
  end if;

  if (select count(*) from public.sale_historical_sources where source_system='showroom') <> 215
     or (select count(*) from public.sale_line_historical_sources where source_system='showroom') <> 215
     or (select sum(s.total_amount) from public.sales s join public.sale_historical_sources h on h.sale_id=s.id and h.tenant_id=s.tenant_id where h.source_system='showroom') <> 11369400
     or exists(select 1 from public.sale_historical_sources group by tenant_id,source_system,source_sale_id having count(*)>1) then
    raise exception 'HISTORICAL_IMPORT_POSTFLIGHT_FAILED';
  end if;
  if v_before_moves<>(select count(*) from public.account_moves) or v_before_move_lines<>(select count(*) from public.account_move_lines)
     or v_before_payments<>(select count(*) from public.financial_payments) or v_before_reconciles<>(select count(*) from public.account_partial_reconcile)
     or v_before_residual<>(select coalesce(sum(amount_residual),0) from public.account_move_lines)
     or v_before_stock_moves<>(select count(*) from public.stock_moves) or v_before_reservations<>(select count(*) from public.inventory_reservations)
     or v_before_deliveries<>(select count(*) from public.sale_deliveries)
     or v_before_tracking is distinct from (select md5(string_agg(id::text||':'||status,',' order by id)) from public.stock_tracking_units) then
    raise exception 'HISTORICAL_IMPORT_SIDE_EFFECT_DETECTED';
  end if;
end $$;

create or replace function public.guard_historical_sale_immutable()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.is_historical then
    raise exception using errcode = '23514', message = 'HISTORICAL_SALE_IMMUTABLE';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists historical_sale_immutable_guard on public.sales;
create trigger historical_sale_immutable_guard
before update or delete on public.sales for each row execute function public.guard_historical_sale_immutable();

revoke all on function public.guard_sale_historical_marker(), public.guard_historical_source_immutable(), public.guard_historical_sale_immutable() from public,anon,authenticated;
comment on table public.sale_historical_sources is 'Immutable provenance for database-imported historical sales; never invokes operational workflows.';
comment on table public.sale_line_historical_sources is 'Immutable provenance and tracking references for historical sale lines; not an inventory reservation or delivery.';

commit;
