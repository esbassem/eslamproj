import { normalizeSaleDraft } from './salesDraft.model.js';

const PAYMENT_STATUSES = new Set(['not_confirmed', 'unpaid', 'partially_paid', 'paid', 'cancelled']);
const FULFILLMENT_STATUSES = new Set(['unreserved', 'reserved', 'partially_delivered', 'delivered', 'not_required']);
const LINE_FULFILLMENT_STATUSES = new Set(['unselected', 'selected', 'unreserved', 'reserved', 'partially_delivered', 'delivered', 'not_required']);

const text = (value) => typeof value === 'string' ? value.trim() : '';
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

function normalizeActor(value) {
  return { name: text(value?.name) };
}

function normalizeTrackingUnit(value = {}) {
  return {
    id: text(value.id),
    trackingNumber: text(value.tracking_number),
    chassisNumber: text(value.chassis_number) || text(value.tracking_number),
    engineNumber: text(value.engine_number),
    state: ['selected', 'reserved', 'delivered'].includes(text(value.state)) ? text(value.state) : 'selected',
    attributes: Array.isArray(value.attributes)
      ? value.attributes.map((item) => ({ name: text(item.name), value: text(item.value) })).filter((item) => item.name || item.value)
      : [],
  };
}

export function normalizeSaleDetails(value = {}) {
  const draft = normalizeSaleDraft(value);
  const paymentStatus = text(value.payment?.status);
  const fulfillmentStatus = text(value.fulfillment?.status);
  const sourceLines = Array.isArray(value.lines) ? value.lines : [];

  return {
    ...draft,
    commercialStatus: draft.status,
    createdAt: text(value.created_at),
    updatedAt: text(value.updated_at),
    createdBy: normalizeActor(value.created_by),
    confirmedAt: text(value.confirmed_at),
    confirmedByName: text(value.confirmed_by_name),
    cancelledAt: text(value.cancelled_at),
    cancelledByName: text(value.cancelled_by_name),
    payment: {
      status: draft.status === 'cancelled' ? 'cancelled' : PAYMENT_STATUSES.has(paymentStatus) ? paymentStatus : draft.status === 'draft' ? 'not_confirmed' : 'unpaid',
      totalAmount: number(value.payment?.total_amount ?? value.total_amount),
      settledAmount: number(value.payment?.settled_amount),
      outstandingAmount: number(value.payment?.outstanding_amount ?? value.total_amount),
      currencyCode: text(value.payment?.currency_code).toUpperCase() || draft.currencyCode,
    },
    fulfillment: {
      status: FULFILLMENT_STATUSES.has(fulfillmentStatus) ? fulfillmentStatus : 'unreserved',
      requiredQuantity: number(value.fulfillment?.required_quantity),
      selectedQuantity: number(value.fulfillment?.selected_quantity),
      reservedQuantity: number(value.fulfillment?.reserved_quantity),
      deliveredQuantity: number(value.fulfillment?.delivered_quantity),
      remainingQuantity: number(value.fulfillment?.remaining_quantity),
      location: value.fulfillment?.location?.id ? {
        id: text(value.fulfillment.location.id),
        name: text(value.fulfillment.location.name),
      } : null,
    },
    lines: draft.lines.map((line, index) => {
      const inventory = sourceLines[index]?.inventory || {};
      const status = text(inventory.status);
      return {
        ...line,
        lineTotal: number(sourceLines[index]?.line_total),
        inventory: {
          kind: ['service', 'serial', 'quantity'].includes(text(inventory.kind)) ? text(inventory.kind) : 'quantity',
          status: LINE_FULFILLMENT_STATUSES.has(status) ? status : 'unreserved',
          selectedQuantity: number(inventory.selected_quantity),
          reservedQuantity: number(inventory.reserved_quantity),
          deliveredQuantity: number(inventory.delivered_quantity),
          remainingQuantity: number(inventory.remaining_quantity),
          trackingUnits: Array.isArray(inventory.tracking_units) ? inventory.tracking_units.map(normalizeTrackingUnit) : [],
        },
      };
    }),
    events: Array.isArray(value.events) ? value.events.map((event) => ({
      type: text(event.type),
      version: Math.max(Math.trunc(number(event.version)), 1),
      occurredAt: text(event.occurred_at),
      actor: normalizeActor(event.actor),
      summary: event.summary && typeof event.summary === 'object' ? event.summary : {},
    })).filter((event) => event.type && event.occurredAt) : [],
  };
}

export function normalizeSaleReadiness(value = {}) {
  return {
    ready: value.ready === true,
    blockingReasons: Array.isArray(value.blocking_reasons) ? value.blocking_reasons.map(text).filter(Boolean) : [],
    warnings: Array.isArray(value.warnings) ? value.warnings.map(text).filter(Boolean) : [],
    lineCount: Math.max(Math.trunc(number(value.line_count)), 0),
    totalAmount: number(value.total_amount),
  };
}
