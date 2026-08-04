import { useEffect, useMemo, useState } from "react";
import { Button } from "@/core/ui/button";
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

export function CreateInstallmentApplicationSheet({
  open,
  onOpenChange,
  tenantId,
  leadId,
  onSaved,
}) {
  const [companies, setCompanies] = useState([]);
  const [representatives, setRepresentatives] = useState([]);
  const [companyId, setCompanyId] = useState("");
  const [representativeId, setRepresentativeId] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || !tenantId) return;
    setCompanyId("");
    setRepresentativeId("");
    setNotes("");
    setError("");
    Promise.all([
      crmService.listFinanceCompanies(tenantId),
      crmService.listFinanceRepresentatives(tenantId),
    ])
      .then(([companyRows, representativeRows]) => {
        setCompanies(companyRows);
        setRepresentatives(representativeRows);
      })
      .catch(() => setError("تعذر تحميل شركات التمويل والمندوبين."));
  }, [open, tenantId]);
  const availableRepresentatives = useMemo(
    () =>
      representatives.filter((item) => item.finance_company_id === companyId),
    [representatives, companyId],
  );
  const submit = async (event) => {
    event.preventDefault();
    if (!companyId) {
      setError("شركة التمويل مطلوبة.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const result = await crmService.createInstallmentApplication({
        tenantId,
        leadId,
        financeCompanyId: companyId,
        financeRepresentativeId: representativeId,
        notes,
      });
      onOpenChange(false);
      onSaved(result);
    } catch (requestError) {
      setError(
        String(requestError?.message || "").includes(
          "CRM_OPEN_INSTALLMENT_APPLICATION_EXISTS",
        )
          ? "يوجد بالفعل تقديم مفتوح لهذه الشركة."
          : "تعذر إنشاء تقديم التقسيط. تحقق من البيانات ثم أعد المحاولة.",
      );
    } finally {
      setSaving(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" dir="rtl">
        <SheetHeader>
          <SheetTitle>تحويل للتقسيط</SheetTitle>
          <SheetDescription>
            أنشئ تقديمًا مستقلًا لدى شركة التمويل المختارة.
          </SheetDescription>
          <SheetDismissButton />
        </SheetHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <SheetBody className="space-y-4">
            <label className="space-y-1.5">
              <Label>شركة التمويل *</Label>
              <select
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3"
                value={companyId}
                onChange={(event) => {
                  const nextCompanyId = event.target.value;
                  setCompanyId(nextCompanyId);
                  setRepresentativeId(
                    representatives.find(
                      (item) =>
                        item.finance_company_id === nextCompanyId &&
                        item.is_primary,
                    )?.id || "",
                  );
                }}
              >
                <option value="">اختر الشركة</option>
                {companies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <Label>المندوب</Label>
              <select
                disabled={!companyId}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 disabled:bg-slate-100"
                value={representativeId}
                onChange={(event) => setRepresentativeId(event.target.value)}
              >
                <option value="">بدون مندوب</option>
                {availableRepresentatives.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <Label>ملاحظات</Label>
              <textarea
                className="min-h-28 w-full rounded-xl border border-slate-200 p-3 text-sm"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
              />
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
              {saving ? "جاري الإنشاء..." : "إنشاء التقديم"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
