begin;

alter function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) rename to post_financial_sale_validated_impl;

revoke all on function public.post_financial_sale_validated_impl(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) from public, anon, authenticated, service_role;

-- Resolve idempotent replays before mutable partner/configuration/date checks.
-- A previously posted immutable event remains readable after a later period lock
-- or resource deactivation, while a changed payload always gets one mismatch.
create function public.post_financial_sale(
  p_tenant_id uuid,
  p_source_app text,
  p_source_model text,
  p_source_id text,
  p_event_version integer,
  p_idempotency_key text,
  p_source_business_fingerprint text,
  p_partner_id uuid,
  p_amount numeric,
  p_currency_code text,
  p_posting_date date,
  p_branch_id uuid,
  p_commercial_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_source_app text := lower(btrim(p_source_app));
  normalized_source_model text := lower(btrim(p_source_model));
  normalized_source_id text := btrim(p_source_id);
  normalized_idempotency_key text := btrim(p_idempotency_key);
  normalized_business_fingerprint text := lower(btrim(p_source_business_fingerprint));
  normalized_currency text := upper(btrim(p_currency_code));
  normalized_reference text := btrim(p_commercial_reference);
  normalized_amount numeric(18,2) := round(p_amount, 2);
  fingerprint text;
  existing public.financial_sale_postings%rowtype;
  result jsonb;
begin
  perform public.assert_financial_authorized(
    p_tenant_id, 'financial.sale.post_operational',
    null, null, p_branch_id, true
  );
  if public.current_tenant_user_id() is null then
    raise exception using errcode = '42501',
      message = 'ACTIVE_TENANT_MEMBERSHIP_REQUIRED';
  end if;

  fingerprint := public.financial_sale_posting_request_fingerprint(
    p_tenant_id, normalized_source_app, normalized_source_model,
    normalized_source_id, p_event_version, normalized_business_fingerprint,
    p_partner_id, normalized_amount, normalized_currency,
    p_posting_date, p_branch_id, normalized_reference
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'financial_sale_posting:key:' || p_tenant_id::text || ':' ||
    coalesce(normalized_idempotency_key, '<null>'),
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'financial_sale_posting:source:' || p_tenant_id::text || ':' ||
    coalesce(normalized_source_app, '<null>') || ':' ||
    coalesce(normalized_source_model, '<null>') || ':' ||
    coalesce(normalized_source_id, '<null>') || ':' ||
    coalesce(p_event_version::text, '<null>'),
    0
  ));

  select * into existing
  from public.financial_sale_postings item
  where item.tenant_id = p_tenant_id
    and item.idempotency_key = normalized_idempotency_key;
  if found then
    if existing.request_fingerprint <> fingerprint then
      raise exception using errcode = '23505',
        message = 'FINANCIAL_SALE_IDEMPOTENCY_PAYLOAD_MISMATCH';
    end if;
    result := public.get_financial_sale_posting(p_tenant_id, existing.id);
    return result || jsonb_build_object(
      'idempotent_replay', true,
      'replay_basis', 'idempotency_key'
    );
  end if;

  select * into existing
  from public.financial_sale_postings item
  where item.tenant_id = p_tenant_id
    and item.source_app = normalized_source_app
    and item.source_model = normalized_source_model
    and item.source_id = normalized_source_id
    and item.event_version = p_event_version;
  if found then
    if existing.request_fingerprint <> fingerprint then
      raise exception using errcode = '23505',
        message = 'FINANCIAL_SALE_SOURCE_EVENT_PAYLOAD_MISMATCH';
    end if;
    result := public.get_financial_sale_posting(p_tenant_id, existing.id);
    return result || jsonb_build_object(
      'idempotent_replay', true,
      'replay_basis', 'source_event'
    );
  end if;

  return public.post_financial_sale_validated_impl(
    p_tenant_id, p_source_app, p_source_model, p_source_id,
    p_event_version, p_idempotency_key, p_source_business_fingerprint,
    p_partner_id, p_amount, p_currency_code, p_posting_date,
    p_branch_id, p_commercial_reference
  );
end
$$;

revoke all on function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) to authenticated;

comment on function public.post_financial_sale_validated_impl(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) is
  'Internal Sale Posting creation implementation. The public wrapper owns replay-before-policy ordering.';
comment on function public.post_financial_sale(
  uuid, text, text, text, integer, text, text, uuid, numeric, text, date, uuid, text
) is
  'Generic canonical Sale Posting boundary with immutable replay before mutable creation-policy validation.';

commit;
