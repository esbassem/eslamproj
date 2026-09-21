import { requireSupabase } from '@/core/lib/supabase';
import { normalizeSalesListResponse } from '@/features/sales/services/sales.model';
import { normalizeSalesOverview } from '@/features/sales/services/salesOverview.model';
import { normalizeSalesBranchReports } from '@/features/sales/services/salesBranchReports.model';
import {
  normalizeCustomer,
  normalizeDraftOptions,
  normalizePaged,
  normalizeProduct,
  normalizeSaleDraft,
  normalizeTrackingUnit,
} from '@/features/sales/services/salesDraft.model';
import { normalizeSaleDetails, normalizeSaleReadiness } from '@/features/sales/services/salesDetails.model';
import { applyHistoricalSaleRead, indexHistoricalSales } from '@/features/sales/services/historicalSales.model';
import {
  normalizeSaleDeliveryEligibility,
  normalizeSaleDeliveryResult,
} from '@/features/sales/services/salesDelivery.model';
import {
  normalizeSaleCancellationEligibility,
  normalizeSaleCancellationResult,
} from '@/features/sales/services/salesCancellation.model';

const SALES_LIST_ERRORS = Object.freeze({
  SALES_OVERVIEW_DENIED: 'ليس لديك صلاحية لعرض نظرة المبيعات.',
  SALES_OVERVIEW_PERIOD_INVALID: 'الفترة المحددة غير صحيحة.',
  SALES_OVERVIEW_BRANCH_SCOPE_DENIED: 'الفرع المحدد خارج نطاق عملك.',
  SALES_BRANCH_REPORTS_DENIED: 'ليس لديك صلاحية لعرض تقارير فروع المبيعات.',
  SALES_VIEW_DENIED: 'ليس لديك صلاحية لعرض المبيعات.',
  SALES_BRANCH_SCOPE_DENIED: 'الفرع المحدد خارج نطاق عملك.',
  SALES_LIST_PAGE_INVALID: 'رقم الصفحة غير صحيح.',
  SALES_LIST_PAGE_SIZE_INVALID: 'حجم الصفحة غير صحيح.',
  SALES_LIST_SEARCH_TOO_LONG: 'نص البحث طويل جدًا.',
  SALES_LIST_STATUS_INVALID: 'حالة البيع المحددة غير صحيحة.',
  SALES_LIST_PAYMENT_STATUS_INVALID: 'حالة الدفع المحددة غير صحيحة.',
  SALES_LIST_FULFILLMENT_STATUS_INVALID: 'حالة التسليم المحددة غير صحيحة.',
  SALES_LIST_DATE_RANGE_INVALID: 'فترة البحث غير صحيحة.',
  SALES_CREATE_DENIED: 'ليس لديك صلاحية إنشاء مسودة بيع.',
  SALES_UPDATE_DRAFT_DENIED: 'ليس لديك صلاحية تعديل مسودة البيع.',
  SALES_BRANCH_ACCESS_DENIED: 'الفرع المحدد خارج نطاق عملك.',
  SALES_BRANCH_INVALID: 'الفرع المحدد غير صالح أو غير نشط.',
  SALES_INVENTORY_LOCATION_DENIED: 'موقع المخزون المحدد خارج نطاق عملك.',
  SALES_CUSTOMER_INVALID: 'العميل المحدد غير صالح للبيع.',
  SALES_FUTURE_DATE_DENIED: 'لا يمكن استخدام تاريخ بيع مستقبلي.',
  SALES_BACKDATE_DENIED: 'ليس لديك صلاحية تغيير تاريخ البيع إلى تاريخ سابق.',
  SALES_CURRENCY_INVALID: 'عملة البيع غير صحيحة.',
  SALES_NOTES_TOO_LONG: 'ملاحظات البيع أطول من الحد المسموح.',
  SALES_VERSION_CONFLICT: 'تم تعديل البيع من مستخدم آخر. أعد تحميل البيانات قبل الحفظ.',
  SALES_IDEMPOTENCY_CONFLICT: 'تعذر إعادة المحاولة لأن بيانات المسودة تغيّرت. حاول الحفظ مرة أخرى.',
  SALE_NOT_DRAFT: 'لا يمكن تعديل البيع لأنه لم يعد مسودة.',
  SALE_NOT_FOUND: 'تعذر العثور على البيع المطلوب.',
  SALE_SCOPE_DENIED: 'البيع المطلوب خارج نطاق الفروع المسموح لك بها.',
  SALE_LINES_INVALID: 'بنود البيع غير صحيحة.',
  SALE_LINE_INPUT_INVALID: 'بيانات أحد بنود البيع غير صحيحة.',
  SALE_LINE_PRODUCT_NOT_SELLABLE: 'أحد المنتجات لم يعد متاحًا للبيع.',
  SALE_DRAFT_TRACKING_UNIT_UNAVAILABLE: 'القطعة المختارة لم تعد متاحة. اختر قطعة أخرى.',
  SALE_MULTIPLE_RESERVATION_LOCATIONS_NOT_SUPPORTED: 'يجب استخدام موقع مخزون واحد لكل عملية بيع.',
  SALES_DRAFT_OPTIONS_DENIED: 'ليس لديك صلاحية فتح بيانات مسودة البيع.',
  SALES_CUSTOMER_SEARCH_DENIED: 'ليس لديك صلاحية البحث عن العملاء من المبيعات.',
  SALES_PRODUCT_SEARCH_DENIED: 'ليس لديك صلاحية البحث عن المنتجات من المبيعات.',
  SALES_TRACKING_SEARCH_DENIED: 'ليس لديك صلاحية عرض القطع المتاحة.',
  SALES_AVAILABILITY_DENIED: 'ليس لديك صلاحية عرض توفر المخزون.',
  SALES_SEARCH_PAGE_INVALID: 'بيانات البحث غير صحيحة.',
  SALES_SEARCH_TOO_LONG: 'نص البحث طويل جدًا.',
  SALES_QUANTITY_INVALID: 'الكمية غير صحيحة.',
  SALES_QUANTITY_PRODUCT_INVALID: 'المنتج الكمي المحدد غير صالح لهذه العملية.',
  SALES_SERIAL_PRODUCT_INVALID: 'المنتج المتسلسل المحدد غير صالح لهذه العملية.',
  SALE_DRAFT_INVENTORY_INTENT_INVALID: 'اختيار المخزون في أحد البنود غير صحيح.',
  SALE_DRAFT_TRACKING_UNIT_DUPLICATE: 'لا يمكن اختيار نفس القطعة في أكثر من بند.',
  SALES_CONFIRM_DENIED: 'ليس لديك صلاحية تأكيد البيع.',
  SALES_CONFIRM_IDEMPOTENCY_KEY_INVALID: 'تعذر بدء محاولة التأكيد بأمان. حاول مرة أخرى.',
  SALES_IDEMPOTENCY_IN_PROGRESS: 'المحاولة السابقة ما زالت قيد التنفيذ. انتظر قليلًا ثم أعد المحاولة.',
  SALE_INVENTORY_SELECTIONS_INVALID: 'اختيارات المخزون غير صحيحة. راجع المسودة ثم حاول مرة أخرى.',
  SALE_INVENTORY_SELECTION_INVALID: 'أحد اختيارات المخزون غير صحيح. راجع المسودة ثم حاول مرة أخرى.',
  SALE_INVENTORY_SELECTION_DUPLICATE: 'لا يمكن استخدام نفس اختيار المخزون أكثر من مرة.',
  SALE_INVENTORY_SELECTION_LINE_INVALID: 'تغير أحد بنود البيع. أعد تحميل البيانات ثم راجع المسودة.',
  SALE_INVENTORY_LOCATION_DENIED: 'موقع المخزون خارج نطاق عملك أو لم يعد متاحًا.',
  SALE_SERVICE_SELECTION_NOT_ALLOWED: 'لا يجب ربط بنود الخدمات باختيار مخزون.',
  SALE_SERIAL_SELECTION_INCOMPLETE: 'اختيار القطع المتسلسلة غير مكتمل.',
  SALE_QUANTITY_SELECTION_INCOMPLETE: 'كمية المخزون المختارة لا تطابق كمية البيع.',
  SALE_INVENTORY_UNAVAILABLE: 'المخزون المختار لم يعد متاحًا. راجع المسودة واختر مخزونًا متاحًا.',
  SALE_MULTIPLE_RESERVATION_LOCATIONS_NOT_SUPPORTED: 'يجب استخدام موقع مخزون واحد لكل عملية بيع.',
  SALE_INVENTORY_PRODUCT_TYPE_UNSUPPORTED: 'نوع أحد بنود المخزون غير مدعوم للتأكيد.',
  SALE_LOT_TRACKING_NOT_SUPPORTED: 'تتبع الدُفعات غير مدعوم في التأكيد الحالي.',
  SALE_TRACKING_REQUIREMENT_UNSUPPORTED: 'طريقة تتبع أحد المنتجات غير مدعومة للتأكيد.',
  SALE_COMMERCIAL_READINESS_FAILED: 'بيانات البيع لم تعد جاهزة للتأكيد. راجع المسودة.',
  SALE_PRODUCT_INVALID: 'أحد المنتجات لم يعد صالحًا للبيع.',
  SALE_FINANCIAL_BINDING_MISSING: 'تعذر إنشاء الاستحقاق المالي للبيع. راجع الإعداد المالي ثم حاول مرة أخرى.',
  FINANCIAL_PERIOD_CLOSED: 'لا يمكن إنشاء الاستحقاق المالي لأن الفترة المالية مغلقة.',
  FUTURE_FINANCIAL_POSTING_DATE_NOT_ALLOWED: 'تاريخ البيع غير مسموح به للترحيل المالي.',
  FINANCIAL_POSTING_DATE_REQUIRED: 'تاريخ البيع مطلوب لإنشاء الاستحقاق المالي.',
  FINANCIAL_AUTHORIZATION_DENIED: 'تعذر إنشاء الاستحقاق المالي بسبب نطاق الصلاحيات.',
  FINANCIAL_SALE_REQUIRED_CONTEXT_MISSING: 'تعذر إنشاء الاستحقاق المالي لأن بيانات البيع غير مكتملة.',
  FINANCIAL_SALE_SOURCE_IDENTITY_INVALID: 'تعذر ربط الاستحقاق المالي بالبيع.',
  FINANCIAL_SALE_EVENT_VERSION_INVALID: 'تغير إصدار البيع قبل إنشاء الاستحقاق المالي. أعد تحميل البيانات.',
  FINANCIAL_SALE_AMOUNT_INVALID: 'إجمالي البيع غير صالح لإنشاء الاستحقاق المالي.',
  FINANCIAL_SALE_CURRENCY_INVALID: 'عملة البيع غير صالحة لإنشاء الاستحقاق المالي.',
  FINANCIAL_SALE_BRANCH_INVALID_OR_INACTIVE: 'تعذر إنشاء الاستحقاق المالي لأن الفرع غير صالح أو غير نشط.',
  FINANCIAL_SALE_CUSTOMER_INVALID_OR_INACTIVE: 'تعذر إنشاء الاستحقاق المالي لأن العميل غير صالح أو غير نشط.',
  FINANCIAL_SALE_IDEMPOTENCY_PAYLOAD_MISMATCH: 'تعارضت محاولة إنشاء الاستحقاق المالي مع محاولة سابقة. أعد تحميل البيانات.',
  FINANCIAL_SALE_SOURCE_EVENT_PAYLOAD_MISMATCH: 'تغيرت بيانات البيع المالية. أعد تحميل البيانات قبل التأكيد.',
  FUNCTIONAL_ACCOUNT_NOT_CONFIGURED_OR_INCOMPATIBLE: 'الإعداد المالي للحسابات الوظيفية غير مكتمل أو غير متوافق.',
  FUNCTIONAL_ACCOUNT_NOT_CONFIGURED: 'الإعداد المالي للحسابات الوظيفية غير مكتمل. استكمل الإعداد ثم حاول مرة أخرى.',
  FINANCIAL_JOURNAL_NOT_CONFIGURED: 'يومية المبيعات غير مضبوطة في الإعداد المالي.',
  SALES_DELIVERY_DENIED: 'ليس لديك صلاحية تسليم المبيعات.',
  SALE_DELIVERY_SCOPE_DENIED: 'البيع أو موقع المخزون خارج نطاق التسليم المسموح لك به.',
  SALES_DELIVERY_IDEMPOTENCY_KEY_INVALID: 'تعذر بدء محاولة التسليم بأمان. حاول مرة أخرى.',
  SALE_DELIVERY_LINES_INVALID: 'اختر بنودًا صحيحة للتسليم.',
  SALE_DELIVERY_LINE_INVALID: 'بيانات أحد بنود التسليم غير صحيحة.',
  SALE_DELIVERY_LINES_DUPLICATE: 'لا يمكن تكرار نفس البند أو القطعة في عملية التسليم.',
  SALE_DELIVERY_NOT_ELIGIBLE: 'لم يعد البيع جاهزًا للتسليم. حدّث البيانات وراجع حالة التنفيذ.',
  SALE_DELIVERY_LINE_NOT_DELIVERABLE: 'أحد البنود أو القطع لم يعد قابلًا للتسليم.',
  SALE_DELIVERY_RESERVATION_MAPPING_INVALID: 'تعذر مطابقة التسليم مع حجز المخزون الحالي.',
  SALE_DELIVERY_INVENTORY_STATE_INVALID: 'تعذر اعتماد حالة المخزون بعد التسليم.',
  SALE_DELIVERY_FINAL_STATE_INVALID: 'تعذر اعتماد الحالة النهائية للتسليم.',
  SALE_NOT_CONFIRMED: 'البيع غير مؤكد ولا يقبل هذه العملية.',
  INVENTORY_RESERVATION_NOT_DELIVERABLE: 'حجز المخزون لم يعد قابلًا للتسليم.',
  INVENTORY_OVER_DELIVERY: 'الكمية المطلوبة أكبر من المتبقي القابل للتسليم.',
  INVENTORY_SERIAL_DELIVERY_INVALID: 'القطعة المتسلسلة المحددة غير صالحة للتسليم.',
  INVENTORY_TRACKING_STATE_INVALID: 'القطعة لم تعد محجوزة أو متاحة لهذا البيع.',
  INVENTORY_NEGATIVE_STOCK_DENIED: 'لا يمكن تنفيذ التسليم لأن رصيد المخزون غير كافٍ.',
  SALES_CANCEL_DENIED: 'ليس لديك صلاحية إلغاء المبيعات.',
  SALES_CANCELLATION_VIEW_DENIED: 'ليس لديك صلاحية عرض جاهزية إلغاء البيع.',
  SALES_CANCELLATION_INPUT_INVALID: 'بيانات طلب الإلغاء غير مكتملة.',
  SALES_CANCELLATION_REASON_INVALID: 'سبب الإلغاء مطلوب ويجب ألا يتجاوز 1000 حرف.',
  SALES_CANCELLATION_IDEMPOTENCY_INVALID: 'تعذر بدء محاولة الإلغاء بأمان. حاول مرة أخرى.',
  SALES_CANCELLATION_IDEMPOTENCY_CONFLICT: 'تعارضت محاولة الإلغاء مع طلب سابق. حدّث البيع ثم حاول مرة أخرى.',
  SALE_ALREADY_CANCELLED: 'تم إلغاء هذا البيع بالفعل.',
  SALE_CANCELLATION_HAS_DELIVERY: 'تم تسليم جزء من هذا البيع بالفعل. استخدم إجراء المرتجع بدل الإلغاء.',
  SALE_CANCELLATION_HAS_SETTLEMENT: 'يوجد تحصيل مسجل على هذا البيع. يجب معالجة رد المبلغ قبل إلغاء البيع.',
  SALE_CANONICAL_CONFIRMATION_INVALID: 'تعذر التحقق من آثار تأكيد البيع الحالية.',
  SALE_FINANCIAL_REVERSAL_UNAVAILABLE: 'تعذر عكس الأثر المالي لهذا البيع بأمان.',
  SALE_INVENTORY_RELEASE_UNAVAILABLE: 'تعذر تحرير حجز البضاعة لهذا البيع بأمان.',
  FINANCIAL_SALE_REVERSAL_DENIED: 'تعذر عكس الأثر المالي بسبب نطاق الصلاحيات.',
  FINANCIAL_SALE_HAS_SETTLEMENT: 'يوجد تحصيل مسجل على هذا البيع. يجب معالجة رد المبلغ قبل إلغاء البيع.',
  FINANCIAL_SALE_POSTING_NOT_REVERSIBLE: 'تعذر عكس ترحيل البيع في حالته الحالية.',
  FINANCIAL_SALE_POSTING_ALREADY_REVERSED: 'تم عكس الأثر المالي لهذا البيع بالفعل.',
});

function normalizeSalesError(error, fallback = 'تعذر إكمال العملية. حاول مرة أخرى.') {
  const diagnostic = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`;
  const code = Object.keys(SALES_LIST_ERRORS).find((candidate) => diagnostic.includes(candidate));
  const normalized = new Error(code ? SALES_LIST_ERRORS[code] : fallback);
  normalized.code = code || 'SALES_REQUEST_FAILED';
  normalized.cause = error;
  return normalized;
}

export async function listSales({
  tenantId,
  page = 1,
  pageSize = 25,
  search = '',
  status = '',
  branchId = '',
  dateFrom = '',
  dateTo = '',
  paymentStatus = '',
  fulfillmentStatus = '',
} = {}) {
  if (!tenantId) {
    throw new Error('تعذر تحديد مساحة العمل الحالية.');
  }

  const client = requireSupabase();
  const { data, error } = await client.rpc('list_sales', {
    p_page: page,
    p_page_size: pageSize,
    p_search: search.trim() || null,
    p_status: status || null,
    p_branch_id: branchId || null,
    p_date_from: dateFrom || null,
    p_date_to: dateTo || null,
    p_payment_status: paymentStatus || null,
    p_fulfillment_status: fulfillmentStatus || null,
  });

  if (error) {
    throw normalizeSalesError(error, 'تعذر تحميل المبيعات. حاول مرة أخرى.');
  }

  const result = normalizeSalesListResponse(data);
  if (!result.items.length) return result;
  const { data: historicalData, error: historicalError } = await client.rpc('get_historical_sales_read', {
    p_sale_ids: result.items.map((item) => item.id),
  });
  if (historicalError) throw normalizeSalesError(historicalError, 'تعذر تحميل بيانات المبيعات التاريخية.');
  const historical = indexHistoricalSales(historicalData);
  return { ...result, items: result.items.map((item) => applyHistoricalSaleRead(item, historical.get(item.id))) };
}

export async function getSalesOverview({ tenantId, period = 'last_7_days', branchId = '' } = {}) {
  if (!tenantId) throw new Error('تعذر تحديد مساحة العمل الحالية.');
  return rpc('get_sales_overview', {
    p_period: period,
    p_branch_id: branchId || null,
  }, normalizeSalesOverview);
}

export async function getSalesBranchReports({ tenantId, month } = {}) {
  if (!tenantId) throw new Error('تعذر تحديد مساحة العمل الحالية.');
  return rpc('get_sales_monthly_branch_reports', { p_month: month || null }, normalizeSalesBranchReports);
}

async function rpc(name, params, normalizer = (value) => value) {
  const client = requireSupabase();
  const { data, error } = await client.rpc(name, params);
  if (error) throw normalizeSalesError(error);
  return normalizer(data);
}

function isMissingSaleDetailsContactOverload(error) {
  if (error?.code === 'PGRST202') return true;
  const diagnostic = `${error?.message ?? ''} ${error?.details ?? ''} ${error?.hint ?? ''}`;
  return diagnostic.includes('get_sale_details') && diagnostic.includes('p_include_customer_contact');
}

export async function getSaleDraftOptions({ tenantId } = {}) {
  if (!tenantId) throw new Error('تعذر تحديد مساحة العمل الحالية.');
  return rpc('get_sale_draft_options', {}, normalizeDraftOptions);
}

export async function searchSaleCustomers({ tenantId, search, page = 1, pageSize = 20 } = {}) {
  if (!tenantId) throw new Error('تعذر تحديد مساحة العمل الحالية.');
  return rpc('search_sale_customers', {
    p_search: String(search ?? '').trim(), p_page: page, p_page_size: pageSize,
  }, (value) => normalizePaged(value, normalizeCustomer));
}

export async function searchSaleProducts({ tenantId, search, page = 1, pageSize = 20 } = {}) {
  if (!tenantId) throw new Error('تعذر تحديد مساحة العمل الحالية.');
  return rpc('search_sale_products', {
    p_search: String(search ?? '').trim(), p_page: page, p_page_size: pageSize,
  }, (value) => normalizePaged(value, normalizeProduct));
}

export async function searchSaleTrackingUnits({
  tenantId, branchId, productId, locationId, search = '', page = 1, pageSize = 20,
} = {}) {
  if (!tenantId || !branchId || !productId || !locationId) return { items: [], page: 1, pageSize, hasMore: false };
  return rpc('search_sale_tracking_units', {
    p_branch_id: branchId, p_product_id: productId, p_location_id: locationId,
    p_search: String(search ?? '').trim() || null, p_page: page, p_page_size: pageSize,
  }, (value) => normalizePaged(value, normalizeTrackingUnit));
}

export async function getSaleQuantityAvailability({ tenantId, branchId, productId, locationId, quantity } = {}) {
  if (!tenantId || !branchId || !productId || !locationId) return null;
  return rpc('get_sale_quantity_availability', {
    p_branch_id: branchId, p_product_id: productId, p_location_id: locationId, p_quantity: quantity,
  }, (value) => ({
    availableQuantity: Number(value?.available_quantity ?? 0),
    isAvailable: value?.is_available === true,
  }));
}

export async function createSale({ tenantId, branchId, customerId, effectiveSaleDate, currencyCode = 'EGP', notes = null, idempotencyKey } = {}) {
  if (!tenantId) throw new Error('تعذر تحديد مساحة العمل الحالية.');
  return rpc('create_sale', {
    p_branch_id: branchId,
    p_customer_id: customerId,
    p_effective_sale_date: effectiveSaleDate,
    p_currency_code: currencyCode,
    p_notes: notes,
    p_idempotency_key: idempotencyKey,
  });
}

export async function updateSaleDraft({ tenantId, saleId, expectedVersion, payload, idempotencyKey } = {}) {
  if (!tenantId) throw new Error('تعذر تحديد مساحة العمل الحالية.');
  return rpc('update_sale_draft', {
    p_sale_id: saleId,
    p_expected_version: expectedVersion,
    p_branch_id: payload.branchId,
    p_customer_id: payload.customerId,
    p_effective_sale_date: payload.effectiveSaleDate,
    p_currency_code: payload.currencyCode,
    p_notes: payload.notes,
    p_lines: payload.lines,
    p_idempotency_key: idempotencyKey,
    p_inventory_intents: payload.inventoryIntents,
  });
}

export async function getSale({ tenantId, saleId } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  return rpc('get_sale', { p_sale_id: saleId }, normalizeSaleDraft);
}

export async function getSaleDetails({ tenantId, saleId } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  const client = requireSupabase();
  let response = await client.rpc('get_sale_details', {
    p_sale_id: saleId,
    p_include_customer_contact: true,
  });

  // Keep the details screen available during a rolling deployment where the
  // frontend may arrive before the contact-aware RPC overload/schema cache.
  if (response.error && isMissingSaleDetailsContactOverload(response.error)) {
    response = await client.rpc('get_sale_details', { p_sale_id: saleId });
  }

  if (response.error) {
    throw normalizeSalesError(response.error, 'تعذر تحميل تفاصيل البيع. حاول مرة أخرى.');
  }

  const sale = normalizeSaleDetails(response.data);
  const historical = await rpc('get_historical_sales_read', { p_sale_ids: [saleId] });
  return applyHistoricalSaleRead(sale, indexHistoricalSales(historical).get(saleId));
}

export async function getSaleReadiness({ tenantId, saleId } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  return rpc('get_sale_readiness', { p_sale_id: saleId }, normalizeSaleReadiness);
}

export async function confirmSale({ tenantId, saleId, expectedVersion, inventorySelections, idempotencyKey } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  return rpc('confirm_sale', {
    p_sale_id: saleId,
    p_expected_version: expectedVersion,
    p_inventory_selections: inventorySelections,
    p_idempotency_key: idempotencyKey,
  });
}

export async function getSaleDeliveryEligibility({ tenantId, saleId } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  return rpc('get_sale_delivery_eligibility', { p_sale_id: saleId }, normalizeSaleDeliveryEligibility);
}

export async function deliverSale({ tenantId, saleId, expectedVersion, deliveryLines, idempotencyKey } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  return rpc('deliver_sale', {
    p_sale_id: saleId,
    p_expected_version: expectedVersion,
    p_delivery_lines: deliveryLines,
    p_idempotency_key: idempotencyKey,
  }, normalizeSaleDeliveryResult);
}

export async function getSaleCancellationEligibility({ tenantId, saleId } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  return rpc('get_sale_cancellation_eligibility', {
    p_sale_id: saleId,
  }, normalizeSaleCancellationEligibility);
}

export async function cancelSale({ tenantId, saleId, expectedVersion, reason, idempotencyKey } = {}) {
  if (!tenantId || !saleId) throw new Error('بيانات البيع غير مكتملة.');
  return rpc('cancel_sale', {
    p_sale_id: saleId,
    p_expected_version: expectedVersion,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  }, normalizeSaleCancellationResult);
}

export const salesService = Object.freeze({
  getSalesOverview,
  getSalesBranchReports,
  listSales,
  getSaleDraftOptions,
  searchSaleCustomers,
  searchSaleProducts,
  searchSaleTrackingUnits,
  getSaleQuantityAvailability,
  createSale,
  updateSaleDraft,
  getSale,
  getSaleDetails,
  getSaleReadiness,
  confirmSale,
  getSaleDeliveryEligibility,
  deliverSale,
  getSaleCancellationEligibility,
  cancelSale,
});
