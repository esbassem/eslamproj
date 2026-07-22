begin;

alter table public.tenant_users
  add column if not exists partner_id uuid;

create unique index if not exists partners_id_tenant_id_uidx
  on public.partners (id, tenant_id);

create unique index if not exists tenant_users_partner_id_uidx
  on public.tenant_users (partner_id)
  where partner_id is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tenant_users'::regclass
      and conname = 'tenant_users_partner_tenant_fkey'
  ) then
    alter table public.tenant_users
      add constraint tenant_users_partner_tenant_fkey
      foreign key (partner_id, tenant_id)
      references public.partners (id, tenant_id)
      on delete set null (partner_id);
  end if;
end;
$$;

create or replace function public.ensure_tenant_user_financial_partner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.partner_id is null then
    insert into public.partners (
      tenant_id,
      name,
      phone1,
      mobile,
      email,
      contact_type,
      is_company,
      is_external_contact,
      customer_rank,
      supplier_rank,
      financer_rank,
      active
    )
    values (
      new.tenant_id,
      coalesce(nullif(btrim(new.full_name), ''), 'مستخدم داخلي'),
      nullif(btrim(new.phone), ''),
      nullif(btrim(new.phone), ''),
      nullif(btrim(new.email), ''),
      'person',
      false,
      false,
      0,
      0,
      0,
      true
    )
    returning id into new.partner_id;
  end if;

  return new;
end;
$$;

drop trigger if exists tenant_users_create_financial_partner on public.tenant_users;
create trigger tenant_users_create_financial_partner
before insert on public.tenant_users
for each row
execute function public.ensure_tenant_user_financial_partner();

create or replace function public.create_financial_partner_for_tenant_user(
  p_tenant_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_user public.tenant_users%rowtype;
  v_partner_id uuid;
begin
  select tenant_user.*
  into v_tenant_user
  from public.tenant_users tenant_user
  where tenant_user.id = p_tenant_user_id
  for update;

  if not found then
    raise exception 'مستخدم الشركة غير موجود.';
  end if;

  if not public.is_tenant_owner(v_tenant_user.tenant_id) then
    raise exception 'إنشاء الملفات المالية متاح فقط لمالك الشركة.'
      using errcode = '42501';
  end if;

  if v_tenant_user.partner_id is not null then
    return jsonb_build_object(
      'tenant_user_id', v_tenant_user.id,
      'partner_id', v_tenant_user.partner_id,
      'created', false
    );
  end if;

  insert into public.partners (
    tenant_id,
    name,
    phone1,
    mobile,
    email,
    contact_type,
    is_company,
    is_external_contact,
    customer_rank,
    supplier_rank,
    financer_rank,
    active
  )
  values (
    v_tenant_user.tenant_id,
    coalesce(nullif(btrim(v_tenant_user.full_name), ''), 'مستخدم داخلي'),
    nullif(btrim(v_tenant_user.phone), ''),
    nullif(btrim(v_tenant_user.phone), ''),
    nullif(btrim(v_tenant_user.email), ''),
    'person',
    false,
    false,
    0,
    0,
    0,
    true
  )
  returning id into v_partner_id;

  update public.tenant_users tenant_user
  set partner_id = v_partner_id,
      updated_at = now()
  where tenant_user.id = v_tenant_user.id;

  return jsonb_build_object(
    'tenant_user_id', v_tenant_user.id,
    'partner_id', v_partner_id,
    'created', true
  );
end;
$$;

create or replace function public.create_financial_partners_for_unlinked_tenant_users(
  p_tenant_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_user_id uuid;
  v_result jsonb;
  v_created_count integer := 0;
begin
  if not public.is_tenant_owner(p_tenant_id) then
    raise exception 'إنشاء الملفات المالية متاح فقط لمالك الشركة.'
      using errcode = '42501';
  end if;

  for v_tenant_user_id in
    select tenant_user.id
    from public.tenant_users tenant_user
    where tenant_user.tenant_id = p_tenant_id
      and tenant_user.partner_id is null
    order by tenant_user.created_at
  loop
    v_result := public.create_financial_partner_for_tenant_user(v_tenant_user_id);
    if coalesce((v_result ->> 'created')::boolean, false) then
      v_created_count := v_created_count + 1;
    end if;
  end loop;

  return v_created_count;
end;
$$;

revoke all on function public.ensure_tenant_user_financial_partner() from public;
revoke all on function public.create_financial_partner_for_tenant_user(uuid) from public;
revoke all on function public.create_financial_partners_for_unlinked_tenant_users(uuid) from public;

grant execute on function public.create_financial_partner_for_tenant_user(uuid) to authenticated;
grant execute on function public.create_financial_partners_for_unlinked_tenant_users(uuid) to authenticated;

comment on column public.tenant_users.partner_id is
'The internal financial partner linked one-to-one to this company user.';

comment on function public.create_financial_partner_for_tenant_user(uuid) is
'Creates and links one internal, non-customer partner for an existing tenant user. Owner only and idempotent.';

comment on function public.create_financial_partners_for_unlinked_tenant_users(uuid) is
'Creates internal financial partners for every unlinked user in the requested tenant. Owner only.';

commit;
