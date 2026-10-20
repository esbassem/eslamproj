import { useCallback } from 'react';
import { salesService } from '@/features/sales/services/sales.service';
import { CustomerPicker } from '@/shared/partners';

const DEFAULT_CUSTOMER_PAGE_SIZE = 20;

export function SaleCustomerSelector({ tenantId, value, onChange, disabled = false, onCreateCustomer }) {
  const searchCustomers = useCallback(({ search, page, pageSize }) => (
    salesService.searchSaleCustomers({ tenantId, search, page, pageSize })
  ), [tenantId]);
  return <CustomerPicker value={value} onChange={onChange} disabled={disabled} onCreateCustomer={onCreateCustomer} searchCustomers={searchCustomers} pageSize={DEFAULT_CUSTOMER_PAGE_SIZE} />;
}
