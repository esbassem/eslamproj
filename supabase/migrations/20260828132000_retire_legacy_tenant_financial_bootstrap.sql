begin;

revoke all on function public.create_tenant_account_groups(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_tenant_accounts(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_tenant_journals(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.create_tenant_pos_payment_methods(uuid)
  from public, anon, authenticated, service_role;

comment on function public.create_tenant_account_groups(uuid) is
  'LEGACY/RETIRED: code-driven chart bootstrap. Kept only for schema history; no API role may execute it.';
comment on function public.create_tenant_accounts(uuid) is
  'LEGACY/RETIRED: code-driven account bootstrap. Replaced by provision_tenant_canonical_chart.';
comment on function public.create_tenant_journals(uuid) is
  'LEGACY/RETIRED: journal bootstrap coupled to account codes. Financial resources require explicit future configuration.';
comment on function public.create_tenant_pos_payment_methods(uuid) is
  'LEGACY/RETIRED: payment bootstrap coupled to account codes. Payment methods are outside Phase 2.5C.';

commit;
