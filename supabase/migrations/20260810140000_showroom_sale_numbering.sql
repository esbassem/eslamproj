begin;

lock table public.showroom_sales in share row exclusive mode;

create table if not exists public.showroom_sale_number_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sale_year integer not null check (sale_year between 2000 and 9999),
  last_value bigint not null check (last_value >= 0 and last_value <= 999999),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, sale_year)
);

revoke all on table public.showroom_sale_number_sequences from public, anon, authenticated;

alter table public.showroom_sales
  drop constraint if exists showroom_sales_tenant_sale_number_key;

alter table public.showroom_sales
  add constraint showroom_sales_tenant_sale_number_key
  unique (tenant_id, sale_number);

do $$
declare
  v_numbered_count bigint;
begin
  if exists (
    select 1
    from public.showroom_sales
    where sale_number is not null
      and sale_number !~ '^[0-9]{4}-[0-9]{6}$'
  ) then
    raise exception 'Existing showroom sale numbers do not match YYYY-NNNNNN.';
  end if;

  with existing_max as (
    select
      tenant_id,
      substring(sale_number from 1 for 4)::integer as sale_year,
      max(substring(sale_number from 6 for 6)::bigint) as max_serial
    from public.showroom_sales
    where sale_number ~ '^[0-9]{4}-[0-9]{6}$'
    group by tenant_id, substring(sale_number from 1 for 4)::integer
  ),
  candidates as (
    select
      sale.id,
      sale.tenant_id,
      extract(year from coalesce(
        account_move.date,
        sale.sale_date::timestamptz,
        sale.created_at
      ))::integer as sale_year,
      coalesce(
        account_move.date,
        sale.sale_date::timestamptz,
        sale.created_at
      ) as effective_confirmation_at,
      sale.created_at
    from public.showroom_sales sale
    left join public.account_moves account_move
      on account_move.id = sale.account_move_id
     and account_move.tenant_id = sale.tenant_id
    where sale.sale_number is null
      and sale.status in ('confirmed', 'cancelled')
  ),
  ranked as (
    select
      candidate.id,
      candidate.tenant_id,
      candidate.sale_year,
      coalesce(existing.max_serial, 0)
        + row_number() over (
          partition by candidate.tenant_id, candidate.sale_year
          order by
            candidate.effective_confirmation_at,
            candidate.created_at,
            candidate.id
        ) as serial_number
    from candidates candidate
    left join existing_max existing
      on existing.tenant_id = candidate.tenant_id
     and existing.sale_year = candidate.sale_year
  )
  update public.showroom_sales sale
  set sale_number = ranked.sale_year::text
    || '-'
    || lpad(ranked.serial_number::text, 6, '0')
  from ranked
  where sale.id = ranked.id
    and sale.tenant_id = ranked.tenant_id;

  get diagnostics v_numbered_count = row_count;
  raise notice 'showroom sales numbered by backfill: %', v_numbered_count;

  if exists (
    select 1
    from public.showroom_sales
    where status in ('confirmed', 'cancelled')
      and sale_number is null
  ) then
    raise exception 'Some historical confirmed or cancelled showroom sales remain unnumbered.';
  end if;
end;
$$;

insert into public.showroom_sale_number_sequences (
  tenant_id,
  sale_year,
  last_value,
  updated_at
)
select
  tenant_id,
  substring(sale_number from 1 for 4)::integer,
  max(substring(sale_number from 6 for 6)::bigint),
  now()
from public.showroom_sales
where sale_number ~ '^[0-9]{4}-[0-9]{6}$'
group by tenant_id, substring(sale_number from 1 for 4)::integer
on conflict (tenant_id, sale_year)
do update set
  last_value = greatest(
    public.showroom_sale_number_sequences.last_value,
    excluded.last_value
  ),
  updated_at = now();

create or replace function public.assign_showroom_sale_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale_year integer;
  v_next_value bigint;
begin
  if tg_op = 'UPDATE' and old.sale_number is not null then
    if new.sale_number is distinct from old.sale_number then
      raise exception 'رقم فاتورة الشو روم نهائي ولا يمكن تعديله أو مسحه.';
    end if;
    return new;
  end if;

  if new.sale_number is not null then
    raise exception 'لا يمكن تعيين رقم فاتورة الشو روم يدويًا.';
  end if;

  if new.status <> 'confirmed' then
    return new;
  end if;

  v_sale_year := extract(year from current_date)::integer;

  insert into public.showroom_sale_number_sequences (
    tenant_id,
    sale_year,
    last_value,
    updated_at
  )
  values (
    new.tenant_id,
    v_sale_year,
    1,
    now()
  )
  on conflict (tenant_id, sale_year)
  do update set
    last_value = public.showroom_sale_number_sequences.last_value + 1,
    updated_at = now()
  returning last_value into v_next_value;

  if v_next_value > 999999 then
    raise exception 'تم استهلاك كل أرقام فواتير الشو روم للسنة %.', v_sale_year;
  end if;

  new.sale_number := v_sale_year::text
    || '-'
    || lpad(v_next_value::text, 6, '0');

  return new;
end;
$$;

revoke all on function public.assign_showroom_sale_number() from public, anon, authenticated;

drop trigger if exists trg_assign_showroom_sale_number
on public.showroom_sales;

create trigger trg_assign_showroom_sale_number
before insert or update
on public.showroom_sales
for each row
execute function public.assign_showroom_sale_number();

notify pgrst, 'reload schema';

commit;
