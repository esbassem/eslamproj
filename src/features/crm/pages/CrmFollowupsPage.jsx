import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  MessageCircle,
  Phone,
  RefreshCw,
  Search,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/core/ui/badge";
import { Button } from "@/core/ui/button";
import { Card } from "@/core/ui/card";
import { EmptyState } from "@/core/ui/empty-state";
import { Input } from "@/core/ui/input";
import { AddLeadActivitySheet } from "@/features/crm/components/AddLeadActivitySheet";
import { crmService } from "@/features/crm/services/crm.service";
import { useWorkspace } from "@/features/workspace/hooks/useWorkspace";
const VIEWS = [
  ["all", "الكل"],
  ["overdue", "متأخر"],
  ["today", "اليوم"],
  ["tomorrow", "غدًا"],
  ["upcoming", "القادم"],
];
const STATUS = {
  new: "جديد",
  assigned: "موزع",
  in_followup: "قيد المتابعة",
  installment_processing: "تحت التقسيط",
  installment_approved: "موافقة تقسيط",
};
const PURCHASE = { cash: "كاش", installment: "تقسيط", undecided: "غير محدد" };
function boundaries() {
  const now = new Date(),
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
    after = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  return {
    dayStart: start.toISOString(),
    tomorrowStart: tomorrow.toISOString(),
    dayAfterTomorrowStart: after.toISOString(),
  };
}
function relative(value) {
  if (!value) return "لم يتم التواصل";
  const diff = Math.max(0, Date.now() - new Date(value).getTime());
  if (diff < 3600000)
    return `منذ ${Math.max(1, Math.floor(diff / 60000))} دقيقة`;
  if (diff < 86400000) return `منذ ${Math.floor(diff / 3600000)} ساعة`;
  return `منذ ${Math.floor(diff / 86400000)} يوم`;
}
function due(value) {
  const date = new Date(value),
    diff = date.getTime() - Date.now(),
    abs = Math.abs(diff);
  if (!Number.isFinite(date.getTime()))
    return { label: "موعد غير صالح", late: true, full: "موعد غير صالح" };
  const hours = Math.max(1, Math.round(abs / 3600000)),
    days = Math.floor(abs / 86400000);
  const now = new Date(),
    d0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    d1 = new Date(date.getFullYear(), date.getMonth(), date.getDate()),
    dayDiff = Math.round((d1 - d0) / 86400000),
    time = date.toLocaleTimeString("ar-EG", {
      hour: "numeric",
      minute: "2-digit",
    });
  const full =
    dayDiff === 0
      ? `اليوم، ${time}`
      : dayDiff === -1
        ? `أمس، ${time}`
        : dayDiff === 1
          ? `غدًا، ${time}`
          : date.toLocaleString("ar-EG", {
              dateStyle: "medium",
              timeStyle: "short",
            });
  if (diff < 0)
    return {
      label: days >= 1 ? `متأخرة ${days} يوم` : `متأخرة ${hours} ساعة`,
      late: true,
      full,
    };
  if (abs < 1800000) return { label: "مستحقة الآن", late: false, full };
  if (dayDiff === 1) return { label: "غدًا", late: false, full };
  return {
    label: days >= 1 ? `بعد ${days} يوم` : `بعد ${hours} ساعة`,
    late: false,
    full,
  };
}
function whatsapp(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.startsWith("0") ? `20${digits.slice(1)}` : digits;
}
function Skeleton() {
  return (
    <div className="space-y-3">
      {[1, 2, 3, 4].map((x) => (
        <div key={x} className="h-20 animate-pulse rounded-xl bg-slate-200" />
      ))}
    </div>
  );
}
export function CrmFollowupsPage() {
  const { tenant, tenantUser } = useWorkspace();
  const tenantId = tenant?.id,
    currentUserId = tenantUser?.id;
  const [scope, setScope] = useState("all"),
    [scopeReady, setScopeReady] = useState(false),
    [view, setView] = useState("all"),
    [search, setSearch] = useState(""),
    [debounced, setDebounced] = useState(""),
    [filters, setFilters] = useState({}),
    [page, setPage] = useState(1),
    [items, setItems] = useState([]),
    [count, setCount] = useState(0),
    [counts, setCounts] = useState({
      overdue: 0,
      today: 0,
      tomorrow: 0,
      totalOpen: 0,
    }),
    [status, setStatus] = useState("loading"),
    [meta, setMeta] = useState({ sources: [], sales: [] }),
    [selected, setSelected] = useState(null),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0);
  const pageSize = 25;
  useEffect(() => {
    if (!tenantId) return;
    Promise.all([
      crmService.isCurrentUserCrmSales({ tenantId, currentUserId }),
      crmService.listLeadSources(tenantId),
      crmService.listSalesUsers(tenantId),
    ])
      .then(([isSales, sources, sales]) => {
        setScope(isSales ? "mine" : "all");
        setMeta({ sources, sales });
        setScopeReady(true);
      })
      .catch(() => setScopeReady(true));
  }, [tenantId, currentUserId]);
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 400);
    return () => clearTimeout(t);
  }, [search]);
  const args = useMemo(
    () => ({
      ...boundaries(),
      tenantId,
      currentUserId,
      scope,
      search: debounced,
      filters,
    }),
    [tenantId, currentUserId, scope, debounced, filters, refresh],
  );
  const load = useCallback(async () => {
    if (!tenantId || !scopeReady) return;
    setStatus("loading");
    try {
      const [list, summary] = await Promise.all([
        crmService.listLeadFollowups({ ...args, view, page, pageSize }),
        crmService.getLeadFollowupCounts(args),
      ]);
      setItems(list.data);
      setCount(list.count);
      setCounts(summary);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [tenantId, scopeReady, args, view, page]);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 2500);
    return () => clearTimeout(t);
  }, [notice]);
  const activeFilters = Object.values(filters).filter(Boolean).length,
    pages = Math.max(1, Math.ceil(count / pageSize));
  const change = (key, value) => {
    setFilters((x) => ({ ...x, [key]: value }));
    setPage(1);
  };
  const reset = () => {
    setSearch("");
    setFilters({});
    setView("all");
    setPage(1);
  };
  return (
    <section>
      {notice ? (
        <div className="fixed left-4 top-4 z-[80] rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white">
          {notice}
        </div>
      ) : null}
      <div>
        <h2 className="text-2xl font-black sm:text-3xl">متابعات اليوم</h2>
        <p className="mt-2 text-sm text-slate-600">
          العملاء الذين لديهم متابعة مستحقة أو متأخرة، مرتبين حسب أولوية
          التنفيذ.
        </p>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["متأخرة", counts.overdue, "text-red-700"],
          ["اليوم", counts.today, "text-blue-700"],
          ["غدًا", counts.tomorrow, "text-violet-700"],
          ["إجمالي المفتوح", counts.totalOpen, "text-slate-900"],
        ].map((x) => (
          <Card
            key={x[0]}
            className="border-slate-200 bg-white p-4 shadow-none"
          >
            <p className="text-xs font-bold text-slate-500">{x[0]}</p>
            <p className={`mt-1 text-2xl font-black ${x[2]}`}>{x[1]}</p>
          </Card>
        ))}
      </div>
      <div className="mt-5 flex overflow-x-auto gap-2 pb-2">
        {VIEWS.map((x) => (
          <button
            key={x[0]}
            onClick={() => {
              setView(x[0]);
              setPage(1);
            }}
            className={`min-w-max rounded-full px-4 py-2 text-sm font-bold ${view === x[0] ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-600"}`}
          >
            {x[1]}
          </button>
        ))}
      </div>
      <Card className="mt-3 border-slate-200 bg-white p-3 shadow-none">
        <div className="mb-3 flex w-fit rounded-xl bg-slate-100 p-1">
          {[
            ["mine", "متابعاتي"],
            ["all", "كل المتابعات"],
          ].map((x) => (
            <button
              key={x[0]}
              onClick={() => {
                setScope(x[0]);
                setPage(1);
              }}
              className={`rounded-lg px-4 py-2 text-xs font-black ${scope === x[0] ? "bg-white text-blue-700 shadow-sm" : "text-slate-500"}`}
            >
              {x[1]}
            </button>
          ))}
        </div>
        <div className="grid gap-2 md:grid-cols-6">
          <div className="relative md:col-span-2">
            <Search className="absolute right-3 top-3.5 h-4 w-4 text-slate-400" />
            <Input
              className="pr-10"
              placeholder="الاسم أو الهاتف"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            className="h-11 rounded-xl border border-slate-200 bg-white px-2 text-sm"
            value={filters.salesUserId || ""}
            onChange={(e) => change("salesUserId", e.target.value)}
          >
            <option value="">كل السيلز</option>
            <option value="unassigned">غير موزع</option>
            {meta.sales.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            className="h-11 rounded-xl border border-slate-200 bg-white px-2 text-sm"
            value={filters.sourceId || ""}
            onChange={(e) => change("sourceId", e.target.value)}
          >
            <option value="">كل المصادر</option>
            {meta.sources.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
          <select
            className="h-11 rounded-xl border border-slate-200 bg-white px-2 text-sm"
            value={filters.purchaseType || ""}
            onChange={(e) => change("purchaseType", e.target.value)}
          >
            <option value="">كل أنواع الشراء</option>
            <option value="cash">كاش</option>
            <option value="installment">تقسيط</option>
            <option value="undecided">غير محدد</option>
          </select>
          <div className="flex gap-2">
            <select
              className="h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-2 text-sm"
              value={filters.priority || ""}
              onChange={(e) => change("priority", e.target.value)}
            >
              <option value="">كل الأولويات</option>
              <option value="urgent">عاجلة</option>
              <option value="high">عالية</option>
              <option value="normal">عادية</option>
              <option value="low">منخفضة</option>
            </select>
            <Button
              variant="secondary"
              size="icon"
              onClick={() => setRefresh((x) => x + 1)}
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
      <div className="mt-4">
        {status === "loading" ? (
          <Skeleton />
        ) : status === "error" ? (
          <EmptyState
            icon={RefreshCw}
            title="تعذر تحميل المتابعات."
            description="حدث خطأ أثناء تحميل قائمة المتابعات."
            actionLabel="إعادة المحاولة"
            onAction={() => setRefresh((x) => x + 1)}
          />
        ) : !items.length ? (
          <EmptyState
            icon={RefreshCw}
            title={
              activeFilters || debounced
                ? "لا توجد نتائج مطابقة للفلاتر الحالية."
                : view === "today"
                  ? "لا توجد متابعات مستحقة اليوم."
                  : "لا توجد متابعات مفتوحة حاليًا."
            }
            description="يمكنك تغيير العرض أو الفلاتر لمراجعة مواعيد أخرى."
            actionLabel={
              activeFilters || debounced ? "إعادة تعيين الفلاتر" : undefined
            }
            onAction={reset}
          />
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white lg:block">
              <table className="w-full text-right text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500">
                  <tr>
                    {[
                      "العميل",
                      "السيلز",
                      "المنتج والشراء",
                      "آخر تواصل",
                      "موعد المتابعة",
                      "درجة التأخير",
                      "الحالة",
                      "الإجراء",
                    ].map((x) => (
                      <th key={x} className="px-3 py-3">
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item) => {
                    const d = due(item.next_followup_at);
                    return (
                      <tr key={item.id}>
                        <td className="px-3 py-3">
                          <Link
                            to={`/apps/crm/leads/${item.id}`}
                            className="font-black hover:text-blue-700"
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
                          {item.sales_user_name || "غير موزع"}
                        </td>
                        <td className="px-3 py-3">
                          {item.interested_product_name || "غير محدد"}
                          <p className="text-xs text-slate-400">
                            {PURCHASE[item.purchase_type]}
                          </p>
                        </td>
                        <td className="px-3 py-3">
                          {relative(item.last_contact_at)}
                        </td>
                        <td className="px-3 py-3 font-bold">{d.full}</td>
                        <td
                          className={`px-3 py-3 font-bold ${d.late ? "text-red-600" : "text-blue-700"}`}
                        >
                          {d.label}
                        </td>
                        <td className="px-3 py-3">
                          <Badge>{STATUS[item.status] || item.status}</Badge>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center gap-1">
                            <Button size="sm" onClick={() => setSelected(item)}>
                              تسجيل متابعة
                            </Button>
                            <a
                              aria-label="اتصال"
                              title="اتصال"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border"
                              href={`tel:${item.phone}`}
                            >
                              <Phone className="h-4 w-4" />
                            </a>
                            <a
                              aria-label="واتساب"
                              title="واتساب"
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border text-emerald-700"
                              href={`https://wa.me/${whatsapp(item.phone)}`}
                            >
                              <MessageCircle className="h-4 w-4" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="grid gap-3 lg:hidden">
              {items.map((item) => {
                const d = due(item.next_followup_at);
                return (
                  <Card
                    key={item.id}
                    className="border-slate-200 bg-white p-4 shadow-none"
                  >
                    <div className="flex justify-between gap-2">
                      <div>
                        <h3 className="font-black">{item.customer_name}</h3>
                        <p
                          dir="ltr"
                          className="text-right text-sm text-slate-500"
                        >
                          {item.phone}
                        </p>
                      </div>
                      <Badge>{STATUS[item.status] || item.status}</Badge>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                      <p>السيلز: {item.sales_user_name || "غير موزع"}</p>
                      <p>
                        {item.interested_product_name || "غير محدد"} ·{" "}
                        {PURCHASE[item.purchase_type]}
                      </p>
                      <p className="font-bold">{d.full}</p>
                      <p
                        className={
                          d.late
                            ? "font-bold text-red-600"
                            : "font-bold text-blue-700"
                        }
                      >
                        {d.label}
                      </p>
                      <p className="col-span-2">
                        آخر تواصل: {relative(item.last_contact_at)}
                      </p>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      <Button size="sm" onClick={() => setSelected(item)}>
                        تسجيل متابعة
                      </Button>
                      <Button asChild size="sm" variant="secondary">
                        <Link to={`/apps/crm/leads/${item.id}`}>
                          فتح العميل
                        </Link>
                      </Button>
                      <a
                        className="inline-flex h-9 items-center gap-1 rounded-xl border px-3 text-xs font-bold"
                        href={`tel:${item.phone}`}
                      >
                        <Phone className="h-4 w-4" />
                        اتصال
                      </a>
                      <a
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-9 items-center gap-1 rounded-xl border px-3 text-xs font-bold text-emerald-700"
                        href={`https://wa.me/${whatsapp(item.phone)}`}
                      >
                        <MessageCircle className="h-4 w-4" />
                        واتساب
                      </a>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
      {status === "ready" && count > 0 ? (
        <div className="mt-4 flex flex-col items-center justify-between gap-3 text-sm sm:flex-row">
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
      <AddLeadActivitySheet
        open={Boolean(selected)}
        onOpenChange={(open) => !open && setSelected(null)}
        tenantId={tenantId}
        leadId={selected?.id}
        onSaved={() => {
          setNotice("تم تسجيل المتابعة بنجاح.");
          setRefresh((x) => x + 1);
        }}
      />
    </section>
  );
}
