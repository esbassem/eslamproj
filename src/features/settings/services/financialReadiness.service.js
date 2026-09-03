export const FINANCIAL_REQUIREMENT_PRESENTATION = Object.freeze({
  CANONICAL_CHART_NOT_INSTALLED: {
    label: 'دليل الحسابات الأساسي غير جاهز',
    detail: 'يحتاج مراجعة إعداد النظام.',
    group: 'foundation',
  },
  GENERAL_JOURNAL_NOT_CONFIGURED: {
    label: 'اليومية العامة غير جاهزة',
    detail: 'يحتاج مراجعة إعداد النظام.',
    group: 'foundation',
  },
  REQUIRED_FUNCTIONAL_ACCOUNTS_NOT_CONFIGURED: {
    label: 'ربط الحسابات الوظيفية غير مكتمل',
    detail: 'يحتاج مراجعة إعداد النظام.',
    group: 'foundation',
  },
  ACTIVE_MONEY_DESTINATION_REQUIRED: {
    label: 'لا يوجد مكان أموال نشط',
    detail: 'أضف مكانًا لاستقبال الأموال أو صرفها.',
    group: 'business',
    actionLabel: 'إضافة مكان أموال',
  },
  USABLE_PAYMENT_METHOD_REQUIRED: {
    label: 'لا توجد طريقة دفع قابلة للاستخدام',
    detail: 'أضف طريقة دفع واربطها بمكان الأموال المناسب.',
    group: 'business',
    actionLabel: 'إعداد طرق الدفع',
  },
});

export const FINANCIAL_WARNING_PRESENTATION = Object.freeze({
  ENABLED_CLEARING_METHOD_NOT_READY: 'توجد طريقة دفع تعتمد على المقاصة ولم يكتمل إعدادها.',
});

function booleanValue(value) {
  return value === true;
}

function diagnosticCode(item) {
  return typeof item === 'string' ? item : item?.code;
}

export function presentFinancialRequirement(item) {
  const code = diagnosticCode(item) || 'UNKNOWN_REQUIREMENT';
  return {
    code,
    category: typeof item === 'object' ? item?.category ?? null : null,
    ...(FINANCIAL_REQUIREMENT_PRESENTATION[code] ?? {
      label: 'يوجد إعداد مالي يحتاج إلى مراجعة',
      detail: `رمز التشخيص: ${code}`,
      group: 'unknown',
    }),
  };
}

export function presentFinancialWarning(item) {
  const code = diagnosticCode(item) || 'UNKNOWN_WARNING';
  return {
    code,
    label: FINANCIAL_WARNING_PRESENTATION[code] ?? 'يوجد تنبيه مالي يحتاج إلى مراجعة.',
    detail: FINANCIAL_WARNING_PRESENTATION[code] ? null : `رمز التشخيص: ${code}`,
  };
}

export function adaptFinancialReadiness(payload, tenantId) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('FINANCIAL_READINESS_INVALID_RESPONSE');
  }

  if (payload.tenant_id && payload.tenant_id !== tenantId) {
    throw new Error('FINANCIAL_READINESS_TENANT_MISMATCH');
  }

  return {
    tenantId,
    overallReady: booleanValue(payload.overall_ready),
    checks: {
      chart: booleanValue(payload.chart_ready),
      journals: booleanValue(payload.journals_ready),
      functionalAccounts: booleanValue(payload.functional_accounts_ready),
      destinations: booleanValue(payload.destinations_ready),
      paymentMethods: booleanValue(payload.payment_methods_ready),
      clearing: booleanValue(payload.clearing_ready),
    },
    missingRequirements: (payload.missing_requirements ?? []).map(presentFinancialRequirement),
    warnings: (payload.warnings ?? []).map(presentFinancialWarning),
  };
}

function readinessError(error) {
  const denied = error?.code === '42501' || String(error?.message ?? '').includes('FINANCIAL_READINESS_ACCESS_DENIED');
  const wrapped = new Error(denied ? 'ليس لديك صلاحية لعرض جاهزية الإعداد المالي.' : 'تعذر تحميل حالة الإعداد المالي.');
  wrapped.code = denied ? 'FINANCIAL_READINESS_ACCESS_DENIED' : 'FINANCIAL_READINESS_LOAD_FAILED';
  wrapped.cause = error;
  return wrapped;
}

export const financialReadinessService = {
  async getReadiness(tenantId, client) {
    if (!tenantId) {
      const error = new Error('لا توجد شركة نشطة لعرض جاهزيتها المالية.');
      error.code = 'FINANCIAL_READINESS_TENANT_REQUIRED';
      throw error;
    }

    let rpcClient = client;
    if (!rpcClient) {
      const { requireSupabase } = await import('@/core/lib/supabase');
      rpcClient = requireSupabase();
    }

    const { data, error } = await rpcClient.rpc('get_financial_readiness', { p_tenant_id: tenantId });
    if (error) throw readinessError(error);

    try {
      return adaptFinancialReadiness(data, tenantId);
    } catch (error) {
      if (error?.message === 'FINANCIAL_READINESS_TENANT_MISMATCH') {
        const mismatch = new Error('تعذر التحقق من نطاق الشركة في نتيجة الجاهزية المالية.');
        mismatch.code = error.message;
        throw mismatch;
      }
      throw readinessError(error);
    }
  },
};
