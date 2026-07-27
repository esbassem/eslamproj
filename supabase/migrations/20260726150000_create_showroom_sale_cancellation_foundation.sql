begin;

-- Supporting tenant-safe foreign keys. The id columns are already primary keys;
-- these constraints only make (id, tenant_id) available as FK targets.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.showroom_sales'::regclass
      and conname = 'showroom_sales_id_tenant_key'
  ) then
    alter table public.showroom_sales
      add constraint showroom_sales_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.tenant_users'::regclass
      and conname = 'tenant_users_id_tenant_key'
  ) then
    alter table public.tenant_users
      add constraint tenant_users_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.account_moves'::regclass
      and conname = 'account_moves_id_tenant_key'
  ) then
    alter table public.account_moves
      add constraint account_moves_id_tenant_key unique (id, tenant_id);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.account_move_lines'::regclass
      and conname = 'account_move_lines_id_tenant_key'
  ) then
    alter table public.account_move_lines
      add constraint account_move_lines_id_tenant_key unique (id, tenant_id);
  end if;
end;
$$;

alter table public.account_moves
  add column if not exists reversed_entry_id uuid null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.account_moves'::regclass
      and conname = 'account_moves_reversed_entry_tenant_fkey'
  ) then
    alter table public.account_moves
      add constraint account_moves_reversed_entry_tenant_fkey
      foreign key (reversed_entry_id, tenant_id)
      references public.account_moves (id, tenant_id)
      on update cascade
      on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.account_moves'::regclass
      and conname = 'account_moves_reversed_entry_not_self_chk'
  ) then
    alter table public.account_moves
      add constraint account_moves_reversed_entry_not_self_chk
      check (reversed_entry_id is null or reversed_entry_id <> id);
  end if;
end;
$$;

create unique index if not exists ux_account_moves_one_reversal_per_original
  on public.account_moves (tenant_id, reversed_entry_id)
  where reversed_entry_id is not null;

create table if not exists public.showroom_sale_cancellations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  sale_id uuid not null,
  status text not null default 'pending',
  reason text not null,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  completed_by uuid null,
  completed_at timestamptz null,
  original_move_id uuid null,
  reversal_move_id uuid null,
  preview_snapshot jsonb null,
  failure_reason text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint showroom_sale_cancellations_id_tenant_key
    unique (id, tenant_id),
  constraint showroom_sale_cancellations_status_chk
    check (status in ('pending', 'completed', 'failed')),
  constraint showroom_sale_cancellations_reason_chk
    check (nullif(btrim(reason), '') is not null),
  constraint showroom_sale_cancellations_tenant_fkey
    foreign key (tenant_id)
    references public.tenants (id)
    on delete cascade,
  constraint showroom_sale_cancellations_sale_tenant_fkey
    foreign key (sale_id, tenant_id)
    references public.showroom_sales (id, tenant_id)
    on update cascade
    on delete restrict,
  constraint showroom_sale_cancellations_requested_by_tenant_fkey
    foreign key (requested_by, tenant_id)
    references public.tenant_users (id, tenant_id)
    on update cascade
    on delete restrict,
  constraint showroom_sale_cancellations_completed_by_tenant_fkey
    foreign key (completed_by, tenant_id)
    references public.tenant_users (id, tenant_id)
    on update cascade
    on delete restrict,
  constraint showroom_sale_cancellations_original_move_tenant_fkey
    foreign key (original_move_id, tenant_id)
    references public.account_moves (id, tenant_id)
    on update cascade
    on delete restrict,
  constraint showroom_sale_cancellations_reversal_move_tenant_fkey
    foreign key (reversal_move_id, tenant_id)
    references public.account_moves (id, tenant_id)
    on update cascade
    on delete restrict
);

create index if not exists idx_showroom_sale_cancellations_tenant_sale
  on public.showroom_sale_cancellations (tenant_id, sale_id);

create index if not exists idx_showroom_sale_cancellations_tenant_status
  on public.showroom_sale_cancellations (tenant_id, status);

create unique index if not exists ux_showroom_sale_cancellations_active_sale
  on public.showroom_sale_cancellations (tenant_id, sale_id)
  where status in ('pending', 'completed');

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.showroom_sale_cancellations'::regclass
      and tgname = 'trg_showroom_sale_cancellations_set_updated_at'
      and not tgisinternal
  ) then
    create trigger trg_showroom_sale_cancellations_set_updated_at
    before update on public.showroom_sale_cancellations
    for each row
    execute function public.set_updated_at();
  end if;
end;
$$;

create table if not exists public.showroom_sale_cancellation_reconciliations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  cancellation_id uuid not null,
  original_apr_id uuid not null,
  debit_move_line_id uuid not null,
  credit_move_line_id uuid not null,
  amount numeric not null,
  classification text not null,
  source_move_id uuid null,
  source_entity_id uuid null,
  created_at timestamptz not null default now(),

  constraint showroom_sale_cancellation_reconciliations_amount_chk
    check (amount > 0),
  constraint showroom_sale_cancellation_reconciliations_lines_different_chk
    check (debit_move_line_id <> credit_move_line_id),
  constraint showroom_sale_cancellation_reconciliations_classification_chk
    check (
      classification in (
        'payment_entity_open_credit',
        'cash',
        'employee_custody_cash',
        'account_settlement',
        'legacy',
        'unknown'
      )
    ),
  constraint showroom_sale_cancellation_reconciliations_tenant_fkey
    foreign key (tenant_id)
    references public.tenants (id)
    on delete cascade,
  constraint showroom_sale_cancellation_reconciliations_cancellation_tenant_fkey
    foreign key (cancellation_id, tenant_id)
    references public.showroom_sale_cancellations (id, tenant_id)
    on update cascade
    on delete cascade,
  constraint showroom_sale_cancellation_reconciliations_debit_line_tenant_fkey
    foreign key (debit_move_line_id, tenant_id)
    references public.account_move_lines (id, tenant_id)
    on update cascade
    on delete restrict,
  constraint showroom_sale_cancellation_reconciliations_credit_line_tenant_fkey
    foreign key (credit_move_line_id, tenant_id)
    references public.account_move_lines (id, tenant_id)
    on update cascade
    on delete restrict,
  constraint showroom_sale_cancellation_reconciliations_source_move_tenant_fkey
    foreign key (source_move_id, tenant_id)
    references public.account_moves (id, tenant_id)
    on update cascade
    on delete restrict,
  constraint showroom_sale_cancellation_reconciliations_source_entity_tenant_fkey
    foreign key (source_entity_id, tenant_id)
    references public.partners (id, tenant_id)
    on update cascade
    on delete restrict
);

create index if not exists idx_showroom_sale_cancellation_reconciliations_cancellation
  on public.showroom_sale_cancellation_reconciliations (tenant_id, cancellation_id);

create index if not exists idx_showroom_sale_cancellation_reconciliations_original_apr
  on public.showroom_sale_cancellation_reconciliations (tenant_id, original_apr_id);

comment on column public.account_moves.reversed_entry_id is
  'Original posted account move reversed by this move; tenant-safe and limited to one reversal per original move.';

comment on table public.showroom_sale_cancellations is
  'Audit and lifecycle record for cancellation of a confirmed showroom sale.';

comment on table public.showroom_sale_cancellation_reconciliations is
  'Immutable snapshot of account_partial_reconcile rows released by a showroom sale cancellation; not a reconciliation engine.';

comment on column public.showroom_sale_cancellation_reconciliations.original_apr_id is
  'Snapshot identifier only. It intentionally has no FK because the source account_partial_reconcile row is removed during future unreconciliation.';

alter table public.showroom_sale_cancellations enable row level security;
alter table public.showroom_sale_cancellation_reconciliations enable row level security;

revoke all on table public.showroom_sale_cancellations
  from public, anon, authenticated;
revoke all on table public.showroom_sale_cancellation_reconciliations
  from public, anon, authenticated;

commit;
