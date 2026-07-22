import { requireSupabase } from '@/core/lib/supabase';
import { resolveCurrentTenantUserId } from '@/features/workspace/api/currentTenantUser.api';

const TENANT_FILES_BUCKET = 'tenant-files';

function requireTenantId(tenantId) {
  if (!tenantId) {
    throw new Error('لا توجد شركة نشطة.');
  }
}

function toMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function unique(values) {
  return Array.from(new Set((values || []).filter(Boolean)));
}

function byId(records) {
  return new Map((records || []).filter((record) => record?.id).map((record) => [record.id, record]));
}

function chunks(values, size = 100) {
  const items = Array.isArray(values) ? values : [];
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => (
    items.slice(index * size, (index + 1) * size)
  ));
}

async function fetchAllPages(buildQuery, pageSize = 50) {
  const records = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildQuery().range(from, from + pageSize - 1);
    if (error) throw error;

    const page = data || [];
    records.push(...page);
    if (page.length < pageSize) break;
  }

  return records;
}

function formatDateLabel(value) {
  if (!value) return '';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';

  const current = new Date();
  const isToday = date.toDateString() === current.toDateString();
  const yesterday = new Date(current);
  yesterday.setDate(current.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const time = date.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

  if (isToday) return `اليوم ${time}`;
  if (isYesterday) return `أمس ${time}`;

  return date.toLocaleDateString('ar-EG', { day: '2-digit', month: 'long', year: 'numeric' });
}

function getFileExtension(file) {
  const nameExtension = String(file?.name || '').split('.').pop();
  const mimeExtension = String(file?.type || '').split('/').pop();
  return (nameExtension && nameExtension !== file?.name ? nameExtension : mimeExtension || 'jpg')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase() || 'jpg';
}

function assertImage(file) {
  if (!file) {
    throw new Error('ارفق صورة العملية أولاً.');
  }

  if (!file.type?.startsWith('image/')) {
    throw new Error('يمكن رفع صور فقط.');
  }
}

export const accountantService = {
  async getTemporaryAccounts({ tenantId } = {}) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const { data: group, error: groupError } = await client
      .from('account_groups')
      .select('id, code, name')
      .eq('tenant_id', tenantId)
      .eq('code', 'TEMP')
      .maybeSingle();

    if (groupError) throw groupError;
    if (!group) return { group: null, accounts: [] };

    const accounts = await fetchAllPages(() => client
      .from('account_accounts')
      .select('id, group_id, code, name, account_type, reconcile, active')
      .eq('tenant_id', tenantId)
      .eq('group_id', group.id)
      .order('code', { ascending: true }));

    if (!accounts.length) return { group, accounts: [] };

    const lines = await fetchAllPages(() => client
      .from('account_move_lines')
      .select('account_id, debit, credit')
      .eq('tenant_id', tenantId)
      .eq('parent_state', 'posted')
      .in('account_id', accounts.map((account) => account.id)));

    const balancesByAccountId = new Map();
    lines.forEach((line) => {
      const currentBalance = toMoney(balancesByAccountId.get(line.account_id));
      balancesByAccountId.set(
        line.account_id,
        currentBalance + toMoney(line.debit) - toMoney(line.credit),
      );
    });

    return {
      group,
      accounts: accounts.map((account) => ({
        ...account,
        balance: Math.round(toMoney(balancesByAccountId.get(account.id)) * 100) / 100,
      })),
    };
  },

  async createTemporaryAccount({
    tenantId,
    groupId,
    code,
    name,
    accountType,
    reconcile = true,
    active = true,
  } = {}) {
    requireTenantId(tenantId);
    if (!groupId) throw new Error('مجموعة الحسابات المؤقتة غير موجودة.');

    const normalizedCode = String(code || '').trim();
    const normalizedName = String(name || '').trim();
    if (!normalizedCode) throw new Error('اكتب كود الحساب.');
    if (!normalizedName) throw new Error('اكتب اسم الحساب.');
    if (!accountType) throw new Error('اختر نوع الحساب.');

    const client = requireSupabase();
    const [groupResult, duplicateResult, typeResult] = await Promise.all([
      client
        .from('account_groups')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('id', groupId)
        .maybeSingle(),
      client
        .from('account_accounts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('code', normalizedCode)
        .limit(1)
        .maybeSingle(),
      client
        .from('account_accounts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('account_type', accountType)
        .limit(1)
        .maybeSingle(),
    ]);

    if (groupResult.error) throw groupResult.error;
    if (!groupResult.data?.id) throw new Error('مجموعة الحساب المختارة غير متاحة.');
    if (duplicateResult.error) throw duplicateResult.error;
    if (duplicateResult.data?.id) throw new Error('كود الحساب مستخدم بالفعل، اختر كودًا آخر.');
    if (typeResult.error) throw typeResult.error;
    if (!typeResult.data?.id) throw new Error('نوع الحساب المختار غير مستخدم في دليل حسابات الشركة.');

    const { data, error } = await client
      .from('account_accounts')
      .insert({
        tenant_id: tenantId,
        group_id: groupId,
        code: normalizedCode,
        name: normalizedName,
        account_type: accountType,
        reconcile: Boolean(reconcile),
        active: Boolean(active),
        responsible_user_id: null,
      })
      .select('id, group_id, code, name, account_type, reconcile, active')
      .single();

    if (error) {
      if (error.code === '23505') throw new Error('كود الحساب مستخدم بالفعل، اختر كودًا آخر.');
      throw new Error(error.message || 'تعذر إضافة الحساب المؤقت.');
    }

    return { ...data, balance: 0 };
  },

  async getAccountCreationOptions({ tenantId } = {}) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const [groupsResult, accounts] = await Promise.all([
      client
        .from('account_groups')
        .select('id, code, name')
        .eq('tenant_id', tenantId)
        .order('name', { ascending: true }),
      fetchAllPages(() => client
        .from('account_accounts')
        .select('group_id, code, account_type')
        .eq('tenant_id', tenantId)
        .order('code', { ascending: true })),
    ]);

    if (groupsResult.error) throw groupsResult.error;

    return {
      groups: groupsResult.data || [],
      accounts,
      accountTypes: unique(accounts.map((account) => account.account_type)),
    };
  },

  async listActiveAccounts({ tenantId } = {}) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    return fetchAllPages(() => client
      .from('account_accounts')
      .select('id, code, name, account_type')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('code', { ascending: true }));
  },

  async getCashLocationsSummary({ tenantId } = {}) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const { data, error } = await client
      .from('account_accounts')
      .select('id, code, name, account_type, active, responsible_user_id')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .order('code', { ascending: true });

    if (error) throw error;

    const cashAccounts = (data || [])
      .filter((account) => {
        const code = String(account.code || '').trim();
        const type = String(account.account_type || '').toLowerCase();
        return code.startsWith('111') || type === 'cash' || type === 'cash_equivalent';
      })
      .map((account) => ({
        ...account,
        kind: account.code === '111001'
          ? 'main'
          : account.responsible_user_id
            ? 'custody'
            : 'cash',
      }));

    if (!cashAccounts.length) {
      return { totalBalance: 0, locations: [] };
    }

    const lines = await fetchAllPages(() => client
      .from('account_move_lines')
      .select('id, account_id, debit, credit')
      .eq('tenant_id', tenantId)
      .in('account_id', cashAccounts.map((account) => account.id))
      .eq('parent_state', 'posted'));

    const balancesByAccountId = new Map();
    lines.forEach((line) => {
      const currentBalance = balancesByAccountId.get(line.account_id) || 0;
      balancesByAccountId.set(line.account_id, currentBalance + toMoney(line.debit) - toMoney(line.credit));
    });

    const locations = cashAccounts.map((account) => ({
      id: account.id,
      code: account.code,
      name: account.name,
      kind: account.kind,
      responsibleUserId: account.responsible_user_id || null,
      balance: Math.round((balancesByAccountId.get(account.id) || 0) * 100) / 100,
    }));

    return {
      totalBalance: Math.round(locations.reduce((sum, location) => sum + location.balance, 0) * 100) / 100,
      locations,
    };
  },

  async listCashLocationOperations({ tenantId, accountId } = {}) {
    requireTenantId(tenantId);
    if (!accountId) throw new Error('تعذر تحديد الخزنة.');

    const client = requireSupabase();
    const lines = await fetchAllPages(() => client
      .from('account_move_lines')
      .select('id, move_id, label, debit, credit, created_at')
      .eq('tenant_id', tenantId)
      .eq('account_id', accountId)
      .eq('parent_state', 'posted')
      .order('created_at', { ascending: false }), 100);

    const moveIds = unique(lines.map((line) => line.move_id));
    const moveResults = await Promise.all(chunks(moveIds).map((ids) => fetchAllPages(() => client
      .from('account_moves')
      .select('id, name, date, notes, ref, created_at')
      .eq('tenant_id', tenantId)
      .in('id', ids))));
    const movesById = byId(moveResults.flat());

    return lines.map((line) => {
      const move = movesById.get(line.move_id);
      const debit = Math.round(toMoney(line.debit) * 100) / 100;
      const credit = Math.round(toMoney(line.credit) * 100) / 100;

      return {
        id: line.id,
        moveId: line.move_id,
        label: line.label || move?.notes || 'عملية نقدية',
        note: move?.notes || '',
        reference: move?.ref || move?.name || '',
        debit,
        credit,
        amount: debit > 0 ? debit : credit,
        direction: debit > 0 ? 'in' : 'out',
        dateLabel: formatDateLabel(move?.date || move?.created_at || line.created_at),
      };
    });
  },

  async listAccountOperations({ tenantId, accountId } = {}) {
    return accountantService.listCashLocationOperations({ tenantId, accountId });
  },

  async createCashLocationOperation({
    tenantId,
    cashAccountId,
    counterAccountId,
    direction,
    amount,
    note,
  } = {}) {
    requireTenantId(tenantId);
    if (!cashAccountId) throw new Error('اختر الخزنة أو العهدة.');
    if (!counterAccountId) throw new Error('اختر الحساب المقابل.');

    const safeAmount = Math.round(toMoney(amount) * 100) / 100;
    if (safeAmount <= 0) throw new Error('اكتب مبلغًا صحيحًا أكبر من صفر.');
    if (!['in', 'out'].includes(direction)) throw new Error('اختر نوع العملية.');

    const normalizedNote = String(note || '').trim();
    if (!normalizedNote) throw new Error('اكتب بيان العملية.');

    const client = requireSupabase();
    const { data, error } = await client.rpc('create_cash_location_operation', {
      p_tenant_id: tenantId,
      p_cash_account_id: cashAccountId,
      p_counter_account_id: counterAccountId,
      p_direction: direction,
      p_amount: safeAmount,
      p_notes: normalizedNote,
    });

    if (error) throw new Error(error.message || 'تعذر تسجيل العملية النقدية.');
    return data;
  },

  async listSettlementAccounts({ tenantId } = {}) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    return fetchAllPages(() => client
      .from('account_accounts')
      .select('id, code, name, account_type')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .neq('code', '114001')
      .order('code', { ascending: true }));
  },

  async settleSalesInvoiceBalance({
    tenantId,
    saleId,
    amount,
    mode,
    destinationAccountId = null,
    notes = '',
  } = {}) {
    requireTenantId(tenantId);
    if (!saleId) throw new Error('تعذر تحديد الفاتورة.');

    const safeAmount = Math.round(toMoney(amount) * 100) / 100;
    if (safeAmount <= 0) throw new Error('اكتب مبلغ تسوية صحيح.');
    if (!['cash', 'account'].includes(mode)) throw new Error('اختر نوع التسوية.');
    if (mode === 'account' && !destinationAccountId) throw new Error('اختر حساب التسوية.');

    const client = requireSupabase();
    const { data, error } = await client.rpc('settle_showroom_sale_balance', {
      p_sale_id: saleId,
      p_amount: safeAmount,
      p_mode: mode,
      p_destination_account_id: mode === 'account' ? destinationAccountId : null,
      p_notes: String(notes || '').trim() || null,
    });

    if (error) throw new Error(error.message || 'تعذر تسجيل التسوية.');
    return data;
  },

  async getSalesInvoiceSummary({ tenantId } = {}) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const invoices = await fetchAllPages(() => client
        .from('showroom_sales')
        .select('id, customer_id, showroom_config_id, sale_number, sale_date, status, account_move_id, created_at')
        .eq('tenant_id', tenantId)
        .in('status', ['confirmed', 'pending_payment'])
        .order('sale_date', { ascending: false })
        .order('created_at', { ascending: false }));

    if (!invoices.length) return { invoices: [], count: 0, total: 0 };

    const saleIds = invoices.map((invoice) => invoice.id);
    const linkedMoveIds = unique(invoices.map((invoice) => invoice.account_move_id));
    const saleRefs = saleIds.map((saleId) => `showroom_sale:${saleId}`);
    const [moveIdResults, moveRefResults, receivableAccountsResult] = await Promise.all([
      Promise.all(chunks(linkedMoveIds).map((ids) => fetchAllPages(() => client
        .from('account_moves')
        .select('id, ref')
        .eq('tenant_id', tenantId)
        .eq('move_type', 'sale')
        .eq('state', 'posted')
        .in('id', ids)))),
      Promise.all(chunks(saleRefs).map((refs) => fetchAllPages(() => client
        .from('account_moves')
        .select('id, ref')
        .eq('tenant_id', tenantId)
        .eq('move_type', 'sale')
        .eq('state', 'posted')
        .in('ref', refs)))),
      client
        .from('account_accounts')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('code', '114001')
        .eq('active', true),
    ]);

    if (receivableAccountsResult.error) throw receivableAccountsResult.error;

    const accountingMoves = [...moveIdResults, ...moveRefResults].flat();
    const movesById = byId(accountingMoves);
    const movesByRef = new Map(accountingMoves.filter((move) => move.ref).map((move) => [move.ref, move]));
    const moveBySaleId = new Map();

    invoices.forEach((invoice) => {
      const move = movesById.get(invoice.account_move_id) || movesByRef.get(`showroom_sale:${invoice.id}`) || null;
      if (move) moveBySaleId.set(invoice.id, move);
    });

    const postedMoveIds = unique([...moveBySaleId.values()].map((move) => move.id));
    const receivableAccountIds = (receivableAccountsResult.data || []).map((account) => account.id);
    if (!postedMoveIds.length || !receivableAccountIds.length) {
      return { invoices: [], count: 0, total: 0 };
    }

    const lineResults = await Promise.all(chunks(postedMoveIds).map((moveIds) => fetchAllPages(() => client
      .from('account_move_lines')
      .select('id, move_id, debit')
      .eq('tenant_id', tenantId)
      .in('move_id', moveIds)
      .in('account_id', receivableAccountIds)
      .gt('debit', 0))));

    const receivableLines = lineResults.flat();
    const reconcileResults = await Promise.all(chunks(receivableLines.map((line) => line.id)).map((lineIds) => fetchAllPages(() => client
      .from('account_partial_reconcile')
      .select('debit_move_id, amount')
      .eq('tenant_id', tenantId)
      .in('debit_move_id', lineIds))));

    const paidByLineId = new Map();
    reconcileResults.flat().forEach((reconcile) => {
      paidByLineId.set(
        reconcile.debit_move_id,
        toMoney(paidByLineId.get(reconcile.debit_move_id)) + toMoney(reconcile.amount),
      );
    });

    const totalsByMoveId = new Map();
    const remainingByMoveId = new Map();
    receivableLines.forEach((line) => {
      const debit = toMoney(line.debit);
      const paid = toMoney(paidByLineId.get(line.id));
      totalsByMoveId.set(line.move_id, toMoney(totalsByMoveId.get(line.move_id)) + debit);
      remainingByMoveId.set(
        line.move_id,
        toMoney(remainingByMoveId.get(line.move_id)) + Math.max(debit - paid, 0),
      );
    });

    const customerIds = unique(invoices.map((invoice) => invoice.customer_id));
    const customerResults = customerIds.length
      ? await Promise.all(chunks(customerIds).map((ids) => fetchAllPages(() => client
        .from('partners')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .in('id', ids))))
      : [];

    const customersById = byId(customerResults.flat());
    const saleLineResults = await Promise.all(chunks(saleIds).map((ids) => fetchAllPages(() => client
      .from('showroom_sale_lines')
      .select('id, sale_id, product_product_id, description, created_at')
      .eq('tenant_id', tenantId)
      .in('sale_id', ids)
      .order('created_at', { ascending: true }))));
    const saleLines = saleLineResults.flat();
    const productIds = unique(saleLines.map((line) => line.product_product_id));
    const productResults = productIds.length
      ? await Promise.all(chunks(productIds).map((ids) => fetchAllPages(() => client
        .from('product_products')
        .select('id, display_name')
        .eq('tenant_id', tenantId)
        .in('id', ids))))
      : [];
    const productsById = byId(productResults.flat());
    const productNamesBySaleId = new Map();

    saleLines.forEach((line) => {
      const name = productsById.get(line.product_product_id)?.display_name || line.description || 'منتج';
      const names = productNamesBySaleId.get(line.sale_id) || [];
      if (!names.includes(name)) names.push(name);
      productNamesBySaleId.set(line.sale_id, names);
    });

    const outstandingInvoices = invoices.map((invoice) => {
      const move = moveBySaleId.get(invoice.id);
      if (!move) return null;

      const totalAmount = Math.round(toMoney(totalsByMoveId.get(move.id)) * 100) / 100;
      const remainingAmount = Math.round(toMoney(remainingByMoveId.get(move.id)) * 100) / 100;
      const paidAmount = Math.max(Math.round((totalAmount - remainingAmount) * 100) / 100, 0);

      return {
        id: invoice.id,
        saleNumber: invoice.sale_number || null,
        saleDate: invoice.sale_date || invoice.created_at || null,
        showroomConfigId: invoice.showroom_config_id || null,
        status: invoice.status,
        customerName: customersById.get(invoice.customer_id)?.name || 'عميل غير محدد',
        productNames: productNamesBySaleId.get(invoice.id) || [],
        totalAmount,
        paidAmount,
        remainingAmount,
      };
    }).filter((invoice) => invoice?.remainingAmount > 0);

    return {
      invoices: outstandingInvoices,
      count: outstandingInvoices.length,
      total: outstandingInvoices.reduce((sum, invoice) => sum + invoice.remainingAmount, 0),
    };
  },

  async listPaymentEntityCustomerCredits({ tenantId, limit = 100 } = {}) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const { data: account, error: accountError } = await client
      .from('account_accounts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('code', '114002')
      .eq('active', true)
      .maybeSingle();

    if (accountError) throw accountError;
    if (!account?.id) return [];

    const { data: lines, error: linesError } = await client
      .from('account_move_lines')
      .select('id, move_id, partner_id, debit, credit, created_at')
      .eq('tenant_id', tenantId)
      .eq('account_id', account.id)
      .ilike('label', 'اعتماد دفعة من جهة%')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (linesError) throw linesError;
    if (!lines?.length) return [];

    const moveIds = unique(lines.map((line) => line.move_id));
    const { data: moves, error: movesError } = await client
      .from('account_moves')
      .select('id, partner_id, amount_total, notes, state, date, created_at')
      .eq('tenant_id', tenantId)
      .in('id', moveIds);

    if (movesError) throw movesError;

    const movesById = byId(moves);
    const partnerIds = unique([
      ...lines.map((line) => line.partner_id),
      ...(moves || []).map((move) => move.partner_id),
    ]);
    const { data: partners, error: partnersError } = partnerIds.length
      ? await client
        .from('partners')
        .select('id, name, display_config')
        .eq('tenant_id', tenantId)
        .in('id', partnerIds)
      : { data: [], error: null };

    if (partnersError) throw partnersError;

    const partnersById = byId(partners);

    return lines.map((line) => {
      const move = movesById.get(line.move_id) || {};
      const customer = partnersById.get(move.partner_id);
      const entity = partnersById.get(line.partner_id);
      const amount = toMoney(line.debit) - toMoney(line.credit);

      return {
        id: line.move_id || line.id,
        entityId: line.partner_id,
        customerId: move.partner_id || null,
        customerName: customer?.name || 'عميل غير محدد',
        entityName: entity?.name || 'جهة غير محددة',
        entityDisplayConfig: entity?.display_config || null,
        amount,
        status: move.state === 'posted' ? 'approved' : 'review',
        dateLabel: formatDateLabel(move.date || move.created_at || line.created_at),
        note: move.notes || 'تم تسجيل القيد المحاسبي.',
      };
    });
  },

  async getPaymentEntityReceivableTotal({ tenantId } = {}) {
    requireTenantId(tenantId);

    const client = requireSupabase();
    const { data: account, error: accountError } = await client
      .from('account_accounts')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('code', '114002')
      .eq('active', true)
      .maybeSingle();

    if (accountError) throw accountError;
    if (!account?.id) return 0;

    const { data: lines, error: linesError } = await client
      .from('account_move_lines')
      .select('debit, credit')
      .eq('tenant_id', tenantId)
      .eq('account_id', account.id)
      .ilike('label', 'اعتماد دفعة من جهة%');

    if (linesError) throw linesError;

    return (lines || []).reduce((total, line) => (
      total + toMoney(line.debit) - toMoney(line.credit)
    ), 0);
  },

  async createPaymentEntityCustomerCredit({
    tenantId,
    branchId,
    customerId,
    paymentEntityId,
    amount,
    note,
    attachmentFile,
    userId,
  } = {}) {
    requireTenantId(tenantId);
    if (!customerId) throw new Error('اختر العميل أولاً.');
    if (!paymentEntityId) throw new Error('اختر الجهة أولاً.');

    const safeAmount = toMoney(amount);
    if (safeAmount <= 0) {
      throw new Error('اكتب مبلغ صحيح أكبر من صفر.');
    }

    assertImage(attachmentFile);

    const client = requireSupabase();
    const createdBy = await resolveCurrentTenantUserId(client, { tenantId, tenantUserId: userId });
    const extension = getFileExtension(attachmentFile);
    const path = `${tenantId}/accountant/payment-entity-credits/${crypto.randomUUID()}.${extension}`;

    const { error: uploadError } = await client.storage.from(TENANT_FILES_BUCKET).upload(path, attachmentFile, {
      cacheControl: '3600',
      contentType: attachmentFile.type || 'image/jpeg',
      upsert: false,
    });

    if (uploadError) {
      throw new Error(uploadError.message || 'تعذر رفع صورة العملية.');
    }

    const payload = {
      tenant_id: tenantId,
      branch_id: branchId || null,
      customer_id: customerId,
      payment_entity_id: paymentEntityId,
      amount: safeAmount,
      notes: String(note || '').trim() || null,
      created_by: createdBy,
      attachment: {
        bucket_name: TENANT_FILES_BUCKET,
        file_path: path,
        document_type: 'accountant_payment_entity_credit',
        original_file_name: attachmentFile.name || null,
        mime_type: attachmentFile.type || null,
        file_size: attachmentFile.size || null,
      },
    };

    const { data, error } = await client.rpc('create_accountant_payment_entity_credit', { payload });

    if (error) {
      await client.storage.from(TENANT_FILES_BUCKET).remove([path]);
      throw new Error(error.message || 'تعذر تسجيل العملية.');
    }

    return data;
  },
};
