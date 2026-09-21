const text = (value) => typeof value === 'string' ? value.trim() : '';
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;

export function indexHistoricalSales(value) {
  return new Map((Array.isArray(value) ? value : [])
    .filter((item) => item?.is_historical === true && text(item.sale_id))
    .map((item) => [text(item.sale_id), item]));
}

export function applyHistoricalSaleRead(sale, historical) {
  if (!sale || !historical?.is_historical) return sale;
  const sourceLines = new Map((Array.isArray(historical.lines) ? historical.lines : [])
    .map((line) => [text(line.sale_line_id), line.inventory]));
  const payment = historical.payment || {};
  const fulfillment = historical.fulfillment || {};
  return {
    ...sale,
    saleNumber: text(historical.source_sale_number) || sale.saleNumber,
    canonicalSaleNumber: text(historical.canonical_sale_number) || null,
    isHistorical: true,
    historicalSource: {
      system: text(historical.source_system),
      saleId: text(historical.source_sale_id),
      classification: text(historical.classification),
      inventoryEvidenceType: text(historical.inventory_evidence_type),
      importedAt: text(historical.imported_at),
      financialAccountMoveId: text(payment.account_move_id) || null,
    },
    payment: {
      ...sale.payment,
      status: text(payment.status) || sale.payment.status,
      totalAmount: number(payment.total_amount ?? sale.payment.totalAmount ?? sale.totalAmount),
      settledAmount: number(payment.settled_amount),
      outstandingAmount: number(payment.outstanding_amount),
      currencyCode: text(payment.currency_code).toUpperCase() || sale.currencyCode,
    },
    fulfillment: {
      ...sale.fulfillment,
      status: text(fulfillment.status) || sale.fulfillment.status,
      requiredQuantity: number(fulfillment.required_quantity),
      selectedQuantity: number(fulfillment.selected_quantity),
      reservedQuantity: number(fulfillment.reserved_quantity),
      deliveredQuantity: number(fulfillment.delivered_quantity),
      remainingQuantity: number(fulfillment.remaining_quantity),
      evidenceType: text(fulfillment.evidence_type),
    },
    lines: Array.isArray(sale.lines) ? sale.lines.map((line) => {
      const inventory = sourceLines.get(line.id);
      return inventory ? { ...line, inventory: {
        kind: text(inventory.kind), status: text(inventory.status),
        selectedQuantity: number(inventory.selected_quantity),
        reservedQuantity: number(inventory.reserved_quantity),
        deliveredQuantity: number(inventory.delivered_quantity),
        remainingQuantity: number(inventory.remaining_quantity),
        trackingUnits: Array.isArray(inventory.tracking_units) ? inventory.tracking_units.map((unit) => ({
          id: text(unit.id), trackingNumber: text(unit.tracking_number),
          chassisNumber: text(unit.chassis_number) || text(unit.tracking_number),
          engineNumber: text(unit.engine_number), state: text(unit.state), attributes: [],
        })) : [],
      } } : line;
    }) : sale.lines,
  };
}
