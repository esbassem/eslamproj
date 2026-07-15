import { PartnerList } from '@/features/contacts/components/PartnerList';

const SUPPLIER_INITIAL_VALUES = {
  isCustomer: false,
  isSupplier: true,
  isFinancer: false,
};

export function SuppliersPage() {
  return <PartnerList filterType="supplier" createInitialValues={SUPPLIER_INITIAL_VALUES} />;
}
