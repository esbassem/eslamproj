import { PartnerList } from '@/features/contacts/components/PartnerList';

const CUSTOMER_INITIAL_VALUES = {
  isCustomer: true,
  isSupplier: false,
  isFinancer: false,
};

export function CustomersPage() {
  return <PartnerList filterType="customer" createInitialValues={CUSTOMER_INITIAL_VALUES} />;
}
