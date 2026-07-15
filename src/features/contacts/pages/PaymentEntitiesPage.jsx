import { PartnerList } from '@/features/contacts/components/PartnerList';

const PAYMENT_ENTITY_INITIAL_VALUES = {
  isCustomer: false,
  isSupplier: false,
  isFinancer: true,
  isCompany: true,
  contactType: 'company',
  companyType: 'شركة تمويل / تقسيط',
};

export function PaymentEntitiesPage() {
  return <PartnerList filterType="financer" createInitialValues={PAYMENT_ENTITY_INITIAL_VALUES} />;
}
