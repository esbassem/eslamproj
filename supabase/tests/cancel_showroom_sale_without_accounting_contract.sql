begin;

do $$
declare
  v_preview text := pg_get_functiondef(
    'public.preview_showroom_sale_cancellation(uuid,uuid)'::regprocedure
  );
  v_cancel text := pg_get_functiondef(
    'public.cancel_showroom_sale(uuid,uuid,text,text)'::regprocedure
  );
begin
  if position('no_accounting_move' in v_preview) = 0 then
    raise exception 'TEST_FAILED: missing-accounting move is not a preview warning';
  end if;
  if position('if v_sale.account_move_id is not null then' in v_preview) = 0 then
    raise exception 'TEST_FAILED: preview accounting checks are not conditional';
  end if;
  if position('v_reversal_move_id := null' in v_cancel) = 0 then
    raise exception 'TEST_FAILED: no-accounting cancellation does not suppress reversal';
  end if;
  if position('if v_sale.account_move_id is not null then' in v_cancel) = 0 then
    raise exception 'TEST_FAILED: cancellation accounting operations are not conditional';
  end if;
end;
$$;

do $$
declare
  v_tenant_id uuid;
  v_sale_id uuid;
  v_owner_auth_id uuid;
  v_preview jsonb;
begin
  select sale.tenant_id, sale.id, owner_user.auth_user_id
  into v_tenant_id, v_sale_id, v_owner_auth_id
  from public.showroom_sales sale
  join lateral (
    select tenant_user.auth_user_id
    from public.tenant_users tenant_user
    where tenant_user.tenant_id = sale.tenant_id
      and tenant_user.role = 'owner'
      and tenant_user.is_active = true
    order by tenant_user.created_at, tenant_user.id
    limit 1
  ) owner_user on true
  where sale.status = 'confirmed'
    and sale.account_move_id is null
  order by sale.created_at, sale.id
  limit 1;

  if v_sale_id is null then
    raise notice 'No confirmed sale without an accounting move; runtime case skipped';
    return;
  end if;

  perform set_config('request.jwt.claim.sub', v_owner_auth_id::text, true);
  v_preview := public.preview_showroom_sale_cancellation(v_tenant_id, v_sale_id);

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_preview -> 'invariants' -> 'failures', '[]'::jsonb)) failure
    where failure ->> 'code' in ('original_move_missing', 'receivable_account_not_unique')
  ) then
    raise exception 'TEST_FAILED: no-accounting sale still has accounting-only failures';
  end if;
  if not exists (
    select 1
    from jsonb_array_elements(coalesce(v_preview -> 'warnings', '[]'::jsonb)) warning
    where warning ->> 'code' = 'no_accounting_move'
  ) then
    raise exception 'TEST_FAILED: no-accounting warning is missing at runtime';
  end if;
end;
$$;

rollback;
