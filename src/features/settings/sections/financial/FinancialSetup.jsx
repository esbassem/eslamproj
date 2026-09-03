import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, CircleAlert, RefreshCw, WalletCards, X } from 'lucide-react';
import { Button } from '@/core/ui/button';
import { useNavigate } from 'react-router-dom';
import { ROUTES } from '@/core/config/routes.config';
import { financialReadinessService } from '@/features/settings/services/financialReadiness.service';

const foundationChecks = [
  ['chart', 'دليل الحسابات'],
  ['journals', 'اليوميات الأساسية'],
  ['functionalAccounts', 'الحسابات الوظيفية'],
];

const businessChecks = [
  ['destinations', 'أماكن الأموال'],
  ['paymentMethods', 'طرق الدفع'],
];

function StatusIcon({ ready }) {
  const Icon = ready ? Check : X;
  return <Icon aria-hidden="true" className={`h-4 w-4 ${ready ? 'text-emerald-700' : 'text-red-700'}`} />;
}

function CheckList({ title, description, checks, values }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h3 className="font-black text-slate-950">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
      <ul className="mt-4 divide-y divide-slate-100">
        {checks.map(([key, label]) => (
          <li key={key} className="flex min-h-11 items-center gap-3 py-2 text-sm font-bold text-slate-800">
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${values[key] ? 'bg-emerald-50' : 'bg-red-50'}`}>
              <StatusIcon ready={values[key]} />
            </span>
            {label}
          </li>
        ))}
      </ul>
    </section>
  );
}

function LoadingState() {
  return <div aria-label="جاري تحميل حالة الإعداد المالي" className="space-y-4"><div className="h-28 animate-pulse rounded-2xl bg-slate-100"/><div className="grid gap-4 md:grid-cols-2"><div className="h-52 animate-pulse rounded-2xl bg-slate-100"/><div className="h-52 animate-pulse rounded-2xl bg-slate-100"/></div></div>;
}

function ErrorState({ error, onRetry }) {
  const denied = error?.code === 'FINANCIAL_READINESS_ACCESS_DENIED';
  return (
    <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-5 text-center">
      <CircleAlert className="mx-auto h-7 w-7 text-red-700" />
      <h3 className="mt-3 font-black text-red-950">{denied ? 'لا يمكنك عرض الجاهزية المالية' : 'تعذر تحميل حالة الإعداد المالي'}</h3>
      <p className="mt-1 text-sm leading-6 text-red-800">{error?.message}</p>
      {!denied ? <Button className="mt-4 gap-2" variant="secondary" onClick={onRetry}><RefreshCw className="h-4 w-4"/>إعادة المحاولة</Button> : null}
    </div>
  );
}

export function FinancialSetup({ tenantId }) {
  const navigate = useNavigate();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const load = useCallback(async () => {
    setState({ status: 'loading', data: null, error: null });
    try {
      const data = await financialReadinessService.getReadiness(tenantId);
      setState({ status: 'ready', data, error: null });
    } catch (error) {
      setState({ status: 'error', data: null, error });
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  if (state.status === 'loading') return <LoadingState />;
  if (state.status === 'error') return <ErrorState error={state.error} onRetry={load} />;

  const readiness = state.data;
  return (
    <div className="space-y-5" dir="rtl">
      <section className={`rounded-2xl border p-5 ${readiness.overallReady ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
        <div className="flex items-start gap-3">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${readiness.overallReady ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}><WalletCards className="h-6 w-6"/></span>
          <div>
            <p className="text-sm font-bold text-slate-600">حالة الإعداد</p>
            <h2 className="mt-1 text-xl font-black text-slate-950">{readiness.overallReady ? 'النظام المالي جاهز للاستخدام' : 'الإعداد المالي يحتاج إلى استكمال'}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">تعكس هذه الحالة جاهزية إعدادات Financial Core، ولا تعني اكتمال نقل البيانات القديمة.</p>
          </div>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <CheckList title="الأساس المالي" description="ينشئه النظام عادةً تلقائيًا. ظهور نقص هنا يعني أن الإعداد يحتاج إلى مراجعة النظام." checks={foundationChecks} values={readiness.checks}/>
        <CheckList title="تشغيل الأموال" description="إعدادات يحددها نشاطك لتسجيل التحصيل والدفع بطريقة صحيحة." checks={businessChecks} values={readiness.checks}/>
      </div>

      {readiness.missingRequirements.length ? (
        <section aria-labelledby="missing-financial-requirements" className="rounded-2xl border border-red-200 bg-white p-4 sm:p-5">
          <h3 id="missing-financial-requirements" className="font-black text-slate-950">ما الذي ينقص؟</h3>
          <div className="mt-4 space-y-3">
            {readiness.missingRequirements.map((item) => (
              <article key={item.code} className="flex flex-col gap-3 rounded-xl bg-red-50 p-4 sm:flex-row sm:items-center">
                <CircleAlert className="h-5 w-5 shrink-0 text-red-700"/>
                <div className="min-w-0 flex-1"><p className="font-bold text-red-950">{item.label}</p><p className="mt-1 text-sm leading-6 text-red-800">{item.detail}</p></div>
                {item.actionLabel ? item.code === 'ACTIVE_MONEY_DESTINATION_REQUIRED'
                  ? <Button type="button" variant="secondary" className="min-h-11 shrink-0" onClick={() => navigate(ROUTES.settingsMoneyDestinations)}>{item.actionLabel}</Button>
                  : <Button type="button" variant="secondary" disabled title="سيتم إتاحته في مرحلة لاحقة" className="min-h-11 shrink-0">{item.actionLabel} — قريبًا</Button> : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {readiness.warnings.length ? (
        <section aria-labelledby="financial-warnings" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
          <h3 id="financial-warnings" className="flex items-center gap-2 font-black text-amber-950"><AlertTriangle className="h-5 w-5"/>تنبيهات</h3>
          <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-900">{readiness.warnings.map((warning) => <li key={warning.code}>{warning.label}{warning.detail ? <span className="block text-xs">{warning.detail}</span> : null}</li>)}</ul>
        </section>
      ) : null}

      {!readiness.checks.clearing && !readiness.warnings.length ? <p className="sr-only">إعداد المقاصة غير جاهز وفق تشخيص الخادم.</p> : null}
    </div>
  );
}
