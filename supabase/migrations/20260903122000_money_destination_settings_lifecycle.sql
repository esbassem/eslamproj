begin;

create table public.money_destination_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  destination_id uuid not null,
  event_type text not null,
  from_status text,
  to_status text,
  actor_user_id uuid not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (destination_id, tenant_id)
    references public.money_destinations(id, tenant_id) on delete restrict,
  foreign key (actor_user_id, tenant_id)
    references public.tenant_users(id, tenant_id) on delete restrict,
  check (event_type in ('created', 'deactivated', 'reactivated', 'archived')),
  check (jsonb_typeof(metadata) = 'object')
);

create index money_destination_events_destination_idx
  on public.money_destination_events (tenant_id, destination_id, created_at desc);

alter table public.money_destination_events enable row level security;
revoke all on public.money_destination_events from public, anon, authenticated;

create or replace function public.create_and_provision_money_destination(
  p_tenant_id uuid, p_destination_key text, p_name text,
  p_destination_type text, p_branch_id uuid default null,
  p_responsible_user_id uuid default null, p_pos_config_id uuid default null,
  p_bank_name text default null, p_bank_account_label text default null,
  p_bank_identifier_masked text default null, p_metadata jsonb default '{}'::jsonb,
  p_activate boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  destination public.money_destinations%rowtype;
  result jsonb;
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.destination.manage', null, null, p_branch_id, true
  );
  perform pg_advisory_xact_lock(hashtextextended(
    'money_destination_create:' || p_tenant_id::text || ':' || lower(btrim(p_destination_key)), 0
  ));

  select * into destination
  from public.money_destinations
  where tenant_id = p_tenant_id and destination_key = lower(btrim(p_destination_key))
  for update;

  if found then
    if destination.name is distinct from btrim(p_name)
       or destination.destination_type is distinct from p_destination_type
       or destination.branch_id is distinct from p_branch_id
       or destination.responsible_user_id is distinct from p_responsible_user_id
       or destination.pos_config_id is distinct from p_pos_config_id
       or destination.bank_name is distinct from nullif(btrim(p_bank_name), '')
       or destination.bank_account_label is distinct from nullif(btrim(p_bank_account_label), '')
       or destination.bank_identifier_masked is distinct from nullif(btrim(p_bank_identifier_masked), '')
       or destination.metadata is distinct from coalesce(p_metadata, '{}'::jsonb) then
      raise exception using errcode = '23505', message = 'MONEY_DESTINATION_IDEMPOTENCY_CONFLICT';
    end if;
    return public.provision_money_destination(p_tenant_id, destination.id, p_activate);
  end if;

  insert into public.money_destinations (
    tenant_id, destination_key, name, destination_type, status, branch_id,
    responsible_user_id, pos_config_id, bank_name, bank_account_label,
    bank_identifier_masked, metadata, created_by
  ) values (
    p_tenant_id, p_destination_key, p_name, p_destination_type, 'draft', p_branch_id,
    p_responsible_user_id, p_pos_config_id, p_bank_name, p_bank_account_label,
    p_bank_identifier_masked, coalesce(p_metadata, '{}'::jsonb),
    public.current_tenant_user_id()
  ) returning * into destination;

  result := public.provision_money_destination(p_tenant_id, destination.id, p_activate);
  insert into public.money_destination_events (
    tenant_id, destination_id, event_type, from_status, to_status, actor_user_id
  ) values (
    p_tenant_id, destination.id, 'created', null, result->>'status', public.current_tenant_user_id()
  );
  return result;
end
$$;

create or replace function public.set_money_destination_status(
  p_tenant_id uuid,
  p_destination_id uuid,
  p_target_status text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  destination public.money_destinations%rowtype;
  event_name text;
begin
  perform pg_advisory_xact_lock(hashtextextended(
    'money_destination:' || p_tenant_id::text || ':' || p_destination_id::text, 0
  ));
  select * into destination
  from public.money_destinations
  where id = p_destination_id and tenant_id = p_tenant_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'MONEY_DESTINATION_NOT_FOUND';
  end if;

  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.destination.manage', null, null, destination.branch_id, true
  );
  if p_target_status not in ('active', 'inactive', 'archived') then
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_STATUS_TARGET_INVALID';
  end if;
  if destination.status = p_target_status then
    return jsonb_build_object('destination_id', destination.id, 'status', destination.status);
  end if;

  if destination.status = 'active' and p_target_status = 'inactive' then
    event_name := 'deactivated';
  elsif destination.status = 'inactive' and p_target_status = 'active' then
    event_name := 'reactivated';
  elsif destination.status = 'inactive' and p_target_status = 'archived' then
    event_name := 'archived';
  else
    raise exception using errcode = '23514', message = 'MONEY_DESTINATION_STATUS_TRANSITION_INVALID';
  end if;

  update public.money_destinations
  set status = p_target_status
  where id = destination.id and tenant_id = destination.tenant_id;

  insert into public.money_destination_events (
    tenant_id, destination_id, event_type, from_status, to_status, actor_user_id
  ) values (
    destination.tenant_id, destination.id, event_name,
    destination.status, p_target_status, public.current_tenant_user_id()
  );

  return jsonb_build_object('destination_id', destination.id, 'status', p_target_status);
end
$$;

revoke all on function public.set_money_destination_status(uuid, uuid, text) from public, anon;
grant execute on function public.set_money_destination_status(uuid, uuid, text) to authenticated;

comment on table public.money_destination_events is
  'Append-only audit trail for supported Money Destination lifecycle commands.';
comment on function public.set_money_destination_status(uuid, uuid, text) is
  'Tenant-safe lifecycle command supporting active to inactive, inactive to active, and inactive to archived without deleting history.';

commit;
