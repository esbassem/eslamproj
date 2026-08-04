import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Edit3,
  Mail,
  MessageCircle,
  MoreVertical,
  Phone,
  Plus,
  RefreshCw,
  WalletCards,
} from "lucide-react";
import { Button } from "@/core/ui/button";
import { Card } from "@/core/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/core/ui/dropdown-menu";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";
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

const cleanWhatsApp = (phone) => {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("0") ? `20${digits.slice(1)}` : digits;
};
function CompanyForm({
  open,
  onOpenChange,
  item,
  tenantId,
  tenantUserId,
  onSaved,
}) {
  const [form, setForm] = useState({
      name: "",
      code: "",
      phone: "",
      email: "",
      address: "",
      notes: "",
      active: true,
    }),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setForm({
        name: item?.name || "",
        code: item?.code || "",
        phone: item?.phone || "",
        email: item?.email || "",
        address: item?.address || "",
        notes: item?.notes || "",
        active: item?.active ?? true,
      });
      setError("");
    }
  }, [open, item]);
  const set = (key, value) => setForm((x) => ({ ...x, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("اسم الشركة مطلوب.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await (item
        ? crmService.updateFinanceCompany({
            tenantId,
            id: item.id,
            payload: form,
          })
        : crmService.createFinanceCompany({
            tenantId,
            createdBy: tenantUserId,
            payload: form,
          }));
      onOpenChange(false);
      onSaved(item ? "تم تعديل شركة التمويل." : "تمت إضافة شركة التمويل.");
    } catch (requestError) {
      setError(
        requestError?.code === "23505"
          ? "اسم الشركة أو الكود مستخدم بالفعل داخل الشركة."
          : "تعذر حفظ شركة التمويل.",
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
            {item ? "تعديل شركة التمويل" : "إضافة شركة تمويل"}
          </SheetTitle>
          <SheetDescription>
            لن يتم إنشاء Partner أو حذف أي سجل.
          </SheetDescription>
          <SheetDismissButton />
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="space-y-4">
            {[
              ["name", "اسم الشركة *"],
              ["code", "الكود"],
              ["phone", "رقم الهاتف"],
              ["email", "البريد الإلكتروني"],
              ["address", "العنوان"],
            ].map(([key, label]) => (
              <label key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type={key === "email" ? "email" : "text"}
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
              </label>
            ))}
            <label className="space-y-1.5">
              <Label>ملاحظات</Label>
              <textarea
                className="min-h-24 w-full rounded-xl border p-3"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </label>
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
function RepresentativeForm({
  open,
  onOpenChange,
  item,
  tenantId,
  companies,
  branches,
  representatives,
  onSaved,
}) {
  const [form, setForm] = useState({
      financeCompanyId: "",
      name: "",
      phone: "",
      whatsappPhone: "",
      email: "",
      jobTitle: "",
      branchId: "",
      isPrimary: false,
      notes: "",
      active: true,
    }),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (open) {
      setForm({
        financeCompanyId: item?.finance_company_id || "",
        name: item?.name || "",
        phone: item?.phone || "",
        whatsappPhone: item?.whatsapp_phone || "",
        email: item?.email || "",
        jobTitle: item?.job_title || "",
        branchId: item?.branch_id || "",
        isPrimary: item?.is_primary ?? false,
        notes: item?.notes || "",
        active: item?.active ?? true,
      });
      setError("");
    }
  }, [open, item]);
  const set = (key, value) => setForm((x) => ({ ...x, [key]: value }));
  const submit = async (event) => {
    event.preventDefault();
    if (!form.financeCompanyId || !form.name.trim()) {
      setError("شركة التمويل واسم المندوب مطلوبان.");
      return;
    }
    const previous = representatives.find(
      (x) =>
        x.finance_company_id === form.financeCompanyId &&
        x.active &&
        x.is_primary &&
        x.id !== item?.id,
    );
    if (
      form.isPrimary &&
      previous &&
      !window.confirm(
        `المندوب ${previous.name} هو المندوب الرئيسي حاليًا. هل تريد استبداله؟`,
      )
    )
      return;
    setSaving(true);
    setError("");
    try {
      await (item
        ? crmService.updateFinanceRepresentative({
            tenantId,
            id: item.id,
            payload: form,
          })
        : crmService.createFinanceRepresentative({ tenantId, payload: form }));
      onOpenChange(false);
      onSaved(item ? "تم تعديل المندوب." : "تمت إضافة المندوب.");
    } catch (requestError) {
      const message = String(requestError?.message || "");
      setError(
        message.includes("CRM_FINANCE_COMPANY_INACTIVE")
          ? "لا يمكن استخدام شركة تمويل غير فعالة."
          : "تعذر حفظ بيانات المندوب.",
      );
    } finally {
      setSaving(false);
    }
  };
  const companyOptions = companies.filter(
    (x) => x.active || x.id === item?.finance_company_id,
  );
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl">
        <SheetHeader>
          <SheetTitle>
            {item ? "تعديل مندوب" : "إضافة مندوب شركة تمويل"}
          </SheetTitle>
          <SheetDescription>
            المندوب الرئيسي الفعال واحد فقط لكل شركة.
          </SheetDescription>
          <SheetDismissButton />
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="space-y-4">
            <label className="space-y-1.5">
              <Label>شركة التمويل *</Label>
              <select
                className="h-11 w-full rounded-xl border bg-white px-3"
                value={form.financeCompanyId}
                onChange={(e) => set("financeCompanyId", e.target.value)}
              >
                {<option value="">اختر الشركة</option>}
                {companyOptions.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                    {!x.active ? " — غير فعالة" : ""}
                  </option>
                ))}
              </select>
            </label>
            {[
              ["name", "اسم المندوب *"],
              ["phone", "رقم الهاتف"],
              ["whatsappPhone", "رقم واتساب"],
              ["email", "البريد الإلكتروني"],
              ["jobTitle", "المسمى الوظيفي"],
            ].map(([key, label]) => (
              <label key={key} className="space-y-1.5">
                <Label>{label}</Label>
                <Input
                  type={key === "email" ? "email" : "text"}
                  value={form[key]}
                  onChange={(e) => set(key, e.target.value)}
                />
              </label>
            ))}
            <label className="space-y-1.5">
              <Label>الفرع</Label>
              <select
                className="h-11 w-full rounded-xl border bg-white px-3"
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
              <Label>ملاحظات</Label>
              <textarea
                className="min-h-24 w-full rounded-xl border p-3"
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
              />
            </label>
            <div className="flex gap-5">
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={form.isPrimary}
                  onChange={(e) => set("isPrimary", e.target.checked)}
                />
                مندوب رئيسي
              </label>
              <label className="flex items-center gap-2 text-sm font-bold">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => set("active", e.target.checked)}
                />
                فعال
              </label>
            </div>
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
export function FinanceDirectorySettings({
  type,
  tenantId,
  tenantUserId,
  branches,
  onNotice,
}) {
  const [items, setItems] = useState([]),
    [companies, setCompanies] = useState([]),
    [status, setStatus] = useState("loading"),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState(null),
    [companyFilter, setCompanyFilter] = useState("");
  const isCompanies = type === "companies";
  const load = useCallback(async () => {
    if (!tenantId) return;
    setStatus("loading");
    try {
      const companyRows =
        await crmService.listFinanceCompaniesForSettings(tenantId);
      setCompanies(companyRows);
      setItems(
        isCompanies
          ? companyRows
          : await crmService.listFinanceRepresentativesForSettings(tenantId),
      );
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [tenantId, isCompanies]);
  useEffect(() => {
    load();
  }, [load]);
  const visible = useMemo(
    () =>
      isCompanies || !companyFilter
        ? items
        : items.filter((x) => x.finance_company_id === companyFilter),
    [items, isCompanies, companyFilter],
  );
  const saved = (message) => {
    onNotice(message);
    load();
  };
  const toggle = async (item) => {
    if (
      !window.confirm(
        `هل تريد ${item.active ? "إيقاف" : "إعادة تفعيل"} ${isCompanies ? "الشركة" : "المندوب"}؟`,
      )
    )
      return;
    try {
      await (isCompanies
        ? crmService.setFinanceCompanyActive({
            tenantId,
            id: item.id,
            active: !item.active,
          })
        : crmService.setFinanceRepresentativeActive({
            tenantId,
            id: item.id,
            active: !item.active,
          }));
      saved("تم تحديث الحالة بنجاح.");
    } catch {
      window.alert(
        "تعذر تحديث الحالة. تأكد من أن شركة التمويل فعالة عند إعادة تفعيل المندوب.",
      );
    }
  };
  const primary = async (item) => {
    const previous = items.find(
      (x) =>
        x.finance_company_id === item.finance_company_id &&
        x.active &&
        x.is_primary &&
        x.id !== item.id,
    );
    if (
      previous &&
      !window.confirm(
        `سيتم استبدال ${previous.name} كمندوب رئيسي. هل تريد المتابعة؟`,
      )
    )
      return;
    try {
      await crmService.setPrimaryFinanceRepresentative({
        tenantId,
        id: item.id,
      });
      saved("تم تعيين المندوب الرئيسي.");
    } catch {
      window.alert(
        "تعذر تعيين المندوب الرئيسي. يجب أن يكون المندوب والشركة فعالين.",
      );
    }
  };
  return (
    <div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        {!isCompanies ? (
          <select
            className="h-10 rounded-xl border bg-white px-3 text-sm"
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
          >
            <option value="">كل شركات التمويل</option>
            {companies.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        ) : (
          <span />
        )}
        <Button
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          {isCompanies ? "إضافة شركة" : "إضافة مندوب"}
        </Button>
      </div>
      <div className="mt-4">
        {status === "loading" ? (
          <div className="space-y-3">
            {[1, 2, 3].map((x) => (
              <div
                key={x}
                className="h-24 animate-pulse rounded-xl bg-slate-200"
              />
            ))}
          </div>
        ) : status === "error" ? (
          <EmptyState
            icon={RefreshCw}
            title="تعذر تحميل البيانات"
            description="حدث خطأ أثناء تحميل دليل شركات التمويل."
            actionLabel="إعادة المحاولة"
            onAction={load}
          />
        ) : !visible.length ? (
          <EmptyState
            icon={WalletCards}
            title={
              isCompanies
                ? "لا توجد شركات تمويل مسجلة."
                : "لا يوجد مناديب لشركات التمويل حتى الآن."
            }
            description="استخدم زر الإضافة لبدء تسجيل البيانات."
          />
        ) : (
          <div className="grid gap-3">
            {visible.map((item) => (
              <Card
                key={item.id}
                className="border-slate-200 bg-white p-4 shadow-none"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-black">{item.name}</h3>
                      {!isCompanies ? (
                        <span className="text-sm text-slate-500">
                          · {item.company_name}
                        </span>
                      ) : null}
                      {item.is_primary ? (
                        <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-bold text-blue-700">
                          رئيسي
                        </span>
                      ) : null}
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-bold ${item.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
                      >
                        {item.active ? "فعال" : "غير فعال"}
                      </span>
                    </div>
                    {isCompanies ? (
                      <p className="mt-2 text-sm text-slate-500">
                        {item.code || "بدون كود"} · {item.phone || "بدون هاتف"}{" "}
                        · {item.email || "بدون بريد"} ·{" "}
                        {item.active_representatives_count} مندوب فعال
                      </p>
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">
                        {item.job_title || "بدون مسمى"} · {item.branch_name} ·{" "}
                        {item.phone || "بدون هاتف"} · واتساب:{" "}
                        {item.whatsapp_phone || "غير محدد"}
                      </p>
                    )}
                    <p className="mt-1 max-w-2xl truncate text-xs text-slate-400">
                      {item.notes || "لا توجد ملاحظات"}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {!isCompanies && item.phone ? (
                      <a
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border"
                        href={`tel:${item.phone}`}
                        title="اتصال"
                      >
                        <Phone className="h-4 w-4" />
                      </a>
                    ) : null}
                    {!isCompanies && item.whatsapp_phone ? (
                      <a
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border text-emerald-700"
                        href={`https://wa.me/${cleanWhatsApp(item.whatsapp_phone)}`}
                        title="واتساب"
                      >
                        <MessageCircle className="h-4 w-4" />
                      </a>
                    ) : null}
                    {!isCompanies && item.email ? (
                      <a
                        className="inline-flex h-9 w-9 items-center justify-center rounded-xl border"
                        href={`mailto:${item.email}`}
                        title="بريد"
                      >
                        <Mail className="h-4 w-4" />
                      </a>
                    ) : null}
                    {!isCompanies && item.active && !item.is_primary ? (
                      <Button
                        className="hidden lg:inline-flex"
                        size="sm"
                        variant="soft"
                        onClick={() => primary(item)}
                      >
                        تعيين رئيسي
                      </Button>
                    ) : null}
                    <Button
                      className="hidden lg:inline-flex"
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
                      className="hidden lg:inline-flex"
                      size="sm"
                      variant="soft"
                      onClick={() => toggle(item)}
                    >
                      {item.active ? "إيقاف" : "تفعيل"}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          className="lg:hidden"
                          size="icon"
                          variant="secondary"
                          aria-label="الإجراءات"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {!isCompanies && item.active && !item.is_primary ? (
                          <DropdownMenuItem onSelect={() => primary(item)}>
                            تعيين كمندوب رئيسي
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem
                          onSelect={() => {
                            setEditing(item);
                            setOpen(true);
                          }}
                        >
                          تعديل
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => toggle(item)}>
                          {item.active ? "إيقاف" : "إعادة تفعيل"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      {isCompanies ? (
        <CompanyForm
          open={open}
          onOpenChange={setOpen}
          item={editing}
          tenantId={tenantId}
          tenantUserId={tenantUserId}
          onSaved={saved}
        />
      ) : (
        <RepresentativeForm
          open={open}
          onOpenChange={setOpen}
          item={editing}
          tenantId={tenantId}
          companies={companies}
          branches={branches}
          representatives={items}
          onSaved={saved}
        />
      )}
    </div>
  );
}
