import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  WalletCards,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import { Card } from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";
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
const STATUS_OPTIONS = Object.entries(STATUSES);
const dateTime = (value) =>
  value
    ? new Date(value).toLocaleString("ar-EG", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "غير محدد";
export function CrmInstallmentsPage() {
  const { tenant } = useWorkspace();
  const tenantId = tenant?.id;
  const [items, setItems] = useState([]),
    [count, setCount] = useState(0),
    [status, setStatus] = useState("loading"),
    [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [filters, setFilters] = useState({}),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [meta, setMeta] = useState({
    companies: [],
    representatives: [],
    sales: [],
    branches: [],
  });
  const pageSize = 25;
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (!tenantId) return;
    Promise.all([
      crmService.listFinanceCompanies(tenantId),
      crmService.listFinanceRepresentatives(tenantId),
      crmService.listSalesUsers(tenantId),
      crmService.listBranches(tenantId),
    ])
      .then(([companies, representatives, sales, branches]) =>
        setMeta({ companies, representatives, sales, branches }),
      )
      .catch(() => {});
  }, [tenantId]);
  const load = useCallback(async () => {
    if (!tenantId) return;
    setStatus("loading");
    try {
      const result = await crmService.listInstallmentApplications({
        tenantId,
        search: debounced,
        filters,
        page,
        pageSize,
      });
      setItems(result.data);
      setCount(result.count);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [tenantId, debounced, filters, page, refresh]);
  useEffect(() => {
    load();
  }, [load]);
  const representatives = useMemo(
    () =>
      filters.companyId
        ? meta.representatives.filter(
            (x) => x.finance_company_id === filters.companyId,
          )
        : meta.representatives,
    [meta.representatives, filters.companyId],
  );
  const change = (key, value) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      ...(key === "companyId" ? { representativeId: "" } : {}),
    }));
    setPage(1);
  };
  const pages = Math.max(1, Math.ceil(count / pageSize));
  return (
    <section>
      <div>
        <h2 className="text-2xl font-black sm:text-3xl">طلبات التقسيط</h2>
        <p className="mt-2 text-sm text-slate-600">
          كل صف يمثل تقديمًا مستقلًا لدى شركة تمويل.
        </p>
      </div>
      <Card className="mt-5 border-slate-200 bg-white p-3 shadow-none">
        <div className="grid gap-2 md:grid-cols-4 lg:grid-cols-7">
          <div className="relative md:col-span-2">
            <Search className="absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
            <Input
              className="pr-10"
              placeholder="اسم العميل أو الهاتف"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="h-11 rounded-xl border px-2 text-sm"
            value={filters.companyId || ""}
            onChange={(e) => change("companyId", e.target.value)}
          >
            <option value="">كل الشركات</option>
            {meta.companies.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            className="h-11 rounded-xl border px-2 text-sm"
            value={filters.representativeId || ""}
            onChange={(e) => change("representativeId", e.target.value)}
          >
            <option value="">كل المندوبين</option>
            {representatives.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            className="h-11 rounded-xl border px-2 text-sm"
            value={filters.status || ""}
            onChange={(e) => change("status", e.target.value)}
          >
            <option value="">كل الحالات</option>
            {STATUS_OPTIONS.map((x) => (
              <option key={x[0]} value={x[0]}>
                {x[1]}
              </option>
            ))}
          </select>
          <select
            className="h-11 rounded-xl border px-2 text-sm"
            value={filters.salesUserId || ""}
            onChange={(e) => change("salesUserId", e.target.value)}
          >
            <option value="">كل السيلز</option>
            {meta.sales.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <select
              className="h-11 min-w-0 flex-1 rounded-xl border px-2 text-sm"
              value={filters.branchId || ""}
              onChange={(e) => change("branchId", e.target.value)}
            >
              <option value="">كل الفروع</option>
              {meta.branches.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
            <Button
              size="icon"
              variant="secondary"
              onClick={() => setRefresh((x) => x + 1)}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
      <div className="mt-4">
        {status === "loading" ? (
          <div className="space-y-3">
            {[1, 2, 3, 4].map((x) => (
              <div
                key={x}
                className="h-20 animate-pulse rounded-xl bg-slate-200"
              />
            ))}
          </div>
        ) : status === "error" ? (
          <EmptyState
            icon={RefreshCw}
            title="تعذر تحميل طلبات التقسيط"
            description="حدث خطأ أثناء تحميل التقديمات."
            actionLabel="إعادة المحاولة"
            onAction={load}
          />
        ) : !items.length ? (
          <EmptyState
            icon={WalletCards}
            title="لا توجد تقديمات تقسيط"
            description="يمكن إنشاء تقديم جديد من صفحة تفاصيل العميل."
          />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-2xl border bg-white lg:block">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    {[
                      "العميل",
                      "الشركة",
                      "المندوب",
                      "تاريخ التقديم",
                      "آخر تحديث",
                      "الحالة",
                      "السيلز",
                      "الإجراءات",
                    ].map((x) => (
                      <th key={x} className="px-3 py-3">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-3">
                        <Link
                          className="font-black hover:text-blue-700"
                          to={`/apps/crm/leads/${item.lead_id}`}
                        >
                          {item.customer_name}
                        </Link>
                        <p
                          dir="ltr"
                          className="text-right text-xs text-slate-500"
                        >
                          {item.phone}
                        </p>
                      </td>
                      <td className="px-3 py-3">
                        {item.company_name}
                        {item.company_active === false ? (
                          <span className="mr-2 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">
                            غير فعال
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        {item.representative_name || "غير محدد"}
                        {item.representative_name &&
                        item.representative_active === false ? (
                          <span className="mr-2 rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-500">
                            غير فعال
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        {dateTime(item.submitted_at || item.created_at)}
                      </td>
                      <td className="px-3 py-3">{dateTime(item.updated_at)}</td>
                      <td className="px-3 py-3">
                        <Badge>{STATUSES[item.status]}</Badge>
                        {item.linked_sale_id ? (
                          <span className="mr-2 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">
                            تم استخدامها في البيع
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3">
                        {item.sales_user_name || "غير موزع"}
                      </td>
                      <td className="px-3 py-3">
                        <Button asChild size="sm" variant="secondary">
                          <Link to={`/apps/crm/installments/${item.id}`}>
                            فتح
                          </Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 lg:hidden">
              {items.map((item) => (
                <Card
                  key={item.id}
                  className="border-slate-200 bg-white p-4 shadow-none"
                >
                  <div className="flex justify-between gap-2">
                    <div>
                      <Link
                        className="font-black"
                        to={`/apps/crm/leads/${item.lead_id}`}
                      >
                        {item.customer_name}
                      </Link>
                      <p className="text-sm text-slate-500">
                        {item.company_name}
                        {item.company_active === false ? " · غير فعالة" : ""}
                      </p>
                    </div>
                    <Badge>{STATUSES[item.status]}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                    <p>
                      المندوب: {item.representative_name || "غير محدد"}
                      {item.representative_name &&
                      item.representative_active === false
                        ? " · غير فعال"
                        : ""}
                    </p>
                    <p>السيلز: {item.sales_user_name || "غير موزع"}</p>
                    <p>
                      التقديم: {dateTime(item.submitted_at || item.created_at)}
                    </p>
                    <p>التحديث: {dateTime(item.updated_at)}</p>
                  </div>
                  <Button asChild className="mt-3 w-full" size="sm">
                    <Link to={`/apps/crm/installments/${item.id}`}>
                      فتح تفاصيل التقديم
                    </Link>
                  </Button>
                </Card>
              ))}
            </div>
          </>
        )}
      </div>
      {status === "ready" && count > 0 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span>
            عرض {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, count)}{" "}
            من {count}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((x) => x - 1)}
            >
              <ChevronRight className="h-4 w-4" />
              السابق
            </Button>
            <span>
              {page}/{pages}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= pages}
              onClick={() => setPage((x) => x + 1)}
            >
              التالي
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
