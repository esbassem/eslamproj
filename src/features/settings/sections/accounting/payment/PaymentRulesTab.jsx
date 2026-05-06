import { PaymentRuleForm } from '@/features/finance/payments/components/PaymentRuleForm';

export function PaymentRulesTab({ rules, isLoading, isSaving, error, onSave }) {
  return <PaymentRuleForm rules={rules} isLoading={isLoading} isSaving={isSaving} error={error} onSave={onSave} />;
}
