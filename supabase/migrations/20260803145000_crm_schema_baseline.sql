-- Idempotent baseline of the CRM schema that pre-existed its repository migrations.
begin;

create table if not exists public.crm_lead_sources (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text not null, description text,
 active boolean not null default true, sort_order integer not null default 10, created_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint crm_lead_sources_id_tenant_unique unique(id,tenant_id), constraint crm_lead_sources_tenant_name_unique unique(tenant_id,name),
 constraint crm_lead_sources_name_not_empty check(length(trim(name))>0), constraint crm_lead_sources_sort_order_valid check(sort_order>=0)
);
create table if not exists public.crm_lead_cancel_reasons (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, name text not null, description text,
 active boolean not null default true, sort_order integer not null default 10, created_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint crm_lead_cancel_reasons_id_tenant_unique unique(id,tenant_id), constraint crm_lead_cancel_reasons_tenant_name_unique unique(tenant_id,name),
 constraint crm_lead_cancel_reasons_name_not_empty check(length(trim(name))>0), constraint crm_lead_cancel_reasons_sort_order_valid check(sort_order>=0)
);
create table if not exists public.crm_sales_users (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, user_id uuid not null, branch_id uuid,
 active boolean not null default true, notes text, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint crm_sales_users_id_tenant_unique unique(id,tenant_id), constraint crm_sales_users_tenant_user_unique unique(tenant_id,user_id)
);
create table if not exists public.crm_finance_companies (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, partner_id uuid, name text not null, code text,
 phone text, email text, address text, active boolean not null default true, notes text, created_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint crm_finance_companies_id_tenant_unique unique(id,tenant_id), constraint crm_finance_companies_tenant_name_unique unique(tenant_id,name),
 constraint crm_finance_companies_name_not_empty check(length(trim(name))>0)
);
create table if not exists public.crm_finance_company_representatives (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, finance_company_id uuid not null, partner_id uuid,
 name text not null, phone text, whatsapp_phone text, email text, job_title text, branch_id uuid,
 is_primary boolean not null default false, active boolean not null default true, notes text, created_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint crm_finance_representatives_id_tenant_unique unique(id,tenant_id),
 constraint crm_finance_representatives_name_not_empty check(length(trim(name))>0),
 constraint crm_finance_representatives_company_fk foreign key(finance_company_id,tenant_id) references public.crm_finance_companies(id,tenant_id) on delete cascade
);
create table if not exists public.crm_leads (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid, customer_id uuid,
 customer_name text not null, phone text not null, alternate_phone text, source_id uuid, interested_product_id uuid,
 interested_product_name text, purchase_type text not null default 'undecided', status text not null default 'new', priority text not null default 'normal',
 assigned_sales_user_id uuid, assigned_at timestamptz, assigned_by uuid, first_contact_at timestamptz, last_contact_at timestamptz,
 last_activity_at timestamptz, next_followup_at timestamptz, cancel_reason_id uuid, cancel_notes text, cancelled_at timestamptz,
 cancelled_by uuid, sale_id uuid, sold_at timestamptz, sold_by uuid, general_notes text, created_by uuid,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint crm_leads_id_tenant_unique unique(id,tenant_id), constraint crm_leads_customer_name_not_empty check(length(trim(customer_name))>0),
 constraint crm_leads_phone_not_empty check(length(trim(phone))>0), constraint crm_leads_purchase_type_valid check(purchase_type in('cash','installment','undecided')),
 constraint crm_leads_status_valid check(status in('new','assigned','in_followup','installment_processing','installment_approved','sold','cancelled')),
 constraint crm_leads_priority_valid check(priority in('low','normal','high','urgent')),
 constraint crm_leads_source_fk foreign key(source_id,tenant_id) references public.crm_lead_sources(id,tenant_id) on delete set null,
 constraint crm_leads_cancel_reason_fk foreign key(cancel_reason_id,tenant_id) references public.crm_lead_cancel_reasons(id,tenant_id) on delete set null
);
create table if not exists public.crm_lead_activities (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, lead_id uuid not null, activity_type text not null,
 outcome text, notes text, next_followup_at timestamptz, from_user_id uuid, to_user_id uuid, created_by uuid, created_at timestamptz not null default now(),
 constraint crm_lead_activities_lead_fk foreign key(lead_id,tenant_id) references public.crm_leads(id,tenant_id) on delete cascade,
 constraint crm_lead_activities_type_valid check(activity_type in('created','assigned','reassigned','call','whatsapp','message','visit','comment','no_answer','followup_scheduled','sent_to_installment','installment_update','installment_approved','installment_rejected','sold','cancelled','reopened'))
);
create table if not exists public.crm_installment_applications (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, branch_id uuid, lead_id uuid not null,
 finance_company_id uuid not null, finance_representative_id uuid, sales_user_id uuid, installment_user_id uuid,
 product_id uuid, product_name text, product_price numeric, requested_finance_amount numeric, requested_down_payment numeric,
 requested_term_months integer, status text not null default 'draft', submitted_at timestamptz, submitted_by uuid,
 company_reference text, approved_finance_amount numeric, approved_down_payment numeric, approved_term_months integer,
 approved_installment_amount numeric, approval_expiry_date date, rejection_reason text, is_selected_approval boolean not null default false,
 notes text, decided_at timestamptz, decided_by uuid, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 constraint crm_installment_applications_id_tenant_unique unique(id,tenant_id),
 constraint crm_installment_lead_fk foreign key(lead_id,tenant_id) references public.crm_leads(id,tenant_id) on delete cascade,
 constraint crm_installment_company_fk foreign key(finance_company_id,tenant_id) references public.crm_finance_companies(id,tenant_id) on delete restrict,
 constraint crm_installment_representative_fk foreign key(finance_representative_id,tenant_id) references public.crm_finance_company_representatives(id,tenant_id) on delete set null,
 constraint crm_installment_applications_status_valid check(status in('draft','under_review','documents_required','submitted','waiting_decision','approved','rejected','cancelled','expired')),
 constraint crm_installment_product_price_valid check(product_price is null or product_price>=0), constraint crm_installment_requested_amount_valid check(requested_finance_amount is null or requested_finance_amount>=0),
 constraint crm_installment_requested_down_payment_valid check(requested_down_payment is null or requested_down_payment>=0), constraint crm_installment_requested_term_valid check(requested_term_months is null or requested_term_months>0),
 constraint crm_installment_approved_amount_valid check(approved_finance_amount is null or approved_finance_amount>=0), constraint crm_installment_approved_down_payment_valid check(approved_down_payment is null or approved_down_payment>=0),
 constraint crm_installment_approved_term_valid check(approved_term_months is null or approved_term_months>0), constraint crm_installment_approved_installment_valid check(approved_installment_amount is null or approved_installment_amount>=0),
 constraint crm_installment_selected_must_be_approved check(not is_selected_approval or status='approved')
);
create table if not exists public.crm_installment_application_events (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, application_id uuid not null, event_type text not null,
 old_status text, new_status text, notes text, metadata jsonb not null default '{}'::jsonb, created_by uuid, created_at timestamptz not null default now(),
 constraint crm_installment_events_application_fk foreign key(application_id,tenant_id) references public.crm_installment_applications(id,tenant_id) on delete cascade,
 constraint crm_installment_events_type_valid check(event_type in('created','assigned','comment_added','company_selected','representative_selected','customer_contacted','documents_requested','documents_received','submitted','resubmitted','status_changed','approved','rejected','selected_for_sale','returned_to_sales','cancelled','expired')),
 constraint crm_installment_events_old_status_valid check(old_status is null or old_status in('draft','under_review','documents_required','submitted','waiting_decision','approved','rejected','cancelled','expired')),
 constraint crm_installment_events_new_status_valid check(new_status is null or new_status in('draft','under_review','documents_required','submitted','waiting_decision','approved','rejected','cancelled','expired'))
);

create unique index if not exists uq_crm_finance_companies_tenant_code on public.crm_finance_companies(tenant_id,code) where code is not null;
create unique index if not exists uq_crm_finance_company_primary_rep on public.crm_finance_company_representatives(tenant_id,finance_company_id) where is_primary and active;
create unique index if not exists uq_crm_installment_selected_approval_per_lead on public.crm_installment_applications(tenant_id,lead_id) where is_selected_approval;
create index if not exists idx_crm_lead_sources_tenant_active on public.crm_lead_sources(tenant_id,active,sort_order);
create index if not exists idx_crm_lead_cancel_reasons_tenant_active on public.crm_lead_cancel_reasons(tenant_id,active,sort_order);
create index if not exists idx_crm_sales_users_tenant_active on public.crm_sales_users(tenant_id,active);
create index if not exists idx_crm_sales_users_user on public.crm_sales_users(tenant_id,user_id);
create index if not exists idx_crm_finance_companies_tenant_active on public.crm_finance_companies(tenant_id,active);
create index if not exists idx_crm_finance_representatives_company on public.crm_finance_company_representatives(tenant_id,finance_company_id,active);
create index if not exists idx_crm_finance_representatives_phone on public.crm_finance_company_representatives(tenant_id,phone);
create index if not exists idx_crm_leads_tenant_status on public.crm_leads(tenant_id,status,created_at desc);
create index if not exists idx_crm_leads_assigned_sales on public.crm_leads(tenant_id,assigned_sales_user_id,status,next_followup_at);
create index if not exists idx_crm_leads_followup on public.crm_leads(tenant_id,next_followup_at) where status not in('sold','cancelled');
create index if not exists idx_crm_leads_phone on public.crm_leads(tenant_id,phone);
create index if not exists idx_crm_leads_source on public.crm_leads(tenant_id,source_id);
create index if not exists idx_crm_leads_created_at on public.crm_leads(tenant_id,created_at desc);
create index if not exists idx_crm_lead_activities_lead on public.crm_lead_activities(tenant_id,lead_id,created_at desc);
create index if not exists idx_crm_lead_activities_creator on public.crm_lead_activities(tenant_id,created_by,created_at desc);
create index if not exists idx_crm_installment_applications_lead on public.crm_installment_applications(tenant_id,lead_id,created_at desc);
create index if not exists idx_crm_installment_applications_company on public.crm_installment_applications(tenant_id,finance_company_id,status);
create index if not exists idx_crm_installment_applications_employee on public.crm_installment_applications(tenant_id,installment_user_id,status,created_at);
create index if not exists idx_crm_installment_applications_status on public.crm_installment_applications(tenant_id,status,created_at desc);
create index if not exists idx_crm_installment_events_application on public.crm_installment_application_events(tenant_id,application_id,created_at desc);
create index if not exists idx_crm_installment_events_creator on public.crm_installment_application_events(tenant_id,created_by,created_at desc);

create or replace function public.crm_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
create or replace trigger trg_crm_lead_sources_updated_at before update on public.crm_lead_sources for each row execute function public.crm_set_updated_at();
create or replace trigger trg_crm_lead_cancel_reasons_updated_at before update on public.crm_lead_cancel_reasons for each row execute function public.crm_set_updated_at();
create or replace trigger trg_crm_sales_users_updated_at before update on public.crm_sales_users for each row execute function public.crm_set_updated_at();
create or replace trigger trg_crm_finance_companies_updated_at before update on public.crm_finance_companies for each row execute function public.crm_set_updated_at();
create or replace trigger trg_crm_finance_representatives_updated_at before update on public.crm_finance_company_representatives for each row execute function public.crm_set_updated_at();
create or replace trigger trg_crm_leads_updated_at before update on public.crm_leads for each row execute function public.crm_set_updated_at();
create or replace trigger trg_crm_installment_applications_updated_at before update on public.crm_installment_applications for each row execute function public.crm_set_updated_at();
commit;
