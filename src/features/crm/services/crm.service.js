import { requireSupabase } from "@/core/lib/supabase";

const LEAD_COLUMNS =
  "id,tenant_id,branch_id,customer_name,phone,alternate_phone,source_id,interested_product_id,interested_product_name,purchase_type,status,priority,assigned_sales_user_id,last_activity_at,last_contact_at,next_followup_at,cancel_reason_id,cancel_notes,cancelled_at,cancelled_by,sale_id,sold_at,sold_by,general_notes,created_at,updated_at,source:crm_lead_sources(name),cancel_reason:crm_lead_cancel_reasons(name)";
const TERMINAL = ["sold", "cancelled"];

function escapeSearch(value) {
  return String(value || "")
    .replace(/[,%()]/g, " ")
    .trim();
}
async function attachSalesNames(client, tenantId, leads) {
  const ids = [
    ...new Set(
      leads.map((lead) => lead.assigned_sales_user_id).filter(Boolean),
    ),
  ];
  if (!ids.length) return leads;
  const { data, error } = await client
    .from("tenant_users")
    .select("id,full_name")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (error) throw error;
  const names = new Map((data || []).map((user) => [user.id, user.full_name]));
  return leads.map((lead) => ({
    ...lead,
    sales_user_name: names.get(lead.assigned_sales_user_id) || "",
  }));
}

export const crmService = {
  async listLeads({
    tenantId,
    view = "all",
    search = "",
    filters = {},
    sort = "default",
    page = 1,
    pageSize = 25,
    currentUserId,
  }) {
    const client = requireSupabase();
    let query = client
      .from("crm_leads")
      .select(LEAD_COLUMNS, { count: "exact" })
      .eq("tenant_id", tenantId);
    const now = new Date().toISOString();
    if (view === "mine")
      query = query
        .eq("assigned_sales_user_id", currentUserId)
        .not("status", "in", `(${TERMINAL.join(",")})`);
    if (view === "followup")
      query = query
        .not("next_followup_at", "is", null)
        .not("status", "in", `(${TERMINAL.join(",")})`);
    if (view === "overdue")
      query = query
        .lt("next_followup_at", now)
        .not("status", "in", `(${TERMINAL.join(",")})`);
    if (view === "installment")
      query = query.eq("status", "installment_processing");
    if (view === "approved") query = query.eq("status", "installment_approved");
    if (view === "sold") query = query.eq("status", "sold");
    if (view === "cancelled") query = query.eq("status", "cancelled");
    const term = escapeSearch(search);
    if (term)
      query = query.or(
        `customer_name.ilike.%${term}%,phone.ilike.%${term}%,alternate_phone.ilike.%${term}%`,
      );
    if (filters.status) query = query.eq("status", filters.status);
    if (filters.sourceId) query = query.eq("source_id", filters.sourceId);
    if (filters.salesUserId)
      query =
        filters.salesUserId === "unassigned"
          ? query.is("assigned_sales_user_id", null)
          : query.eq("assigned_sales_user_id", filters.salesUserId);
    if (filters.purchaseType)
      query = query.eq("purchase_type", filters.purchaseType);
    if (filters.priority) query = query.eq("priority", filters.priority);
    if (filters.branchId) query = query.eq("branch_id", filters.branchId);
    if (filters.createdFrom)
      query = query.gte("created_at", `${filters.createdFrom}T00:00:00`);
    if (filters.createdTo)
      query = query.lte("created_at", `${filters.createdTo}T23:59:59.999`);
    if (filters.followupFrom)
      query = query.gte("next_followup_at", `${filters.followupFrom}T00:00:00`);
    if (filters.followupTo)
      query = query.lte(
        "next_followup_at",
        `${filters.followupTo}T23:59:59.999`,
      );
    if (view === "followup" || view === "overdue" || sort === "followup")
      query = query.order("next_followup_at", { ascending: true });
    else query = query.order("created_at", { ascending: sort !== "oldest" });
    query = query
      .order("id", { ascending: true })
      .range((page - 1) * pageSize, page * pageSize - 1);
    const { data, count, error } = await query;
    if (error) throw error;
    return {
      data: await attachSalesNames(client, tenantId, data || []),
      count: count || 0,
    };
  },
  async getLead({ tenantId, leadId }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from("crm_leads")
      .select(LEAD_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("id", leadId)
      .single();
    if (error) throw error;
    const lead = (await attachSalesNames(client, tenantId, [data]))[0];
    const [cancelledUserResult, soldUserResult, saleResult] = await Promise.all(
      [
        lead.cancelled_by
          ? client
              .from("tenant_users")
              .select("full_name")
              .eq("tenant_id", tenantId)
              .eq("id", lead.cancelled_by)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        lead.sold_by
          ? client
              .from("tenant_users")
              .select("full_name")
              .eq("tenant_id", tenantId)
              .eq("id", lead.sold_by)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        lead.sale_id
          ? client
              .from("showroom_sales")
              .select(
                "id,sale_number,sale_date,status,crm_installment_application_id",
              )
              .eq("tenant_id", tenantId)
              .eq("id", lead.sale_id)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ],
    );
    if (cancelledUserResult.error || soldUserResult.error || saleResult.error)
      throw (
        cancelledUserResult.error || soldUserResult.error || saleResult.error
      );
    return {
      ...lead,
      cancelled_by_name: cancelledUserResult.data?.full_name || "",
      sold_by_name: soldUserResult.data?.full_name || "",
      sale: saleResult.data || null,
    };
  },
  async listLeadSources(tenantId) {
    const { data, error } = await requireSupabase()
      .from("crm_lead_sources")
      .select("id,name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("sort_order")
      .order("name");
    if (error) throw error;
    return data || [];
  },
  async listSalesUsers(tenantId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from("crm_sales_users")
      .select("user_id,branch_id")
      .eq("tenant_id", tenantId)
      .eq("active", true);
    if (error) throw error;
    const ids = (data || []).map((x) => x.user_id);
    if (!ids.length) return [];
    const { data: users, error: userError } = await client
      .from("tenant_users")
      .select("id,full_name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .in("id", ids);
    if (userError) throw userError;
    const map = new Map(users.map((x) => [x.id, x.full_name]));
    return data.map((x) => ({
      id: x.user_id,
      name: map.get(x.user_id) || "مستخدم مبيعات",
      branchId: x.branch_id,
    }));
  },
  async listBranches(tenantId) {
    const { data, error } = await requireSupabase()
      .from("branches")
      .select("id,name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("name");
    if (error) throw error;
    return data || [];
  },
  async listProducts(tenantId, search = "") {
    let q = requireSupabase()
      .from("product_products")
      .select("id,display_name")
      .eq("tenant_id", tenantId)
      .eq("is_active", true)
      .order("display_name")
      .limit(20);
    if (search.trim()) q = q.ilike("display_name", `%${escapeSearch(search)}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async findDuplicatePhone(tenantId, phone) {
    if (!phone.trim()) return null;
    const client = requireSupabase();
    const { data, error } = await client
      .from("crm_leads")
      .select("id,customer_name,status,assigned_sales_user_id,created_at")
      .eq("tenant_id", tenantId)
      .eq("phone", phone.trim())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (!data?.assigned_sales_user_id) return data;
    const { data: user } = await client
      .from("tenant_users")
      .select("full_name")
      .eq("tenant_id", tenantId)
      .eq("id", data.assigned_sales_user_id)
      .maybeSingle();
    return { ...data, sales_user_name: user?.full_name || "" };
  },
  async createLead({ tenantId, payload }) {
    const { data, error } = await requireSupabase().rpc("crm_create_lead", {
      p_tenant_id: tenantId,
      p_payload: payload,
    });
    if (error) throw error;
    return data;
  },
  async updateLeadAssignment({ tenantId, leadId, salesUserId, notes }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_update_lead_assignment",
      {
        p_tenant_id: tenantId,
        p_lead_id: leadId,
        p_sales_user_id: salesUserId || null,
        p_notes: notes || null,
      },
    );
    if (error) throw error;
    return data;
  },
  async listLeadActivities({ tenantId, leadId, page = 1, pageSize = 20 }) {
    const client = requireSupabase();
    const { data, count, error } = await client
      .from("crm_lead_activities")
      .select(
        "id,activity_type,outcome,notes,next_followup_at,from_user_id,to_user_id,created_by,created_at",
        { count: "exact" },
      )
      .eq("tenant_id", tenantId)
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    const ids = [
      ...new Set(
        (data || [])
          .flatMap((x) => [x.from_user_id, x.to_user_id, x.created_by])
          .filter(Boolean),
      ),
    ];
    let users = [];
    if (ids.length) {
      const result = await client
        .from("tenant_users")
        .select("id,full_name")
        .eq("tenant_id", tenantId)
        .in("id", ids);
      if (result.error) throw result.error;
      users = result.data || [];
    }
    const names = new Map(users.map((x) => [x.id, x.full_name]));
    return {
      data: (data || []).map((x) => ({
        ...x,
        created_by_name: names.get(x.created_by) || "",
        from_user_name: names.get(x.from_user_id) || "",
        to_user_name: names.get(x.to_user_id) || "",
      })),
      count: count || 0,
    };
  },
  async addLeadActivity({
    tenantId,
    leadId,
    activityType,
    outcome,
    notes,
    nextFollowupAt,
  }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_add_lead_activity",
      {
        p_tenant_id: tenantId,
        p_lead_id: leadId,
        p_activity_type: activityType,
        p_outcome: outcome || null,
        p_notes: notes || null,
        p_next_followup_at: nextFollowupAt || null,
      },
    );
    if (error) throw error;
    return data;
  },
  async listLeadSourcesForSettings(tenantId) {
    const { data, error } = await requireSupabase()
      .from("crm_lead_sources")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("sort_order")
      .order("name");
    if (error) throw error;
    return data || [];
  },
  async createLeadSource({ tenantId, createdBy, payload }) {
    const { data, error } = await requireSupabase()
      .from("crm_lead_sources")
      .insert({
        tenant_id: tenantId,
        created_by: createdBy,
        name: payload.name.trim(),
        description: payload.description?.trim() || null,
        sort_order: Number(payload.sortOrder || 0),
        active: payload.active,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async updateLeadSource({ tenantId, id, payload }) {
    const { data, error } = await requireSupabase()
      .from("crm_lead_sources")
      .update({
        name: payload.name.trim(),
        description: payload.description?.trim() || null,
        sort_order: Number(payload.sortOrder || 0),
        active: payload.active,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async setLeadSourceActive({ tenantId, id, active }) {
    const { error } = await requireSupabase()
      .from("crm_lead_sources")
      .update({ active })
      .eq("tenant_id", tenantId)
      .eq("id", id);
    if (error) throw error;
  },
  async listCancelReasons(tenantId, { activeOnly = false } = {}) {
    let q = requireSupabase()
      .from("crm_lead_cancel_reasons")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("sort_order")
      .order("name");
    if (activeOnly) q = q.eq("active", true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
  async createCancelReason({ tenantId, createdBy, payload }) {
    const { data, error } = await requireSupabase()
      .from("crm_lead_cancel_reasons")
      .insert({
        tenant_id: tenantId,
        created_by: createdBy,
        name: payload.name.trim(),
        description: payload.description?.trim() || null,
        sort_order: Number(payload.sortOrder || 0),
        active: payload.active,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async updateCancelReason({ tenantId, id, payload }) {
    const { data, error } = await requireSupabase()
      .from("crm_lead_cancel_reasons")
      .update({
        name: payload.name.trim(),
        description: payload.description?.trim() || null,
        sort_order: Number(payload.sortOrder || 0),
        active: payload.active,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async setCancelReasonActive({ tenantId, id, active }) {
    const { error } = await requireSupabase()
      .from("crm_lead_cancel_reasons")
      .update({ active })
      .eq("tenant_id", tenantId)
      .eq("id", id);
    if (error) throw error;
  },
  async listCrmSalesUsers(tenantId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from("crm_sales_users")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at");
    if (error) throw error;
    const userIds = (data || []).map((x) => x.user_id),
      branchIds = (data || []).map((x) => x.branch_id).filter(Boolean);
    const [usersResult, branchesResult, leadsResult] = await Promise.all([
      userIds.length
        ? client
            .from("tenant_users")
            .select("id,full_name")
            .eq("tenant_id", tenantId)
            .in("id", userIds)
        : Promise.resolve({ data: [] }),
      branchIds.length
        ? client
            .from("branches")
            .select("id,name")
            .eq("tenant_id", tenantId)
            .in("id", branchIds)
        : Promise.resolve({ data: [] }),
      userIds.length
        ? client
            .from("crm_leads")
            .select("assigned_sales_user_id")
            .eq("tenant_id", tenantId)
            .in("assigned_sales_user_id", userIds)
            .not("status", "in", "(sold,cancelled)")
        : Promise.resolve({ data: [] }),
    ]);
    if (usersResult.error || branchesResult.error || leadsResult.error)
      throw usersResult.error || branchesResult.error || leadsResult.error;
    const names = new Map(usersResult.data.map((x) => [x.id, x.full_name])),
      branches = new Map(branchesResult.data.map((x) => [x.id, x.name])),
      counts = new Map();
    leadsResult.data.forEach((x) =>
      counts.set(
        x.assigned_sales_user_id,
        (counts.get(x.assigned_sales_user_id) || 0) + 1,
      ),
    );
    return (data || []).map((x) => ({
      ...x,
      user_name: names.get(x.user_id) || "مستخدم",
      branch_name: branches.get(x.branch_id) || "كل الفروع",
      active_leads_count: counts.get(x.user_id) || 0,
    }));
  },
  async listAvailableTenantUsers(tenantId) {
    const client = requireSupabase();
    const [{ data: users, error }, { data: crm, error: crmError }] =
      await Promise.all([
        client
          .from("tenant_users")
          .select("id,full_name")
          .eq("tenant_id", tenantId)
          .eq("is_active", true)
          .order("full_name"),
        client
          .from("crm_sales_users")
          .select("user_id")
          .eq("tenant_id", tenantId),
      ]);
    if (error || crmError) throw error || crmError;
    const used = new Set(crm.map((x) => x.user_id));
    return users.filter((x) => !used.has(x.id));
  },
  async createCrmSalesUser({ tenantId, createdBy, payload }) {
    const { data, error } = await requireSupabase()
      .from("crm_sales_users")
      .insert({
        tenant_id: tenantId,
        created_by: createdBy,
        user_id: payload.userId,
        branch_id: payload.branchId || null,
        notes: payload.notes?.trim() || null,
        active: payload.active,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async updateCrmSalesUser({ tenantId, id, payload }) {
    const { data, error } = await requireSupabase()
      .from("crm_sales_users")
      .update({
        branch_id: payload.branchId || null,
        notes: payload.notes?.trim() || null,
        active: payload.active,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async setCrmSalesUserActive({ tenantId, id, active }) {
    const { error } = await requireSupabase()
      .from("crm_sales_users")
      .update({ active })
      .eq("tenant_id", tenantId)
      .eq("id", id);
    if (error) throw error;
  },
  async cancelLead({ tenantId, leadId, cancelReasonId, cancelNotes }) {
    const { data, error } = await requireSupabase().rpc("crm_cancel_lead", {
      p_tenant_id: tenantId,
      p_lead_id: leadId,
      p_cancel_reason_id: cancelReasonId,
      p_cancel_notes: cancelNotes || null,
    });
    if (error) throw error;
    return data;
  },
  async reopenLead({ tenantId, leadId, notes, nextFollowupAt }) {
    const { data, error } = await requireSupabase().rpc("crm_reopen_lead", {
      p_tenant_id: tenantId,
      p_lead_id: leadId,
      p_notes: notes,
      p_next_followup_at: nextFollowupAt || null,
    });
    if (error) throw error;
    return data;
  },
  async isCurrentUserCrmSales({ tenantId, currentUserId }) {
    const { data, error } = await requireSupabase()
      .from("crm_sales_users")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("user_id", currentUserId)
      .eq("active", true)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data);
  },
  async listLeadFollowups({
    tenantId,
    currentUserId,
    scope,
    view,
    search = "",
    filters = {},
    dayStart,
    tomorrowStart,
    dayAfterTomorrowStart,
    page = 1,
    pageSize = 25,
  }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_list_lead_followups",
      {
        p_tenant_id: tenantId,
        p_current_user_id: currentUserId,
        p_scope: scope,
        p_view: view,
        p_search: search,
        p_filters: {
          sales_user_id: filters.salesUserId || "",
          source_id: filters.sourceId || "",
          purchase_type: filters.purchaseType || "",
          priority: filters.priority || "",
        },
        p_day_start: dayStart,
        p_tomorrow_start: tomorrowStart,
        p_day_after_tomorrow_start: dayAfterTomorrowStart,
        p_page: page,
        p_page_size: pageSize,
      },
    );
    if (error) throw error;
    return { data: data?.data || [], count: Number(data?.count || 0) };
  },
  async getLeadFollowupCounts({
    tenantId,
    currentUserId,
    scope,
    search = "",
    filters = {},
    dayStart,
    tomorrowStart,
    dayAfterTomorrowStart,
  }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_get_lead_followup_counts",
      {
        p_tenant_id: tenantId,
        p_current_user_id: currentUserId,
        p_scope: scope,
        p_search: search,
        p_filters: {
          sales_user_id: filters.salesUserId || "",
          source_id: filters.sourceId || "",
          purchase_type: filters.purchaseType || "",
          priority: filters.priority || "",
        },
        p_day_start: dayStart,
        p_tomorrow_start: tomorrowStart,
        p_day_after_tomorrow_start: dayAfterTomorrowStart,
      },
    );
    if (error) throw error;
    return {
      overdue: Number(data?.overdue || 0),
      today: Number(data?.today || 0),
      tomorrow: Number(data?.tomorrow || 0),
      totalOpen: Number(data?.totalOpen || 0),
    };
  },
  async listFinanceCompanies(tenantId) {
    const { data, error } = await requireSupabase()
      .from("crm_finance_companies")
      .select("id,name")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("name");
    if (error) throw error;
    return data || [];
  },
  async listFinanceRepresentatives(tenantId) {
    const { data, error } = await requireSupabase()
      .from("crm_finance_company_representatives")
      .select("id,name,finance_company_id,is_primary")
      .eq("tenant_id", tenantId)
      .eq("active", true)
      .order("is_primary", { ascending: false })
      .order("name");
    if (error) throw error;
    return data || [];
  },
  async listInstallmentApplications({
    tenantId,
    search = "",
    filters = {},
    leadId = null,
    page = 1,
    pageSize = 25,
  }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_list_installment_applications",
      {
        p_tenant_id: tenantId,
        p_search: search,
        p_filters: {
          company_id: filters.companyId || "",
          representative_id: filters.representativeId || "",
          status: filters.status || "",
          sales_user_id: filters.salesUserId || "",
          branch_id: filters.branchId || "",
        },
        p_lead_id: leadId,
        p_page: page,
        p_page_size: pageSize,
      },
    );
    if (error) throw error;
    return { data: data?.data || [], count: Number(data?.count || 0) };
  },
  async getInstallmentApplication({ tenantId, applicationId }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_get_installment_application",
      { p_tenant_id: tenantId, p_application_id: applicationId },
    );
    if (error) throw error;
    if (!data?.application)
      throw new Error("CRM_INSTALLMENT_APPLICATION_NOT_FOUND");
    return data;
  },
  async createInstallmentApplication({
    tenantId,
    leadId,
    financeCompanyId,
    financeRepresentativeId,
    notes,
  }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_create_installment_application",
      {
        p_tenant_id: tenantId,
        p_lead_id: leadId,
        p_finance_company_id: financeCompanyId,
        p_finance_representative_id: financeRepresentativeId || null,
        p_notes: notes || null,
      },
    );
    if (error) throw error;
    return data;
  },
  async transitionInstallmentApplication({
    tenantId,
    applicationId,
    newStatus,
    notes,
  }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_transition_installment_application",
      {
        p_tenant_id: tenantId,
        p_application_id: applicationId,
        p_new_status: newStatus,
        p_notes: notes || null,
      },
    );
    if (error) throw error;
    return data;
  },
  async listFinanceCompaniesForSettings(tenantId) {
    const client = requireSupabase();
    const [
      { data: companies, error },
      { data: representatives, error: repError },
    ] = await Promise.all([
      client
        .from("crm_finance_companies")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("name"),
      client
        .from("crm_finance_company_representatives")
        .select("finance_company_id")
        .eq("tenant_id", tenantId)
        .eq("active", true),
    ]);
    if (error || repError) throw error || repError;
    const counts = new Map();
    (representatives || []).forEach((x) =>
      counts.set(
        x.finance_company_id,
        (counts.get(x.finance_company_id) || 0) + 1,
      ),
    );
    return (companies || []).map((x) => ({
      ...x,
      active_representatives_count: counts.get(x.id) || 0,
    }));
  },
  async createFinanceCompany({ tenantId, createdBy, payload }) {
    const { data, error } = await requireSupabase()
      .from("crm_finance_companies")
      .insert({
        tenant_id: tenantId,
        created_by: createdBy,
        name: payload.name.trim(),
        code: payload.code?.trim() || null,
        phone: payload.phone?.trim() || null,
        email: payload.email?.trim() || null,
        address: payload.address?.trim() || null,
        notes: payload.notes?.trim() || null,
        active: payload.active,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async updateFinanceCompany({ tenantId, id, payload }) {
    const { data, error } = await requireSupabase()
      .from("crm_finance_companies")
      .update({
        name: payload.name.trim(),
        code: payload.code?.trim() || null,
        phone: payload.phone?.trim() || null,
        email: payload.email?.trim() || null,
        address: payload.address?.trim() || null,
        notes: payload.notes?.trim() || null,
        active: payload.active,
      })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async setFinanceCompanyActive({ tenantId, id, active }) {
    const { data, error } = await requireSupabase()
      .from("crm_finance_companies")
      .update({ active })
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },
  async listFinanceRepresentativesForSettings(tenantId) {
    const client = requireSupabase();
    const [{ data, error }, { data: branches, error: branchError }] =
      await Promise.all([
        client
          .from("crm_finance_company_representatives")
          .select("*,company:crm_finance_companies(id,name,active)")
          .eq("tenant_id", tenantId)
          .order("created_at"),
        client.from("branches").select("id,name").eq("tenant_id", tenantId),
      ]);
    if (error || branchError) throw error || branchError;
    const branchNames = new Map((branches || []).map((x) => [x.id, x.name]));
    return (data || []).map((x) => ({
      ...x,
      company_name: x.company?.name || "شركة غير معروفة",
      company_active: Boolean(x.company?.active),
      branch_name: branchNames.get(x.branch_id) || "كل الفروع",
    }));
  },
  async createFinanceRepresentative({ tenantId, payload }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_create_finance_representative",
      {
        p_tenant_id: tenantId,
        p_payload: {
          finance_company_id: payload.financeCompanyId,
          name: payload.name,
          phone: payload.phone,
          whatsapp_phone: payload.whatsappPhone,
          email: payload.email,
          job_title: payload.jobTitle,
          branch_id: payload.branchId,
          is_primary: payload.isPrimary,
          active: payload.active,
          notes: payload.notes,
        },
      },
    );
    if (error) throw error;
    return data;
  },
  async updateFinanceRepresentative({ tenantId, id, payload }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_update_finance_representative",
      {
        p_tenant_id: tenantId,
        p_representative_id: id,
        p_payload: {
          finance_company_id: payload.financeCompanyId,
          name: payload.name,
          phone: payload.phone,
          whatsapp_phone: payload.whatsappPhone,
          email: payload.email,
          job_title: payload.jobTitle,
          branch_id: payload.branchId,
          is_primary: payload.isPrimary,
          active: payload.active,
          notes: payload.notes,
        },
      },
    );
    if (error) throw error;
    return data;
  },
  async setFinanceRepresentativeActive({ tenantId, id, active }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_set_finance_representative_active",
      { p_tenant_id: tenantId, p_representative_id: id, p_active: active },
    );
    if (error) throw error;
    return data;
  },
  async setPrimaryFinanceRepresentative({ tenantId, id }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_set_primary_finance_representative",
      { p_tenant_id: tenantId, p_representative_id: id },
    );
    if (error) throw error;
    return data || [];
  },
  async selectInstallmentApproval({ tenantId, applicationId }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_select_installment_approval",
      { p_tenant_id: tenantId, p_application_id: applicationId },
    );
    if (error) throw error;
    return data;
  },
  async getLeadSaleContext({ tenantId, leadId }) {
    const { data, error } = await requireSupabase().rpc(
      "crm_get_lead_sale_context",
      { p_tenant_id: tenantId, p_lead_id: leadId },
    );
    if (error) throw error;
    if (!data?.lead) throw new Error("CRM_LEAD_NOT_FOUND");
    return data;
  },
};
