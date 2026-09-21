begin;
alter table public.account_moves drop constraint chk_account_moves_move_type;
alter table public.account_moves add constraint chk_account_moves_move_type check(move_type in('sale','purchase','refund','payment','journal','cash_in','cash_out','opening','provider_batch'));
comment on constraint chk_account_moves_move_type on public.account_moves is'Canonical move domains including immutable provider clearing settlement batches.';
commit;
