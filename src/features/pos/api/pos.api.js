import { requireSupabase } from '@/core/lib/supabase';

const POS_CONFIG_COLUMNS = 'id, tenant_id, branch_id, name, code, is_active, created_at, updated_at';
const POS_SESSION_COLUMNS =
  'id, tenant_id, pos_config_id, user_id, status, opening_balance, closing_balance, expected_balance, difference_amount, note, opened_at, closed_at, created_at';
const TENANT_USER_COLUMNS = 'id, full_name, email';
const POS_ORDER_COLUMNS = 'id, tenant_id, session_id, status, total, paid_amount, due_amount, change_amount, created_at';
const PRODUCT_VARIANT_COLUMNS =
  'id, tenant_id, product_template_id, display_name, sku, barcode, tracking, sale_price, cost_price, is_active, created_at, updated_at';
const PAYMENT_METHOD_COLUMNS = 'id, tenant_id, name, code, is_active';
const ATTRIBUTE_COLUMNS = 'id, tenant_id, name, display_type, sort_order, is_active, creates_variant, behavior';
const ATTRIBUTE_VALUE_COLUMNS = 'id, tenant_id, attribute_id, name, code, color_hex, extra_price, sort_order, is_active';
const CATEGORY_ATTRIBUTE_COLUMNS = 'id, tenant_id, category_id, attribute_id, is_required, display_order, created_at';

function normalizePosConfig(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    tenantId: record.tenant_id,
    branchId: record.branch_id,
    name: record.name ?? '',
    code: record.code ?? '',
    isActive: record.is_active ?? false,
    createdAt: record.created_at ?? null,
    updatedAt: record.updated_at ?? null,
  };
}

function normalizePosSession(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    tenantId: record.tenant_id,
    posConfigId: record.pos_config_id,
    userId: record.user_id,
    status: record.status ?? 'open',
    openingBalance: record.opening_balance ?? 0,
    closingBalance: record.closing_balance ?? null,
    expectedBalance: record.expected_balance ?? 0,
    differenceAmount: record.difference_amount ?? 0,
    note: record.note ?? '',
    openedAt: record.opened_at ?? null,
    closedAt: record.closed_at ?? null,
    createdAt: record.created_at ?? null,
    userName: record.userName ?? record.user_name ?? '',
    userEmail: record.userEmail ?? record.user_email ?? '',
  };
}

function toMoneyValue(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function byId(rows) {
  return new Map((rows ?? []).filter(Boolean).map((row) => [row.id, row]));
}

function normalizeSaleAttribute(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    name: record.name ?? '',
    displayType: record.display_type ?? 'select',
    sortOrder: Number(record.sort_order) || 0,
    isActive: record.is_active ?? true,
    createsVariant: record.creates_variant ?? true,
    behavior: record.behavior ?? 'variant',
  };
}

function normalizeSaleAttributeValue(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    attributeId: record.attribute_id,
    name: record.name ?? '',
    code: record.code ?? '',
    colorHex: record.color_hex ?? '',
    extraPrice: toMoneyValue(record.extra_price),
    sortOrder: Number(record.sort_order) || 0,
    isActive: record.is_active ?? true,
  };
}

function putTemplateNameFirst(displayName, templateName) {
  const normalizedDisplayName = String(displayName ?? '').trim();
  const normalizedTemplateName = String(templateName ?? '').trim();

  if (!normalizedDisplayName || !normalizedTemplateName || normalizedDisplayName.startsWith(normalizedTemplateName)) {
    return normalizedDisplayName;
  }

  const parts = normalizedDisplayName
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean);
  const templateIndex = parts.findIndex((part) => part === normalizedTemplateName);

  if (templateIndex <= 0) {
    return normalizedDisplayName;
  }

  return [parts[templateIndex], ...parts.filter((_, index) => index !== templateIndex)].join(' / ');
}

function normalizeProductTemplate(record) {
  if (!record) {
    return null;
  }

  const template = record.product_template ?? record.productTemplate ?? null;
  const price = record.sale_price ?? template?.sale_price ?? 0;
  const displayName = putTemplateNameFirst(record.display_name ?? template?.name ?? '', template?.name ?? '');

  return {
    id: record.id,
    tenantId: record.tenant_id,
    productTemplateId: record.product_template_id ?? template?.id ?? null,
    productProductId: record.id,
    categoryId: template?.category_id ?? null,
    name: displayName,
    displayName,
    templateName: template?.name ?? '',
    code: record.sku ?? template?.internal_reference ?? '',
    barcode: record.barcode ?? template?.barcode ?? '',
    price: toMoneyValue(price),
    productType: template?.product_type ?? 'goods',
    tracking: record.tracking ?? template?.tracking ?? 'none',
    isActive: record.is_active ?? true,
    attributesJsonb: template?.attributes_jsonb ?? [],
    hasVariantDimensions: record.display_name ? record.display_name !== (template?.name ?? '') : false,
    requiresContract: template?.requires_contract ?? false,
    requiresOwnershipTransfer: template?.requires_ownership_transfer ?? false,
    requiresPostSaleDocuments: template?.requires_post_sale_documents ?? false,
    requiresLicense: template?.requires_license ?? false,
  };
}

function removeTemplateDefaultRowsWhenVariantsExist(products) {
  const groupedByTemplate = products.reduce((map, product) => {
    const templateId = product.productTemplateId ?? product.id;
    const current = map.get(templateId) ?? [];
    current.push(product);
    map.set(templateId, current);
    return map;
  }, new Map());

  return products.filter((product) => {
    const templateProducts = groupedByTemplate.get(product.productTemplateId ?? product.id) ?? [];
    const hasNamedVariants = templateProducts.some((item) => item.hasVariantDimensions);

    if (!hasNamedVariants) {
      return true;
    }

    return product.hasVariantDimensions;
  });
}

async function attachSellAttributeFields(client, { tenantId, products }) {
  const categoryIds = [...new Set(products.map((product) => product.categoryId).filter(Boolean))];
  const productIds = products.map((product) => product.id).filter(Boolean);

  if (!categoryIds.length) {
    return products;
  }

  const [{ data: categoryLinkRows, error: categoryLinksError }, { data: selectedRows, error: selectedRowsError }] = await Promise.all([
    client
      .from('product_category_attributes')
      .select(CATEGORY_ATTRIBUTE_COLUMNS)
      .eq('tenant_id', tenantId)
      .in('category_id', categoryIds)
      .order('display_order', { ascending: true })
      .order('created_at', { ascending: true }),
    productIds.length
      ? client
          .from('product_product_attribute_values')
          .select('product_product_id, attribute_id, attribute_value_id')
          .eq('tenant_id', tenantId)
          .in('product_product_id', productIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (categoryLinksError) throw new Error(categoryLinksError.message);
  if (selectedRowsError) throw new Error(selectedRowsError.message);

  const attributeIds = [...new Set((categoryLinkRows ?? []).map((row) => row.attribute_id).filter(Boolean))];
  if (!attributeIds.length) {
    return products;
  }

  const [{ data: attributeRows, error: attributesError }, { data: valueRows, error: valuesError }] = await Promise.all([
    client.from('product_attributes').select(ATTRIBUTE_COLUMNS).eq('tenant_id', tenantId).eq('is_active', true).in('id', attributeIds),
    client
      .from('product_attribute_values')
      .select(ATTRIBUTE_VALUE_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .in('attribute_id', attributeIds)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
  ]);

  if (attributesError) throw new Error(attributesError.message);
  if (valuesError) throw new Error(valuesError.message);

  const attributesById = byId((attributeRows ?? []).map(normalizeSaleAttribute).filter((attribute) => attribute?.isActive));
  const valuesByAttributeId = (valueRows ?? []).map(normalizeSaleAttributeValue).reduce((map, value) => {
    if (!value?.isActive) return map;
    const current = map.get(value.attributeId) ?? [];
    current.push(value);
    map.set(value.attributeId, current);
    return map;
  }, new Map());
  const selectedAttributeIdsByProductId = (selectedRows ?? []).reduce((map, row) => {
    const current = map.get(row.product_product_id) ?? new Set();
    if (row.attribute_id) current.add(row.attribute_id);
    map.set(row.product_product_id, current);
    return map;
  }, new Map());
  const selectedAttributeValueIdsByProductId = (selectedRows ?? []).reduce((map, row) => {
    const current = map.get(row.product_product_id) ?? [];
    if (row.attribute_value_id) current.push(row.attribute_value_id);
    map.set(row.product_product_id, current);
    return map;
  }, new Map());
  const fieldsByCategoryId = (categoryLinkRows ?? []).reduce((map, link) => {
    const attribute = attributesById.get(link.attribute_id);
    if (!attribute) return map;

    const current = map.get(link.category_id) ?? [];
    current.push({
      key: attribute.id,
      attributeId: attribute.id,
      label: attribute.name,
      displayType: attribute.displayType,
      isRequired: Boolean(link.is_required),
      displayOrder: Number(link.display_order) || 0,
      values: valuesByAttributeId.get(attribute.id) ?? [],
      createsVariant: attribute.createsVariant ?? true,
      behavior: attribute.behavior ?? 'variant',
    });
    map.set(link.category_id, current);
    return map;
  }, new Map());

  return products.map((product) => {
    const selectedAttributeIds = selectedAttributeIdsByProductId.get(product.id) ?? new Set();
    const attributeValueIds = [...new Set(selectedAttributeValueIdsByProductId.get(product.id) ?? [])];
    const attributeFields = (fieldsByCategoryId.get(product.categoryId) ?? [])
      .filter((field) => field.createsVariant ? !selectedAttributeIds.has(field.attributeId) : true)
      .sort((left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0) || String(left.label).localeCompare(String(right.label)));

    return {
      ...product,
      attributeValueIds,
      attributeFields,
    };
  });
}

function normalizePaymentMethod(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    tenantId: record.tenant_id,
    name: record.name ?? '',
    code: record.code ?? '',
    isActive: record.is_active ?? true,
  };
}

function normalizePosOrder(record) {
  if (!record) {
    return null;
  }

  return {
    id: record.id,
    tenantId: record.tenant_id,
    sessionId: record.session_id,
    status: record.status ?? '',
    total: toMoneyValue(record.total),
    paidAmount: toMoneyValue(record.paid_amount),
    dueAmount: toMoneyValue(record.due_amount),
    changeAmount: toMoneyValue(record.change_amount),
    createdAt: record.created_at ?? null,
    lineCount: record.lineCount ?? 0,
    paymentMethodId: record.paymentMethodId ?? null,
    paymentMethodName: record.paymentMethodName ?? '',
  };
}

async function fetchOpenSession(client, { tenantId, posConfigId }) {
  const { data, error } = await client
    .from('pos_sessions')
    .select(POS_SESSION_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('pos_config_id', posConfigId)
    .eq('status', 'open')
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return normalizePosSession(data);
}

export const posService = {
  async listConfigs(tenantId) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('pos_configs')
      .select(POS_CONFIG_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map(normalizePosConfig);
  },

  async createConfig({ tenantId, name, code }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('pos_configs')
      .insert({
        tenant_id: tenantId,
        name: name.trim(),
        code: code?.trim() || null,
      })
      .select(POS_CONFIG_COLUMNS)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return normalizePosConfig(data);
  },

  async listSessions({ tenantId, posConfigId }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('pos_sessions')
      .select(POS_SESSION_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('pos_config_id', posConfigId)
      .order('opened_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    const sessions = (data ?? []).map(normalizePosSession);
    const userIds = [...new Set(sessions.map((session) => session.userId).filter(Boolean))];

    if (!userIds.length) {
      return sessions;
    }

    const { data: users, error: usersError } = await client
      .from('tenant_users')
      .select(TENANT_USER_COLUMNS)
      .in('id', userIds);

    if (usersError) {
      return sessions;
    }

    const usersById = new Map(
      (users ?? []).map((user) => [
        user.id,
        {
          userName: user.full_name ?? '',
          userEmail: user.email ?? '',
        },
      ]),
    );

    return sessions.map((session) => ({ ...session, ...(usersById.get(session.userId) ?? {}) }));
  },

  async listOpenSessions({ tenantId }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('pos_sessions')
      .select(POS_SESSION_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map(normalizePosSession);
  },

  async getOpenSession({ tenantId, posConfigId }) {
    const client = requireSupabase();
    return fetchOpenSession(client, { tenantId, posConfigId });
  },

  async openSession({ tenantId, posConfigId, userId, openingBalance, note }) {
    const client = requireSupabase();
    const openSession = await fetchOpenSession(client, { tenantId, posConfigId });

    if (openSession) {
      throw new Error('pos.messages.openSessionExists');
    }

    const { data, error } = await client
      .from('pos_sessions')
      .insert({
        tenant_id: tenantId,
        pos_config_id: posConfigId,
        user_id: userId,
        status: 'open',
        opening_balance: toMoneyValue(openingBalance),
        note: note?.trim() || null,
        opened_at: new Date().toISOString(),
      })
      .select(POS_SESSION_COLUMNS)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return normalizePosSession(data);
  },

  async closeSession({ tenantId, sessionId, closingBalance }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('pos_sessions')
      .update({
        status: 'closed',
        closing_balance: toMoneyValue(closingBalance),
        closed_at: new Date().toISOString(),
      })
      .eq('tenant_id', tenantId)
      .eq('id', sessionId)
      .eq('status', 'open')
      .select(POS_SESSION_COLUMNS)
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return normalizePosSession(data);
  },

  async getSession({ tenantId, sessionId }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('pos_sessions')
      .select(POS_SESSION_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      throw new Error(error.message);
    }

    return normalizePosSession(data);
  },

  async listSellProducts({ tenantId, search }) {
    const client = requireSupabase();
    let query = client
      .from('product_products')
      .select(`
        ${PRODUCT_VARIANT_COLUMNS},
        product_template:product_template_id (
          id,
          tenant_id,
          name,
          category_id,
          internal_reference,
          barcode,
          product_type,
          tracking,
          is_active,
          attributes_jsonb,
          sale_price,
          requires_contract,
          requires_ownership_transfer,
          requires_post_sale_documents,
          requires_license
        )
      `)
      .eq('tenant_id', tenantId)
      .limit(80);

    if (search?.trim()) {
      query = query.or(`display_name.ilike.%${search.trim()}%,sku.ilike.%${search.trim()}%`);
    }

    const { data, error } = await query.order('display_name', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    const products = (data ?? []).map(normalizeProductTemplate).filter((product) => product?.isActive);
    const productsWithAttributes = await attachSellAttributeFields(client, { tenantId, products });
    return removeTemplateDefaultRowsWhenVariantsExist(productsWithAttributes);
  },

  async listPaymentMethods({ tenantId }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('pos_payment_methods')
      .select(PAYMENT_METHOD_COLUMNS)
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true });

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []).map(normalizePaymentMethod).filter((method) => method?.isActive);
  },

  async listSessionOrders({ tenantId, sessionId, limit = 12 }) {
    const client = requireSupabase();
    const { data, error } = await client
      .from('pos_orders')
      .select(POS_ORDER_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw new Error(error.message);
    }

    const orderIds = (data ?? []).map((order) => order.id).filter(Boolean);

    if (!orderIds.length) {
      return [];
    }

    const [{ data: lines }, { data: payments }] = await Promise.all([
      client.from('pos_order_lines').select('order_id').eq('tenant_id', tenantId).in('order_id', orderIds),
      client.from('pos_payments').select('order_id, payment_method_id').eq('tenant_id', tenantId).in('order_id', orderIds),
    ]);

    const lineCountsByOrderId = (lines ?? []).reduce((counts, line) => {
      counts.set(line.order_id, (counts.get(line.order_id) ?? 0) + 1);
      return counts;
    }, new Map());
    const paymentMethodIdByOrderId = new Map((payments ?? []).map((payment) => [payment.order_id, payment.payment_method_id]));
    const orders = (data ?? []).map((order) =>
      normalizePosOrder({
        ...order,
        lineCount: lineCountsByOrderId.get(order.id) ?? 0,
        paymentMethodId: paymentMethodIdByOrderId.get(order.id) ?? null,
      }),
    );
    const paymentMethodIds = [...new Set(orders.map((order) => order.paymentMethodId).filter(Boolean))];

    if (!paymentMethodIds.length) {
      return orders;
    }

    const { data: methods, error: methodsError } = await client
      .from('pos_payment_methods')
      .select('id, name')
      .eq('tenant_id', tenantId)
      .in('id', paymentMethodIds);

    if (methodsError) {
      return orders;
    }

    const methodsById = new Map((methods ?? []).map((method) => [method.id, method.name ?? '']));
    return orders.map((order) => ({ ...order, paymentMethodName: methodsById.get(order.paymentMethodId) ?? '' }));
  },

  async createPaidOrder({ tenantId, sessionId, total, lines, paymentMethodId, amount }) {
    const client = requireSupabase();
    const orderTotal = toMoneyValue(total);
    const paidAmount = toMoneyValue(amount);
    const dueAmount = Math.max(orderTotal - paidAmount, 0);
    const changeAmount = Math.max(paidAmount - orderTotal, 0);

    const { data: order, error: orderError } = await client
      .from('pos_orders')
      .insert({
        tenant_id: tenantId,
        session_id: sessionId,
        status: paidAmount >= orderTotal ? 'paid' : 'partially_paid',
        total: orderTotal,
        paid_amount: paidAmount,
        due_amount: dueAmount,
        change_amount: changeAmount,
      })
      .select(POS_ORDER_COLUMNS)
      .single();

    if (orderError) {
      throw new Error(orderError.message);
    }

    const orderLines = lines.map((line) => ({
      tenant_id: tenantId,
      order_id: order.id,
      product_product_id: line.productProductId ?? line.productId,
      quantity: line.quantity,
      unit_price: toMoneyValue(line.price),
      total: toMoneyValue(line.total),
    }));

    const { error: linesError } = await client.from('pos_order_lines').insert(orderLines);

    if (linesError) {
      throw new Error(linesError.message);
    }

    const { error: paymentError } = await client.from('pos_payments').insert({
      tenant_id: tenantId,
      order_id: order.id,
      session_id: sessionId,
      payment_method_id: paymentMethodId,
      amount: paidAmount,
    });

    if (paymentError) {
      throw new Error(paymentError.message);
    }

    return order;
  },
};
