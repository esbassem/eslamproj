begin;

alter function public.create_manual_receivable(jsonb) rename to create_manual_receivable_baseline_impl;
revoke all on function public.create_manual_receivable_baseline_impl(jsonb) from public,anon,authenticated;

create function public.create_manual_receivable(payload jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare tid uuid:=nullif(payload->>'tenant_id','')::uuid;
begin
 if tid is null or tid<>public.current_tenant_id() or not public.is_current_tenant_owner(tid) then
  raise exception using errcode='42501',message='Creating receivables is temporarily owner-only until action permissions are defined.';
 end if;
 return public.create_manual_receivable_baseline_impl(payload);
end $$;

revoke all on function public.create_manual_receivable(jsonb) from public,anon;
grant execute on function public.create_manual_receivable(jsonb) to authenticated;

commit;
