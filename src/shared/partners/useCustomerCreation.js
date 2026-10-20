import { useCallback, useState } from 'react';
import { PERMISSIONS } from '@/core/authorization/permissions';
import { useAuthorization } from '@/core/authorization/useAuthorization';
import { partnersService } from '@/features/contacts/services/partners.service';

export function useCustomerCreation({ tenantId, onCreated } = {}) {
  const { can } = useAuthorization();
  const canCreateCustomer = can(PERMISSIONS.PARTNERS_CREATE_CUSTOMER) || can(PERMISSIONS.PARTNERS_CREATE);
  const [isCreatingCustomer, setIsCreatingCustomer] = useState(false);
  const createCustomer = useCallback(async (payload = {}) => {
    if (!canCreateCustomer) return { ok: false, error: 'غير مصرح لك بإنشاء عملاء.' };
    if (!tenantId) return { ok: false, error: 'لا توجد شركة نشطة.' };
    setIsCreatingCustomer(true);
    try {
      const partner = await partnersService.createPartner({
        ...payload, tenantId,
        isCustomer: true, customerRank: 1,
        isSupplier: false, supplierRank: 0,
        isFinancer: false, financerRank: 0,
      });
      await onCreated?.(partner);
      return { ok: true, partnerId: partner.id, partner, customer: partner };
    } catch (error) {
      return { ok: false, error: error?.message || 'تعذر إضافة العميل.' };
    } finally {
      setIsCreatingCustomer(false);
    }
  }, [canCreateCustomer, onCreated, tenantId]);
  return { canCreateCustomer, createCustomer, isCreatingCustomer };
}
