alter table public.old_cashbox_transactions
  alter column id set default gen_random_uuid();
