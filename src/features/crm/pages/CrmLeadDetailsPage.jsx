import { useCallback, useEffect, useState } from "react";
import {
  ArrowRight,
  ContactRound,
  Plus,
  RefreshCw,
  ShoppingCart,
  WalletCards,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import { Card, CardContent } from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import { AddLeadActivitySheet } from "@/features/crm/components/AddLeadActivitySheet";
import { CreateInstallmentApplicationSheet } from "@/features/crm/components/CreateInstallmentApplicationSheet";
import { CrmActivityTimeline } from "@/features/crm/components/CrmActivityTimeline";
import {
  CancelLeadSheet,
  ReopenLeadSheet,
} from "@/features/crm/components/LeadLifecycleSheets";
import { crmService } from "@/features/crm/services/crm.service";
import { useWorkspace } from "@/features/workspace/hooks/useWorkspace";

const STATUS = {
  new: "جديد",
  assigned: "موزع",
  in_followup: "قيد المتابعة",
  installment_processing: "تحت التقسيط",
  installment_approved: "موافقة تقسيط",
  sold: "تم البيع",
  cancelled: "ملغي",
};
const INSTALLMENT_STATUS = {
  draft: "مسودة",
  submitted: "تم الإرسال",
  waiting_documents: "مطلوب مستندات",
  under_review: "تحت المراجعة",
  approved: "موافقة",
  rejected: "مرفوض",
  cancelled: "ملغي",
};
export function CrmLeadDetailsPage() {
  const { leadId } = useParams();
  const navigate = useNavigate();
  const { tenant } = useWorkspace();
  const tenantId = tenant?.id;
  const [lead, setLead] = useState(null),
    [leadStatus, setLeadStatus] = useState("loading"),
    [activities, setActivities] = useState([]),
    [activityStatus, setActivityStatus] = useState("loading"),
    [activityPage, setActivityPage] = useState(1),
    [activityCount, setActivityCount] = useState(0),
    [applications, setApplications] = useState([]),
    [applicationsStatus, setApplicationsStatus] = useState("loading"),
    [sheetOpen, setSheetOpen] = useState(false),
    [installmentOpen, setInstallmentOpen] = useState(false),
    [cancelOpen, setCancelOpen] = useState(false),
    [reopenOpen, setReopenOpen] = useState(false),
    [notice, setNotice] = useState("");
  const pageSize = 20;
  const loadLead = useCallback(() => {
    if (!tenantId) return;
    setLeadStatus("loading");
    crmService
      .getLead({ tenantId, leadId })
      .then((x) => {
        setLead(x);
        setLeadStatus("ready");
      })
      .catch(() => setLeadStatus("error"));
  }, [tenantId, leadId]);
  const loadActivities = useCallback(
    async (page = 1, append = false) => {
      if (!tenantId) return;
      setActivityStatus("loading");
      try {
        const result = await crmService.listLeadActivities({
          tenantId,
          leadId,
          page,
          pageSize,
        });
        setActivities((current) =>
          append ? [...current, ...result.data] : result.data,
        );
        setActivityCount(result.count);
        setActivityPage(page);
        setActivityStatus("ready");
      } catch {
        setActivityStatus("error");
      }
    },
    [tenantId, leadId],
  );
  const loadApplications = useCallback(async () => {
    if (!tenantId) return;
    setApplicationsStatus("loading");
    try {
      const result = await crmService.listInstallmentApplications({
        tenantId,
        leadId,
        page: 1,
        pageSize: 100,
      });
      setApplications(result.data);
      setApplicationsStatus("ready");
    } catch {
      setApplicationsStatus("error");
    }
  }, [tenantId, leadId]);
  useEffect(() => {
    loadLead();
    loadActivities();
    loadApplications();
  }, [loadLead, loadActivities, loadApplications]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);
  if (leadStatus === "loading")
    return <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />;
  if (leadStatus === "error")
    return (
      <EmptyState
        icon={RefreshCw}
        title="تعذر تحميل العميل"
        description="السجل غير موجود أو لا يمكنك الوصول إليه."
        actionLabel="إعادة المحاولة"
        onAction={loadLead}
      />
    );
  const rows = [
    ["الهاتف", lead.phone],
    ["الهاتف البديل", lead.alternate_phone || "غير محدد"],
    ["المصدر", lead.source?.name || "غير محدد"],
    ["السيلز المسؤول", lead.sales_user_name || "غير موزع"],
    ["الحالة", STATUS[lead.status]],
    ["المنتج المهتم به", lead.interested_product_name || "غير محدد"],
    [
      "موعد المتابعة",
      lead.next_followup_at
        ? new Date(lead.next_followup_at).toLocaleString("ar-EG")
        : "لا توجد متابعة",
    ],
    [
      "آخر تواصل",
      lead.last_contact_at
        ? new Date(lead.last_contact_at).toLocaleString("ar-EG")
        : "لا يوجد تواصل",
    ],
    ["الملاحظات", lead.general_notes || "لا توجد ملاحظات"],
  ];
  const refreshed = (message) => {
    setNotice(message);
    loadLead();
    loadActivities(1, false);
    loadApplications();
  };
  const approvedApplications = applications.filter(
    (item) => item.status === "approved",
  );
  const selectedApproval =
    approvedApplications.find((item) => item.is_selected_approval) || null;
  const allInstallmentsRejected =
    applications.length > 0 &&
    applications.every((item) =>
      ["rejected", "cancelled"].includes(item.status),
    );
  const selectApproval = async (applicationId) => {
    try {
      await crmService.selectInstallmentApproval({ tenantId, applicationId });
      refreshed("تم اختيار موافقة التقسيط لإكمال البيع.");
    } catch {
      setNotice("تعذر اختيار الموافقة.");
    }
  };
  const startSale = (saleType) => {
    if (saleType === "financing" && !selectedApproval) {
      setNotice("اختر موافقة التقسيط أولًا.");
      return;
    }
    if (
      saleType === "financing" &&
      selectedApproval.approval_expiry_date &&
      selectedApproval.approval_expiry_date <
        new Date().toISOString().slice(0, 10) &&
      !window.confirm(
        "انتهت صلاحية الموافقة المختارة. هل تريد المتابعة رغم ذلك؟",
      )
    )
      return;
    navigate(`/app/showroom_point/new?leadId=${leadId}&saleType=${saleType}`);
  };
  return (
    <section>
      {notice ? (
        <div className="fixed left-4 top-4 z-[80] rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white shadow-lg">
          {notice}
        </div>
      ) : null}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link
          to="/apps/crm/leads"
          className="inline-flex items-center gap-2 text-sm font-bold text-blue-700"
        >
          <ArrowRight className="h-4 w-4" />
          العودة إلى العملاء
        </Link>
        <div className="flex gap-2">
          {lead.status === "in_followup" ||
          lead.status === "installment_approved" ? (
            <Button
              onClick={() =>
                startSale(
                  lead.status === "installment_approved" ||
                    lead.purchase_type === "installment"
                    ? "financing"
                    : "cash",
                )
              }
            >
              <ShoppingCart className="h-4 w-4" />
              إتمام البيع
            </Button>
          ) : null}
          {lead.status === "installment_processing" &&
          allInstallmentsRejected ? (
            <Button onClick={() => startSale("cash")}>
              <ShoppingCart className="h-4 w-4" />
              إتمام البيع كاش
            </Button>
          ) : null}
          {lead.status !== "sold" && lead.status !== "cancelled" ? (
            <Button
              variant="secondary"
              onClick={() => setInstallmentOpen(true)}
            >
              <WalletCards className="h-4 w-4" />
              تحويل للتقسيط
            </Button>
          ) : null}
          {lead.status === "cancelled" ? (
            <Button onClick={() => setReopenOpen(true)}>
              إعادة فتح العميل
            </Button>
          ) : lead.status !== "sold" ? (
            <Button
              variant="secondary"
              className="text-red-700"
              onClick={() => setCancelOpen(true)}
            >
              إلغاء العميل
            </Button>
          ) : null}
          <Button
            onClick={() => setSheetOpen(true)}
            disabled={lead.status === "sold" || lead.status === "cancelled"}
          >
            <Plus className="h-4 w-4" />
            إضافة متابعة
          </Button>
        </div>
      </div>
      <div className="mb-5 flex items-center gap-3">
        <span className="rounded-xl bg-blue-50 p-3 text-blue-700">
          <ContactRound className="h-6 w-6" />
        </span>
        <div>
          <h2 className="text-2xl font-black">{lead.customer_name}</h2>
          <Badge className="mt-1">{STATUS[lead.status]}</Badge>
        </div>
      </div>
      {lead.status === "cancelled" ? (
        <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4">
          <h3 className="font-black text-red-900">بيانات الإلغاء</h3>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <p>السبب: {lead.cancel_reason?.name || "غير محدد"}</p>
            <p>
              التاريخ:{" "}
              {lead.cancelled_at
                ? new Date(lead.cancelled_at).toLocaleString("ar-EG")
                : "غير محدد"}
            </p>
            <p>بواسطة: {lead.cancelled_by_name || "مستخدم"}</p>
            <p>الملاحظات: {lead.cancel_notes || "لا توجد"}</p>
          </div>
        </div>
      ) : null}
      {lead.status === "installment_approved" ? (
        <Card className="mb-5 border-blue-200 bg-blue-50 p-4 shadow-none">
          <h3 className="font-black text-blue-950">الموافقة المختارة</h3>
          {selectedApproval ? (
            <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
              <p>الشركة: {selectedApproval.company_name}</p>
              <p>
                المندوب: {selectedApproval.representative_name || "غير محدد"}
              </p>
              <p>
                مبلغ التمويل:{" "}
                {selectedApproval.approved_finance_amount ?? "غير محدد"}
              </p>
              <p>
                المقدم: {selectedApproval.approved_down_payment ?? "غير محدد"}
              </p>
              <p>
                المدة:{" "}
                {selectedApproval.approved_term_months
                  ? `${selectedApproval.approved_term_months} شهر`
                  : "غير محددة"}
              </p>
              <p>
                القسط:{" "}
                {selectedApproval.approved_installment_amount ?? "غير محدد"}
              </p>
              <p>
                انتهاء الموافقة:{" "}
                {selectedApproval.approval_expiry_date || "غير محدد"}
              </p>
              <p>
                مرجع الشركة: {selectedApproval.company_reference || "غير محدد"}
              </p>
              {selectedApproval.approval_expiry_date &&
              selectedApproval.approval_expiry_date <
                new Date().toISOString().slice(0, 10) ? (
                <p className="col-span-full rounded-lg bg-amber-100 p-2 font-bold text-amber-800">
                  تنبيه: انتهت صلاحية هذه الموافقة.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-2 text-sm font-bold text-amber-700">
              توجد موافقات تقسيط، اختر الموافقة التي سيكمل بها العميل.
            </p>
          )}
        </Card>
      ) : null}
      {lead.status === "sold" && lead.sale ? (
        <Card className="mb-5 border-emerald-200 bg-emerald-50 p-4 shadow-none">
          <h3 className="font-black text-emerald-950">عملية البيع</h3>
          <div className="mt-2 grid gap-2 text-sm sm:grid-cols-3">
            <p>المرجع: {lead.sale.sale_number || lead.sale.id}</p>
            <p>
              التاريخ:{" "}
              {lead.sold_at
                ? new Date(lead.sold_at).toLocaleString("ar-EG")
                : lead.sale.sale_date}
            </p>
            <p>بواسطة: {lead.sold_by_name || "مستخدم"}</p>
          </div>
          <Button
            className="mt-3"
            size="sm"
            onClick={() =>
              navigate(`/app/showroom_point/new?saleId=${lead.sale_id}`)
            }
          >
            فتح عملية البيع
          </Button>
        </Card>
      ) : null}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.85fr)]">
        <Card className="border-slate-200 bg-white shadow-none">
          <CardContent className="grid gap-0 p-5 sm:grid-cols-2">
            {rows.map(([label, value]) => (
              <div key={label} className="border-b border-slate-100 py-3">
                <p className="text-xs font-bold text-slate-400">{label}</p>
                <p className="mt-1 text-sm font-bold text-slate-800">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <section>
          <div className="mb-4">
            <h3 className="text-lg font-black">سجل الأنشطة</h3>
            <p className="mt-1 text-sm text-slate-500">
              تاريخ التواصل والتعيينات والتغييرات على العميل.
            </p>
          </div>
          <CrmActivityTimeline
            activities={activities}
            status={activityStatus}
            hasMore={activities.length < activityCount}
            onMore={() => loadActivities(activityPage + 1, true)}
            onRetry={() => loadActivities(1, false)}
          />
        </section>
      </div>
      <section className="mt-6">
        <div className="mb-4">
          <h3 className="text-lg font-black">طلبات التقسيط</h3>
          <p className="mt-1 text-sm text-slate-500">
            كل تقديم محفوظ كسجل مستقل لدى شركة التمويل.
          </p>
        </div>
        {applicationsStatus === "loading" ? (
          <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
        ) : applicationsStatus === "error" ? (
          <EmptyState
            icon={RefreshCw}
            title="تعذر تحميل طلبات التقسيط"
            description="أعد المحاولة لتحميل التقديمات."
            actionLabel="إعادة المحاولة"
            onAction={loadApplications}
          />
        ) : applications.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {applications.map((application) => (
              <Card
                key={application.id}
                className={`h-full border bg-white p-4 shadow-none ${application.is_selected_approval ? "border-blue-400" : "border-slate-200"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="font-black">
                    {application.company_name}
                    {application.company_active === false ? " · غير فعالة" : ""}
                  </h4>
                  <Badge>{INSTALLMENT_STATUS[application.status]}</Badge>
                </div>
                <p className="mt-2 text-sm text-slate-600">
                  المندوب: {application.representative_name || "غير محدد"}
                  {application.representative_name &&
                  application.representative_active === false
                    ? " · غير فعال"
                    : ""}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {new Date(application.created_at).toLocaleString("ar-EG")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="secondary">
                    <Link to={`/apps/crm/installments/${application.id}`}>
                      فتح التقديم
                    </Link>
                  </Button>
                  {application.status === "approved" &&
                  !application.is_selected_approval &&
                  lead.status !== "sold" ? (
                    <Button
                      size="sm"
                      onClick={() => selectApproval(application.id)}
                    >
                      اختيار هذه الموافقة
                    </Button>
                  ) : null}
                  {application.is_selected_approval ? (
                    <Badge>الموافقة المختارة</Badge>
                  ) : null}
                  {application.linked_sale_id ? (
                    <Badge>تم استخدامها في البيع</Badge>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={WalletCards}
            title="لا توجد طلبات تقسيط"
            description="يمكن إنشاء أول تقديم من زر تحويل للتقسيط."
          />
        )}
      </section>
      <AddLeadActivitySheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        tenantId={tenantId}
        leadId={leadId}
        onSaved={() => refreshed("تمت إضافة المتابعة بنجاح.")}
      />
      <CreateInstallmentApplicationSheet
        open={installmentOpen}
        onOpenChange={setInstallmentOpen}
        tenantId={tenantId}
        leadId={leadId}
        onSaved={() => refreshed("تم إنشاء تقديم التقسيط بنجاح.")}
      />
      <CancelLeadSheet
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        tenantId={tenantId}
        lead={lead}
        onSaved={() => refreshed("تم إلغاء العميل بنجاح.")}
      />
      <ReopenLeadSheet
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        tenantId={tenantId}
        lead={lead}
        onSaved={() => refreshed("تمت إعادة فتح العميل بنجاح.")}
      />
    </section>
  );
}
