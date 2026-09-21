begin;

create table public.paperwork_legacy_sale_sources (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  paperwork_request_id uuid not null,
  source_system text not null default 'showroom' check (source_system = 'showroom'),
  source_sale_id uuid not null,
  source_sale_line_id uuid,
  source_tracking_unit_id uuid,
  original_sale_number text not null,
  original_sale_date date not null,
  original_sale_status text not null,
  customer_id uuid,
  product_id uuid,
  total_amount numeric(18,2) not null,
  classification text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence)='object'),
  created_at timestamptz not null default now(),
  constraint paperwork_legacy_sale_sources_request_fk foreign key (paperwork_request_id)
    references public.paperwork_requests(id) on delete restrict,
  constraint paperwork_legacy_sale_sources_tracking_fk foreign key (source_tracking_unit_id,tenant_id)
    references public.stock_tracking_units(id,tenant_id) on delete restrict,
  constraint paperwork_legacy_sale_sources_unique unique (tenant_id,paperwork_request_id,source_system,source_sale_id)
);

create or replace function public.guard_paperwork_legacy_sale_source_immutable()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin raise exception using errcode='23514',message='PAPERWORK_LEGACY_SALE_SOURCE_IMMUTABLE'; end $$;
create trigger paperwork_legacy_sale_sources_immutable before update or delete on public.paperwork_legacy_sale_sources
for each row execute function public.guard_paperwork_legacy_sale_source_immutable();
alter table public.paperwork_legacy_sale_sources enable row level security;
revoke all on public.paperwork_legacy_sale_sources from public,anon,authenticated;
grant select on public.paperwork_legacy_sale_sources to authenticated;
create policy paperwork_legacy_sale_sources_read on public.paperwork_legacy_sale_sources for select to authenticated
using (tenant_id=public.current_tenant_id() and public.has_permission('paperwork.view',tenant_id));

do $$
declare
  v_sale public.showroom_sales;
  v_line public.showroom_sale_lines;
  v_branch uuid;
  v_before_moves bigint := (select count(*) from public.account_moves);
  v_before_move_lines bigint := (select count(*) from public.account_move_lines);
  v_before_payments bigint := (select count(*) from public.financial_payments);
  v_before_reconciles bigint := (select count(*) from public.account_partial_reconcile);
  v_before_stock bigint := (select count(*) from public.stock_moves);
  v_before_reservations bigint := (select count(*) from public.inventory_reservations);
  v_before_tracking text := (select md5(string_agg(id::text||':'||status,',' order by id)) from public.stock_tracking_units);
begin
  select * into strict v_sale from public.showroom_sales where id='dae32949-c838-41f8-8721-8bdc8d7cd626';
  select * into strict v_line from public.showroom_sale_lines where id='1922477d-d1c3-46d6-8c2f-1938d4a9792c' and sale_id=v_sale.id;
  select branch_id into strict v_branch from public.showroom_configs where id=v_sale.showroom_config_id and tenant_id=v_sale.tenant_id;
  if v_sale.status<>'confirmed' or v_sale.total_amount<>48000 or v_sale.account_move_id<>'17b6103f-6a68-4b0a-8423-0a21f7e08308'
     or not exists(select 1 from public.account_moves where id=v_sale.account_move_id and state='posted' and amount_total=48000)
     or not exists(select 1 from public.stock_moves where id='fc05d750-7826-4345-8c1e-fc71848dc417' and reference_id=v_sale.id and move_type='out') then
    raise exception 'PAPERWORK_TARGET_IMPORT_FACT_MISMATCH';
  end if;
  if not exists(select 1 from public.sales where id=v_sale.id) then
    insert into public.sales(id,tenant_id,branch_id,customer_id,effective_sale_date,currency_code,status,total_amount,notes,version,create_idempotency_key,create_request_fingerprint,created_by,created_at,updated_at,is_historical)
    values(v_sale.id,v_sale.tenant_id,v_branch,v_sale.customer_id,v_sale.sale_date,'EGP','draft',v_sale.total_amount,v_sale.notes,1,'legacy-showroom:'||v_sale.id,encode(digest(jsonb_build_object('source','showroom','id',v_sale.id,'total',v_sale.total_amount)::text,'sha256'),'hex'),v_sale.created_by,v_sale.created_at,v_sale.updated_at,true);
    insert into public.sale_lines(id,tenant_id,sale_id,line_position,product_id,description,quantity,unit_price,line_total,tracking_requirement,created_at,updated_at)
    select v_line.id,v_line.tenant_id,v_line.sale_id,1,v_line.product_product_id,coalesce(nullif(btrim(v_line.description),''),p.display_name,t.name),v_line.quantity,v_line.unit_price,v_line.total,coalesce(p.tracking,t.tracking,'none'),v_line.created_at,v_line.created_at
    from public.product_products p join public.product_templates t on t.id=p.product_template_id and t.tenant_id=p.tenant_id where p.id=v_line.product_product_id and p.tenant_id=v_line.tenant_id;
    insert into public.sale_historical_sources(tenant_id,sale_id,source_system,source_sale_id,source_sale_number,classification,financial_account_move_id,inventory_evidence_type,provenance)
    values(v_sale.tenant_id,v_sale.id,'showroom',v_sale.id,v_sale.sale_number,'A',v_sale.account_move_id,'EXISTING_HISTORICAL_STOCK_OUT',jsonb_build_object('legacy_status','confirmed','legacy_showroom_config_id',v_sale.showroom_config_id,'canonical_internal_number','SAL-'||substring(v_sale.sale_number,1,5)||'900'||substring(v_sale.sale_number,6),'post_snapshot_import',true,'stock_move_id','fc05d750-7826-4345-8c1e-fc71848dc417'));
    insert into public.sale_line_historical_sources(tenant_id,sale_line_id,source_system,source_line_id,tracking_unit_id,inventory_evidence_type,provenance)
    values(v_line.tenant_id,v_line.id,'showroom',v_line.id,v_line.tracking_unit_id,'EXISTING_HISTORICAL_STOCK_OUT',jsonb_build_object('legacy_sale_id',v_sale.id,'legacy_line_total',v_line.total));
    perform set_config('app.historical_sales_import','on',true);
    perform set_config('app.canonical_sales_transition',v_sale.id::text,true);
    update public.sales set status='confirmed',sale_number='SAL-'||substring(v_sale.sale_number,1,5)||'900'||substring(v_sale.sale_number,6),confirmed_by=v_sale.created_by,confirmed_at=(select created_at from public.account_moves where id=v_sale.account_move_id),version=2,updated_at=v_sale.updated_at where id=v_sale.id;
    perform set_config('app.canonical_sales_transition','',true);
    perform set_config('app.historical_sales_import','',true);
  elsif not exists(select 1 from public.sale_historical_sources where source_system='showroom' and source_sale_id=v_sale.id and sale_id=v_sale.id) then
    raise exception 'PAPERWORK_TARGET_IMPORT_IDENTITY_COLLISION';
  end if;

  insert into public.paperwork_legacy_sale_sources(tenant_id,paperwork_request_id,source_sale_id,source_sale_line_id,source_tracking_unit_id,original_sale_number,original_sale_date,original_sale_status,customer_id,product_id,total_amount,classification,evidence)
  select s.tenant_id,r.id,s.id,l.id,l.tracking_unit_id,s.sale_number,s.sale_date,s.status,s.customer_id,l.product_product_id,s.total_amount,x.classification,
    jsonb_build_object('paperwork_status',r.status,'paperwork_stage',r.current_stage,'financial_account_move_id',s.account_move_id)
  from (values
    ('36efa3b4-12a1-4eff-b346-7467b08aa14d'::uuid,'a4e4f61a-a730-42f0-82bc-9b353aedce76'::uuid,'DUPLICATE_INCOMPLETE_LEGACY_SALE_EXCLUDED'),
    ('67f4258b-b486-499a-83ed-fe43012bfcca'::uuid,'27df8d14-6455-4a4f-be42-821c4f2116ad'::uuid,'CANCELLED_LEGACY_SALE_WITH_VALID_UNAPPLIED_CUSTOMER_CREDIT')) x(sale_id,request_id,classification)
  join public.showroom_sales s on s.id=x.sale_id join public.showroom_sale_lines l on l.sale_id=s.id join public.paperwork_requests r on r.id=x.request_id and r.sale_id=s.id
  on conflict (tenant_id,paperwork_request_id,source_system,source_sale_id) do nothing;
  if (select count(*) from public.paperwork_legacy_sale_sources where source_system='showroom' and source_sale_id in ('36efa3b4-12a1-4eff-b346-7467b08aa14d','67f4258b-b486-499a-83ed-fe43012bfcca'))<>2 then raise exception 'PAPERWORK_ARCHIVE_FAILED'; end if;
  update public.paperwork_requests set sale_id=null,sale_line_id=null where id in ('a4e4f61a-a730-42f0-82bc-9b353aedce76','27df8d14-6455-4a4f-be42-821c4f2116ad');

  if (select count(*) from public.paperwork_requests)<>205 or (select count(*) from public.paperwork_documents)<>59
    or (select count(*) from public.paperwork_requests where sale_id is not null)<>203 or (select count(*) from public.paperwork_requests where sale_line_id is not null)<>203
    or exists(select 1 from public.paperwork_requests r left join public.sales s on s.id=r.sale_id and s.tenant_id=r.tenant_id where r.sale_id is not null and s.id is null)
    or exists(select 1 from public.paperwork_requests r left join public.sale_lines l on l.id=r.sale_line_id and l.tenant_id=r.tenant_id where r.sale_line_id is not null and (l.id is null or l.sale_id<>r.sale_id))
    or exists(select 1 from public.paperwork_documents d left join public.sales s on s.id=d.sale_id and s.tenant_id=d.tenant_id where d.sale_id is not null and s.id is null) then raise exception 'PAPERWORK_CANONICAL_PREFLIGHT_FAILED'; end if;
  if v_before_moves<>(select count(*) from public.account_moves) or v_before_move_lines<>(select count(*) from public.account_move_lines) or v_before_payments<>(select count(*) from public.financial_payments) or v_before_reconciles<>(select count(*) from public.account_partial_reconcile) or v_before_stock<>(select count(*) from public.stock_moves) or v_before_reservations<>(select count(*) from public.inventory_reservations) or v_before_tracking is distinct from (select md5(string_agg(id::text||':'||status,',' order by id)) from public.stock_tracking_units) then raise exception 'PAPERWORK_DETACHMENT_SIDE_EFFECT'; end if;
end $$;

alter table public.paperwork_requests drop constraint paperwork_requests_sale_id_fkey;
alter table public.paperwork_requests drop constraint paperwork_requests_sale_line_id_fkey;
alter table public.paperwork_documents drop constraint paperwork_documents_sale_id_fkey;
alter table public.paperwork_requests add constraint paperwork_requests_sale_id_fkey foreign key(sale_id) references public.sales(id);
alter table public.paperwork_requests add constraint paperwork_requests_sale_line_id_fkey foreign key(sale_line_id) references public.sale_lines(id);
alter table public.paperwork_documents add constraint paperwork_documents_sale_id_fkey foreign key(sale_id) references public.sales(id) on delete restrict;

create or replace function public.sync_paperwork_document_sale_from_request() returns trigger language plpgsql security invoker set search_path=public as $$
declare v_request_sale_id uuid;
begin
  if new.paperwork_request_id is null then return new; end if;
  select pr.sale_id into v_request_sale_id from public.paperwork_requests pr where pr.id=new.paperwork_request_id and pr.tenant_id=new.tenant_id;
  if not found then raise exception 'طلب الأوراق المرتبط غير موجود داخل نفس المنشأة.'; end if;
  new.sale_id:=v_request_sale_id; return new;
end $$;
create or replace function public.sync_linked_paperwork_documents_sale() returns trigger language plpgsql security invoker set search_path=public as $$
begin
  update public.paperwork_documents set sale_id=new.sale_id where tenant_id=new.tenant_id and paperwork_request_id=new.id and sale_id is distinct from new.sale_id;
  return new;
end $$;

do $$
declare r record; v_definition text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('create_legacy_delivered_paperwork_request','link_vault_paperwork_request','receive_paperwork_request_from_processor')
  loop
    v_definition:=pg_get_functiondef(r.oid);
    v_definition:=replace(v_definition,'public.showroom_sales','public.sales');
    v_definition:=replace(v_definition,'public.showroom_sale_lines','public.sale_lines');
    execute v_definition;
  end loop;
  select pg_get_functiondef(p.oid) into v_definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='deliver_paperwork_to_customer';
  v_definition:=replace(v_definition,'v_sale public.showroom_sales%rowtype','v_sale public.sales%rowtype');
  v_definition:=replace(v_definition,'from public.showroom_sales','from public.sales');
  v_definition:=replace(v_definition,'''showroom_sale:'' || v_sale.id','''financial_sale_posting:'' || v_sale.id');
  v_definition:=replace(v_definition,'am.id = v_sale.account_move_id','am.id = (select financial_account_move_id from public.sale_historical_sources where tenant_id=p_tenant_id and sale_id=v_sale.id)');
  execute v_definition;
end $$;

commit;
