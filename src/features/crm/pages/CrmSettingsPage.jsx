import { useCallback, useEffect, useState } from "react";
import { Edit3, Plus, RefreshCw, Users } from "lucide-react";
import { Button } from "@/core/ui/button";
import { Card } from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";
import { Label } from "@/core/ui/label";
import { FinanceDirectorySettings } from "@/features/crm/components/FinanceDirectorySettings";
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

const TABS = [
  ["sources", "مصادر العملاء"],
  ["sales", "موظفو المبيعات"],
  ["reasons", "أسباب الإلغاء"],
  ["finance_companies", "شركات التمويل"],
  ["finance_representatives", "مندوبي شركات التمويل"],
];
function SettingsForm({
  open,
  onOpenChange,
  type,
  item,
  tenantId,
  tenantUserId,
  branches,
  onSaved,
}) {
  const [form, setForm] = useState({
      name: "",
      description: "",
      sortOrder: 10,
      active: true,
      userId: "",
      branchId: "",
      notes: "",
    }),
    [users, setUsers] = useState([]),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setForm({
      name: item?.name || "",
      description: item?.description || "",
      sortOrder: item?.sort_order ?? 10,
      active: item?.active ?? true,
      userId: item?.user_id || "",
      branchId: item?.branch_id || "",
      notes: item?.notes || "",
    });
    setError("");
    if (type === "sales" && !item)
      crmService
        .listAvailableTenantUsers(tenantId)
        .then(setUsers)
        .catch(() => setError("تعذر تحميل مستخدمي الشركة."));
  }, [open, item, type, tenantId]);
  const set = (k, v) => setForm((x) => ({ ...x, [k]: v }));
  const save = async (e) => {
    e.preventDefault();
    if (type !== "sales" && !form.name.trim()) {
      setError("الاسم مطلوب.");
      return;
    }
    if (type === "sales" && !item && !form.userId) {
      setError("اختر المستخدم.");
      return;
    }
    if (Number(form.sortOrder) < 0) {
      setError("ترتيب العرض لا يمكن أن يكون سالبًا.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (type === "sources")
        await (item
          ? crmService.updateLeadSource({
              tenantId,
              id: item.id,
              payload: form,
            })
          : crmService.createLeadSource({
              tenantId,
              createdBy: tenantUserId,
              payload: form,
            }));
      else if (type === "reasons")
        await (item
          ? crmService.updateCancelReason({
              tenantId,
              id: item.id,
              payload: form,
            })
          : crmService.createCancelReason({
              tenantId,
              createdBy: tenantUserId,
              payload: form,
            }));
      else
        await (item
          ? crmService.updateCrmSalesUser({
              tenantId,
              id: item.id,
              payload: form,
            })
          : crmService.createCrmSalesUser({
              tenantId,
              createdBy: tenantUserId,
              payload: form,
            }));
      onOpenChange(false);
      onSaved();
    } catch (err) {
      setError(
        err?.code === "23505"
          ? "هذا السجل موجود بالفعل داخل الشركة."
          : "تعذر حفظ البيانات. تحقق من الحقول ثم أعد المحاولة.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl">
        <SheetHeader>
          <SheetTitle>
            {item ? "تعديل" : "إضافة"}{" "}
            {type === "sources"
              ? "مصدر عميل"
              : type === "reasons"
                ? "سبب إلغاء"
                : "موظف مبيعات"}
          </SheetTitle>
          <SheetDescription>
            لن يتم إنشاء مستخدم جديد أو حذف أي سجل نهائيًا.
          </SheetDescription>
          <SheetDismissButton />
        </SheetHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="space-y-4">
            {type === "sales" ? (
              <>
                <label className="space-y-1.5">
                  <Label>المستخدم *</Label>
                  <select
                    disabled={Boolean(item)}
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                    value={form.userId}
                    onChange={(e) => set("userId", e.target.value)}
                  >
                    {item ? (
                      <option value={item.user_id}>{item.user_name}</option>
                    ) : (
                      <>
                        <option value="">اختر المستخدم</option>
                        {users.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.full_name}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <Label>الفرع</Label>
                  <select
                    className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                    value={form.branchId}
                    onChange={(e) => set("branchId", e.target.value)}
                  >
                    <option value="">كل الفروع</option>
                    {branches.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <Label>الملاحظات</Label>
                  <textarea
                    className="min-h-24 w-full rounded-xl border border-slate-200 p-3"
                    value={form.notes}
                    onChange={(e) => set("notes", e.target.value)}
                  />
                </label>
              </>
            ) : (
              <>
                <label className="space-y-1.5">
                  <Label>الاسم *</Label>
                  <Input
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                  />
                </label>
                <label className="space-y-1.5">
                  <Label>الوصف</Label>
                  <textarea
                    className="min-h-24 w-full rounded-xl border border-slate-200 p-3"
                    value={form.description}
                    onChange={(e) => set("description", e.target.value)}
                  />
                </label>
                <label className="space-y-1.5">
                  <Label>ترتيب العرض</Label>
                  <Input
                    type="number"
                    min="0"
                    value={form.sortOrder}
                    onChange={(e) => set("sortOrder", e.target.value)}
                  />
                </label>
              </>
            )}
            <label className="flex items-center gap-2 text-sm font-bold">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => set("active", e.target.checked)}
              />
              فعال
            </label>
            {error ? (
              <p className="rounded-xl bg-red-50 p-3 text-sm font-bold text-red-700">
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
              إلغاء
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "جاري الحفظ..." : "حفظ"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
export function CrmSettingsPage() {
  const { tenant, tenantUser } = useWorkspace();
  const tenantId = tenant?.id;
  const [tab, setTab] = useState("sources"),
    [items, setItems] = useState([]),
    [branches, setBranches] = useState([]),
    [status, setStatus] = useState("loading"),
    [editing, setEditing] = useState(undefined),
    [open, setOpen] = useState(false),
    [notice, setNotice] = useState("");
  const financeTab =
    tab === "finance_companies" || tab === "finance_representatives";
  const load = useCallback(async () => {
    if (!tenantId) return;
    setStatus("loading");
    try {
      if (financeTab) {
        setBranches(await crmService.listBranches(tenantId));
        setStatus("ready");
        return;
      }
      const [data, branchData] = await Promise.all([
        tab === "sources"
          ? crmService.listLeadSourcesForSettings(tenantId)
          : tab === "reasons"
            ? crmService.listCancelReasons(tenantId)
            : crmService.listCrmSalesUsers(tenantId),
        crmService.listBranches(tenantId),
      ]);
      setItems(data);
      setBranches(branchData);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [tenantId, tab, financeTab]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(timer);
  }, [notice]);
  const toggle = async (item) => {
    if (
      !window.confirm(`هل تريد ${item.active ? "إيقاف" : "تفعيل"} هذا السجل؟`)
    )
      return;
    try {
      const args = { tenantId, id: item.id, active: !item.active };
      await (tab === "sources"
        ? crmService.setLeadSourceActive(args)
        : tab === "reasons"
          ? crmService.setCancelReasonActive(args)
          : crmService.setCrmSalesUserActive(args));
      load();
    } catch {
      window.alert("تعذر تحديث الحالة.");
    }
  };
  return (
    <section>
      {notice ? (
        <div className="fixed left-4 top-4 z-[80] rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white">
          {notice}
        </div>
      ) : null}
      <div>
        <h2 className="text-2xl font-black sm:text-3xl">إعدادات التطبيق</h2>
        <p className="mt-2 text-sm text-slate-600">
          إدارة مصادر العملاء وموظفي المبيعات وأسباب الإلغاء ودليل شركات
          التمويل.
        </p>
      </div>
      <div className="mt-6 flex overflow-x-auto border-b border-slate-200">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`min-w-max border-b-2 px-4 py-3 text-sm font-bold ${tab === key ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500"}`}
          >
            {label}
          </button>
        ))}
      </div>
      {financeTab ? (
        <FinanceDirectorySettings
          type={tab === "finance_companies" ? "companies" : "representatives"}
          tenantId={tenantId}
          tenantUserId={tenantUser?.id}
          branches={branches}
          onNotice={setNotice}
        />
      ) : (
        <>
          <div className="mt-5 flex justify-end">
            <Button
              onClick={() => {
                setEditing(null);
                setOpen(true);
              }}
            >
              <Plus className="h-4 w-4" />
              إضافة{" "}
              {tab === "sources"
                ? "مصدر"
                : tab === "sales"
                  ? "موظف مبيعات"
                  : "سبب إلغاء"}
            </Button>
          </div>
          <div className="mt-4">
            {status === "loading" ? (
              <div className="space-y-3">
                {[1, 2, 3].map((x) => (
                  <div
                    key={x}
                    className="h-20 animate-pulse rounded-xl bg-slate-200"
                  />
                ))}
              </div>
            ) : status === "error" ? (
              <EmptyState
                icon={RefreshCw}
                title="تعذر تحميل الإعدادات"
                description="حدث خطأ أثناء تحميل البيانات."
                actionLabel="إعادة المحاولة"
                onAction={load}
              />
            ) : !items.length ? (
              <EmptyState
                icon={Users}
                title="لا توجد سجلات بعد"
                description="ابدأ بإضافة أول سجل في هذا القسم."
              />
            ) : (
              <div className="space-y-3">
                {items.map((item) => (
                  <Card
                    key={item.id}
                    className="flex flex-col gap-3 border-slate-200 bg-white p-4 shadow-none sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-black">
                          {tab === "sales" ? item.user_name : item.name}
                        </h3>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-bold ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                        >
                          {item.active ? "فعال" : "غير فعال"}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {tab === "sales"
                          ? `${item.branch_name} · ${item.notes || "لا توجد ملاحظات"} · ${item.active_leads_count} عميل نشط`
                          : `${item.description || "لا يوجد وصف"} · ترتيب ${item.sort_order}`}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditing(item);
                          setOpen(true);
                        }}
                      >
                        <Edit3 className="h-4 w-4" />
                        تعديل
                      </Button>
                      <Button
                        size="sm"
                        variant="soft"
                        onClick={() => toggle(item)}
                      >
                        {item.active ? "إيقاف" : "تفعيل"}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
          <SettingsForm
            open={open}
            onOpenChange={setOpen}
            type={tab}
            item={editing}
            tenantId={tenantId}
            tenantUserId={tenantUser?.id}
            branches={branches}
            onSaved={load}
          />
        </>
      )}
    </section>
  );
}
