begin;

-- The linked project installs pgcrypto in `extensions`. Existing function text
-- uses digest() and resolves it through this restricted, explicit search path.
alter function public.allocate_financial_payment(uuid,uuid,uuid,numeric,text)
  set search_path = pg_catalog, public, extensions;

commit;
