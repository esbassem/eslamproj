import { requireSupabase } from '@/core/lib/supabase';
import { isInventoryInstalled } from '@/core/lib/inventoryGuard';

const SALE_SELECT = `
  id,
  tenant_id,
  branch_id,
  customer_id,
  showroom_config_id,
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

const SHOWROOM_CONFIG_COLUMNS = 'id, tenant_id, branch_id, name, code, is_active, journal_id';

function todayISODate() {
  return new Date().toISOString().slice(0, 10);
}

function toMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function normalizeConfigCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

function requireTenantId(tenantId) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة.');
  }
}

function requireShowroomConfigId(showroomConfigId) {
  if (!showroomConfigId) {
    throw new Error('اختر نقطة معرض أولاً.');
  }
}

function buildConfigPayload({ tenantId, branchId, branch_id, name, code, isActive, is_active, journalId, journal_id } = {}) {
  const payload = {};

  if (tenantId) payload.tenant_id = tenantId;
  if (Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'branchId') || Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'branch_id')) {
    payload.branch_id = branchId ?? branch_id ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'name')) {
    payload.name = String(name ?? '').trim();
  }
  if (Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'code')) {
    payload.code = normalizeConfigCode(code);
  }
  if (Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'isActive') || Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'is_active')) {
    payload.is_active = Boolean(isActive ?? is_active);
  }
  if (Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'journalId') || Object.prototype.hasOwnProperty.call(arguments[0] ?? {}, 'journal_id')) {
    payload.journal_id = journalId ?? journal_id ?? null;
  }

  return payload;
}

async function ensureConfigCodeUnique(client, tenantId, code, excludeId) {
  const normalizedCode = normalizeConfigCode(code);
  if (!normalizedCode) return;

  let query = client
    .from('showroom_configs')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('code', normalizedCode)
    .limit(1);

  if (excludeId) {
    query = query.neq('id', excludeId);
  }

  const { data, error } = await query;
  if (error) throw error;
  if ((data || []).length) {
    throw new Error('كود نقطة المعرض مستخدم بالفعل داخل نفس الشركة.');
  }
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

function buildSaleLine({ tenantId, saleId, showroomConfigId, item }) {
  const quantity = Math.max(toMoney(item?.quantity) || 1, 1);
  const unitPrice = Math.max(toMoney(item?.price), 0);

  return {
    tenant_id: tenantId,
    sale_id: saleId,
    showroom_config_id: showroomConfigId,
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

async function attachSaleLines(client, tenantId, sales, showroomConfigId) {
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
  async listConfigs({ tenantId } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    const { data, error } = await client
      .from('showroom_configs')
      .select(SHOWROOM_CONFIG_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async listBranches({ tenantId } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    const { data, error } = await client
      .from('branches')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async listPaymentJournals({ tenantId } = {}) {
    requireTenantId(tenantId);
    const client = requireSupabase();
    const { data, error } = await client
      .from('account_journals')
      .select('id, name, code, type, is_active')
      .eq('tenant_id', tenantId)
      .in('type', ['cash', 'bank'])
      .order('name', { ascending: true });

    if (error) throw error;
    return data || [];
  },

  async createConfig(data = {}) {
    const tenantId = data.tenantId ?? data.tenant_id;
    requireTenantId(tenantId);

    const payload = buildConfigPayload({ ...data, tenantId, isActive: data.isActive ?? data.is_active ?? true });
    if (!payload.name) throw new Error('اكتب اسم نقطة المعرض.');
    if (!payload.code) throw new Error('اكتب كود نقطة المعرض.');

    const client = requireSupabase();
    await ensureConfigCodeUnique(client, tenantId, payload.code);

    const { data: createdConfig, error } = await client
      .from('showroom_configs')
      .insert(payload)
      .select(SHOWROOM_CONFIG_COLUMNS)
      .single();

    if (error) throw error;
    return createdConfig;
  },

  async updateConfig(id, data = {}) {
    const tenantId = data.tenantId ?? data.tenant_id;
    requireTenantId(tenantId);
    if (!id) throw new Error('تعذر تحديد نقطة المعرض.');

    const client = requireSupabase();
    const { data: current, error: currentError } = await client
      .from('showroom_configs')
      .select(SHOWROOM_CONFIG_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .single();

    if (currentError) throw currentError;

    const payload = buildConfigPayload(data);
    const nextName = Object.prototype.hasOwnProperty.call(payload, 'name') ? payload.name : current.name;
    const nextCode = Object.prototype.hasOwnProperty.call(payload, 'code') ? payload.code : current.code;

    if (!nextName) throw new Error('اكتب اسم نقطة المعرض.');
    if (!nextCode) throw new Error('اكتب كود نقطة المعرض.');
    await ensureConfigCodeUnique(client, tenantId, nextCode, id);

    delete payload.tenant_id;

    const { data: updatedConfig, error } = await client
      .from('showroom_configs')
      .update(payload)
      .eq('tenant_id', tenantId)
      .eq('id', id)
      .select(SHOWROOM_CONFIG_COLUMNS)
      .single();

    if (error) throw error;
    return updatedConfig;
  },

  async toggleConfigActive({ tenantId, id, isActive } = {}) {
    return showroomService.updateConfig(id, { tenantId, isActive });
  },

  async listConfigActivity({ tenantId, configIds } = {}) {
    requireTenantId(tenantId);
    const scopedConfigIds = Array.isArray(configIds) ? configIds.filter(Boolean) : [];

    if (!scopedConfigIds.length) {
      return {};
    }

    const client = requireSupabase();
    const { data, error } = await client
      .from('showroom_sales')
      .select('showroom_config_id')
      .eq('tenant_id', tenantId)
      .in('showroom_config_id', scopedConfigIds);

    if (error) throw error;

    return (data || []).reduce((accumulator, row) => {
      if (row?.showroom_config_id) {
        accumulator[row.showroom_config_id] = true;
      }
      return accumulator;
    }, {});
  },

  async deleteConfig({ tenantId, id } = {}) {
    requireTenantId(tenantId);
    if (!id) throw new Error('تعذر تحديد نقطة المعرض.');

    const client = requireSupabase();
    const { data: linkedSales, error: linkedSalesError } = await client
      .from('showroom_sales')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', id)
      .limit(1);

    if (linkedSalesError) throw linkedSalesError;

    if ((linkedSales || []).length) {
      throw new Error('لا يمكن حذف النقطة بعد تسجيل عمليات عليها. يمكنك تعطيلها فقط.');
    }

    const { error } = await client
      .from('showroom_configs')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('id', id);

    if (error) throw error;
    return true;
  },

  async softDeleteConfig({ tenantId, id } = {}) {
    return showroomService.deleteConfig({ tenantId, id });
  },

  async getSales({ tenantId, limit = 20, status, showroomConfigId } = {}) {
    requireTenantId(tenantId);
    requireShowroomConfigId(showroomConfigId);
    const client = requireSupabase();
    let query = client
      .from('showroom_sales')
      .select(SALE_SELECT)
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', showroomConfigId);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error } = await query
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    const salesWithCustomers = await attachCustomers(client, tenantId, data || []);
    return attachSaleLines(client, tenantId, salesWithCustomers, showroomConfigId);
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
    showroomConfigId,
  }) {
    requireTenantId(tenantId);
    requireShowroomConfigId(showroomConfigId);
    const client = requireSupabase();
    const saleItems = Array.isArray(items) ? items : [];
    const safeTotalAmount = Math.max(toMoney(totalAmount), 0);
    const safePaidAmount = Math.min(Math.max(toMoney(paidAmount), 0), safeTotalAmount);
    const remainingAmount = Math.max(safeTotalAmount - safePaidAmount, 0);
    const saleDate = todayISODate();
    const { data: showroomConfig, error: configError } = await client
      .from('showroom_configs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('id', showroomConfigId)
      .eq('is_active', true)
      .single();

    if (configError) throw configError;

    const { data: sale, error: saleError } = await client
      .from('showroom_sales')
      .insert([{
        tenant_id: tenantId,
        customer_id: customerId || null,
        showroom_config_id: showroomConfig.id,
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

    const lineRows = saleItems.map((item) => buildSaleLine({
      tenantId,
      saleId: sale.id,
      showroomConfigId: showroomConfig.id,
      item,
    }));

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
          showroom_config_id: showroomConfig.id,
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

  async getSaleDetails({ tenantId, saleId, showroomConfigId }) {
    requireTenantId(tenantId);
    requireShowroomConfigId(showroomConfigId);
    const client = requireSupabase();
    const { data: sale, error: saleError } = await client
      .from('showroom_sales')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', showroomConfigId)
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
        .eq('showroom_config_id', showroomConfigId)
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

  async paySaleRemaining({ tenantId, saleId, showroomConfigId, amount, notes, paymentMethod = 'دفعة' }) {
    requireTenantId(tenantId);
    requireShowroomConfigId(showroomConfigId);
    const client = requireSupabase();
    const { data: sale, error: saleError } = await client
      .from('showroom_sales')
      .select('id, tenant_id, total_amount, paid_amount, remaining_amount')
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', showroomConfigId)
      .eq('id', saleId)
      .single();

    if (saleError) throw saleError;

    const totalAmount = Math.max(toMoney(sale?.total_amount), 0);
    const paidAmount = Math.max(toMoney(sale?.paid_amount), 0);
    const remainingAmount = Math.max(toMoney(sale?.remaining_amount ?? totalAmount - paidAmount), 0);
    const paymentAmount = Math.min(Math.max(toMoney(amount), 0), remainingAmount);

    if (remainingAmount <= 0 || paymentAmount <= 0) {
      return showroomService.getSaleDetails({ tenantId, saleId, showroomConfigId });
    }

    const paymentDate = todayISODate();
    const { error: paymentError } = await client
      .from('showroom_sale_payments')
      .insert([{
        tenant_id: tenantId,
        sale_id: saleId,
        showroom_config_id: showroomConfigId,
        amount: paymentAmount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        notes: notes?.trim() || null,
      }]);

    if (paymentError) throw paymentError;

    const nextPaidAmount = Math.min(paidAmount + paymentAmount, totalAmount);
    const nextRemainingAmount = Math.max(totalAmount - nextPaidAmount, 0);

    const { error: updateError } = await client
      .from('showroom_sales')
      .update({
        paid_amount: nextPaidAmount,
        remaining_amount: nextRemainingAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('showroom_config_id', showroomConfigId)
      .eq('id', saleId);

    if (updateError) throw updateError;

    return showroomService.getSaleDetails({ tenantId, saleId, showroomConfigId });
  },

  async getInvoiceDetails({ tenantId, invoiceId, showroomConfigId }) {
    return showroomService.getSaleDetails({ tenantId, saleId: invoiceId, showroomConfigId });
  },

  async createInvoiceFromSale() {
    throw new Error('إنشاء فواتير محاسبية غير مفعل داخل نقطة المعرض حاليًا.');
  },

  async updateInvoiceStatus() {
    throw new Error('تحديث فواتير محاسبية غير مفعل داخل نقطة المعرض حاليًا.');
  },
};
