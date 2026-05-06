import { requireSupabase } from '@/core/lib/supabase';
import { isInventoryInstalled } from '@/core/lib/inventoryGuard';

const SALE_SELECT = `
  id,
  tenant_id,
  branch_id,
  customer_id,
  sale_number,
  sale_date,
  status,
  total_amount,
  paid_amount,
  remaining_amount,
  notes,
  account_move_id,
  created_by,
  created_at,
  updated_at
`;

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function toMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function getProductProductId(item) {
  const explicitProductId = item?.productProductId ?? item?.product_product_id ?? item?.productVariantId ?? item?.variantId ?? null;
  if (explicitProductId) return explicitProductId;

  return item?.id ?? null;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value ?? ''));
}

function getLineAttributes(item) {
  const attributes = Array.isArray(item?.configuredAttributes) ? item.configuredAttributes : [];

  return attributes
    .map((attribute) => {
      const attributeId = attribute?.attributeId ?? attribute?.attribute_id ?? attribute?.key ?? null;
      const attributeValueId = attribute?.valueId ?? attribute?.value_id ?? null;
      const valueText = attribute?.value ?? attribute?.valueText ?? attribute?.value_text ?? '';

      if (!isUuid(attributeId)) {
        return null;
      }

      return {
        attributeId,
        attributeValueId: isUuid(attributeValueId) ? attributeValueId : null,
        valueText: isUuid(attributeValueId) ? null : String(valueText || '').trim() || null,
      };
    })
    .filter(Boolean)
    .filter((attribute) => attribute.attributeValueId || attribute.valueText);
}

function buildSaleLine({ tenantId, saleId, item }) {
  const quantity = Math.max(toMoney(item?.quantity) || 1, 1);
  const unitPrice = Math.max(toMoney(item?.price), 0);

  return {
    tenant_id: tenantId,
    sale_id: saleId,
    product_product_id: getProductProductId(item),
    tracking_unit_id: null,
    ownership_name: item?.ownershipTransferName?.trim() || null,
    description: item?.name || item?.displayName || null,
    quantity,
    unit_price: unitPrice,
    total: unitPrice * quantity,
  };
}

async function attachLineAttributes(client, tenantId, lines) {
  const saleLines = Array.isArray(lines) ? lines : [];
  const lineIds = saleLines.map((line) => line.id).filter(Boolean);

  if (!lineIds.length) {
    return saleLines;
  }

  const { data: attributeRows, error } = await client
    .from('transaction_line_attributes')
    .select('id, transaction_line_id, attribute_id, attribute_value_id, value_text')
    .eq('tenant_id', tenantId)
    .in('transaction_line_id', lineIds);

  if (error) throw error;

  const rows = attributeRows || [];
  const attributeIds = [...new Set(rows.map((row) => row.attribute_id).filter(Boolean))];
  const valueIds = [...new Set(rows.map((row) => row.attribute_value_id).filter(Boolean))];

  const [{ data: attributes, error: attributesError }, { data: values, error: valuesError }] = await Promise.all([
    attributeIds.length
      ? client.from('product_attributes').select('id, name').eq('tenant_id', tenantId).in('id', attributeIds)
      : Promise.resolve({ data: [], error: null }),
    valueIds.length
      ? client.from('product_attribute_values').select('id, name').eq('tenant_id', tenantId).in('id', valueIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (attributesError) throw attributesError;
  if (valuesError) throw valuesError;

  const attributesById = new Map((attributes || []).map((attribute) => [attribute.id, attribute]));
  const valuesById = new Map((values || []).map((value) => [value.id, value]));
  const lineAttributesByLineId = new Map();

  rows.forEach((row) => {
    const current = lineAttributesByLineId.get(row.transaction_line_id) || [];
    const attribute = attributesById.get(row.attribute_id);
    const value = row.attribute_value_id ? valuesById.get(row.attribute_value_id) : null;

    current.push({
      id: row.id,
      key: row.attribute_id,
      attributeId: row.attribute_id,
      label: attribute?.name || 'خاصية',
      valueId: row.attribute_value_id,
      value: value?.name || row.value_text || '',
    });

    lineAttributesByLineId.set(row.transaction_line_id, current);
  });

  return saleLines.map((line) => ({
    ...line,
    configuredAttributes: lineAttributesByLineId.get(line.id) || [],
  }));
}

async function attachSaleLines(client, tenantId, sales) {
  const saleRows = Array.isArray(sales) ? sales : [sales].filter(Boolean);
  const saleIds = saleRows.map((sale) => sale.id).filter(Boolean);

  if (!saleIds.length) {
    return Array.isArray(sales) ? saleRows : saleRows[0] || null;
  }

  const { data: lines, error } = await client
    .from('showroom_sale_lines')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('sale_id', saleIds)
    .order('created_at', { ascending: true });

  if (error) throw error;

  const linesWithAttributes = await attachLineAttributes(client, tenantId, lines || []);
  const linesBySaleId = new Map();

  linesWithAttributes.forEach((line) => {
    const current = linesBySaleId.get(line.sale_id) || [];
    current.push(line);
    linesBySaleId.set(line.sale_id, current);
  });

  const salesWithLines = saleRows.map((sale) => ({
    ...sale,
    lines: linesBySaleId.get(sale.id) || [],
  }));

  return Array.isArray(sales) ? salesWithLines : salesWithLines[0] || null;
}

async function attachCustomers(client, tenantId, sales) {
  const saleRows = Array.isArray(sales) ? sales : [sales].filter(Boolean);
  const customerIds = [...new Set(saleRows.map((sale) => sale.customer_id).filter(Boolean))];

  if (!customerIds.length) {
    return Array.isArray(sales) ? saleRows : saleRows[0] || null;
  }

  const { data: customers, error } = await client
    .from('partners')
    .select('id, name, phone1, phone2, address, national_id')
    .eq('tenant_id', tenantId)
    .in('id', customerIds);

  if (error) throw error;

  const customersById = new Map((customers || []).map((customer) => [customer.id, customer]));
  const salesWithCustomers = saleRows.map((sale) => ({
    ...sale,
    customer: customersById.has(sale.customer_id)
      ? {
          ...customersById.get(sale.customer_id),
          phone: customersById.get(sale.customer_id)?.phone1 || customersById.get(sale.customer_id)?.phone2 || '',
          nationalId: customersById.get(sale.customer_id)?.national_id || '',
        }
      : null,
  }));

  return Array.isArray(sales) ? salesWithCustomers : salesWithCustomers[0] || null;
}

export const showroomService = {
  async getSales({ tenantId, limit = 20, status } = {}) {
    const client = requireSupabase();
    let query = client
      .from('showroom_sales')
      .select(SALE_SELECT)
      .eq('tenant_id', tenantId);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    const salesWithCustomers = await attachCustomers(client, tenantId, data || []);
    return attachSaleLines(client, tenantId, salesWithCustomers);
  },

  async getInvoices(params = {}) {
    return showroomService.getSales(params);
  },

  async createSale({
    tenantId,
    customerId,
    items,
    totalAmount,
    paidAmount = 0,
    paymentMethodId,
    contractNote,
    notes,
    userId,
  }) {
    const client = requireSupabase();
    const saleItems = Array.isArray(items) ? items : [];
    const safeTotalAmount = Math.max(toMoney(totalAmount), 0);
    const safePaidAmount = Math.min(Math.max(toMoney(paidAmount), 0), safeTotalAmount);
    const remainingAmount = Math.max(safeTotalAmount - safePaidAmount, 0);
    const saleDate = todayISODate();

    const { data: sale, error: saleError } = await client
      .from('showroom_sales')
      .insert([{
        tenant_id: tenantId,
        customer_id: customerId || null,
        sale_date: saleDate,
        status: 'confirmed',
        total_amount: safeTotalAmount,
        paid_amount: safePaidAmount,
        remaining_amount: remainingAmount,
        notes: contractNote?.trim() || notes?.trim() || null,
        account_move_id: null,
      }])
      .select(SALE_SELECT)
      .single();

    if (saleError) throw saleError;

    const lineRows = saleItems.map((item) => buildSaleLine({ tenantId, saleId: sale.id, item }));

    let lines = [];
    if (lineRows.length) {
      const { data: createdLines, error: linesError } = await client
        .from('showroom_sale_lines')
        .insert(lineRows)
        .select();

      if (linesError) throw linesError;
      lines = (createdLines || []).map((line, index) => ({
        ...line,
        serialNumber: saleItems[index]?.serialNumber || '',
        trackingIdentifiers: Array.isArray(saleItems[index]?.trackingIdentifiers) ? saleItems[index].trackingIdentifiers : [],
      }));

      const attributeRows = lines.flatMap((line, index) => {
        const itemAttributes = getLineAttributes(saleItems[index]);

        return itemAttributes.map((attribute) => ({
          tenant_id: tenantId,
          transaction_line_id: line.id,
          attribute_id: attribute.attributeId,
          attribute_value_id: attribute.attributeValueId,
          value_text: attribute.valueText,
        }));
      });

      if (attributeRows.length) {
        const { error: attributesError } = await client
          .from('transaction_line_attributes')
          .insert(attributeRows);

        if (attributesError) throw attributesError;
      }

      lines = await attachLineAttributes(client, tenantId, lines);
    }

    let payments = [];
    if (safePaidAmount > 0) {
      const { data: createdPayments, error: paymentError } = await client
        .from('showroom_sale_payments')
        .insert([{
          tenant_id: tenantId,
          sale_id: sale.id,
          amount: safePaidAmount,
          payment_date: saleDate,
          payment_method: paymentMethodId || null,
          notes: null,
        }])
        .select();

      if (paymentError) throw paymentError;
      payments = createdPayments || [];
    }

    const saleWithCustomer = await attachCustomers(client, tenantId, sale);

    // Create stock moves if the inventory module is installed
    const inventoryActive = await isInventoryInstalled(tenantId);
    if (inventoryActive) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const saleItem = saleItems[i] ?? {};
        const productProductId = line.product_product_id ?? getProductProductId(saleItem);
        const isService = (saleItem?.productType ?? saleItem?.product_type) === 'service';

        if (!isService && productProductId) {
          const quantity = Math.max(toMoney(line.quantity) || 1, 1);

          // Record the outgoing stock move
          await client.from('stock_moves').insert({
            tenant_id: tenantId,
            product_product_id: productProductId,
            move_type: 'out',
            quantity,
            created_by: userId ?? null,
            notes: `showroom_sale:${sale.id}`,
          });

          // Decrease quant (showroom allows selling without stock validation)
          const { data: existingQuant } = await client
            .from('stock_quants')
            .select('id, quantity_on_hand')
            .eq('tenant_id', tenantId)
            .eq('product_product_id', productProductId)
            .limit(1)
            .maybeSingle();

          if (existingQuant) {
            const nextQty = Number(existingQuant.quantity_on_hand) - quantity;
            await client.from('stock_quants').update({ quantity_on_hand: nextQty }).eq('id', existingQuant.id);
          } else {
            await client.from('stock_quants').insert({
              tenant_id: tenantId,
              product_product_id: productProductId,
              quantity_on_hand: -quantity,
            });
          }
        }
      }
    }

    return {
      ...saleWithCustomer,
      lines,
      payments,
    };
  },

  async getSaleDetails({ tenantId, saleId }) {
    const client = requireSupabase();
    const { data: sale, error: saleError } = await client
      .from('showroom_sales')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('id', saleId)
      .single();

    if (saleError) throw saleError;

    const [{ data: lines, error: linesError }, { data: payments, error: paymentsError }] = await Promise.all([
      client
        .from('showroom_sale_lines')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('sale_id', saleId)
        .order('created_at', { ascending: true }),
      client
        .from('showroom_sale_payments')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('sale_id', saleId)
        .order('created_at', { ascending: true }),
    ]);

    if (linesError) throw linesError;
    if (paymentsError) throw paymentsError;

    const saleWithCustomer = await attachCustomers(client, tenantId, sale);
    const linesWithAttributes = await attachLineAttributes(client, tenantId, lines || []);

    return {
      ...saleWithCustomer,
      lines: linesWithAttributes,
      payments: payments || [],
    };
  },

  async getInvoiceDetails({ tenantId, invoiceId }) {
    return showroomService.getSaleDetails({ tenantId, saleId: invoiceId });
  },

  async createInvoiceFromSale() {
    throw new Error('إنشاء فواتير محاسبية غير مفعل داخل نقطة المعرض حاليًا.');
  },

  async updateInvoiceStatus() {
    throw new Error('تحديث فواتير محاسبية غير مفعل داخل نقطة المعرض حاليًا.');
  },
};
