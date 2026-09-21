begin;

insert into public.auth_permissions (
  code, name, description, resource, action,
  module_code, permission_type, sort_order, active
)
values (
  'financial.payment_method.manage', 'إدارة طرق الدفع',
  'إنشاء وتعديل وتعطيل طرق الدفع الخاصة بالشركة.',
  'financial.payment_method', 'manage', 'accountant_app', 'action', 620, true
)
on conflict (code) do update set
  name = excluded.name, description = excluded.description,
  resource = excluded.resource, action = excluded.action,
  module_code = excluded.module_code, permission_type = excluded.permission_type,
  sort_order = excluded.sort_order, active = true, updated_at = now();

create table public.financial_payment_method_types (
  code text primary key,
  name text not null,
  default_requires_reference boolean not null default false,
  default_requires_confirmation boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint financial_payment_method_types_code_format_check
    check (code ~ '^[a-z][a-z0-9_]*$'),
  constraint financial_payment_method_types_name_not_blank check (btrim(name) <> '')
);

insert into public.financial_payment_method_types (
  code, name, default_requires_reference, default_requires_confirmation
)
values
  ('cash', 'Cash', false, false),
  ('bank_transfer', 'Bank Transfer', true, true),
  ('card', 'Card', true, true),
  ('wallet', 'Wallet', true, false),
  ('cheque', 'Cheque', true, true),
  ('other', 'Other', false, false);

create table public.financial_payment_method_destination_types (
  method_type text not null references public.financial_payment_method_types(code) on delete restrict,
  destination_type text not null references public.money_destination_types(code) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (method_type, destination_type)
);

insert into public.financial_payment_method_destination_types (method_type, destination_type)
values
  ('cash', 'cashbox'),
  ('cash', 'employee_cash_custody'),
  ('cash', 'pos_drawer'),
  ('bank_transfer', 'bank'),
  ('wallet', 'wallet');

create table public.financial_payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null,
  semantic_key text not null,
  method_type text not null references public.financial_payment_method_types(code) on delete restrict,
  is_active boolean not null default true,
  requires_reference boolean not null default false,
  requires_confirmation boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_payment_methods_created_by_fkey
    foreign key (created_by, tenant_id) references public.tenant_users(id, tenant_id) on delete set null,
  constraint financial_payment_methods_name_not_blank check (btrim(name) <> ''),
  constraint financial_payment_methods_semantic_key_format_check
    check (semantic_key ~ '^[a-z][a-z0-9_]*$'),
  constraint financial_payment_methods_metadata_object_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint financial_payment_methods_id_tenant_key unique (id, tenant_id),
  constraint financial_payment_methods_tenant_semantic_key unique (tenant_id, semantic_key)
);

create index financial_payment_methods_runtime_idx
  on public.financial_payment_methods (tenant_id, is_active, method_type, name);

create or replace function public.validate_financial_payment_method()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.name := btrim(new.name);
  new.semantic_key := lower(btrim(new.semantic_key));
  new.updated_at := now();
  if not exists (
    select 1 from public.financial_payment_method_types definition
    where definition.code = new.method_type and definition.is_active
  ) then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_TYPE_INVALID_OR_INACTIVE';
  end if;
  if tg_op = 'UPDATE' then
    if new.tenant_id is distinct from old.tenant_id then
      raise exception using errcode = '23514', message = 'PAYMENT_METHOD_TENANT_IMMUTABLE';
    end if;
    if new.semantic_key is distinct from old.semantic_key
       or new.method_type is distinct from old.method_type then
      raise exception using errcode = '23514', message = 'PAYMENT_METHOD_IDENTITY_IMMUTABLE';
    end if;
  end if;
  return new;
end
$$;

create trigger financial_payment_methods_validation_guard
before insert or update on public.financial_payment_methods
for each row execute function public.validate_financial_payment_method();

create or replace function public.save_financial_payment_method(
  p_tenant_id uuid,
  p_payment_method_id uuid,
  p_name text,
  p_semantic_key text,
  p_method_type text,
  p_is_active boolean default true,
  p_requires_reference boolean default null,
  p_requires_confirmation boolean default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  saved_id uuid;
  definition public.financial_payment_method_types%rowtype;
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.payment_method.manage', null, null, null, true
  );
  select * into definition from public.financial_payment_method_types
  where code = lower(btrim(p_method_type)) and is_active;
  if not found then
    raise exception using errcode = '23514', message = 'PAYMENT_METHOD_TYPE_INVALID_OR_INACTIVE';
  end if;
  if p_payment_method_id is null then
    insert into public.financial_payment_methods (
      tenant_id, name, semantic_key, method_type, is_active,
      requires_reference, requires_confirmation, metadata, created_by
    ) values (
      p_tenant_id, p_name, p_semantic_key, definition.code, coalesce(p_is_active, true),
      coalesce(p_requires_reference, definition.default_requires_reference),
      coalesce(p_requires_confirmation, definition.default_requires_confirmation),
      coalesce(p_metadata, '{}'::jsonb), public.current_tenant_user_id()
    ) returning id into saved_id;
  else
    update public.financial_payment_methods method set
      name = p_name,
      semantic_key = p_semantic_key,
      method_type = lower(btrim(p_method_type)),
      is_active = coalesce(p_is_active, method.is_active),
      requires_reference = coalesce(p_requires_reference, method.requires_reference),
      requires_confirmation = coalesce(p_requires_confirmation, method.requires_confirmation),
      metadata = coalesce(p_metadata, '{}'::jsonb)
    where method.id = p_payment_method_id and method.tenant_id = p_tenant_id
    returning method.id into saved_id;
    if saved_id is null then
      raise exception using errcode = 'P0002', message = 'PAYMENT_METHOD_NOT_FOUND';
    end if;
  end if;
  return saved_id;
end
$$;

create or replace function public.is_payment_method_compatible_with_destination(
  p_payment_method_id uuid,
  p_destination_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.financial_payment_methods method
    join public.money_destinations destination
      on destination.id = p_destination_id
     and destination.tenant_id = method.tenant_id
    join public.financial_payment_method_destination_types compatibility
      on compatibility.method_type = method.method_type
     and compatibility.destination_type = destination.destination_type
    where method.id = p_payment_method_id
      and method.is_active
      and destination.status = 'active'
      and method.tenant_id = public.current_tenant_id()
  )
$$;

create or replace function public.list_available_financial_payment_methods(
  p_tenant_id uuid,
  p_permission_code text
)
returns table (
  payment_method_id uuid, semantic_key text, payment_method_name text,
  method_type text, requires_reference boolean, requires_confirmation boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select method.id, method.semantic_key, method.name, method.method_type,
    method.requires_reference, method.requires_confirmation
  from public.financial_payment_methods method
  where method.tenant_id = p_tenant_id and method.is_active
    and public.current_tenant_id() = p_tenant_id
    and p_permission_code like 'financial.payment.%'
    and public.has_permission(p_permission_code, p_tenant_id)
  order by method.name, method.id
$$;

create or replace function public.list_allowed_payment_destinations(
  p_tenant_id uuid,
  p_payment_method_id uuid,
  p_permission_code text,
  p_access_type text,
  p_branch_id uuid default null
)
returns table (
  destination_id uuid, destination_key text, destination_name text,
  destination_type text, branch_id uuid, responsible_user_id uuid,
  ledger_account_id uuid, journal_id uuid, is_own_custody boolean
)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select allowed.*
  from public.financial_payment_methods method
  join lateral public.list_allowed_money_destinations(
    p_tenant_id, p_permission_code, p_access_type, p_branch_id,
    array(
      select compatibility.destination_type
      from public.financial_payment_method_destination_types compatibility
      where compatibility.method_type = method.method_type
      order by compatibility.destination_type
    )
  ) allowed on true
  where method.id = p_payment_method_id
    and method.tenant_id = p_tenant_id
    and method.is_active
    and public.current_tenant_id() = p_tenant_id
$$;

create or replace function public.get_payment_method_destination_selection(
  p_tenant_id uuid,
  p_payment_method_id uuid,
  p_permission_code text,
  p_access_type text,
  p_branch_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with allowed as materialized (
    select * from public.list_allowed_payment_destinations(
      p_tenant_id, p_payment_method_id, p_permission_code, p_access_type, p_branch_id
    )
  ), summary as (
    select count(*)::integer allowed_count,
      (array_agg(destination_id order by destination_id))[1] single_id
    from allowed
  )
  select jsonb_build_object(
    'allowed_count', summary.allowed_count,
    'selection_state', case summary.allowed_count
      when 0 then 'none' when 1 then 'single' else 'multiple' end,
    'auto_selected_destination_id', case when summary.allowed_count = 1
      then summary.single_id else null end,
    'reason', case when summary.allowed_count = 0
      then 'NO_ALLOWED_PAYMENT_DESTINATION' else null end,
    'destinations', coalesce((select jsonb_agg(to_jsonb(item)
      order by item.is_own_custody desc, item.destination_name, item.destination_id)
      from allowed item), '[]'::jsonb)
  ) from summary
$$;

alter table public.financial_payment_method_types enable row level security;
alter table public.financial_payment_method_destination_types enable row level security;
alter table public.financial_payment_methods enable row level security;

revoke all on public.financial_payment_method_types from public, anon, authenticated;
revoke all on public.financial_payment_method_destination_types from public, anon, authenticated;
revoke all on public.financial_payment_methods from public, anon, authenticated;
grant select on public.financial_payment_method_types to authenticated;
grant select on public.financial_payment_method_destination_types to authenticated;
grant select on public.financial_payment_methods to authenticated;

create policy financial_payment_method_types_read
on public.financial_payment_method_types for select to authenticated using (is_active);
create policy financial_payment_method_destination_types_read
on public.financial_payment_method_destination_types for select to authenticated
using (exists (
  select 1 from public.financial_payment_method_types definition
  where definition.code = method_type and definition.is_active
));
create policy financial_payment_methods_read
on public.financial_payment_methods for select to authenticated
using (
  tenant_id = public.current_tenant_id()
  and (
    public.has_permission('financial.payment_method.manage', tenant_id)
    or public.has_permission('financial.payment.create', tenant_id)
    or public.has_permission('financial.payment.submit', tenant_id)
    or public.has_permission('financial.payment.confirm', tenant_id)
    or public.has_permission('financial.payment.refund', tenant_id)
  )
);

revoke all on function public.save_financial_payment_method(uuid,uuid,text,text,text,boolean,boolean,boolean,jsonb) from public, anon;
revoke all on function public.is_payment_method_compatible_with_destination(uuid,uuid) from public, anon;
revoke all on function public.list_available_financial_payment_methods(uuid,text) from public, anon;
revoke all on function public.list_allowed_payment_destinations(uuid,uuid,text,text,uuid) from public, anon;
revoke all on function public.get_payment_method_destination_selection(uuid,uuid,text,text,uuid) from public, anon;
grant execute on function public.save_financial_payment_method(uuid,uuid,text,text,text,boolean,boolean,boolean,jsonb) to authenticated;
grant execute on function public.is_payment_method_compatible_with_destination(uuid,uuid) to authenticated;
grant execute on function public.list_available_financial_payment_methods(uuid,text) to authenticated;
grant execute on function public.list_allowed_payment_destinations(uuid,uuid,text,text,uuid) to authenticated;
grant execute on function public.get_payment_method_destination_selection(uuid,uuid,text,text,uuid) to authenticated;

comment on table public.financial_payment_methods is
  'Phase 4A tenant configuration: how money moves. It is deliberately independent from where money lands and creates no payment or ledger entry.';
comment on table public.financial_payment_method_destination_types is
  'Central method-type to destination-type compatibility. Card, cheque and other intentionally have no direct destination mapping until their later lifecycle exists.';
comment on function public.list_allowed_payment_destinations(uuid,uuid,text,text,uuid) is
  'Intersection of active payment-method compatibility and the Phase 3C permission, branch and account-resource scope contract.';

commit;
