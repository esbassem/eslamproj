begin;

-- Composite keys make tenant integrity enforceable by foreign keys.
create unique index if not exists pos_configs_id_tenant_branch_unique
  on public.pos_configs (id, tenant_id, branch_id);
create unique index if not exists account_accounts_id_tenant_unique
  on public.account_accounts (id, tenant_id);
create unique index if not exists stock_locations_id_tenant_branch_unique
  on public.stock_locations (id, tenant_id, branch_id);

create table if not exists public.user_branch_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  branch_id uuid not null,
  created_at timestamptz not null default now(),
  constraint user_branch_access_user_tenant_fkey
    foreign key (user_id, tenant_id)
    references public.tenant_users (id, tenant_id) on delete cascade,
  constraint user_branch_access_branch_tenant_fkey
    foreign key (branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete cascade,
  constraint user_branch_access_unique unique (tenant_id, user_id, branch_id)
);

create table if not exists public.user_pos_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  pos_id uuid not null,
  branch_id uuid not null,
  created_at timestamptz not null default now(),
  constraint user_pos_access_user_tenant_fkey
    foreign key (user_id, tenant_id)
    references public.tenant_users (id, tenant_id) on delete cascade,
  constraint user_pos_access_pos_tenant_branch_fkey
    foreign key (pos_id, tenant_id, branch_id)
    references public.pos_configs (id, tenant_id, branch_id) on delete cascade,
  constraint user_pos_access_parent_branch_fkey
    foreign key (tenant_id, user_id, branch_id)
    references public.user_branch_access (tenant_id, user_id, branch_id) on delete restrict,
  constraint user_pos_access_unique unique (tenant_id, user_id, pos_id),
  constraint user_pos_access_hierarchy_unique unique (tenant_id, user_id, pos_id, branch_id)
);

create table if not exists public.user_stock_location_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  stock_location_id uuid not null,
  branch_id uuid not null,
  created_at timestamptz not null default now(),
  constraint user_stock_location_access_user_tenant_fkey
    foreign key (user_id, tenant_id)
    references public.tenant_users (id, tenant_id) on delete cascade,
  constraint user_stock_location_access_location_tenant_branch_fkey
    foreign key (stock_location_id, tenant_id, branch_id)
    references public.stock_locations (id, tenant_id, branch_id) on delete cascade,
  constraint user_stock_location_access_parent_branch_fkey
    foreign key (tenant_id, user_id, branch_id)
    references public.user_branch_access (tenant_id, user_id, branch_id) on delete restrict,
  constraint user_stock_location_access_unique unique (tenant_id, user_id, stock_location_id),
  constraint user_stock_location_access_hierarchy_unique
    unique (tenant_id, user_id, stock_location_id, branch_id)
);

create table if not exists public.user_account_access (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  account_id uuid not null,
  created_at timestamptz not null default now(),
  constraint user_account_access_user_tenant_fkey
    foreign key (user_id, tenant_id)
    references public.tenant_users (id, tenant_id) on delete cascade,
  constraint user_account_access_account_tenant_fkey
    foreign key (account_id, tenant_id)
    references public.account_accounts (id, tenant_id) on delete cascade,
  constraint user_account_access_unique unique (tenant_id, user_id, account_id)
);

create table if not exists public.user_operational_defaults (
  tenant_id uuid not null,
  user_id uuid not null,
  default_branch_id uuid,
  default_pos_id uuid,
  default_stock_location_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_operational_defaults_pkey primary key (tenant_id, user_id),
  constraint user_operational_defaults_user_tenant_fkey
    foreign key (user_id, tenant_id)
    references public.tenant_users (id, tenant_id) on delete cascade,
  constraint user_operational_defaults_branch_tenant_fkey
    foreign key (default_branch_id, tenant_id)
    references public.branches (id, tenant_id) on delete restrict,
  constraint user_operational_defaults_pos_tenant_branch_fkey
    foreign key (default_pos_id, tenant_id, default_branch_id)
    references public.pos_configs (id, tenant_id, branch_id) on delete restrict,
  constraint user_operational_defaults_stock_tenant_branch_fkey
    foreign key (default_stock_location_id, tenant_id, default_branch_id)
    references public.stock_locations (id, tenant_id, branch_id) on delete restrict,
  constraint user_operational_defaults_pos_requires_branch
    check (default_pos_id is null or default_branch_id is not null),
  constraint user_operational_defaults_stock_requires_branch
    check (default_stock_location_id is null or default_branch_id is not null)
);

create index if not exists user_branch_access_user_idx
  on public.user_branch_access (tenant_id, user_id);
create index if not exists user_branch_access_branch_idx
  on public.user_branch_access (tenant_id, branch_id);
create index if not exists user_pos_access_user_idx
  on public.user_pos_access (tenant_id, user_id);
create index if not exists user_pos_access_pos_idx
  on public.user_pos_access (tenant_id, pos_id);
create index if not exists user_stock_location_access_user_idx
  on public.user_stock_location_access (tenant_id, user_id);
create index if not exists user_stock_location_access_location_idx
  on public.user_stock_location_access (tenant_id, stock_location_id);
create index if not exists user_account_access_user_idx
  on public.user_account_access (tenant_id, user_id);
create index if not exists user_account_access_account_idx
  on public.user_account_access (tenant_id, account_id);

create or replace function public.validate_user_operational_defaults()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_role text;
begin
  select tenant_user.role
  into target_role
  from public.tenant_users tenant_user
  where tenant_user.id = new.user_id
    and tenant_user.tenant_id = new.tenant_id
    and tenant_user.is_active = true;

  if target_role is null then
    raise exception 'SCOPE_TARGET_USER_INACTIVE_OR_MISSING' using errcode = '23514';
  end if;

  if target_role <> 'owner' then
    if new.default_branch_id is not null and not exists (
      select 1 from public.user_branch_access branch_access
      where branch_access.tenant_id = new.tenant_id
        and branch_access.user_id = new.user_id
        and branch_access.branch_id = new.default_branch_id
    ) then
      raise exception 'DEFAULT_BRANCH_NOT_ALLOWED' using errcode = '23514';
    end if;

    if new.default_pos_id is not null and not exists (
      select 1 from public.user_pos_access pos_access
      where pos_access.tenant_id = new.tenant_id
        and pos_access.user_id = new.user_id
        and pos_access.pos_id = new.default_pos_id
        and pos_access.branch_id = new.default_branch_id
    ) then
      raise exception 'DEFAULT_POS_NOT_ALLOWED' using errcode = '23514';
    end if;

    if new.default_stock_location_id is not null and not exists (
      select 1 from public.user_stock_location_access stock_access
      where stock_access.tenant_id = new.tenant_id
        and stock_access.user_id = new.user_id
        and stock_access.stock_location_id = new.default_stock_location_id
        and stock_access.branch_id = new.default_branch_id
    ) then
      raise exception 'DEFAULT_STOCK_LOCATION_NOT_ALLOWED' using errcode = '23514';
    end if;
  end if;

  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists user_operational_defaults_validate on public.user_operational_defaults;
create trigger user_operational_defaults_validate
before insert or update on public.user_operational_defaults
for each row execute function public.validate_user_operational_defaults();

create or replace function public.has_branch_access(p_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with caller as (
    select tenant_user.id, tenant_user.tenant_id, tenant_user.role
    from public.tenant_users tenant_user
    where tenant_user.id = public.current_tenant_user_id()
      and tenant_user.is_active = true
  )
  select exists (
    select 1
    from caller
    join public.branches branch on branch.id = p_branch_id and branch.tenant_id = caller.tenant_id
    where caller.role = 'owner'
       or exists (
         select 1 from public.user_branch_access branch_access
         where branch_access.tenant_id = caller.tenant_id
           and branch_access.user_id = caller.id
           and branch_access.branch_id = branch.id
       )
  )
$$;

create or replace function public.has_pos_access(p_pos_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with caller as (
    select tenant_user.id, tenant_user.tenant_id, tenant_user.role
    from public.tenant_users tenant_user
    where tenant_user.id = public.current_tenant_user_id()
      and tenant_user.is_active = true
  )
  select exists (
    select 1
    from caller
    join public.pos_configs pos on pos.id = p_pos_id and pos.tenant_id = caller.tenant_id
    where caller.role = 'owner'
       or exists (
         select 1 from public.user_pos_access pos_access
         where pos_access.tenant_id = caller.tenant_id
           and pos_access.user_id = caller.id
           and pos_access.pos_id = pos.id
       )
  )
$$;

create or replace function public.has_stock_location_access(p_stock_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with caller as (
    select tenant_user.id, tenant_user.tenant_id, tenant_user.role
    from public.tenant_users tenant_user
    where tenant_user.id = public.current_tenant_user_id()
      and tenant_user.is_active = true
  )
  select exists (
    select 1
    from caller
    join public.stock_locations stock_location
      on stock_location.id = p_stock_location_id
     and stock_location.tenant_id = caller.tenant_id
    where caller.role = 'owner'
       or exists (
         select 1 from public.user_stock_location_access stock_access
         where stock_access.tenant_id = caller.tenant_id
           and stock_access.user_id = caller.id
           and stock_access.stock_location_id = stock_location.id
       )
  )
$$;

create or replace function public.has_account_access(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with caller as (
    select tenant_user.id, tenant_user.tenant_id, tenant_user.role
    from public.tenant_users tenant_user
    where tenant_user.id = public.current_tenant_user_id()
      and tenant_user.is_active = true
  )
  select exists (
    select 1
    from caller
    join public.account_accounts account
      on account.id = p_account_id
     and account.tenant_id = caller.tenant_id
    where caller.role = 'owner'
       or exists (
         select 1 from public.user_account_access account_access
         where account_access.tenant_id = caller.tenant_id
           and account_access.user_id = caller.id
           and account_access.account_id = account.id
       )
  )
$$;

create or replace function public.get_my_resource_scope()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with caller as (
    select tenant_user.id, tenant_user.tenant_id, tenant_user.role
    from public.tenant_users tenant_user
    where tenant_user.id = public.current_tenant_user_id()
      and tenant_user.is_active = true
  ), defaults as (
    select operational_defaults.*
    from caller
    left join public.user_operational_defaults operational_defaults
      on operational_defaults.tenant_id = caller.tenant_id
     and operational_defaults.user_id = caller.id
  )
  select coalesce((
    select jsonb_build_object(
      'tenant_id', caller.tenant_id,
      'tenant_user_id', caller.id,
      'allowed_branch_ids', case when caller.role = 'owner'
        then coalesce((select jsonb_agg(branch.id order by branch.id) from public.branches branch where branch.tenant_id = caller.tenant_id), '[]'::jsonb)
        else coalesce((select jsonb_agg(branch_access.branch_id order by branch_access.branch_id) from public.user_branch_access branch_access where branch_access.tenant_id = caller.tenant_id and branch_access.user_id = caller.id), '[]'::jsonb) end,
      'allowed_pos_ids', case when caller.role = 'owner'
        then coalesce((select jsonb_agg(pos.id order by pos.id) from public.pos_configs pos where pos.tenant_id = caller.tenant_id), '[]'::jsonb)
        else coalesce((select jsonb_agg(pos_access.pos_id order by pos_access.pos_id) from public.user_pos_access pos_access where pos_access.tenant_id = caller.tenant_id and pos_access.user_id = caller.id), '[]'::jsonb) end,
      'allowed_stock_location_ids', case when caller.role = 'owner'
        then coalesce((select jsonb_agg(stock_location.id order by stock_location.id) from public.stock_locations stock_location where stock_location.tenant_id = caller.tenant_id), '[]'::jsonb)
        else coalesce((select jsonb_agg(stock_access.stock_location_id order by stock_access.stock_location_id) from public.user_stock_location_access stock_access where stock_access.tenant_id = caller.tenant_id and stock_access.user_id = caller.id), '[]'::jsonb) end,
      'allowed_account_ids', case when caller.role = 'owner'
        then coalesce((select jsonb_agg(account.id order by account.id) from public.account_accounts account where account.tenant_id = caller.tenant_id), '[]'::jsonb)
        else coalesce((select jsonb_agg(account_access.account_id order by account_access.account_id) from public.user_account_access account_access where account_access.tenant_id = caller.tenant_id and account_access.user_id = caller.id), '[]'::jsonb) end,
      'default_branch_id', defaults.default_branch_id,
      'default_pos_id', defaults.default_pos_id,
      'default_stock_location_id', defaults.default_stock_location_id
    )
    from caller
    left join defaults on true
  ), jsonb_build_object(
    'tenant_id', null,
    'tenant_user_id', null,
    'allowed_branch_ids', '[]'::jsonb,
    'allowed_pos_ids', '[]'::jsonb,
    'allowed_stock_location_ids', '[]'::jsonb,
    'allowed_account_ids', '[]'::jsonb,
    'default_branch_id', null,
    'default_pos_id', null,
    'default_stock_location_id', null
  ))
$$;

create or replace function public.get_my_authorization()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object(
    'permission_codes', to_jsonb(public.get_my_permissions()),
    'resource_scope', public.get_my_resource_scope()
  )
$$;

do $$
declare v_table_name text;
begin
  foreach v_table_name in array array[
    'user_branch_access', 'user_pos_access', 'user_stock_location_access',
    'user_account_access', 'user_operational_defaults'
  ] loop
    execute format('alter table public.%I enable row level security', v_table_name);
    execute format('revoke all privileges on table public.%I from anon, authenticated', v_table_name);
  end loop;
end
$$;

drop policy if exists user_branch_access_read on public.user_branch_access;
create policy user_branch_access_read on public.user_branch_access
for select to authenticated using (
  tenant_id = public.current_tenant_id()
  and (user_id = public.current_tenant_user_id() or public.is_current_tenant_owner(tenant_id))
);
drop policy if exists user_branch_access_insert_owner on public.user_branch_access;
create policy user_branch_access_insert_owner on public.user_branch_access
for insert to authenticated with check (public.is_current_tenant_owner(tenant_id));
drop policy if exists user_branch_access_delete_owner on public.user_branch_access;
create policy user_branch_access_delete_owner on public.user_branch_access
for delete to authenticated using (public.is_current_tenant_owner(tenant_id));

drop policy if exists user_pos_access_read on public.user_pos_access;
create policy user_pos_access_read on public.user_pos_access
for select to authenticated using (
  tenant_id = public.current_tenant_id()
  and (user_id = public.current_tenant_user_id() or public.is_current_tenant_owner(tenant_id))
);
drop policy if exists user_pos_access_insert_owner on public.user_pos_access;
create policy user_pos_access_insert_owner on public.user_pos_access
for insert to authenticated with check (public.is_current_tenant_owner(tenant_id));
drop policy if exists user_pos_access_delete_owner on public.user_pos_access;
create policy user_pos_access_delete_owner on public.user_pos_access
for delete to authenticated using (public.is_current_tenant_owner(tenant_id));

drop policy if exists user_stock_location_access_read on public.user_stock_location_access;
create policy user_stock_location_access_read on public.user_stock_location_access
for select to authenticated using (
  tenant_id = public.current_tenant_id()
  and (user_id = public.current_tenant_user_id() or public.is_current_tenant_owner(tenant_id))
);
drop policy if exists user_stock_location_access_insert_owner on public.user_stock_location_access;
create policy user_stock_location_access_insert_owner on public.user_stock_location_access
for insert to authenticated with check (public.is_current_tenant_owner(tenant_id));
drop policy if exists user_stock_location_access_delete_owner on public.user_stock_location_access;
create policy user_stock_location_access_delete_owner on public.user_stock_location_access
for delete to authenticated using (public.is_current_tenant_owner(tenant_id));

drop policy if exists user_account_access_read on public.user_account_access;
create policy user_account_access_read on public.user_account_access
for select to authenticated using (
  tenant_id = public.current_tenant_id()
  and (user_id = public.current_tenant_user_id() or public.is_current_tenant_owner(tenant_id))
);
drop policy if exists user_account_access_insert_owner on public.user_account_access;
create policy user_account_access_insert_owner on public.user_account_access
for insert to authenticated with check (public.is_current_tenant_owner(tenant_id));
drop policy if exists user_account_access_delete_owner on public.user_account_access;
create policy user_account_access_delete_owner on public.user_account_access
for delete to authenticated using (public.is_current_tenant_owner(tenant_id));

drop policy if exists user_operational_defaults_read on public.user_operational_defaults;
create policy user_operational_defaults_read on public.user_operational_defaults
for select to authenticated using (
  tenant_id = public.current_tenant_id()
  and (user_id = public.current_tenant_user_id() or public.is_current_tenant_owner(tenant_id))
);
drop policy if exists user_operational_defaults_insert_owner on public.user_operational_defaults;
create policy user_operational_defaults_insert_owner on public.user_operational_defaults
for insert to authenticated with check (public.is_current_tenant_owner(tenant_id));
drop policy if exists user_operational_defaults_update_owner on public.user_operational_defaults;
create policy user_operational_defaults_update_owner on public.user_operational_defaults
for update to authenticated
using (public.is_current_tenant_owner(tenant_id))
with check (public.is_current_tenant_owner(tenant_id));
drop policy if exists user_operational_defaults_delete_owner on public.user_operational_defaults;
create policy user_operational_defaults_delete_owner on public.user_operational_defaults
for delete to authenticated using (public.is_current_tenant_owner(tenant_id));

grant select, insert, delete on public.user_branch_access, public.user_pos_access,
  public.user_stock_location_access, public.user_account_access to authenticated;
grant select, insert, update, delete on public.user_operational_defaults to authenticated;

revoke all on function public.validate_user_operational_defaults() from public, anon, authenticated;

do $$
declare function_record record;
begin
  for function_record in
    select function_row.oid::regprocedure as signature
    from pg_proc function_row
    join pg_namespace function_schema on function_schema.oid = function_row.pronamespace
    where function_schema.nspname = 'public'
      and function_row.proname = any(array[
        'has_branch_access', 'has_pos_access', 'has_stock_location_access',
        'has_account_access', 'get_my_resource_scope', 'get_my_authorization'
      ])
  loop
    execute format('revoke all on function %s from public, anon', function_record.signature);
    execute format('grant execute on function %s to authenticated', function_record.signature);
  end loop;
end
$$;

comment on table public.user_branch_access is 'Explicit branch allow assignments for non-owner tenant users.';
comment on table public.user_pos_access is 'Explicit POS allow assignments constrained by branch access.';
comment on table public.user_stock_location_access is 'Explicit stock-location allows constrained by branch access.';
comment on table public.user_account_access is 'Explicit account allows; responsible_user_id is not authorization.';
comment on table public.user_operational_defaults is 'Operational defaults validated against owner scope or explicit assignments.';

commit;
