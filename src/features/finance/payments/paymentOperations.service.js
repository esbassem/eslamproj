import { partnersService } from '@/features/contacts/services/partners.service';
import {
  allocatePayment,
  confirmFinancialPayment,
  createFinancialPayment,
  getFinancialPayment,
  getPaymentAllocationSummary,
  postFinancialPayment,
  submitFinancialPayment,
} from './canonicalPayments.service';
import { normalizeFinancialError, requireFinancialTenant } from '../shared/financialError';

const INBOUND_CUSTOMER_PURPOSE = 'inbound_customer_unallocated';

export async function searchPaymentCustomers({ tenantId, search, limit = 25 } = {}) {
  requireFinancialTenant(tenantId);
  const term = String(search ?? '').trim();
  if (term.length < 2) return [];
  try {
    return await partnersService.getPartners({
      tenantId,
      filterType: 'customer',
      status: 'active',
      search: term,
      limit,
    });
  } catch (error) {
    throw normalizeFinancialError(error, 'تعذر البحث عن العملاء.');
  }
}

export async function registerInboundCustomerPayment({
  tenantId,
  partnerId,
  amount,
  paymentMethodId,
  moneyDestinationId = null,
  currencyCode = 'EGP',
  branchId = null,
  referenceNumber = null,
  notes = null,
  source = null,
  targetOpenItemId = null,
  allocationAmount = null,
  idempotencyKey,
  includeAllocationSummary = false,
  confirmSubmitted = false,
} = {}) {
  requireFinancialTenant(tenantId);
  try {
    const created = await createFinancialPayment({
      tenantId,
      direction: 'inbound',
      amount,
      paymentMethodId,
      moneyDestinationId,
      currencyCode,
      partnerId,
      branchId,
      referenceNumber,
      notes,
      sourceApp: source?.app ?? null,
      sourceModel: source?.model ?? null,
      sourceId: source?.id ?? null,
      idempotencyKey,
    });
    let currentReadback = await getFinancialPayment({ tenantId, paymentId: created.payment_id });
    const submitted = currentReadback?.payment?.status === 'draft'
      ? await submitFinancialPayment({ tenantId, paymentId: created.payment_id })
      : { payment_id: created.payment_id, status: currentReadback?.payment?.status, idempotent_resume: true };
    const confirmed = submitted?.status === 'submitted' && confirmSubmitted
      ? await confirmFinancialPayment({ tenantId, paymentId: created.payment_id })
      : null;
    const lifecycle = confirmed ?? submitted;
    let posting = null;
    let allocation = null;

    if (lifecycle?.status === 'confirmed') {
      if (confirmed || submitted?.status !== currentReadback?.payment?.status) {
        currentReadback = await getFinancialPayment({ tenantId, paymentId: created.payment_id });
      }
      posting = currentReadback?.payment?.accounting_state === 'posted'
        ? { payment_id: created.payment_id, accounting_state: 'posted', idempotent_resume: true }
        : await postFinancialPayment({
          tenantId,
          paymentId: created.payment_id,
          paymentPurpose: INBOUND_CUSTOMER_PURPOSE,
        });
      if (targetOpenItemId) {
        allocation = await allocatePayment({
          tenantId,
          paymentId: created.payment_id,
          targetAccountLineId: targetOpenItemId,
          amount: allocationAmount ?? amount,
          idempotencyKey: `${idempotencyKey}:allocation`,
        });
      }
    }

    const readback = await getFinancialPayment({ tenantId, paymentId: created.payment_id });
    const shouldLoadSummary = Boolean(posting && (includeAllocationSummary || targetOpenItemId));
    const allocationSummary = shouldLoadSummary
      ? await getPaymentAllocationSummary({ tenantId, paymentId: created.payment_id })
      : null;

    return { created, submitted, confirmed, posting, allocation, readback, allocationSummary };
  } catch (error) {
    throw normalizeFinancialError(error, 'تعذر تسجيل الدفعة.');
  }
}
