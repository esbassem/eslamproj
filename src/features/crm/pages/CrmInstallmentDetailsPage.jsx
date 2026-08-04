import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Clock3, RefreshCw, WalletCards } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import { Card, CardContent } from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import { Label } from "@/core/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetDismissButton,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/core/ui/sheet";
import { crmService } from "@/features/crm/services/crm.service";
import { useWorkspace } from "@/features/workspace/hooks/useWorkspace";

const STATUSES = {
  draft: "مسودة",
  submitted: "تم الإرسال",
  waiting_documents: "مطلوب مستندات",
  under_review: "تحت المراجعة",
  approved: "موافقة",
  rejected: "مرفوض",
  cancelled: "ملغي",
};
const EVENTS = {
  submitted: "تم الإرسال للشركة",
  documents_requested: "تم طلب مستندات",
  status_changed: "تغيرت الحالة",
  approved: "تمت الموافقة",
  rejected: "تم الرفض",
  cancelled: "تم الإلغاء",
  selected_for_sale: "تم اختيار الموافقة لإكمال البيع",
};
const ACTIONS = [
  ["submitted", "إرسال للشركة"],
  ["waiting_documents", "طلب مستندات"],
  ["under_review", "تحت المراجعة"],
  ["approved", "موافقة"],
  ["rejected", "رفض"],
  ["cancelled", "إلغاء"],
];
const FINAL = ["approved", "rejected", "cancelled"];
const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString("ar-EG", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "غير محدد";
function TransitionSheet({
  open,
  onOpenChange,
  action,
  tenantId,
  applicationId,
  onSaved,
}) {
  const [notes, setNotes] = useState(""),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setNotes("");
      setError("");
    }
  }, [open]);
  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await crmService.transitionInstallmentApplication({
        tenantId,
        applicationId,
        newStatus: action?.[0],
        notes,
      });
      onOpenChange(false);
      onSaved();
    } catch {
      setError("تعذر تحديث حالة التقديم. ربما تغيرت حالته بالفعل.");
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl">
        <SheetHeader>
          <SheetTitle>{action?.[1]}</SheetTitle>
          <SheetDescription>
            سيتم تسجيل هذا الإجراء داخل Timeline الخاصة بالتقديم.
          </SheetDescription>
          <SheetDismissButton />
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody>
            <label className="space-y-1.5">
              <Label>ملاحظات</Label>
              <textarea
                className="min-h-32 w-full rounded-xl border p-3 text-sm"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            {error ? (
              <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
                {error}
              </p>
            ) : null}
          </SheetBody>
          <SheetFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
            >
              رجوع
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "جاري التحديث..." : "تأكيد الإجراء"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
export function CrmInstallmentDetailsPage() {
  const { applicationId } = useParams();
  const { tenant } = useWorkspace();
  const tenantId = tenant?.id;
  const [data, setData] = useState(null),
    [status, setStatus] = useState("loading"),
    [action, setAction] = useState(null),
    [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    if (!tenantId) return;
    setStatus("loading");
    try {
      setData(
        await crmService.getInstallmentApplication({ tenantId, applicationId }),
      );
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [tenantId, applicationId]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(timer);
  }, [notice]);
  if (status === "loading")
    return <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />;
  if (status === "error")
    return (
      <EmptyState
        icon={RefreshCw}
        title="تعذر تحميل التقديم"
        description="التقديم غير موجود أو لا يمكنك الوصول إليه."
        actionLabel="إعادة المحاولة"
        onAction={load}
      />
    );
  const item = data.application;
  const selectApproval = async () => {
    try {
      await crmService.selectInstallmentApproval({ tenantId, applicationId });
      setNotice("تم اختيار الموافقة لإكمال البيع.");
      load();
    } catch {
      setNotice("تعذر اختيار الموافقة.");
    }
  };
  return (
    <section>
      {notice ? (
        <div className="fixed left-4 top-4 z-[80] rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white">
          {notice}
        </div>
      ) : null}
      <Link
        to="/apps/crm/installments"
        className="inline-flex items-center gap-2 text-sm font-bold text-blue-700"
      >
        <ArrowRight className="h-4 w-4" />
        العودة إلى التقديمات
      </Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-blue-50 p-3 text-blue-700">
            <WalletCards className="h-6 w-6" />
          </span>
          <div>
            <h2 className="text-2xl font-black">{item.customer_name}</h2>
            <p className="mt-1 text-sm text-slate-500">{item.company_name}</p>
          </div>
        </div>
        <Badge>{STATUSES[item.status]}</Badge>
      </div>
      {!FINAL.includes(item.status) ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {ACTIONS.filter(
            (x) => x[0] !== item.status || x[0] === "submitted",
          ).map((x) => (
            <Button
              key={x[0]}
              variant={
                ["rejected", "cancelled"].includes(x[0])
                  ? "secondary"
                  : "default"
              }
              className={x[0] === "cancelled" ? "text-red-700" : ""}
              onClick={() => setAction(x)}
            >
              {x[1]}
            </Button>
          ))}
        </div>
      ) : null}
      {item.status === "approved" ? (
        <div className="mt-5 flex items-center gap-2">
          {item.is_selected_approval ? (
            <Badge>الموافقة المختارة لإكمال البيع</Badge>
          ) : !["sold", "cancelled"].includes(item.lead_status) ? (
            <Button onClick={selectApproval}>اختيار هذه الموافقة</Button>
          ) : null}
          {item.linked_sale_id ? <Badge>تم استخدامها في البيع</Badge> : null}
        </div>
      ) : null}
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(340px,.8fr)]">
        <Card className="border-slate-200 bg-white shadow-none">
          <CardContent className="grid gap-0 p-5 sm:grid-cols-2">
            {[
              ["العميل", item.customer_name],
              ["الهاتف", item.phone],
              [
                "الشركة",
                `${item.company_name}${item.company_active === false ? " — غير فعالة" : ""}`,
              ],
              [
                "المندوب",
                `${item.representative_name || "غير محدد"}${item.representative_name && item.representative_active === false ? " — غير فعال" : ""}`,
              ],
              ["الحالة", STATUSES[item.status]],
              ["السيلز", item.sales_user_name || "غير موزع"],
              ["الفرع", item.branch_name || "غير محدد"],
              ["تاريخ التقديم", dateTime(item.submitted_at || item.created_at)],
              ["آخر تحديث", dateTime(item.updated_at)],
              ["الملاحظات", item.notes || "لا توجد ملاحظات"],
            ].map(([label, value]) => (
              <div key={label} className="border-b border-slate-100 py-3">
                <p className="text-xs font-bold text-slate-400">{label}</p>
                <p className="mt-1 text-sm font-bold">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <section>
          <h3 className="text-lg font-black">Timeline التقديم</h3>
          <p className="mt-1 text-sm text-slate-500">
            تاريخ مستقل عن سجل أنشطة العميل.
          </p>
          <div className="mt-4 space-y-3">
            {data.events.length ? (
              data.events.map((event) => (
                <Card
                  key={event.id}
                  className="border-slate-200 bg-white p-4 shadow-none"
                >
                  <div className="flex gap-3">
                    <Clock3 className="mt-1 h-4 w-4 text-blue-600" />
                    <div>
                      <p className="font-black">
                        {EVENTS[event.event_type] || event.event_type}
                      </p>
                      {event.old_status && event.new_status ? (
                        <p className="mt-1 text-xs text-slate-500">
                          {STATUSES[event.old_status]} ←{" "}
                          {STATUSES[event.new_status]}
                        </p>
                      ) : null}
                      <p className="mt-1 text-sm text-slate-600">
                        {event.notes || "بدون ملاحظات"}
                      </p>
                      <p className="mt-2 text-xs text-slate-400">
                        {dateTime(event.created_at)} ·{" "}
                        {event.created_by_name || "مستخدم"}
                      </p>
                    </div>
                  </div>
                </Card>
              ))
            ) : (
              <EmptyState
                icon={Clock3}
                title="لا توجد أحداث"
                description="ستظهر تغييرات حالة التقديم هنا."
              />
            )}
          </div>
        </section>
      </div>
      <TransitionSheet
        open={Boolean(action)}
        onOpenChange={(open) => !open && setAction(null)}
        action={action}
        tenantId={tenantId}
        applicationId={applicationId}
        onSaved={() => {
          setAction(null);
          setNotice("ok");
          load();
        }}
      />
    </section>
  );
}
