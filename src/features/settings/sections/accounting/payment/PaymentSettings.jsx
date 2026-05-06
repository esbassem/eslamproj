import { useState } from 'react';
import { cn } from '@/core/utils/cn';
import { JournalMethodsTab } from '@/features/settings/sections/accounting/payment/JournalMethodsTab';
import { JournalsTab } from '@/features/settings/sections/accounting/payment/JournalsTab';
import { PaymentMethodsTab } from '@/features/settings/sections/accounting/payment/PaymentMethodsTab';
import { PaymentRulesTab } from '@/features/settings/sections/accounting/payment/PaymentRulesTab';
import { usePaymentMethods } from '@/features/finance/payments/hooks/usePaymentMethods';
import { usePayments } from '@/features/finance/payments/hooks/usePayments';

const paymentTabs = [
  { id: 'methods', label: 'طرق الدفع', description: 'إدارة طرق الدفع المحاسبية' },
  { id: 'rules', label: 'القواعد العامة', description: 'سياسات الدفع العامة' },
  { id: 'journals', label: 'الجورنالات المالية', description: 'جورنالات النقد والبنوك' },
  { id: 'journal-methods', label: 'ربط الطرق بالجورنالات', description: 'ربط طرق الدفع بالجورنالات' },
];

export function PaymentSettings({ activeTab: controlledActiveTab, onActiveTabChange, showTabs = true }) {
  const [localActiveTab, setLocalActiveTab] = useState('methods');
  const activeTab = controlledActiveTab ?? localActiveTab;
  const setActiveTab = onActiveTabChange ?? setLocalActiveTab;
  const showMethodState = activeTab === 'methods' || activeTab === 'journal-methods' || activeTab === 'journals';
  const showPaymentState = activeTab === 'rules';
  const {
    methods,
    methodLines,
    paymentJournals,
    activeMethods,
    activePaymentJournals,
    isLoading: isLoadingMethods,
    isSaving: isSavingMethods,
    error: methodsError,
    saveMethod,
    saveMethodLine,
    saveJournal,
    setMethodActive,
    setMethodLineActive,
    setJournalActive,
  } = usePaymentMethods({
    enabled: true,
    includeMethods: activeTab === 'methods' || activeTab === 'journal-methods' || activeTab === 'journals',
    includeMethodLines: activeTab === 'journal-methods',
    includeCashDestinations: activeTab === 'journal-methods' || activeTab === 'journals',
    bootstrap: true,
  });
  const { rules, isLoading, isSaving, error, updateRules } = usePayments({
    enabled: showPaymentState,
    includeCashDestinations: false,
  });

  return (
    <div className="space-y-6">
      {showTabs ? (
        <div className="grid gap-2 rounded-lg border border-slate-200 bg-white/90 p-2 shadow-sm md:grid-cols-4">
          {paymentTabs.map((tab) => {
            const isActive = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                className={cn(
                  'rounded-lg px-4 py-3 text-right transition duration-200',
                  isActive ? 'bg-slate-950 text-white shadow-lg shadow-slate-950/15' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950',
                )}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                <span className={cn('mt-1 block text-xs', isActive ? 'text-white/70' : 'text-muted-foreground')}>{tab.description}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {((showPaymentState && (error || isLoading)) || (showMethodState && (methodsError || isLoadingMethods))) && (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-600">
          {error || methodsError || 'جار تحميل إعدادات الدفع المحاسبية...'}
        </div>
      )}

      {activeTab === 'methods' ? (
        <PaymentMethodsTab
          methods={methods}
          isLoading={isLoadingMethods}
          isSaving={isSavingMethods}
          error={methodsError}
          onSave={saveMethod}
          onToggle={setMethodActive}
        />
      ) : null}

      {activeTab === 'rules' ? (
        <PaymentRulesTab rules={rules} isLoading={isLoading} isSaving={isSaving} error={error} onSave={updateRules} />
      ) : null}

      {activeTab === 'journals' ? (
        <JournalsTab
          journals={paymentJournals}
          methods={methods}
          isLoading={isLoadingMethods}
          isSaving={isSavingMethods}
          error={methodsError}
          onSave={saveJournal}
          onToggle={setJournalActive}
        />
      ) : null}

      {activeTab === 'journal-methods' ? (
        <JournalMethodsTab
          journals={activePaymentJournals}
          methods={activeMethods}
          methodLines={methodLines}
          isLoading={isLoadingMethods}
          isSaving={isSavingMethods}
          error={methodsError}
          onSave={saveMethodLine}
          onToggle={setMethodLineActive}
        />
      ) : null}
    </div>
  );
}
