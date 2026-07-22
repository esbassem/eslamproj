begin;

-- Showroom payments are now represented exclusively by posted account moves,
-- move lines, and partial reconciliations. Keep the legacy table only as
-- historical data, but prevent application roles from reading or mutating it.
revoke all on table public.showroom_sale_payments from anon, authenticated;

-- This legacy RPC wrote duplicate payment records beside the accounting entry.
drop function if exists public.settle_showroom_sale_payments(jsonb);

commit;
