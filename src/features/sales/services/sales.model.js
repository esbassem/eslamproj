const COMMERCIAL_STATUSES = new Set(['draft', 'confirmed', 'cancelled']);
const PAYMENT_STATUSES = new Set(['unpaid', 'partially_paid', 'paid', 'cancelled']);
const FULFILLMENT_STATUSES = new Set([
  'unreserved',
  'reserved',
  'partially_delivered',
  'delivered',
  'not_required',
]);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function entity(value) {
  return {
    id: text(value?.id) || null,
    name: text(value?.name),
  };
}

export function normalizeSaleListItem(value = {}) {
  const status = text(value.status).toLowerCase();
  const paymentStatus = text(value.payment?.status).toLowerCase();
  const fulfillmentStatus = text(value.fulfillment?.status).toLowerCase();

  return {
    id: text(value.id),
    saleNumber: text(value.sale_number) || null,
    effectiveSaleDate: text(value.effective_sale_date),
    customer: entity(value.customer),
    branch: entity(value.branch),
    productSummary: text(value.product_summary),
    createdBy: entity(value.created_by),
    status: COMMERCIAL_STATUSES.has(status) ? status : 'draft',
    totalAmount: number(value.total_amount),
    currencyCode: text(value.currency_code).toUpperCase() || 'EGP',
    payment: {
      status: status === 'cancelled' ? 'cancelled' : PAYMENT_STATUSES.has(paymentStatus) ? paymentStatus : 'unpaid',
      settledAmount: number(value.payment?.settled_amount),
      outstandingAmount: number(value.payment?.outstanding_amount),
    },
    fulfillment: {
      status: FULFILLMENT_STATUSES.has(fulfillmentStatus) ? fulfillmentStatus : 'unreserved',
    },
    version: Math.max(number(value.version), 1),
    createdAt: text(value.created_at),
    updatedAt: text(value.updated_at),
  };
}

export function normalizeSalesListResponse(value = {}) {
  const page = Math.max(Math.trunc(number(value.page)), 1);
  const pageSize = Math.max(Math.trunc(number(value.page_size)), 1);
  const totalCount = Math.max(Math.trunc(number(value.total_count)), 0);

  return {
    items: Array.isArray(value.items) ? value.items.map(normalizeSaleListItem).filter((item) => item.id) : [],
    page,
    pageSize,
    totalCount,
    pageCount: Math.max(Math.trunc(number(value.page_count)), 0),
    filterOptions: {
      branches: Array.isArray(value.filter_options?.branches)
        ? value.filter_options.branches.map(entity).filter((item) => item.id)
        : [],
    },
  };
}

export const SALES_COMMERCIAL_LABELS = Object.freeze({
  draft: 'مسودة',
  confirmed: 'مؤكد',
  cancelled: 'ملغي',
});

export const SALES_PAYMENT_LABELS = Object.freeze({
  unpaid: 'غير مدفوع',
  partially_paid: 'مدفوع جزئيًا',
  paid: 'مدفوع بالكامل',
  cancelled: 'تم عكس الأثر المالي',
});

export const SALES_FULFILLMENT_LABELS = Object.freeze({
  unreserved: 'غير محجوز',
  reserved: 'محجوز',
  partially_delivered: 'تسليم جزئي',
  delivered: 'تم التسليم',
  not_required: 'لا يتطلب تسليم',
});
