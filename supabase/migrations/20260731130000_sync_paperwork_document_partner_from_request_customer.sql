-- A document linked to a paperwork request belongs to the request customer.
-- document_owner_name remains the independent snapshot of the name written on the paper.

update public.paperwork_documents as pd
set owner_partner_id = pr.customer_id
from public.paperwork_requests as pr
where pd.paperwork_request_id = pr.id
  and pd.tenant_id = pr.tenant_id
  and pr.customer_id is not null
  and pd.owner_partner_id is distinct from pr.customer_id;

create or replace function public.sync_paperwork_document_partner_from_request_customer()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if new.paperwork_request_id is null then
    return new;
  end if;

  select pr.customer_id
  into v_customer_id
  from public.paperwork_requests as pr
  where pr.id = new.paperwork_request_id
    and pr.tenant_id = new.tenant_id;

  if not found then
    raise exception 'طلب الأوراق المرتبط غير موجود داخل نفس المنشأة.';
  end if;

  if v_customer_id is null then
    raise exception 'لا يمكن تسجيل الورقة لأن طلب الأوراق لا يحتوي على عميل مرتبط.';
  end if;

  new.owner_partner_id := v_customer_id;
  return new;
end;
$$;

drop trigger if exists trg_sync_paperwork_document_partner_from_request_customer
on public.paperwork_documents;

create trigger trg_sync_paperwork_document_partner_from_request_customer
before insert or update of paperwork_request_id, tenant_id, owner_partner_id
on public.paperwork_documents
for each row
execute function public.sync_paperwork_document_partner_from_request_customer();
