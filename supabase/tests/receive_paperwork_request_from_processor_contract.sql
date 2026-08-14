do $$
declare
  v_definition text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'paperwork_documents'
      and column_name = 'sale_id'
      and data_type = 'uuid'
      and is_nullable = 'YES'
  ) then
    raise exception 'TEST_FAILED: paperwork_documents.sale_id is missing or invalid';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    join pg_class source_table on source_table.oid = constraint_row.conrelid
    join pg_class target_table on target_table.oid = constraint_row.confrelid
    where constraint_row.contype = 'f'
      and source_table.relname = 'paperwork_documents'
      and target_table.relname = 'showroom_sales'
      and constraint_row.conname = 'paperwork_documents_sale_id_fkey'
  ) then
    raise exception 'TEST_FAILED: paperwork document sale foreign key is missing';
  end if;

  if to_regclass('public.idx_paperwork_documents_sale_id') is null then
    raise exception 'TEST_FAILED: paperwork document sale index is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    join pg_class table_row on table_row.oid = trigger_row.tgrelid
    where not trigger_row.tgisinternal
      and table_row.relname = 'paperwork_documents'
      and trigger_row.tgname = 'trg_sync_paperwork_document_sale_from_request'
  ) then
    raise exception 'TEST_FAILED: document/request sale consistency trigger is missing';
  end if;

  if not exists (
    select 1
    from pg_trigger trigger_row
    join pg_class table_row on table_row.oid = trigger_row.tgrelid
    where not trigger_row.tgisinternal
      and table_row.relname = 'paperwork_requests'
      and trigger_row.tgname = 'trg_sync_linked_paperwork_documents_sale'
  ) then
    raise exception 'TEST_FAILED: request/document sale propagation trigger is missing';
  end if;

  select pg_get_functiondef(
    'public.receive_paperwork_request_from_processor(uuid, uuid)'::regprocedure
  ) into v_definition;

  if position('v_request.id, v_sale_id, v_request.tracking_unit_id' in v_definition) = 0 then
    raise exception 'TEST_FAILED: new document does not persist the request sale';
  end if;

  if position('v_request.sale_line_id' in v_definition) = 0 then
    raise exception 'TEST_FAILED: sale line fallback is missing';
  end if;

  if position('v_owner_name := nullif(btrim(coalesce(v_request.document_owner_name' in v_definition) = 0 then
    raise exception 'TEST_FAILED: document owner name is not sourced from paperwork_requests.document_owner_name';
  end if;

  if position('v_request.customer_id, v_owner_name' in v_definition) = 0 then
    raise exception 'TEST_FAILED: new document does not persist partner and document name independently';
  end if;

  if position('v_request.current_stage <> ''sent_to_processor''' in v_definition) = 0
     or position('v_request.status <> ''open''' in v_definition) = 0 then
    raise exception 'TEST_FAILED: receipt is not a direct sent_to_processor/open transition';
  end if;

  raise notice 'receive_paperwork_request_from_processor contract tests passed';
end;
$$;
